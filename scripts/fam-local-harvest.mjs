import { extractTextItems, getDocumentProxy } from "unpdf";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { dirname } from "node:path";
import { __test } from "../workers/results-collector/src/continuous.js";

const ORIGIN = "https://atletismomadrid.com";
const OUTPUT = process.env.FAM_SNAPSHOT_FILE || "data/official-results/fam-live-snapshot.json";
const headers = { "user-agent": "Club Atletas de Fuenlabrada official results collector/3.0", accept: "application/rss+xml,application/pdf,text/xml,*/*", "accept-language": "es-ES,es;q=0.9" };
const normal = (value = "") => String(value).normalize("NFD").replace(/[\u0300-\u036f]/g, "").toUpperCase().replace(/[^A-Z0-9]+/g, " ").replace(/\s+/g, " ").trim();

async function fetchOk(url) {
  const response = await fetch(url, { headers, signal: AbortSignal.timeout(45_000) });
  if (!response.ok) throw new Error(`${response.status} ${url}`);
  return response;
}

const xml = await (await fetchOk(`${ORIGIN}/index.php?format=feed&type=rss`)).text();
const cutoff = new Date(); cutoff.setUTCDate(cutoff.getUTCDate() - 70);
const sources = new Map();
for (const match of xml.matchAll(/https?:[^\s"'<>]+\/images\/stories\/ficheros\/eventos\/[^\s"'<>]+\.pdf(?:\?[^\s"'<>]*)?/gi)) {
  const resultsUrl = match[0].replaceAll("&amp;", "&");
  const filename = decodeURIComponent(new URL(resultsUrl).pathname.split("/").pop() || "");
  const parts = filename.match(/^(\d{4})[._-](\d{2})[._-](\d{2})[_-](.+)\.pdf$/i);
  if (!parts) continue;
  const competitionDate = `${parts[1]}-${parts[2]}-${parts[3]}`;
  if (new Date(`${competitionDate}T00:00:00Z`) < cutoff) continue;
  sources.set(resultsUrl, { resultsUrl, competitionDate, competitionName: parts[4].replaceAll("_", " ").replace(/\s+/g, " ").trim() });
}

const results = [];
for (const source of sources.values()) {
  try {
    const bytes = new Uint8Array(await (await fetchOk(source.resultsUrl)).arrayBuffer());
    if (bytes.byteLength > 20 * 1024 * 1024) continue;
    const pdf = await getDocumentProxy(bytes, { maxImageSize: 16_777_216 });
    if (pdf.numPages > 100) continue;
    const extracted = await extractTextItems(pdf);
    for (const row of __test.famPdfRows(extracted.items)) results.push({
      federation: "FAM", competition_name: source.competitionName, competition_date: source.competitionDate,
      source_url: source.resultsUrl, athlete: row.athlete, birth: row.birth, license: row.license || null,
      club: row.club || null, event_name: row.event_name, style: row.style, sex: row.sex || "",
      mark: row.mark, position: row.position || null
    });
  } catch (error) { console.warn(`No se pudo leer ${source.resultsUrl}: ${error.message}`); }
}

const unique = new Map();
for (const row of results) unique.set([row.source_url, normal(row.event_name), normal(row.athlete), row.birth, row.mark].join("|"), row);
const sorted = [...unique.values()].sort((a, b) => `${a.competition_date}|${a.athlete}`.localeCompare(`${b.competition_date}|${b.athlete}`));
const stable = JSON.stringify(sorted);
let previous = [];
if (existsSync(OUTPUT)) { try { previous = JSON.parse(await readFile(OUTPUT, "utf8")).results || []; } catch { /* replace invalid snapshot */ } }
if (JSON.stringify(previous) === stable) {
  console.log(JSON.stringify({ changed: false, sources: sources.size, results: sorted.length }));
  process.exit(0);
}
await mkdir(dirname(OUTPUT), { recursive: true });
await writeFile(OUTPUT, `${JSON.stringify({ updated_at: new Date().toISOString(), cursor_month: new Date().toISOString().slice(0, 7), results: sorted }, null, 2)}\n`);
console.log(JSON.stringify({ changed: true, sources: sources.size, results: sorted.length, output: OUTPUT }));
