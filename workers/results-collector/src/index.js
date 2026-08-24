const FAM_ORIGIN = "https://www.atletismomadrid.com/";
const USER_AGENT = "Club Atletas de Fuenlabrada official-results collector/1.2";

function cleanHtml(value) {
  return value.replace(/<script[\s\S]*?<\/script>/gi, " ").replace(/<style[\s\S]*?<\/style>/gi, " ").replace(/<[^>]+>/g, " ").replace(/&nbsp;/gi, " ").replace(/&amp;/gi, "&").replace(/\s+/g, " ").trim();
}
function absolute(href) {
  try { return new URL(href.replace(/&amp;/g, "&"), FAM_ORIGIN).toString(); }
  catch { return ""; }
}
function linksIn(html) {
  return [...html.matchAll(/<a[^>]+href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi)]
    .map(link => ({ href: absolute(link[1]), label: cleanHtml(link[2]) }))
    .filter(link => link.href);
}
function resultLinkIn(html) {
  const links = linksIn(html);
  const direct = links.find(link => /\.pdf(?:[?#]|$)/i.test(link.href) && /resul/i.test(link.href + " " + link.label));
  if (direct) return direct.href;
  const labelled = links.find(link => /resul/i.test(link.label));
  return labelled?.href || "";
}
function calendarRows(html, year) {
  const rows = [];
  const rowRegex = /<tr[^>]*>([\s\S]*?)<\/tr>/gi;
  let match;
  while ((match = rowRegex.exec(html))) {
    const rowHtml = match[1];
    const links = linksIn(rowHtml);
    const cells = [...rowHtml.matchAll(/<td[^>]*>([\s\S]*?)<\/td>/gi)].map(cell => cleanHtml(cell[1])).filter(Boolean);
    const dateCell = cells.find(cell => /\b\d{1,2}(?:y\d{1,2})?\.\d{2}\b/.test(cell));
    if (!dateCell) continue;
    const parts = dateCell.match(/(\d{1,2})(?:y\d{1,2})?\.(\d{2})/);
    if (!parts) continue;
    const competitionLink = links.find(link =>
      /atletismomadrid\.com/i.test(link.href) &&
      !/^(regl|insc|resul|jurado)$/i.test(link.label)
    );
    const competition = competitionLink?.label || cells.find(cell =>
      cell !== dateCell && cell.length > 4 && !/^(regl|insc|resul|AL|PC|C|R|M|O|TR)/i.test(cell)
    );
    if (!competition) continue;
    const directResult = resultLinkIn(rowHtml);
    rows.push({
      federation: "FAM",
      competition_name: competition,
      competition_date: year + "-" + parts[2].padStart(2, "0") + "-" + parts[1].padStart(2, "0"),
      event_url: competitionLink?.href || "",
      results_url: directResult,
      status: "waiting_results",
      last_checked_at: new Date().toISOString()
    });
  }
  return rows;
}
async function mapWithLimit(items, limit, mapper) {
  const output = new Array(items.length);
  let next = 0;
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (next < items.length) {
      const index = next++;
      output[index] = await mapper(items[index]);
    }
  }));
  return output;
}
async function resolveResultUrl(row) {
  if (row.results_url) return row.results_url;
  if (!row.event_url) return "";
  const response = await fetch(row.event_url, {
    headers: { "user-agent": USER_AGENT, accept: "text/html,application/xhtml+xml" }
  });
  if (!response.ok) return "";
  return resultLinkIn(await response.text());
}
function monthsForBackfill(current) {
  const months = [];
  for (const year of [2024, 2025, current.getUTCFullYear()]) {
    const lastMonth = year === current.getUTCFullYear() ? current.getUTCMonth() : 11;
    for (let month = 0; month <= lastMonth; month += 1) months.push(new Date(Date.UTC(year, month, 1)));
  }
  return months;
}
function serviceRoleKey(env) {
  return env.SUPABASE_SERVICE_ROLE_KEY || env.SUPABASE_SERVICE_ROLE_KE || "";
}
function serviceHeaders(env) {
  const key = serviceRoleKey(env);
  return { apikey: key, authorization: "Bearer " + key, "content-type": "application/json" };
}
async function supabase(env, path, init = {}) {
  const response = await fetch(env.SUPABASE_URL + "/rest/v1/" + path, {
    ...init,
    headers: { ...serviceHeaders(env), ...(init.headers || {}) }
  });
  const data = await response.json().catch(() => null);
  if (!response.ok) throw new Error(typeof data?.message === "string" ? data.message : "Supabase respondió " + response.status);
  return data;
}
async function scanFamMonth(env, date) {
  const year = date.getUTCFullYear(), month = date.getUTCMonth() + 1;
  const calendarUrl = "https://www.atletismomadrid.com/index.php?Itemid=111&ano=" + year + "&id=3292&mes=" + String(month).padStart(2, "0") + "&option=com_content&view=article";
  const response = await fetch(calendarUrl, {
    headers: { "user-agent": USER_AGENT, accept: "text/html,application/xhtml+xml" }
  });
  if (!response.ok) throw new Error("FAM respondió " + response.status + " en " + year + "-" + String(month).padStart(2, "0"));
  const events = calendarRows(await response.text(), year);
  const resolved = await mapWithLimit(events, 5, async row => ({
    ...row,
    results_url: await resolveResultUrl(row)
  }));
  const rows = resolved.filter(row => row.results_url).map(({ event_url, ...row }) => ({
    ...row, calendar_url: calendarUrl
  }));
  if (rows.length) await supabase(env, "federation_import_sources?on_conflict=federation,competition_name,competition_date", {
    method: "POST",
    headers: { Prefer: "resolution=merge-duplicates,return=minimal" },
    body: JSON.stringify(rows)
  });
  return {
    month: year + "-" + String(month).padStart(2, "0"),
    competitions_checked: events.length,
    found: rows.length
  };
}
async function runCollector(env) {
  if (!env.SUPABASE_URL) throw new Error("Falta SUPABASE_URL.");
  if (!serviceRoleKey(env)) throw new Error("Falta la clave de servicio de Supabase.");
  const current = new Date(Date.UTC(new Date().getUTCFullYear(), new Date().getUTCMonth(), 1));
  const months = monthsForBackfill(current);
  const summary = [];
  // Un mes por turno: evita superar el límite de consultas mientras se construye el histórico.
  for (const month of months) {
    try { summary.push(await scanFamMonth(env, month)); }
    catch (error) {
      summary.push({
        month: month.toISOString().slice(0, 7),
        error: error instanceof Error ? error.message : "Error desconocido"
      });
    }
  }
  const errors = summary.filter(item => item.error).map(item => item.month + ": " + item.error).join(" | ");
  console.log(JSON.stringify({ event: "fam_results_source_scan", scope: "2024-2026", summary, errors: errors || null }));
  return { scope: "2024-2026", summary, errors: errors || null };
}
export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const token = url.searchParams.get("token");
    if (token) {
      if (!env.MANUAL_RUN_TOKEN || token !== env.MANUAL_RUN_TOKEN) {
        return Response.json({ ok: false, error: "No autorizado" }, { status: 401 });
      }
      try {
        const result = await runCollector(env);
        return Response.json({ ok: true, ...result });
      } catch (error) {
        console.error(JSON.stringify({ event: "manual_fam_results_source_scan_failed", message: error instanceof Error ? error.message : "Error desconocido" }));
        return Response.json({ ok: false, error: error instanceof Error ? error.message : "Error desconocido" }, { status: 500 });
      }
    }
    if (url.pathname === "/health") return Response.json({ ok: true, service: "club-atletas-results-collector", schedule: "lunes y jueves a las 05:30 UTC" });
    return Response.json({ ok: true, message: "El colector se ejecuta de forma programada lunes y jueves a las 05:30 UTC." });
  },
  async scheduled(_controller, env, ctx) {
    ctx.waitUntil(runCollector(env).catch(error => console.error(JSON.stringify({ event: "fam_results_source_scan_failed", message: error instanceof Error ? error.message : "Error desconocido" }))));
  }
};