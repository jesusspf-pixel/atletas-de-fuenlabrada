const JSON_HEADERS = { "content-type": "application/json" };
const RUNNING_TYPES = new Set(["run", "trailrun", "virtualrun", "wheelchair"]);
const database = (env, path, init = {}) => fetch(`${env.SUPABASE_URL}${path}`, { ...init, headers: { apikey: env.SUPABASE_SERVICE_ROLE_KEY, authorization: `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`, ...JSON_HEADERS, ...(init.headers || {}) } });
const isoDate = (date) => date.toISOString().slice(0, 10);
const finite = (value, fallback = 0) => { const parsed = Number(value); return Number.isFinite(parsed) ? parsed : fallback; };
async function sha256(value) { const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(JSON.stringify(value))); return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join(""); }
async function readRows(env, path) { const response = await database(env, path); if (!response.ok) throw new Error(`Supabase ${response.status} en ${path.split("?")[0]}`); return response.json(); }

function metricsFor(activities, feedback) {
  const byDay = new Map(), sources = new Set();
  for (const activity of activities) {
    if (!RUNNING_TYPES.has(String(activity.activity_type || "").toLowerCase())) continue;
    const day = String(activity.started_at).slice(0, 10), minutes = finite(activity.moving_time_s) / 60, effort = finite(activity.relative_effort);
    byDay.set(day, (byDay.get(day) || 0) + (effort || minutes)); sources.add(effort ? "strava-effort" : "strava-duration");
  }
  for (const entry of feedback) { const duration = finite(entry.duration_minutes), rpe = finite(entry.rpe); if (!duration || !rpe) continue; byDay.set(String(entry.session_date), duration * rpe); sources.add("rpe"); }
  let fitness = 0, fatigue = 0; const days = [], start = new Date(); start.setUTCHours(12, 0, 0, 0); start.setUTCDate(start.getUTCDate() - 89);
  for (let index = 0; index < 90; index += 1) { const date = new Date(start); date.setUTCDate(start.getUTCDate() + index); const load = byDay.get(isoDate(date)) || 0; fitness += (load - fitness) / 42; fatigue += (load - fatigue) / 7; days.push({ load, fitness, fatigue, form: fitness - fatigue }); }
  const latest = days.at(-1), weekLoad = days.slice(-7).reduce((sum, day) => sum + day.load, 0), previousWeekLoad = days.slice(-14, -7).reduce((sum, day) => sum + day.load, 0);
  const wellness = feedback.filter((entry) => new Date(`${entry.session_date}T12:00:00Z`) >= new Date(Date.now() - 7 * 86_400_000));
  const readiness = wellness.length ? Math.round((wellness.reduce((sum, entry) => sum + finite(entry.sleep_quality, 3) + (6 - finite(entry.fatigue_feeling, 3)) + (6 - finite(entry.muscle_soreness, 3)) + finite(entry.mood, 3), 0) / (wellness.length * 20)) * 100) : null;
  const recentPain = feedback.some((entry) => entry.pain_or_discomfort && new Date(`${entry.session_date}T12:00:00Z`) >= new Date(Date.now() - 14 * 86_400_000));
  return { fitness: finite(latest.fitness), fatigue: finite(latest.fatigue), form: finite(latest.form), weekLoad: Math.max(0, weekLoad), previousWeekLoad: Math.max(0, previousWeekLoad), changePercent: previousWeekLoad ? (weekLoad / previousWeekLoad - 1) * 100 : null, readiness, dataConfidence: sources.has("strava-effort") || sources.has("rpe") ? "medium_high" : "initial", sources: [...sources], recentPain, wellnessEntries: wellness.length, runningActivities: activities.filter((activity) => RUNNING_TYPES.has(String(activity.activity_type || "").toLowerCase())).length };
}

function localInsight(metrics) {
  const actions = [];
  let headline = "Carga equilibrada", summary = "La evolución reciente se mantiene dentro de una relación estable entre forma y fatiga.", confidence = metrics.dataConfidence === "medium_high" ? "alta" : "baja", alert = false;
  if (metrics.recentPain) { headline = "Molestia pendiente de revisar"; summary = "Hay una molestia comunicada recientemente. Conviene compartirla con el entrenador y valorar atención sanitaria si persiste."; actions.push("Comentar la molestia con el entrenador"); alert = true; }
  if (metrics.form < -22) { headline = "Fatiga acumulada elevada"; summary = "La carga reciente está claramente por encima de la carga sostenida. Conviene revisar recuperación y sensaciones con el entrenador."; actions.push("Revisar la recuperación antes de aumentar carga"); alert = true; }
  else if (metrics.form < -10) { headline = "Fatiga acumulada"; summary = "La carga reciente supera la carga sostenida y aconseja vigilar recuperación y sensaciones."; actions.push("Priorizar sueño e hidratación"); }
  else if (metrics.form > 12) { headline = "Estado de frescura alto"; summary = "La carga reciente ha bajado respecto a la carga sostenida y el indicador refleja un estado de frescura alto."; actions.push("Revisar con el entrenador el objetivo de la semana"); }
  if (metrics.changePercent !== null && metrics.changePercent > 50) { actions.push("Revisar el aumento semanal de carga"); alert = true; }
  if (metrics.readiness !== null && metrics.readiness < 45) { actions.push("Comentar las sensaciones de recuperación"); alert = true; }
  if (!metrics.runningActivities && !metrics.wellnessEntries) { headline = "Faltan datos recientes"; summary = "Todavía no hay suficiente actividad de carrera ni sensaciones registradas para valorar la evolución."; actions.push("Sincronizar Strava o registrar el entrenamiento"); confidence = "baja"; alert = false; }
  if (!actions.length) actions.push("Mantener el seguimiento diario");
  return { headline, summary, actions: [...new Set(actions)].slice(0, 3), confidence, alert };
}

async function run(env) {
  if (!env.SUPABASE_URL || !env.SUPABASE_SERVICE_ROLE_KEY) throw new Error("Faltan secretos del servicio de rendimiento");
  const today = isoDate(new Date()), groups = await readRows(env, "/rest/v1/training_groups?active=eq.true&name=ilike.*running*&select=id"), groupIds = groups.map((group) => group.id);
  if (!groupIds.length) return { processed: 0, skipped: 0, reason: "no_running_groups" };
  const athletes = await readRows(env, `/rest/v1/athletes?club_status=eq.active&training_group_id=in.(${groupIds.join(",")})&select=id&order=id`);
  if (!athletes.length) return { processed: 0, skipped: 0, reason: "no_running_athletes" };
  const athleteIds = athletes.map((athlete) => athlete.id), existing = await readRows(env, `/rest/v1/performance_ai_insights?analysis_date=eq.${today}&athlete_id=in.(${athleteIds.join(",")})&select=athlete_id`), completed = new Set(existing.map((row) => row.athlete_id));
  const batchSize = Math.max(1, Math.min(30, finite(env.PERFORMANCE_DAILY_BATCH_SIZE, 15))), pending = athletes.filter((athlete) => !completed.has(athlete.id)).slice(0, batchSize);
  if (!pending.length) return { processed: 0, skipped: athletes.length, reason: "all_current" };
  const pendingIds = pending.map((athlete) => athlete.id), since = new Date(); since.setUTCDate(since.getUTCDate() - 120);
  const [activities, feedback] = await Promise.all([
    readRows(env, `/rest/v1/external_sport_activities?athlete_id=in.(${pendingIds.join(",")})&started_at=gte.${encodeURIComponent(since.toISOString())}&select=athlete_id,started_at,activity_type,moving_time_s,relative_effort`),
    readRows(env, `/rest/v1/athlete_training_feedback?athlete_id=in.(${pendingIds.join(",")})&session_date=gte.${isoDate(since)}&select=athlete_id,session_date,duration_minutes,rpe,sleep_quality,fatigue_feeling,muscle_soreness,mood,pain_or_discomfort`),
  ]);
  let processed = 0, failed = 0;
  for (const athlete of pending) {
    try {
      const metrics = metricsFor(activities.filter((item) => item.athlete_id === athlete.id), feedback.filter((item) => item.athlete_id === athlete.id));
      const saved = await database(env, "/rest/v1/performance_ai_insights?on_conflict=athlete_id,analysis_date", { method: "POST", headers: { Prefer: "resolution=merge-duplicates,return=minimal" }, body: JSON.stringify({ athlete_id: athlete.id, analysis_date: today, input_signature: await sha256(metrics), insight: localInsight(metrics), model: "performance-engine-v1", input_tokens: null, output_tokens: null }) });
      if (!saved.ok) throw new Error(`No se pudo guardar: ${saved.status}`); processed += 1;
    } catch (error) { failed += 1; console.error(JSON.stringify({ event: "performance_daily_athlete_failed", athleteId: athlete.id, message: error instanceof Error ? error.message : "unknown" })); }
  }
  const result = { processed, skipped: athletes.length - pending.length, failed, eligible: athletes.length, date: today }; console.log(JSON.stringify({ event: "performance_daily_complete", ...result })); return result;
}

export default {
  async fetch(request) { if (new URL(request.url).pathname === "/health") return Response.json({ ok: true, service: "club-atletas-performance-daily" }); return new Response("Not found", { status: 404 }); },
  async scheduled(_controller, env, ctx) { ctx.waitUntil(run(env)); },
};
