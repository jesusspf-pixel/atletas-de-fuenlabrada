const json = (body: unknown, status = 200) => Response.json(body, { status });

export async function onRequestPost(context: any) {
  const env = context.env as { SUPABASE_URL?: string; SUPABASE_SERVICE_ROLE_KEY?: string };
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

  await fetch(`${env.SUPABASE_URL}/rest/v1/athlete_integration_tokens?integration_id=eq.${encodeURIComponent(integration.id)}`, { method: "DELETE", headers });
  const response = await fetch(`${env.SUPABASE_URL}/rest/v1/athlete_external_integrations?id=eq.${encodeURIComponent(integration.id)}`, { method: "PATCH", headers: { ...headers, Prefer: "return=minimal" }, body: JSON.stringify({ status: "disconnected", updated_at: new Date().toISOString() }) });
  if (!response.ok) return json({ error: "No se pudo desconectar Strava." }, 502);
  return json({ ok: true });
}
