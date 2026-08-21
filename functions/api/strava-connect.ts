const json = (body: unknown, status = 200) => Response.json(body, { status });

export async function onRequestPost(context: any) {
  const env = context.env as { STRAVA_CLIENT_ID?: string; SUPABASE_URL?: string; SUPABASE_SERVICE_ROLE_KEY?: string };
  if (!env.STRAVA_CLIENT_ID || !env.SUPABASE_URL || !env.SUPABASE_SERVICE_ROLE_KEY) return json({ error: "Strava aún no está configurado por el club." }, 503);
  const bearer = context.request.headers.get("authorization");
  if (!bearer) return json({ error: "Inicia sesión para conectar Strava." }, 401);

  const auth = await fetch(`${env.SUPABASE_URL}/auth/v1/user`, { headers: { apikey: env.SUPABASE_SERVICE_ROLE_KEY, authorization: bearer } });
  const user = await auth.json().catch(() => null) as { id?: string } | null;
  if (!auth.ok || !user?.id) return json({ error: "Sesión no válida." }, 401);

  const { athleteId } = await context.request.json().catch(() => ({})) as { athleteId?: string };
  if (!athleteId) return json({ error: "Falta el atleta." }, 400);

  const headers = { apikey: env.SUPABASE_SERVICE_ROLE_KEY, authorization: `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`, "content-type": "application/json" };
  const athleteResponse = await fetch(`${env.SUPABASE_URL}/rest/v1/athletes?id=eq.${encodeURIComponent(athleteId)}&select=id,user_profile_id`, { headers });
  const [athlete] = await athleteResponse.json().catch(() => []) as { id?: string; user_profile_id?: string | null }[];
  if (!athlete || athlete.user_profile_id !== user.id) return json({ error: "Cada atleta debe conectar su propia cuenta de Strava." }, 403);

  const state = crypto.randomUUID();
  const expiresAt = new Date(Date.now() + 10 * 60 * 1000).toISOString();
  const stateResponse = await fetch(`${env.SUPABASE_URL}/rest/v1/external_oauth_states`, { method: "POST", headers: { ...headers, Prefer: "return=minimal" }, body: JSON.stringify({ state, provider: "strava", athlete_id: athleteId, profile_id: user.id, expires_at: expiresAt }) });
  if (!stateResponse.ok) return json({ error: "No se pudo iniciar la conexión con Strava." }, 502);

  const origin = new URL(context.request.url).origin;
  const params = new URLSearchParams({
    client_id: env.STRAVA_CLIENT_ID,
    redirect_uri: `${origin}/api/strava-callback`,
    response_type: "code",
    approval_prompt: "auto",
    scope: "activity:read",
    state,
  });
  return json({ url: `https://www.strava.com/oauth/authorize?${params.toString()}` });
}
