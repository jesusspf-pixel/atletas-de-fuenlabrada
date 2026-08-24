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
function monthsForBackfill(current) {
  const months = [];
  for (const year of [2024, 2025, current.getUTCFullYear()]) {
    const lastMonth = year === current.getUTCFullYear() ? current.getUTCMonth() : 11;
    for (let month = 0; month <= lastMonth; month += 1) months.push(new Date(Date.UTC(year, month, 1)));
  }
  return months;
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
  const settings = await supabase(env, "federation_import_settings?id=eq.true&select=id");
  if (!settings?.[0]) throw new Error("No existe la configuración de importación federativa.");

  const current = new Date(Date.UTC(new Date().getUTCFullYear(), new Date().getUTCMonth(), 1));
  const months = monthsForBackfill(current);
  const summary = [];
  for (let index = 0; index < months.length; index += 4) {
    const batch = await Promise.all(months.slice(index, index + 4).map(async month => {
      try { return await scanFamMonth(env, month); }
      catch (error) { return { month: month.toISOString().slice(0, 7), error: error instanceof Error ? error.message : "Error desconocido" }; }
    }));
    summary.push(...batch);
  }
  const errors = summary.filter(item => item.error).map(item => item.month + ": " + item.error).join(" | ");
  await supabase(env, "federation_import_settings?id=eq.true", {
    method: "PATCH", headers: { Prefer: "return=minimal" },
    body: JSON.stringify({
      fam_last_scan_at: new Date().toISOString(),
      import_job_last_error: errors || null
    })
  });
  console.log(JSON.stringify({ event: "fam_calendar_scan", scope: "2024-2026", summary }));
  return { scope: "2024-2026", summary };
}
export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (url.pathname === "/health") return Response.json({ ok: true, service: "club-atletas-results-collector", schedule: "lunes y jueves a las 05:30 UTC" });
    if (url.pathname === "/run-now" || url.pathname === "/run_now" || url.pathname === "/run-now/") {
      const token = url.searchParams.get("token");
      if (!env.MANUAL_RUN_TOKEN || !token || token !== env.MANUAL_RUN_TOKEN) {
        return Response.json({ ok: false, error: "No autorizado" }, { status: 401 });
      }
      try {
        const result = await runCollector(env);
        return Response.json({ ok: true, ...result });
      } catch (error) {
        console.error(JSON.stringify({ event: "manual_fam_calendar_scan_failed", message: error instanceof Error ? error.message : "Error desconocido" }));
        return Response.json({ ok: false, error: error instanceof Error ? error.message : "Error desconocido" }, { status: 500 });
      }
    }
    return Response.json({ ok: true, message: "El colector se ejecuta de forma programada lunes y jueves a las 05:30 UTC." });
  },
  async scheduled(_controller, env, ctx) {
    ctx.waitUntil(runCollector(env).catch(error => console.error(JSON.stringify({ event: "fam_calendar_scan_failed", message: error instanceof Error ? error.message : "Error desconocido" }))));
  }
};
