const json = (body: unknown, status = 200) => Response.json(body, { status });

async function refreshAccess(env: any, integrationId: string, token: any, headers: Record<string,string>) {
  if (Number(token.expires_at) > Math.floor(Date.now() / 1000) + 120) return token.access_token as string;
  const form = new URLSearchParams({ client_id: env.STRAVA_CLIENT_ID, client_secret: env.STRAVA_CLIENT_SECRET, grant_type: "refresh_token", refresh_token: token.refresh_token });
  const response = await fetch("https://www.strava.com/oauth/token", { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" }, body: form });
  const next = await response.json().catch(() => null) as any;
  if (!response.ok || !next?.access_token) throw new Error("No se pudo renovar el token de Strava.");
  await fetch(`${env.SUPABASE_URL}/rest/v1/athlete_integration_tokens?integration_id=eq.${encodeURIComponent(integrationId)}`, { method: "PATCH", headers: { ...headers, Prefer: "return=minimal" }, body: JSON.stringify({ access_token: next.access_token, refresh_token: next.refresh_token, expires_at: next.expires_at, updated_at: new Date().toISOString() }) });
  return next.access_token as string;
}

async function processEvent(env: any, event: any) {
  if (!env.SUPABASE_URL || !env.SUPABASE_SERVICE_ROLE_KEY || !env.STRAVA_CLIENT_ID || !env.STRAVA_CLIENT_SECRET) return;
  const headers = { apikey: env.SUPABASE_SERVICE_ROLE_KEY, authorization: `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`, "content-type": "application/json" };
  const integrationResponse = await fetch(`${env.SUPABASE_URL}/rest/v1/athlete_external_integrations?provider=eq.strava&provider_athlete_id=eq.${encodeURIComponent(String(event.owner_id))}&select=id,athlete_id`, { headers });
  const [integration] = await integrationResponse.json().catch(() => []) as any[];
  if (!integration?.id) return;

  if (event.object_type === "athlete" && event.updates?.authorized === "false") {
    await fetch(`${env.SUPABASE_URL}/rest/v1/athlete_external_integrations?id=eq.${encodeURIComponent(integration.id)}`, { method: "PATCH", headers: { ...headers, Prefer: "return=minimal" }, body: JSON.stringify({ status: "revoked", updated_at: new Date().toISOString() }) });
    return;
  }
  if (event.object_type !== "activity") return;
  if (event.aspect_type === "delete") {
    await fetch(`${env.SUPABASE_URL}/rest/v1/external_sport_activities?provider=eq.strava&provider_activity_id=eq.${encodeURIComponent(String(event.object_id))}`, { method: "DELETE", headers });
    return;
  }

  const tokenResponse = await fetch(`${env.SUPABASE_URL}/rest/v1/athlete_integration_tokens?integration_id=eq.${encodeURIComponent(integration.id)}&select=access_token,refresh_token,expires_at`, { headers });
  const [token] = await tokenResponse.json().catch(() => []) as any[];
  if (!token) return;
  const accessToken = await refreshAccess(env, integration.id, token, headers);
  const response = await fetch(`https://api-v3.strava.com/activities/${encodeURIComponent(String(event.object_id))}`, { headers: { authorization: `Bearer ${accessToken}` } });
  const item = await response.json().catch(() => null) as any;
  if (!response.ok || !item?.id) return;
  const row = {
    integration_id: integration.id,
    athlete_id: integration.athlete_id,
    provider: "strava",
    provider_activity_id: String(item.id),
    activity_type: item.sport_type || item.type || null,
    name: item.name || null,
    started_at: item.start_date || new Date().toISOString(),
    distance_m: item.distance ?? null,
    moving_time_s: item.moving_time ?? null,
    elapsed_time_s: item.elapsed_time ?? null,
    elevation_gain_m: item.total_elevation_gain ?? null,
    average_speed_mps: item.average_speed ?? null,
    average_heartrate: item.average_heartrate ?? null,
    max_heartrate: item.max_heartrate ?? null,
    relative_effort: item.suffer_score ?? null,
    average_cadence: item.average_cadence ?? null,
    max_speed_mps: item.max_speed ?? null,
    calories: item.calories ?? null,
    source_url: `https://www.strava.com/activities/${item.id}`,
    updated_at: new Date().toISOString(),
  };
  await fetch(`${env.SUPABASE_URL}/rest/v1/external_sport_activities?on_conflict=provider,provider_activity_id`, { method: "POST", headers: { ...headers, Prefer: "resolution=merge-duplicates,return=minimal" }, body: JSON.stringify(row) });
  await fetch(`${env.SUPABASE_URL}/rest/v1/athlete_external_integrations?id=eq.${encodeURIComponent(integration.id)}`, { method: "PATCH", headers: { ...headers, Prefer: "return=minimal" }, body: JSON.stringify({ last_synced_at: new Date().toISOString(), updated_at: new Date().toISOString() }) });
}

export async function onRequestGet(context: any) {
  const env = context.env as { STRAVA_VERIFY_TOKEN?: string };
  const url = new URL(context.request.url);
  const mode = url.searchParams.get("hub.mode");
  const token = url.searchParams.get("hub.verify_token");
  const challenge = url.searchParams.get("hub.challenge");
  if (mode !== "subscribe" || !challenge || !env.STRAVA_VERIFY_TOKEN || token !== env.STRAVA_VERIFY_TOKEN) return json({ error: "Verificación no válida." }, 403);
  return json({ "hub.challenge": challenge });
}

export async function onRequestPost(context: any) {
  const env = context.env as { STRAVA_CLIENT_ID?: string; STRAVA_CLIENT_SECRET?: string; STRAVA_VERIFY_TOKEN?: string; SUPABASE_URL?: string; SUPABASE_SERVICE_ROLE_KEY?: string };
  const event = await context.request.json().catch(() => null);
  if (!event) return json({ received: false }, 400);
  if (context.waitUntil) context.waitUntil(processEvent(env, event)); else void processEvent(env, event);
  return json({ received: true });
}
