const json = (body: unknown, status = 200) => Response.json(body, { status });

async function validToken(env: any, integrationId: string, tokenRow: { access_token: string; refresh_token: string; expires_at: number }, headers: Record<string,string>) {
  if (tokenRow.expires_at > Math.floor(Date.now() / 1000) + 120) return tokenRow.access_token;
  const form = new URLSearchParams({ client_id: env.STRAVA_CLIENT_ID, client_secret: env.STRAVA_CLIENT_SECRET, grant_type: "refresh_token", refresh_token: tokenRow.refresh_token });
  const response = await fetch("https://www.strava.com/oauth/token", { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" }, body: form });
  const refreshed = await response.json().catch(() => null) as { access_token?: string; refresh_token?: string; expires_at?: number } | null;
  if (!response.ok || !refreshed?.access_token || !refreshed.refresh_token || !refreshed.expires_at) throw new Error("No se pudo renovar el acceso a Strava.");
  await fetch(`${env.SUPABASE_URL}/rest/v1/athlete_integration_tokens?integration_id=eq.${encodeURIComponent(integrationId)}`, { method: "PATCH", headers: { ...headers, Prefer: "return=minimal" }, body: JSON.stringify({ access_token: refreshed.access_token, refresh_token: refreshed.refresh_token, expires_at: refreshed.expires_at, updated_at: new Date().toISOString() }) });
  return refreshed.access_token;
}

export async function onRequestPost(context: any) {
  const env = context.env as { STRAVA_CLIENT_ID?: string; STRAVA_CLIENT_SECRET?: string; SUPABASE_URL?: string; SUPABASE_SERVICE_ROLE_KEY?: string };
  if (!env.STRAVA_CLIENT_ID || !env.STRAVA_CLIENT_SECRET || !env.SUPABASE_URL || !env.SUPABASE_SERVICE_ROLE_KEY) return json({ error: "Strava aún no está configurado por el club." }, 503);
  const bearer = context.request.headers.get("authorization");
  if (!bearer) return json({ error: "Inicia sesión." }, 401);
  const auth = await fetch(`${env.SUPABASE_URL}/auth/v1/user`, { headers: { apikey: env.SUPABASE_SERVICE_ROLE_KEY, authorization: bearer } });
  const user = await auth.json().catch(() => null) as { id?: string } | null;
  if (!auth.ok || !user?.id) return json({ error: "Sesión no válida." }, 401);
  const { athleteId } = await context.request.json().catch(() => ({})) as { athleteId?: string };
  if (!athleteId) return json({ error: "Falta el atleta." }, 400);

  const headers = { apikey: env.SUPABASE_SERVICE_ROLE_KEY, authorization: `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`, "content-type": "application/json" };
  const athleteResponse = await fetch(`${env.SUPABASE_URL}/rest/v1/athletes?id=eq.${encodeURIComponent(athleteId)}&select=id,user_profile_id`, { headers });
  const [athlete] = await athleteResponse.json().catch(() => []) as { user_profile_id?: string | null }[];
  if (!athlete || athlete.user_profile_id !== user.id) return json({ error: "Solo el propio atleta puede sincronizar su Strava." }, 403);

  const integrationResponse = await fetch(`${env.SUPABASE_URL}/rest/v1/athlete_external_integrations?athlete_id=eq.${encodeURIComponent(athleteId)}&provider=eq.strava&status=eq.connected&select=id`, { headers });
  const [integration] = await integrationResponse.json().catch(() => []) as { id?: string }[];
  if (!integration?.id) return json({ error: "Este atleta no tiene Strava conectado." }, 404);
  const tokensResponse = await fetch(`${env.SUPABASE_URL}/rest/v1/athlete_integration_tokens?integration_id=eq.${encodeURIComponent(integration.id)}&select=access_token,refresh_token,expires_at`, { headers });
  const [tokens] = await tokensResponse.json().catch(() => []) as { access_token?: string; refresh_token?: string; expires_at?: number }[];
  if (!tokens?.access_token || !tokens.refresh_token || !tokens.expires_at) return json({ error: "Faltan credenciales de Strava." }, 409);

  try {
    const accessToken = await validToken(env, integration.id, tokens as { access_token: string; refresh_token: string; expires_at: number }, headers);
    const after = Math.floor((Date.now() - 120 * 24 * 60 * 60 * 1000) / 1000);
    const response = await fetch(`https://api-v3.strava.com/athlete/activities?after=${after}&page=1&per_page=100`, { headers: { authorization: `Bearer ${accessToken}` } });
    const activities = await response.json().catch(() => []) as any[];
    if (!response.ok || !Array.isArray(activities)) return json({ error: "Strava no devolvió las actividades." }, 502);
    const rows = activities.map(item => ({
      integration_id: integration.id,
      athlete_id: athleteId,
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
      calories: item.calories ?? null,
      source_url: item.id ? `https://www.strava.com/activities/${item.id}` : null,
      updated_at: new Date().toISOString(),
    }));
    if (rows.length) {
      const save = await fetch(`${env.SUPABASE_URL}/rest/v1/external_sport_activities?on_conflict=provider,provider_activity_id`, { method: "POST", headers: { ...headers, Prefer: "resolution=merge-duplicates,return=minimal" }, body: JSON.stringify(rows) });
      if (!save.ok) return json({ error: "No se pudieron guardar las actividades de Strava." }, 502);
    }
    await fetch(`${env.SUPABASE_URL}/rest/v1/athlete_external_integrations?id=eq.${encodeURIComponent(integration.id)}`, { method: "PATCH", headers: { ...headers, Prefer: "return=minimal" }, body: JSON.stringify({ last_synced_at: new Date().toISOString(), updated_at: new Date().toISOString() }) });
    return json({ synced: rows.length });
  } catch (error) {
    return json({ error: error instanceof Error ? error.message : "No se pudo sincronizar Strava." }, 502);
  }
}
