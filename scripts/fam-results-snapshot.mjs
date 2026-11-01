import { extractTextItems, getDocumentProxy } from "unpdf";
import dns from "node:dns";
import { readFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { __test } from "../workers/results-collector/src/continuous.js";

dns.setDefaultResultOrder("ipv4first");

const ORIGIN = "https://atletismomadrid.com";
const START = "2024-09";
const WORKER = "https://club-atletas-results-collector.eatletismourjc.workers.dev";
const LOCAL_SNAPSHOT = process.env.FAM_SNAPSHOT_FILE || "data/official-results/fam-live-snapshot.json";
// La automatización obtiene una credencial OIDC temporal; no guarda secretos ni actas en GitHub.

const normal = (value = "") => String(value).normalize("NFD").replace(/[\u0300-\u036f]/g, "").toUpperCase().replace(/[^A-Z0-9]+/g, " ").replace(/\s+/g, " ").trim();
const month = (value) => value.toISOString().slice(0, 7);
const monthDate = (value) => new Date(`${value}-01T00:00:00Z`);
const addMonth = (value, count) => new Date(Date.UTC(value.getUTCFullYear(), value.getUTCMonth() + count, 1));
const calendarUrl = (date) => `${ORIGIN}/index.php?option=com_content&view=article&id=3292&Itemid=111&cal_year=${date.getUTCFullYear()}&cal_month=${date.getUTCMonth() + 1}&cal_type=Todos`;
const headers = { "user-agent": "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 Chrome/140 Safari/537.36", accept: "text/html,application/pdf", "accept-language": "es-ES,es;q=0.9", referer: `${ORIGIN}/` };

async function savedSnapshot() {
  if (!existsSync(LOCAL_SNAPSHOT)) return null;
  const snapshot = JSON.parse(await readFile(LOCAL_SNAPSHOT, "utf8"));
  if (!Array.isArray(snapshot?.results) || !/^\d{4}-\d{2}$/.test(String(snapshot?.cursor_month || ""))) {
    throw new Error("La instantánea local FAM no tiene un formato válido.");
  }
  return snapshot;
}

async function uploadSnapshot(token, snapshot) {
  const response = await fetch(`${WORKER}/fam-snapshot`, {
    method: "POST", headers: { "content-type": "application/json", authorization: `Bearer ${token}` }, body: JSON.stringify(snapshot), signal: AbortSignal.timeout(120_000)
  });
  const body = await response.text();
  if (!response.ok) throw new Error(`La carga FAM falló (${response.status}): ${body.slice(0, 500)}`);
  return JSON.parse(body);
}

async function cursorMonth(token) {
  if (!token) return START;
  const response = await fetch(`${WORKER}/fam-cursor`, { headers: { authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(30_000) });
  if (!response.ok) throw new Error(`No se pudo consultar el cursor FAM (${response.status}): ${(await response.text()).slice(0, 300)}`);
  const payload = await response.json();
  return String(payload.cursor_month || START).slice(0, 7);
}

async function fetchOk(url) {
  const response = await fetch(url, { headers, signal: AbortSignal.timeout(30_000) });
  if (!response.ok) throw new Error(`${response.status} ${url}`);
  return response;
}

async function feedSources(date) {
  const response = await fetchOk(`${ORIGIN}/index.php?format=feed&type=rss`);
  const xml = await response.text();
  const wantedMonth = month(date);
  const urls = [...xml.matchAll(/https?:[^\s"'<>]+\/images\/stories\/ficheros\/eventos\/[^\s"'<>]+\.pdf(?:\?[^\s"'<>]*)?/gi)]
    .map((match) => match[0].replaceAll("&amp;", "&"));
  const sources = new Map();
  for (const resultsUrl of urls) {
    const filename = decodeURIComponent(new URL(resultsUrl).pathname.split("/").pop() || "");
    const dateMatch = filename.match(/^(\d{4})[._-](\d{2})[._-](\d{2})[_-](.+)\.pdf$/i);
    if (!dateMatch) continue;
    const competitionDate = `${dateMatch[1]}-${dateMatch[2]}-${dateMatch[3]}`;
    if (!competitionDate.startsWith(wantedMonth)) continue;
    const competitionName = dateMatch[4].replaceAll("_", " ").replace(/\s+/g, " ").trim();
    sources.set(resultsUrl, {
      federation: "FAM",
      competition_name: competitionName,
      competition_date: competitionDate,
      calendar_url: `${ORIGIN}/index.php?format=feed&type=rss`,
      results_url: resultsUrl
    });
  }
  return [...sources.values()];
}

async function scanMonth(date) {
  const url = calendarUrl(date);
  let sources;
  try {
    const html = await (await fetchOk(url)).text();
    sources = __test.famRows(html, date.getUTCFullYear(), url).filter((source) => /\.pdf(?:$|\?)/i.test(source.results_url || ""));
  } catch (calendarError) {
    sources = await feedSources(date);
    if (!sources.length) throw calendarError;
  }
  const results = [];
  for (const source of sources) {
    try {
      const buffer = await (await fetchOk(source.results_url)).arrayBuffer();
      if (buffer.byteLength > 20 * 1024 * 1024) continue;
      const pdf = await getDocumentProxy(new Uint8Array(buffer), { maxImageSize: 16_777_216 });
      if (pdf.numPages > 100) continue;
      const extracted = await extractTextItems(pdf);
      for (const row of __test.famPdfRows(extracted.items)) results.push({
        federation: "FAM", competition_name: source.competition_name, competition_date: source.competition_date,
        source_url: source.results_url, athlete: row.athlete, birth: row.birth, license: row.license || null,
        club: row.club || null, event_name: row.event_name, style: row.style, sex: row.sex || "",
        mark: row.mark, position: row.position || null
      });
    } catch (error) { console.warn(`No se pudo leer ${source.results_url}: ${error.message}`); }
  }
  return results;
}

const token = process.env.FAM_INGEST_TOKEN || "";
const localSnapshot = await savedSnapshot();
if (token && localSnapshot) {
  const imported = await uploadSnapshot(token, localSnapshot);
  console.log(JSON.stringify({ source: "local_fam_snapshot", total: localSnapshot.results.length, updated_at: localSnapshot.updated_at, imported }));
  process.exit(0);
}
const now = new Date(), current = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
let cursor = monthDate(process.env.FAM_CURSOR_MONTH || await cursorMonth(token)); if (cursor > current || cursor < monthDate(START)) cursor = monthDate(START);
const months = [...new Set([month(cursor), month(addMonth(current, -1)), month(current)])].map(monthDate);
const found = [];
const scanErrors = [];
for (const date of months) {
  try { found.push(...await scanMonth(date)); }
  catch (error) {
    const message = `No se pudo escanear ${month(date)}: ${error.message}`;
    scanErrors.push(message); console.warn(message);
  }
}
if (scanErrors.length === months.length && found.length === 0) {
  console.log(JSON.stringify({
    skipped: true,
    reason: "fam_source_blocked",
    months: months.map(month),
    scan_errors: scanErrors
  }));
  process.exit(0);
}

const key = (row) => [row.source_url, normal(row.event_name), normal(row.athlete), row.birth, row.mark].join("|");
const merged = new Map();
for (const row of found) merged.set(key(row), row);
// Do not skip a historical month when the federation rejected or failed that
// month's scan. The current and previous months are still retried on every run.
const cursorId = month(cursor);
const cursorFailed = scanErrors.some((message) => String(message).includes(cursorId));
const next = cursorFailed ? cursor : cursor < current ? addMonth(cursor, 1) : monthDate(START);
const output = { updated_at: new Date().toISOString(), cursor_month: month(next), results: [...merged.values()].sort((a, b) => `${a.competition_date}|${a.athlete}`.localeCompare(`${b.competition_date}|${b.athlete}`)) };
if (!token) {
  const clubCounts = {};
  for (const row of output.results) if (/FUENLABRADA|URJC/i.test(row.club || "")) clubCounts[row.club] = (clubCounts[row.club] || 0) + 1;
  console.log(JSON.stringify({ dry_run: true, months: months.map(month), found: found.length, total: output.results.length, next: output.cursor_month, club_counts: clubCounts, scan_errors: scanErrors }));
} else {
  const imported = await uploadSnapshot(token, output);
  console.log(JSON.stringify({ months: months.map(month), found: found.length, total: output.results.length, next: output.cursor_month, scan_errors: scanErrors, imported }));
}
