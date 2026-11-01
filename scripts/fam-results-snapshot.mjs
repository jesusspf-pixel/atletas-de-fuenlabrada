import { extractTextItems, getDocumentProxy } from "unpdf";
import { __test } from "../workers/results-collector/src/continuous.js";

const ORIGIN = "https://www.atletismomadrid.com";
const START = "2024-09";
const WORKER = "https://club-atletas-results-collector.eatletismourjc.workers.dev";

const normal = (value = "") => String(value).normalize("NFD").replace(/[\u0300-\u036f]/g, "").toUpperCase().replace(/[^A-Z0-9]+/g, " ").replace(/\s+/g, " ").trim();
const month = (value) => value.toISOString().slice(0, 7);
const monthDate = (value) => new Date(`${value}-01T00:00:00Z`);
const addMonth = (value, count) => new Date(Date.UTC(value.getUTCFullYear(), value.getUTCMonth() + count, 1));
const calendarUrl = (date) => `${ORIGIN}/index.php?option=com_content&view=article&id=3292&Itemid=111&cal_year=${date.getUTCFullYear()}&cal_month=${date.getUTCMonth() + 1}&cal_type=Todos`;
const headers = { "user-agent": "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 Chrome/140 Safari/537.36", accept: "text/html,application/pdf", "accept-language": "es-ES,es;q=0.9", referer: `${ORIGIN}/` };

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

async function scanMonth(date) {
  const url = calendarUrl(date), html = await (await fetchOk(url)).text();
  const sources = __test.famRows(html, date.getUTCFullYear(), url).filter((source) => /\.pdf(?:$|\?)/i.test(source.results_url || ""));
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

const token = process.env.FAM_INGEST_TOKEN || "", now = new Date(), current = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
let cursor = monthDate(process.env.FAM_CURSOR_MONTH || await cursorMonth(token)); if (cursor > current || cursor < monthDate(START)) cursor = monthDate(START);
const months = [...new Set([month(cursor), month(addMonth(current, -1)), month(current)])].map(monthDate);
const found = [];
for (const date of months) {
  try { found.push(...await scanMonth(date)); }
  catch (error) { console.warn(`No se pudo escanear ${month(date)}: ${error.message}`); }
}
const key = (row) => [row.source_url, normal(row.event_name), normal(row.athlete), row.birth, row.mark].join("|");
const merged = new Map();
for (const row of found) merged.set(key(row), row);
const next = cursor < current ? addMonth(cursor, 1) : monthDate(START);
const output = { updated_at: new Date().toISOString(), cursor_month: month(next), results: [...merged.values()].sort((a, b) => `${a.competition_date}|${a.athlete}`.localeCompare(`${b.competition_date}|${b.athlete}`)) };
if (!token) {
  const clubCounts = {};
  for (const row of output.results) if (/FUENLABRADA|URJC/i.test(row.club || "")) clubCounts[row.club] = (clubCounts[row.club] || 0) + 1;
  console.log(JSON.stringify({ dry_run: true, months: months.map(month), found: found.length, total: output.results.length, next: output.cursor_month, club_counts: clubCounts }));
} else {
  const response = await fetch(`${WORKER}/fam-snapshot`, {
    method: "POST", headers: { "content-type": "application/json", authorization: `Bearer ${token}` }, body: JSON.stringify(output), signal: AbortSignal.timeout(120_000)
  });
  const body = await response.text();
  if (!response.ok) throw new Error(`La carga FAM falló (${response.status}): ${body.slice(0, 500)}`);
  console.log(JSON.stringify({ months: months.map(month), found: found.length, total: output.results.length, next: output.cursor_month, imported: JSON.parse(body) }));
}
