const redirect = (origin: string, params: Record<string, string>) => Response.redirect(`${origin}/deportivo?${new URLSearchParams(params).toString()}`, 302);

export async function onRequestGet(context: any) {
  const env = context.env as { STRAVA_CLIENT_ID?: string; STRAVA_CLIENT_SECRET?: string; SUPABASE_URL?: string; SUPABASE_SERVICE_ROLE_KEY?: string };
  const requestUrl = new URL(context.request.url);
  const origin = requestUrl.origin;
  if (!env.STRAVA_CLIENT_ID || !env.STRAVA_CLIENT_SECRET || !env.SUPABASE_URL || !env.SUPABASE_SERVICE_ROLE_KEY) return redirect(origin, { strava: "config_error" });
  const code = requestUrl.searchParams.get("code");
  const state = requestUrl.searchParams.get("state");
  const error = requestUrl.searchParams.get("error");
  if (error || !code || !state) return redirect(origin, { strava: "cancelled" });

  const headers = { apikey: env.SUPABASE_SERVICE_ROLE_KEY, authorization: `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`, "content-type": "application/json" };
  const stateResponse = await fetch(`${env.SUPABASE_URL}/rest/v1/external_oauth_states?state=eq.${encodeURIComponent(state)}&provider=eq.strava&select=state,athlete_id,profile_id,expires_at`, { headers });
  const [savedState] = await stateResponse.json().catch(() => []) as { athlete_id?: string; profile_id?: string; expires_at?: string }[];
  if (!savedState?.athlete_id || !savedState.profile_id || !savedState.expires_at || new Date(savedState.expires_at).getTime() < Date.now()) return redirect(origin, { strava: "invalid_state" });

  const form = new URLSearchParams({ client_id: env.STRAVA_CLIENT_ID, client_secret: env.STRAVA_CLIENT_SECRET, code, grant_type: "authorization_code" });
  const tokenResponse = await fetch("https://www.strava.com/oauth/token", { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" }, body: form });
  const token = await tokenResponse.json().catch(() => null) as { access_token?: string; refresh_token?: string; expires_at?: number; scope?: string; athlete?: { id?: number } } | null;
  if (!tokenResponse.ok || !token?.access_token || !token.refresh_token || !token.expires_at || !token.athlete?.id) return redirect(origin, { strava: "token_error" });

  const integrationResponse = await fetch(`${env.SUPABASE_URL}/rest/v1/athlete_external_integrations?on_conflict=athlete_id,provider`, {
    method: "POST",
    headers: { ...headers, Prefer: "resolution=merge-duplicates,return=representation" },
    body: JSON.stringify({ athlete_id: savedState.athlete_id, provider: "strava", provider_athlete_id: String(token.athlete.id), scopes: (token.scope || "activity:read").split(/[ ,]+/).filter(Boolean), status: "connected", connected_by: savedState.profile_id, connected_at: new Date().toISOString(), updated_at: new Date().toISOString() }),
  });
  const [integration] = await integrationResponse.json().catch(() => []) as { id?: string }[];
  if (!integrationResponse.ok || !integration?.id) return redirect(origin, { strava: "save_error" });

  const tokenSave = await fetch(`${env.SUPABASE_URL}/rest/v1/athlete_integration_tokens?on_conflict=integration_id`, {
    method: "POST",
    headers: { ...headers, Prefer: "resolution=merge-duplicates,return=minimal" },
    body: JSON.stringify({ integration_id: integration.id, access_token: token.access_token, refresh_token: token.refresh_token, expires_at: token.expires_at, updated_at: new Date().toISOString() }),
  });
  await fetch(`${env.SUPABASE_URL}/rest/v1/external_oauth_states?state=eq.${encodeURIComponent(state)}`, { method: "DELETE", headers });
  if (!tokenSave.ok) return redirect(origin, { strava: "save_error" });
  return redirect(origin, { athleteId: savedState.athlete_id, strava: "connected" });
}
