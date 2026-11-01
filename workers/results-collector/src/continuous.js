const FAM_ORIGIN = "https://www.atletismomadrid.com";
const RFEA_ORIGIN = "https://atletismorfea.es";
const RFEA_FEDERATION = "0017Q00000ntHy5QAE";
const USER_AGENT = "Club Atletas de Fuenlabrada official-results collector/3.0";
const BATCH_SIZE = 16;
const SLOT_MS = 5 * 60 * 1000;

const CATEGORIES = [
  [145, "Absoluta", "F", 2], [146, "Absoluta", "M", 1],
  [159, "Sub 23", "F", 2], [160, "Sub 23", "M", 1],
  [157, "Sub 20", "F", 2], [158, "Sub 20", "M", 1],
  [155, "Sub 18", "F", 2], [156, "Sub 18", "M", 1],
  [153, "Sub 16", "F", 2], [154, "Sub 16", "M", 1],
  [151, "Sub 14", "F", 2], [152, "Sub 14", "M", 1],
  [149, "Sub 12", "F", 2], [150, "Sub 12", "M", 1],
  [147, "Sub 10", "F", 2], [148, "Sub 10", "M", 1],
  [161, "Sub 8", "F", 2], [162, "Sub 8", "M", 1]
];
// El ranking absoluto de la RFEA ya contiene las marcas de todas las edades.
// Consultarlo por sexo y modalidad evita repetir la misma marca en 18 categorías
// y permite completar un ciclo entero en unos 40 minutos.
const CONFIGS = ["AL", "PC", "RT", "MA"].flatMap((style) => [
  { style, category: 145, label: "Absoluta", sex: "F", gender: 2 },
  { style, category: 146, label: "Absoluta", sex: "M", gender: 1 }
]);
const ACCEPTED_CLUBS = [
  "ATLETISMO URJC FUENLABRADA", "ATLETAS DE FUENLABRADA", "CDB ATLETAS DE FUENLABRADA",
  "CLUB ATLETAS DE FUENLABRADA", "CLUB DEPORTIVO BASICO ATLETAS DE FUENLABRADA"
];
const REJECTED_CLUBS = ["AT. FUENLABRADA", "CLUB ATLETISMO FUENLABRADA", "CLUB DE ATLETISMO FUENLABRADA"];

function json(payload, status = 200) {
  return new Response(JSON.stringify(payload), { status, headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" } });
}

function decode(value = "") {
  return String(value).replace(/&nbsp;|&#160;/gi, " ").replace(/&amp;/gi, "&").replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'").replace(/&lt;/gi, "<").replace(/&gt;/gi, ">").replace(/&#(\d+);/g, (_m, n) => String.fromCodePoint(Number(n)));
}

function text(value = "") {
  return decode(value).replace(/<script[\s\S]*?<\/script>/gi, " ").replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
}

function normal(value = "") {
  return String(value).normalize("NFD").replace(/[\u0300-\u036f]/g, "").toUpperCase()
    .replace(/[^A-Z0-9]+/g, " ").replace(/\s+/g, " ").trim();
}

function serviceKey(env) { return env.SUPABASE_SERVICE_ROLE_KEY || env.SUPABASE_SERVICE_ROLE_KE || ""; }

async function db(env, path, init = {}) {
  const key = serviceKey(env);
  const base = String(env.SUPABASE_URL || "").replace(/\/$/, "").replace(/\/rest\/v1$/, "");
  if (!base || !key) throw new Error("Faltan los secretos de Supabase.");
  const headers = new Headers(init.headers || {});
  headers.set("apikey", key); headers.set("authorization", `Bearer ${key}`); headers.set("content-type", "application/json");
  const response = await fetch(`${base}/rest/v1/${path}`, { ...init, headers });
  const body = await response.text();
  if (!response.ok) throw new Error(`Supabase ${response.status}: ${body.slice(0, 700)}`);
  return body ? JSON.parse(body) : null;
}

function monthStart(value) {
  const date = value instanceof Date ? value : new Date(value);
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), 1));
}
function addMonth(value, count) { const d = monthStart(value); return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + count, 1)); }
function monthId(value) { return value.toISOString().slice(0, 7); }
function famUrl(date) {
  return `${FAM_ORIGIN}/index.php?option=com_content&view=article&id=3292&Itemid=111&cal_year=${date.getUTCFullYear()}&cal_month=${date.getUTCMonth() + 1}&cal_type=Todos`;
}
function absolute(href) { try { return new URL(decode(href), FAM_ORIGIN).toString(); } catch { return ""; } }

function parseDate(value, fallbackYear) {
  const match = text(value).match(/(\d{1,2})[./-](\d{1,2})(?:[./-](\d{2,4}))?/);
  if (!match) return null;
  const year = match[3] ? (Number(match[3]) < 100 ? 2000 + Number(match[3]) : Number(match[3])) : fallbackYear;
  return `${year}-${String(match[2]).padStart(2, "0")}-${String(match[1]).padStart(2, "0")}`;
}

function famRows(html, year, calendarUrl) {
  const rows = [];
  for (const row of html.matchAll(/<tr[^>]*class=["'][^"']*fam-calendar-row[^"']*["'][^>]*>([\s\S]*?)<\/tr>/gi)) {
    const content = row[1];
    const date = content.match(/fam-calendar-table__date[^>]*>([\s\S]*?)<\/td>/i)?.[1];
    const title = content.match(/fam-calendar-title[^>]*>([\s\S]*?)<\/a>/i)?.[1];
    const result = content.match(/fam-calendar-link--results[^>]*href=["']([^"']+)["']/i)
      || content.match(/href=["']([^"']+)["'][^>]*title=["']Resultados?["']/i);
    const competitionDate = parseDate(date, year), competitionName = text(title);
    if (!competitionDate || !competitionName) continue;
    rows.push({ federation: "FAM", competition_name: competitionName, competition_date: competitionDate,
      calendar_url: calendarUrl, results_url: result ? absolute(result[1]) : null,
      status: result ? "waiting_results" : "pending", last_checked_at: new Date().toISOString(), error_message: null });
  }
  return rows;
}

async function scanFam(env, date) {
  const url = famUrl(date);
  const response = await fetch(url, { headers: { "user-agent": USER_AGENT, accept: "text/html" } });
  if (!response.ok) throw new Error(`FAM respondió ${response.status} en ${monthId(date)}.`);
  const rows = famRows(await response.text(), date.getUTCFullYear(), url);
  if (rows.length) await db(env, "federation_import_sources?on_conflict=federation,competition_name,competition_date", {
    method: "POST", headers: { Prefer: "resolution=merge-duplicates,return=minimal" }, body: JSON.stringify(rows)
  });
  return { month: monthId(date), competitions: rows.length, with_results: rows.filter((row) => row.results_url).length };
}

function options(html, name) {
  const select = html.match(new RegExp(`<select[^>]*name=["']${name}["'][^>]*>([\\s\\S]*?)<\\/select>`, "i"));
  if (!select) return [];
  return [...select[1].matchAll(/<option[^>]*value=["']([^"']*)["'][^>]*>([\s\S]*?)<\/option>/gi)]
    .map((match) => ({ value: decode(match[1]), label: text(match[2]) }));
}

async function clubIds(settings) {
  const response = await fetch(`${RFEA_ORIGIN}/federaciones/ranking/mad`, { headers: { "user-agent": USER_AGENT, accept: "text/html" } });
  if (!response.ok) throw new Error(`RFEA respondió ${response.status} al localizar el club.`);
  const accepted = [...ACCEPTED_CLUBS, ...(settings.accepted_club_names || [])].map(normal);
  const rejected = [...REJECTED_CLUBS, ...(settings.rejected_club_names || [])].map(normal);
  const found = options(await response.text(), "club").filter((item) => item.value && accepted.includes(normal(item.label)) && !rejected.includes(normal(item.label)));
  if (!found.length) throw new Error("No se encontró el identificador federativo del club en la RFEA.");
  return found;
}

async function athletes(env) {
  const rows = await db(env, "athletes?select=id,federation_license,first_name,last_name,birth_date", { method: "GET" });
  const byName = new Map();
  for (const athlete of rows || []) {
    const key = normal(`${athlete.first_name || ""} ${athlete.last_name || ""}`);
    if (!byName.has(key)) byName.set(key, []);
    byName.get(key).push(athlete);
  }
  return byName;
}

async function eventOptions(config, season) {
  const url = `${RFEA_ORIGIN}/options/ranking/fed/${RFEA_FEDERATION}/${season}/${config.style}/${config.category}/0/${config.gender}/0`;
  const response = await fetch(url, { headers: { "user-agent": USER_AGENT, accept: "application/json" } });
  if (!response.ok) throw new Error(`RFEA respondió ${response.status} al consultar pruebas.`);
  const data = await response.json();
  return (data.event || []).filter((event) => event.key && String(event.key).includes("::")).map((event) => {
    const [id, short] = String(event.key).split("::"); return { id, short: short || "0", name: text(event.value) };
  });
}

function rankingUrl(season, config, event, club) {
  return `${RFEA_ORIGIN}/ranking/fed/${season}/${config.category}/0/3/1/1/${event.id}/${RFEA_FEDERATION}/${club.value}/100/1/${event.short}/1/1`;
}

function rankingHtml(payload) {
  const data = JSON.parse(payload); return (Array.isArray(data) ? data.find((item) => typeof item?.data === "string")?.data : "") || "";
}

function rankingRows(html) {
  const rows = [];
  for (const row of html.matchAll(/<tr[^>]*>([\s\S]*?)<\/tr>/gi)) {
    const cells = [...row[1].matchAll(/<td[^>]*>([\s\S]*?)<\/td>/gi)].map((match) => text(match[1]));
    if (cells.length < 11 || !/^\d+$/.test(cells[0])) continue;
    rows.push({ rank: Number(cells[0]), mark: cells[1], wind: cells[2], athlete: cells[3], club: cells[4], birth: cells[5],
      position: cells[8], venue: cells[9], date: cells[10] });
  }
  return rows;
}

function eventInfo(eventName, style) {
  const name = text(eventName).replace(/\s+ST$/i, "").trim();
  const n = normal(name), compact = n.replace(/\s+/g, "");
  let code = compact, discipline = style === "RT" ? "road" : "track", kind = "time", direction = "asc";
  const field = (newCode, resultKind = "distance") => { code = newCode; discipline = "field"; kind = resultKind; direction = "desc"; };
  if (/ALTURA/.test(n)) field("HIGH", "height"); else if (/PERTIGA/.test(n)) field("POLE", "height");
  else if (/LONGITUD/.test(n)) field("LONG"); else if (/TRIPLE/.test(n)) field("TRIPLE");
  else if (/PESO/.test(n)) field(`SHOT${n.match(/(\d+(?:[.,]\d+)?)\s*KG/)?.[1]?.replace(/[.,]/g, "") || ""}`);
  else if (/DISCO/.test(n)) field(`DISCUS${n.match(/(\d+(?:[.,]\d+)?)\s*KG/)?.[1]?.replace(/[.,]/g, "") || ""}`);
  else if (/MARTILLO/.test(n)) field(`HAMMER${n.match(/(\d+(?:[.,]\d+)?)\s*KG/)?.[1]?.replace(/[.,]/g, "") || ""}`);
  else if (/JABALINA/.test(n)) field(`JAVELIN${n.match(/(\d+)\s*G/)?.[1] || ""}`);
  else if (/DECATLON|HEPTATLON|PENTATLON|TRIATLON|COMBINAD/.test(n)) { discipline = "combined"; kind = "points"; direction = "desc"; }
  else if (/MARCHA/.test(n)) discipline = "road";
  return { code: code.slice(0, 80), name, discipline, result_kind: kind, sort_direction: direction, active: true };
}

function markValue(mark, kind) {
  const raw = String(mark || "").replace(/,/g, ".").replace(/[^0-9:.]/g, ""); if (!raw) return null;
  if (kind === "time") { const p = raw.split(":").map(Number); if (p.some(Number.isNaN)) return null; return p.length === 3 ? p[0] * 3600 + p[1] * 60 + p[2] : p.length === 2 ? p[0] * 60 + p[1] : p[0]; }
  const number = Number(raw); return Number.isFinite(number) ? number : null;
}

async function hash(parts) {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(parts.join("|")));
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

async function eventIds(env, events) {
  const unique = [...new Map(events.map((event) => [event.code, event])).values()];
  if (unique.length) await db(env, "athletics_events?on_conflict=code", { method: "POST", headers: { Prefer: "resolution=merge-duplicates,return=minimal" }, body: JSON.stringify(unique) });
  const codes = unique.map((event) => `"${event.code}"`).join(",");
  const rows = codes ? await db(env, `athletics_events?code=in.(${encodeURIComponent(codes)})&select=id,code`, { method: "GET" }) : [];
  return new Map((rows || []).map((row) => [row.code, row.id]));
}

function matchAthlete(byName, row) {
  const candidates = byName.get(normal(row.athlete)) || []; if (candidates.length === 1) return candidates[0];
  const birth = parseDate(row.birth, 2000); return candidates.find((athlete) => athlete.birth_date === birth) || null;
}

function categoryForBirth(birth, season, sex) {
  const parsed = parseDate(birth, season); const year = Number(parsed?.slice(0, 4));
  if (!year) return `Absoluta ${sex}`;
  const age = season - year;
  const category = age <= 7 ? "Sub 8" : age <= 9 ? "Sub 10" : age <= 11 ? "Sub 12" : age <= 13 ? "Sub 14"
    : age <= 15 ? "Sub 16" : age <= 17 ? "Sub 18" : age <= 19 ? "Sub 20" : age <= 22 ? "Sub 23" : "Absoluta";
  return `${category} ${sex}`;
}

async function scanRfea(env, settings, forcedSlot) {
  if (!settings.rfea_enabled) return { enabled: false };
  const season = new Date().getUTCFullYear();
  const slot = Number.isFinite(Number(forcedSlot)) ? Number(forcedSlot) : Math.floor(Date.now() / SLOT_MS);
  const config = CONFIGS[((slot % CONFIGS.length) + CONFIGS.length) % CONFIGS.length];
  const cycle = Math.floor(slot / CONFIGS.length);
  const [clubList, byName, events] = await Promise.all([clubIds(settings), athletes(env), eventOptions(config, season)]);
  const chunks = Math.max(1, Math.ceil(events.length / BATCH_SIZE)), chunk = ((cycle % chunks) + chunks) % chunks;
  const selected = events.slice(chunk * BATCH_SIZE, (chunk + 1) * BATCH_SIZE);
  const infos = selected.map((event) => eventInfo(event.name, config.style)), ids = await eventIds(env, infos);
  const results = [], sources = new Map(); let found = 0, matched = 0;
  for (const event of selected) for (const club of clubList) {
    const url = rankingUrl(season, config, event, club), response = await fetch(url, { headers: { "user-agent": USER_AGENT, accept: "application/json" } });
    if (!response.ok) throw new Error(`RFEA respondió ${response.status} en ${event.name}.`);
    for (const row of rankingRows(rankingHtml(await response.text()))) {
      found += 1; const info = eventInfo(event.name, config.style), id = ids.get(info.code), date = parseDate(row.date, season), value = markValue(row.mark, info.result_kind);
      if (!id || !date || value === null) continue;
      const athlete = matchAthlete(byName, row); if (athlete) matched += 1;
      const competition = `${info.name} · ${row.venue || "RFEA"}`;
      results.push({ athlete_id: athlete?.id || null, external_athlete_name: row.athlete, federation_license: athlete?.federation_license || null,
        athletics_event_id: id, competition_name: competition, competition_date: date, venue: row.venue || null, season: String(season),
        category_label: categoryForBirth(row.birth, season, config.sex), result_text: row.mark, result_value: value,
        result_unit: info.result_kind === "time" ? "s" : info.result_kind === "points" ? "pts" : "m",
        position: /^\d+$/.test(row.position) ? Number(row.position) : null,
        wind: Number.isFinite(Number(String(row.wind).replace(",", "."))) ? Number(String(row.wind).replace(",", ".")) : null,
        official: true, source: "rfea", source_url: url,
        source_external_id: await hash(["rfea", season, config.category, info.code, row.athlete, date, row.mark, row.venue]),
        source_club_name: row.club || club.label, verified: true, imported_at: new Date().toISOString() });
      sources.set(`${competition}|${date}`, { federation: "RFEA", competition_name: competition, competition_date: date,
        calendar_url: `${RFEA_ORIGIN}/federaciones/ranking/mad`, results_url: url, status: "imported",
        last_checked_at: new Date().toISOString(), imported_at: new Date().toISOString(), error_message: null });
    }
  }
  if (sources.size) await db(env, "federation_import_sources?on_conflict=federation,competition_name,competition_date", { method: "POST", headers: { Prefer: "resolution=merge-duplicates,return=minimal" }, body: JSON.stringify([...sources.values()]) });
  if (results.length) await db(env, "athlete_results", { method: "POST", headers: { Prefer: "resolution=ignore-duplicates,return=minimal" }, body: JSON.stringify(results) });
  await db(env, "federation_import_settings?id=eq.true", { method: "PATCH", headers: { Prefer: "return=minimal" }, body: JSON.stringify({ rfea_last_scan_at: new Date().toISOString(), import_job_last_error: null }) });
  return { enabled: true, config: { style: config.style, category: config.label, sex: config.sex, chunk: chunk + 1, chunks }, clubs: clubList.map((club) => club.label), events: selected.length, found, matched, stored: results.length };
}

async function settings(env) { const rows = await db(env, "federation_import_settings?id=eq.true&select=*", { method: "GET" }); if (!rows?.[0]) throw new Error("Falta la configuración federativa."); return rows[0]; }
async function saveError(env, error) { try { await db(env, "federation_import_settings?id=eq.true", { method: "PATCH", headers: { Prefer: "return=minimal" }, body: JSON.stringify({ import_job_last_error: String(error?.message || error).slice(0, 1500) }) }); } catch { /* preserve original error */ } }

async function run(env, slot) {
  const config = await settings(env), now = monthStart(new Date()), from = monthStart(config.history_from || "2024-09-01");
  let cursor = monthStart(config.history_cursor_month || from); if (cursor < from || cursor > now) cursor = from;
  const months = monthId(cursor) === monthId(now) ? [cursor] : [cursor, now], calendar = [];
  if (config.fam_enabled !== false) for (const month of months) calendar.push(await scanFam(env, month));
  const next = cursor < now ? addMonth(cursor, 1) : from;
  await db(env, "federation_import_settings?id=eq.true", { method: "PATCH", headers: { Prefer: "return=minimal" }, body: JSON.stringify({ history_cursor_month: next.toISOString().slice(0, 10), fam_last_scan_at: new Date().toISOString(), import_job_last_error: null }) });
  return { calendar, ranking: await scanRfea(env, config, slot) };
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (url.pathname === "/health") return json({ ok: true, service: "club-atletas-results-collector", mode: "continuous", schedule: "cada 5 minutos", sources: ["Federación de Atletismo de Madrid", "RFEA"] });
    if (!env.MANUAL_RUN_TOKEN || url.searchParams.get("token") !== env.MANUAL_RUN_TOKEN) return json({ ok: false, error: "No autorizado" }, 401);
    try { return json({ ok: true, ...(await run(env, url.searchParams.get("slot"))) }); }
    catch (error) { await saveError(env, error); return json({ ok: false, error: error?.message || "Error desconocido" }, 500); }
  },
  async scheduled(_event, env, ctx) { ctx.waitUntil(run(env).catch(async (error) => { await saveError(env, error); console.error("results collector", error?.message || error); })); }
};

export const __test = { text, normal, parseDate, famRows, options, rankingRows, eventInfo, markValue, matchAthlete, categoryForBirth };
