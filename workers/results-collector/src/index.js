const FAM_ORIGIN = "https://www.atletismomadrid.com/";
const FAM_RANKINGS_PAGE = FAM_ORIGIN + "estadistica/ranking-antiguos";
const USER_AGENT = "Club Atletas de Fuenlabrada official-results collector/1.3";

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
function uniqueSources(rows) {
  const seen = new Set();
  return rows.filter(row => {
    const key = row.federation + "|" + row.competition_name + "|" + row.competition_date;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}
function rankingPdfSources(html) {
  const rows = [];
  const headings = [...html.matchAll(/<h[1-6][^>]*>\s*Ranking de Madrid\s+(20\d{2})[\s\S]*?<\/h[1-6]>([\s\S]{0,2500}?)(?=<h[1-6]|$)/gi)];
  for (const heading of headings) {
    const year = Number(heading[1]);
    const pdf = linksIn(heading[2]).find(link => /\.pdf(?:[?#]|$)/i.test(link.href));
    if (!pdf) continue;
    rows.push({
      federation: "FAM",
      competition_name: "Ranking FAM " + year,
      competition_date: year + "-12-31",
      calendar_url: FAM_RANKINGS_PAGE,
      results_url: pdf.href,
      status: "waiting_results",
      last_checked_at: new Date().toISOString()
    });
  }
  return rows;
}
function officialKnownSources() {
  return [{
    federation: "FAM",
    competition_name: "Ranking FAM 2025",
    competition_date: "2025-12-31",
    calendar_url: FAM_RANKINGS_PAGE,
    results_url: "https://www.atletismomadrid.com/images/stories/ficheros/ranking/RankingFAM2025_v2.pdf",
    status: "waiting_results",
    last_checked_at: new Date().toISOString()
  }];
}
async function discoverFamSources() {
  const response = await fetch(FAM_RANKINGS_PAGE, {
    headers: { "user-agent": USER_AGENT, accept: "text/html,application/xhtml+xml" }
  });
  if (!response.ok) throw new Error("FAM respondió " + response.status + " al consultar su página oficial de rankings.");
  const html = await response.text();
  return uniqueSources([...officialKnownSources(), ...rankingPdfSources(html)]);
}
async function runCollector(env) {
  if (!env.SUPABASE_URL) throw new Error("Falta SUPABASE_URL.");
  if (!serviceRoleKey(env)) throw new Error("Falta la clave de servicio de Supabase.");

  const rows = await discoverFamSources();
  if (rows.length) {
    await supabase(env, "federation_import_sources?on_conflict=federation,competition_name,competition_date", {
      method: "POST",
      headers: { Prefer: "resolution=merge-duplicates,return=minimal" },
      body: JSON.stringify(rows)
    });
  }
  const result = {
    scope: "fuentes oficiales FAM",
    sources_found: rows.length,
    sources: rows.map(row => ({ name: row.competition_name, date: row.competition_date, url: row.results_url })),
    next: "Las fuentes quedan preparadas para extracción y revisión administrativa; no se publica ninguna marca sin identificar atleta, prueba y resultado."
  };
  console.log(JSON.stringify({ event: "fam_official_sources_discovered", ...result }));
  return result;
}
export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const token = url.searchParams.get("token");
    if (token) {
      if (!env.MANUAL_RUN_TOKEN || token !== env.MANUAL_RUN_TOKEN) return Response.json({ ok: false, error: "No autorizado" }, { status: 401 });
      try { return Response.json({ ok: true, ...(await runCollector(env)) }); }
      catch (error) {
        console.error(JSON.stringify({ event: "manual_fam_source_discovery_failed", message: error instanceof Error ? error.message : "Error desconocido" }));
        return Response.json({ ok: false, error: error instanceof Error ? error.message : "Error desconocido" }, { status: 500 });
      }
    }
    if (url.pathname === "/health") return Response.json({ ok: true, service: "club-atletas-results-collector", schedule: "lunes y jueves a las 05:30 UTC" });
    return Response.json({ ok: true, message: "El colector consulta fuentes oficiales FAM lunes y jueves a las 05:30 UTC." });
  },
  async scheduled(_controller, env, ctx) {
    ctx.waitUntil(runCollector(env).catch(error => console.error(JSON.stringify({ event: "fam_source_discovery_failed", message: error instanceof Error ? error.message : "Error desconocido" }))));
  }
};
