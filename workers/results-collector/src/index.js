const FAM_ORIGIN = "https://www.atletismomadrid.com/";
const USER_AGENT = "Club Atletas de Fuenlabrada official-results collector/1.1";

function cleanHtml(value) {
  return value.replace(/<script[\s\S]*?<\/script>/gi, " ").replace(/<style[\s\S]*?<\/style>/gi, " ").replace(/<[^>]+>/g, " ").replace(/&nbsp;/gi, " ").replace(/&amp;/gi, "&").replace(/\s+/g, " ").trim();
}
function absolute(href) { return new URL(href.replace(/&amp;/g, "&"), FAM_ORIGIN).toString(); }
function calendarRows(html, year) {
  const rows = [];
  const rowRegex = /<tr[^>]*>([\s\S]*?)<\/tr>/gi;
  let match;
  while ((match = rowRegex.exec(html))) {
    const rowHtml = match[1];
    const links = [...rowHtml.matchAll(/<a[^>]+href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi)];
    const resultLink = links.find(link => /resul/i.test(cleanHtml(link[2])));
    if (!resultLink) continue;
    const cells = [...rowHtml.matchAll(/<td[^>]*>([\s\S]*?)<\/td>/gi)].map(cell => cleanHtml(cell[1])).filter(Boolean);
    const dateCell = cells.find(cell => /\b\d{1,2}(?:y\d{1,2})?\.\d{2}\b/.test(cell));
    if (!dateCell) continue;
    const parts = dateCell.match(/(\d{1,2})(?:y\d{1,2})?\.(\d{2})/);
    if (!parts) continue;
    const competition = cells.find(cell => cell !== dateCell && cell.length > 4 && !/^(regl|insc|resul|AL|PC|C|R|M|O|TR)/i.test(cell));
    if (!competition) continue;
    rows.push({
      federation: "FAM", competition_name: competition,
      competition_date: year + "-" + parts[2].padStart(2, "0") + "-" + parts[1].padStart(2, "0"),
      calendar_url: "", results_url: absolute(resultLink[1]), status: "waiting_results",
      last_checked_at: new Date().toISOString()
    });
  }
  return rows;
}
function addMonths(month, count) {
  const date = new Date(Date.UTC(month.getUTCFullYear(), month.getUTCMonth() + count, 1));
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), 1));
}
function monthAt(value) {
  const date = value ? new Date(value + "T00:00:00Z") : new Date();
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), 1));
}
function sameOrBefore(left, right) { return left.getTime() <= right.getTime(); }
function stageEnd(stage, current) {
  if (stage === "2026") return current;
  return new Date(Date.UTC(Number(stage), 11, 1));
}
function nextStage(stage) {
  if (stage === "2026") return "2025";
  if (stage === "2025") return "2024";
  return "complete";
}
function serviceHeaders(env) {
  return { apikey: env.SUPABASE_SERVICE_ROLE_KEY, authorization: "Bearer " + env.SUPABASE_SERVICE_ROLE_KEY, "content-type": "application/json" };
}
async function supabase(env, path, init = {}) {
  const response = await fetch(env.SUPABASE_URL + "/rest/v1/" + path, { ...init, headers: { ...serviceHeaders(env), ...(init.headers || {}) } });
  const data = await response.json().catch(() => null);
  if (!response.ok) throw new Error(typeof data?.message === "string" ? data.message : "Supabase respondió " + response.status);
  return data;
}
async function scanFamMonth(env, date) {
  const year = date.getUTCFullYear(), month = date.getUTCMonth() + 1;
  const calendarUrl = "https://www.atletismomadrid.com/index.php?Itemid=111&ano=" + year + "&id=3292&mes=" + String(month).padStart(2, "0") + "&option=com_content&view=article";
  const response = await fetch(calendarUrl, { headers: { "user-agent": USER_AGENT, accept: "text/html,application/xhtml+xml" } });
  if (!response.ok) throw new Error("FAM respondió " + response.status + " en " + year + "-" + String(month).padStart(2, "0"));
  const rows = calendarRows(await response.text(), year).map(row => ({ ...row, calendar_url: calendarUrl }));
  if (rows.length) await supabase(env, "federation_import_sources?on_conflict=federation,competition_name,competition_date", {
    method: "POST", headers: { Prefer: "resolution=merge-duplicates,return=minimal" }, body: JSON.stringify(rows)
  });
  return { month: year + "-" + String(month).padStart(2, "0"), found: rows.length };
}
async function runCollector(env) {
  if (!env.SUPABASE_URL || !env.SUPABASE_SERVICE_ROLE_KEY) throw new Error("Faltan los secretos de Supabase.");
  const settings = await supabase(env, "federation_import_settings?id=eq.true&select=history_cursor_month,history_from,history_backfill_stage");
  const setting = settings?.[0];
  if (!setting) throw new Error("No existe la configuración de importación federativa.");
  const now = new Date(), current = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
  const stage = setting.history_backfill_stage || "2026";
  const collectingHistory = stage !== "complete";
  const end = collectingHistory ? stageEnd(stage, current) : current;
  const cursor = collectingHistory ? monthAt(setting.history_cursor_month || (stage + "-01-01")) : current;
  // Para 2026 se recogen seis meses por ejecución; el histórico posterior, dos.
  const batchSize = stage === "2026" ? 6 : 2;
  const months = collectingHistory
    ? Array.from({ length: batchSize }, (_, index) => addMonths(cursor, index)).filter(month => sameOrBefore(month, end))
    : [current, addMonths(current, -1)];
  const summary = [];
  for (const month of months) {
    try { summary.push(await scanFamMonth(env, month)); }
    catch (error) { summary.push({ month: month.toISOString().slice(0, 7), error: error instanceof Error ? error.message : "Error desconocido" }); }
  }
  let nextCursor = setting.history_cursor_month;
  let nextBackfillStage = stage;
  if (collectingHistory && months.length) {
    const candidate = addMonths(months[months.length - 1], 1);
    if (sameOrBefore(candidate, end)) nextCursor = candidate.toISOString().slice(0, 10);
    else {
      nextBackfillStage = nextStage(stage);
      nextCursor = nextBackfillStage === "complete" ? null : nextBackfillStage + "-01-01";
    }
  }
  const errors = summary.filter(item => item.error).map(item => item.month + ": " + item.error).join(" | ");
  await supabase(env, "federation_import_settings?id=eq.true", {
    method: "PATCH", headers: { Prefer: "return=minimal" },
    body: JSON.stringify({ history_cursor_month: nextCursor, history_backfill_stage: nextBackfillStage, fam_last_scan_at: new Date().toISOString(), import_job_last_error: errors || null })
  });
  console.log(JSON.stringify({ event: "fam_calendar_scan", stage, summary, nextCursor, nextBackfillStage }));
  return { stage, summary, nextCursor, nextBackfillStage };
}
export default {
  async fetch(request) {
    const url = new URL(request.url);
    if (url.pathname === "/health") return Response.json({ ok: true, service: "club-atletas-results-collector", schedule: "lunes y jueves a las 05:30 UTC" });
    return Response.json({ ok: true, message: "El colector se ejecuta de forma programada lunes y jueves a las 05:30 UTC." });
  },
  async scheduled(_controller, env, ctx) {
    ctx.waitUntil(runCollector(env).catch(error => console.error(JSON.stringify({ event: "fam_calendar_scan_failed", message: error instanceof Error ? error.message : "Error desconocido" }))));
  }
};
