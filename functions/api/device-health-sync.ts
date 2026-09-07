const allowedOrigins = new Set(["https://atletasdefuenlabrada.com", "https://www.atletasdefuenlabrada.com", "https://localhost", "capacitor://localhost"]);
const cors = (request: Request) => {
  const origin = request.headers.get("origin") || "";
  return allowedOrigins.has(origin) ? { "access-control-allow-origin": origin, "access-control-allow-headers": "authorization, content-type", "access-control-allow-methods": "POST, OPTIONS", vary: "Origin" } : {};
};

export async function onRequestOptions(context: any) {
  return new Response(null, { status: 204, headers: cors(context.request) });
}

type IncomingActivity = {
  id?: string;
  activityType?: string;
  name?: string;
  startedAt?: string;
  endedAt?: string;
  durationSeconds?: number;
  distanceMetres?: number;
  averageHeartRate?: number | null;
  calories?: number | null;
  sourceName?: string | null;
};

const finite = (value: unknown, min: number, max: number) => {
  const number = Number(value);
  return Number.isFinite(number) && number >= min && number <= max ? number : null;
};

const clean = (value: unknown, max = 160) => String(value ?? "").trim().slice(0, max);

export async function onRequestPost(context: any) {
  const reply = (body: unknown, status = 200) => Response.json(body, { status, headers: { ...cors(context.request), "cache-control": "no-store" } });
  const env = context.env as { SUPABASE_URL?: string; SUPABASE_SERVICE_ROLE_KEY?: string };
  if (!env.SUPABASE_URL || !env.SUPABASE_SERVICE_ROLE_KEY) return reply({ error: "Falta configuración del servidor." }, 503);
  const bearer = context.request.headers.get("authorization");
  if (!bearer) return reply({ error: "Inicia sesión." }, 401);

  const auth = await fetch(`${env.SUPABASE_URL}/auth/v1/user`, { headers: { apikey: env.SUPABASE_SERVICE_ROLE_KEY, authorization: bearer } });
  const user = await auth.json().catch(() => null) as { id?: string } | null;
  if (!auth.ok || !user?.id) return reply({ error: "Sesión no válida." }, 401);

  const payload = await context.request.json().catch(() => null) as { athleteId?: string; activities?: IncomingActivity[] } | null;
  const athleteId = clean(payload?.athleteId, 80);
  if (!athleteId || !Array.isArray(payload?.activities)) return reply({ error: "Solicitud incompleta." }, 400);
  if (payload.activities.length > 100) return reply({ error: "Demasiadas actividades en una sola sincronización." }, 400);

  const headers = { apikey: env.SUPABASE_SERVICE_ROLE_KEY, authorization: `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`, "content-type": "application/json" };
  const athleteResponse = await fetch(`${env.SUPABASE_URL}/rest/v1/athletes?id=eq.${encodeURIComponent(athleteId)}&select=id,user_profile_id`, { headers });
  const [athlete] = await athleteResponse.json().catch(() => []) as { user_profile_id?: string | null }[];
  if (!athlete || athlete.user_profile_id !== user.id) return reply({ error: "Solo el propio atleta puede sincronizar sus datos de salud." }, 403);

  const integrationResponse = await fetch(`${env.SUPABASE_URL}/rest/v1/athlete_external_integrations?on_conflict=athlete_id,provider`, {
    method: "POST",
    headers: { ...headers, Prefer: "resolution=merge-duplicates,return=representation" },
    body: JSON.stringify({ athlete_id: athleteId, provider: "other", provider_display_name: "Salud del dispositivo", provider_athlete_id: user.id, status: "connected", connected_by: user.id, last_synced_at: new Date().toISOString(), updated_at: new Date().toISOString() }),
  });
  const [integration] = await integrationResponse.json().catch(() => []) as { id?: string }[];
  if (!integrationResponse.ok || !integration?.id) return reply({ error: "No se pudo preparar la conexión de salud." }, 502);

  const now = Date.now();
  const rows = payload.activities.flatMap((item) => {
    const id = clean(item.id, 220);
    const started = Date.parse(clean(item.startedAt, 40));
    const ended = Date.parse(clean(item.endedAt, 40));
    const duration = finite(item.durationSeconds, 1, 7 * 86400) ?? (Number.isFinite(ended - started) ? Math.round((ended - started) / 1000) : null);
    if (!id || !Number.isFinite(started) || started > now + 86400000 || started < now - 370 * 86400000 || !duration) return [];
    const distance = finite(item.distanceMetres, 0, 1_000_000);
    const heartRate = finite(item.averageHeartRate, 20, 260);
    const calories = finite(item.calories, 0, 50_000);
    return [{
      integration_id: integration.id,
      athlete_id: athleteId,
      provider: "other",
      provider_activity_id: `health:${user.id}:${id}`,
      activity_type: clean(item.activityType || "run", 60).toLowerCase(),
      name: clean(item.name || "Entrenamiento", 160),
      started_at: new Date(started).toISOString(),
      distance_m: distance,
      moving_time_s: duration,
      elapsed_time_s: duration,
      average_speed_mps: distance && duration ? distance / duration : null,
      average_heartrate: heartRate,
      calories,
      source_url: null,
      updated_at: new Date().toISOString(),
    }];
  });

  if (rows.length) {
    const save = await fetch(`${env.SUPABASE_URL}/rest/v1/external_sport_activities?on_conflict=provider,provider_activity_id`, {
      method: "POST",
      headers: { ...headers, Prefer: "resolution=merge-duplicates,return=minimal" },
      body: JSON.stringify(rows),
    });
    if (!save.ok) return reply({ error: "No se pudieron guardar los entrenamientos del dispositivo." }, 502);
  }

  return reply({ synced: rows.length });
}
