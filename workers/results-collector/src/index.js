const FAM_RANKING_2025 = "https://raw.githubusercontent.com/jesusspf-pixel/atletas-de-fuenlabrada/main/data/official-results/fam-ranking-2025.json";
const USER_AGENT = "Club Atletas de Fuenlabrada official-results collector/2.0";

function serviceRoleKey(env) {
  return env.SUPABASE_SERVICE_ROLE_KEY || env.SUPABASE_SERVICE_ROLE_KE || "";
}

function response(payload, status = 200) {
  return new Response(JSON.stringify(payload), { status, headers: { "content-type": "application/json; charset=utf-8" } });
}

function eventDefinitions() {
  return {
    "50M": ["50 m", "track", "time", "asc"], "60M": ["60 m", "track", "time", "asc"],
    "80M": ["80 m", "track", "time", "asc"], "100M": ["100 m", "track", "time", "asc"],
    "200M": ["200 m", "track", "time", "asc"], "300M": ["300 m", "track", "time", "asc"],
    "400M": ["400 m", "track", "time", "asc"], "500M": ["500 m", "track", "time", "asc"],
    "600M": ["600 m", "track", "time", "asc"], "800M": ["800 m", "track", "time", "asc"],
    "1000M": ["1000 m", "track", "time", "asc"], "3000M": ["3000 m", "track", "time", "asc"],
    "300MH": ["300 m vallas", "track", "time", "asc"], "LONG": ["Longitud", "field", "distance", "desc"],
    "SHOT": ["Peso", "field", "distance", "desc"], "JAVELIN": ["Jabalina", "field", "distance", "desc"]
  };
}

async function supabase(env, path, init = {}) {
  const key = serviceRoleKey(env);
  const base = (env.SUPABASE_URL || "").replace(/\/$/, "");
  if (!base || !key) throw new Error("Faltan los secretos de Supabase.");
  const headers = new Headers(init.headers || {});
  headers.set("apikey", key); headers.set("authorization", `Bearer ${key}`);
  headers.set("content-type", "application/json");
  const res = await fetch(`${base}/rest/v1/${path}`, { ...init, headers });
  const text = await res.text();
  if (!res.ok) throw new Error(`Supabase respondió ${res.status}: ${text.slice(0, 240)}`);
  return text ? JSON.parse(text) : null;
}

async function downloadFam2025() {
  const res = await fetch(FAM_RANKING_2025, { headers: { "user-agent": USER_AGENT } });
  if (!res.ok) throw new Error(`No se pudo descargar el ranking FAM 2025 (${res.status}).`);
  const json = await res.json();
  if (!Array.isArray(json.rows) || !json.rows.length) throw new Error("El archivo FAM no contiene resultados importables.");
  return json;
}

async function ensureEvents(env, codes) {
  const definitions = eventDefinitions();
  const initial = await supabase(env, "athletics_events?select=id,code", { method: "GET" });
  const known = new Map(initial.map((event) => [String(event.code).toUpperCase(), event.id]));
  const missing = [...new Set(codes)].filter((code) => !known.has(code) && definitions[code]);
  if (missing.length) {
    const values = missing.map((code) => {
      const [name, discipline, result_kind, sort_direction] = definitions[code];
      return { code, name, discipline, result_kind, sort_direction, active: true };
    });
    await supabase(env, "athletics_events?on_conflict=code", {
      method: "POST", headers: { Prefer: "resolution=merge-duplicates" }, body: JSON.stringify(values)
    });
    const refreshed = await supabase(env, "athletics_events?select=id,code", { method: "GET" });
    refreshed.forEach((event) => known.set(String(event.code).toUpperCase(), event.id));
  }
  return known;
}

async function currentAthletes(env) {
  const rows = await supabase(env, "athletes?select=id,federation_license,first_name,last_name", { method: "GET" });
  const byLicense = new Map(), byName = new Map();
  for (const athlete of rows) {
    if (athlete.federation_license) byLicense.set(String(athlete.federation_license).trim().toUpperCase(), athlete.id);
    byName.set(`${athlete.first_name || ""} ${athlete.last_name || ""}`.trim().toUpperCase(), athlete.id);
  }
  return { byLicense, byName };
}

async function existingResultIds(env, ids) {
  if (!ids.length) return new Set();
  const quoted = ids.map((id) => `"${String(id).replace(/"/g, "")}"`).join(",");
  const found = await supabase(env, `athlete_results?source=eq.fam&source_external_id=in.(${encodeURIComponent(quoted)})&select=source_external_id`, { method: "GET" });
  return new Set(found.map((row) => row.source_external_id));
}

async function upsertSource(env, file) {
  const source = {
    federation: "FAM", competition_name: file.source.name, competition_date: "2025-12-31",
    calendar_url: "https://www.atletismomadrid.com/estadistica/ranking-antiguos", results_url: file.source.url,
    status: "processing", last_checked_at: new Date().toISOString(), error_message: null
  };
  const rows = await supabase(env, "federation_import_sources?on_conflict=federation,competition_name,competition_date", {
    method: "POST", headers: { Prefer: "resolution=merge-duplicates,return=representation" }, body: JSON.stringify([source])
  });
  if (!rows?.[0]?.id) throw new Error("No se pudo guardar la fuente FAM.");
  return rows[0];
}

async function runCollector(env) {
  const file = await downloadFam2025();
  const source = await upsertSource(env, file);
  const events = await ensureEvents(env, file.rows.map((row) => row.event_code));
  const athletes = await currentAthletes(env);
  const existing = await existingResultIds(env, file.rows.map((row) => row.external_row_id));
  const skippedUnknownEvent = [];
  const rows = [];
  for (const row of file.rows) {
    const eventId = events.get(String(row.event_code).toUpperCase());
    if (!eventId) { skippedUnknownEvent.push(row.event_name); continue; }
    if (existing.has(row.external_row_id)) continue;
    const athleteId = athletes.byLicense.get(String(row.federation_license || "").trim().toUpperCase()) ||
      athletes.byName.get(String(row.athlete_name || "").trim().toUpperCase()) || null;
    rows.push({
      athlete_id: athleteId, external_athlete_name: row.athlete_name, federation_license: row.federation_license,
      athletics_event_id: eventId, competition_name: file.source.name, competition_date: row.competition_date,
      venue: row.venue || null, season: String(row.competition_date).slice(0, 4), category_label: row.category_label,
      result_text: row.result_text, result_value: row.result_value, result_unit: row.result_unit, position: row.position,
      official: true, source: "fam", source_url: file.source.url, source_external_id: row.external_row_id,
      source_club_name: row.club_name, verified: true, imported_at: new Date().toISOString()
    });
  }
  if (rows.length) await supabase(env, "athlete_results", { method: "POST", headers: { Prefer: "return=minimal" }, body: JSON.stringify(rows) });
  await supabase(env, `federation_import_sources?id=eq.${source.id}`, {
    method: "PATCH", headers: { Prefer: "return=minimal" },
    body: JSON.stringify({ status: "imported", imported_at: new Date().toISOString(), last_checked_at: new Date().toISOString(), error_message: null })
  });
  return { federation: "FAM", source: file.source.name, source_rows: file.stats.source_rows,
    imported_now: rows.length, already_present: existing.size, individual_results_available: file.rows.length,
    skipped_unknown_event: [...new Set(skippedUnknownEvent)] };
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (url.pathname === "/health") return response({ ok: true, schedule: "lunes y jueves 05:30 UTC", source: "FAM 2025" });
    if (!env.MANUAL_RUN_TOKEN || url.searchParams.get("token") !== env.MANUAL_RUN_TOKEN) {
      return response({ ok: false, error: "No autorizado" }, 401);
    }
    try { return response({ ok: true, ...(await runCollector(env)) }); }
    catch (error) { return response({ ok: false, error: error.message || "Error desconocido" }, 500); }
  },
  async scheduled(controller, env, ctx) {
    ctx.waitUntil(runCollector(env).catch((error) => console.error("results collector", error)));
  }
};
