const json = (body: unknown, status = 200) => Response.json(body, { status });

export async function onRequestPost(context: any) {
  const env = context.env as { STRAVA_CLIENT_ID?: string; STRAVA_CLIENT_SECRET?: string; SUPABASE_URL?: string; SUPABASE_SERVICE_ROLE_KEY?: string };
  if (!env.SUPABASE_URL || !env.SUPABASE_SERVICE_ROLE_KEY) return json({ error: "La conexión deportiva no está configurada." }, 503);
  const bearer = context.request.headers.get("authorization");
  if (!bearer) return json({ error: "Inicia sesión primero." }, 401);

  const auth = await fetch(`${env.SUPABASE_URL}/auth/v1/user`, { headers: { apikey: env.SUPABASE_SERVICE_ROLE_KEY, authorization: bearer } });
  const user = await auth.json().catch(() => null) as { id?: string } | null;
  if (!auth.ok || !user?.id) return json({ error: "Sesión no válida." }, 401);

  const { athleteId } = await context.request.json().catch(() => ({})) as { athleteId?: string };
  if (!athleteId) return json({ error: "Falta el atleta." }, 400);

  const headers = { apikey: env.SUPABASE_SERVICE_ROLE_KEY, authorization: `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`, "content-type": "application/json" };
  const athleteResponse = await fetch(`${env.SUPABASE_URL}/rest/v1/athletes?id=eq.${encodeURIComponent(athleteId)}&select=id,user_profile_id`, { headers });
  const [athlete] = await athleteResponse.json().catch(() => []) as { id?: string; user_profile_id?: string | null }[];
  if (!athlete || athlete.user_profile_id !== user.id) return json({ error: "Solo el propio atleta puede desconectar su Strava." }, 403);

  const integrationResponse = await fetch(`${env.SUPABASE_URL}/rest/v1/athlete_external_integrations?athlete_id=eq.${encodeURIComponent(athleteId)}&provider=eq.strava&select=id`, { headers });
  const [integration] = await integrationResponse.json().catch(() => []) as { id?: string }[];
  if (!integration?.id) return json({ ok: true });

  // Revoke the authorization in Strava before removing our local tokens. Merely
  // deleting the local row leaves the athlete attached to the Strava app and can
  // continue consuming one of the app's athlete-capacity slots.
  const tokenResponse = await fetch(`${env.SUPABASE_URL}/rest/v1/athlete_integration_tokens?integration_id=eq.${encodeURIComponent(integration.id)}&select=access_token,refresh_token,expires_at`, { headers });
  const [token] = await tokenResponse.json().catch(() => []) as { access_token?: string; refresh_token?: string; expires_at?: number }[];
  let accessToken = token?.access_token || "";
  if (token?.refresh_token && env.STRAVA_CLIENT_ID && env.STRAVA_CLIENT_SECRET && Number(token.expires_at || 0) <= Math.floor(Date.now() / 1000) + 120) {
    const refresh = await fetch("https://www.strava.com/oauth/token", {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ client_id: env.STRAVA_CLIENT_ID, client_secret: env.STRAVA_CLIENT_SECRET, grant_type: "refresh_token", refresh_token: token.refresh_token }),
    });
    const refreshed = await refresh.json().catch(() => null) as { access_token?: string } | null;
    if (refresh.ok && refreshed?.access_token) accessToken = refreshed.access_token;
  }
  if (accessToken) {
    await fetch("https://www.strava.com/oauth/deauthorize", {
      method: "POST",
      headers: { authorization: `Bearer ${accessToken}` },
    }).catch(() => null);
  }

  await fetch(`${env.SUPABASE_URL}/rest/v1/athlete_integration_tokens?integration_id=eq.${encodeURIComponent(integration.id)}`, { method: "DELETE", headers });
  const response = await fetch(`${env.SUPABASE_URL}/rest/v1/athlete_external_integrations?id=eq.${encodeURIComponent(integration.id)}`, { method: "PATCH", headers: { ...headers, Prefer: "return=minimal" }, body: JSON.stringify({ status: "disconnected", updated_at: new Date().toISOString() }) });
  if (!response.ok) return json({ error: "No se pudo desconectar Strava." }, 502);
  return json({ ok: true });
}
