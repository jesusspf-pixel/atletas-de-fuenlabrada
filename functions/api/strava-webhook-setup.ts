const json = (body: unknown, status = 200) => Response.json(body, { status });
const CALLBACK_URL = "https://atletasdefuenlabrada.com/api/strava-webhook";

export async function onRequestPost(context: any) {
  const env = context.env as { STRAVA_CLIENT_ID?: string; STRAVA_CLIENT_SECRET?: string; STRAVA_VERIFY_TOKEN?: string; SUPABASE_URL?: string; SUPABASE_SERVICE_ROLE_KEY?: string };
  if (!env.STRAVA_CLIENT_ID || !env.STRAVA_CLIENT_SECRET || !env.STRAVA_VERIFY_TOKEN || !env.SUPABASE_URL || !env.SUPABASE_SERVICE_ROLE_KEY) return json({ error: "Falta configuración de Strava o Supabase." }, 503);
  const bearer = context.request.headers.get("authorization");
  if (!bearer) return json({ error: "Inicia sesión." }, 401);

  const userResponse = await fetch(`${env.SUPABASE_URL}/auth/v1/user`, { headers: { apikey: env.SUPABASE_SERVICE_ROLE_KEY, authorization: bearer } });
  const user = await userResponse.json().catch(() => null) as { id?: string } | null;
  if (!userResponse.ok || !user?.id) return json({ error: "Sesión no válida." }, 401);
  const adminResponse = await fetch(`${env.SUPABASE_URL}/rest/v1/profiles?id=eq.${encodeURIComponent(user.id)}&select=role`, { headers: { apikey: env.SUPABASE_SERVICE_ROLE_KEY, authorization: `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}` } });
  const [profile] = await adminResponse.json().catch(() => []) as { role?: string }[];
  if (!profile || !["owner","admin"].includes(profile.role || "")) return json({ error: "Solo administración puede configurar el webhook." }, 403);

  const query = new URLSearchParams({ client_id: env.STRAVA_CLIENT_ID, client_secret: env.STRAVA_CLIENT_SECRET });
  const currentResponse = await fetch(`https://www.strava.com/api/v3/push_subscriptions?${query.toString()}`);
  const current = await currentResponse.json().catch(() => []) as { id?: number; callback_url?: string }[];
  if (currentResponse.ok && current?.length) return json({ ok: true, existing: current });

  const form = new URLSearchParams({ client_id: env.STRAVA_CLIENT_ID, client_secret: env.STRAVA_CLIENT_SECRET, callback_url: CALLBACK_URL, verify_token: env.STRAVA_VERIFY_TOKEN });
  const response = await fetch("https://www.strava.com/api/v3/push_subscriptions", { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" }, body: form });
  const result = await response.json().catch(() => null);
  if (!response.ok) return json({ error: "Strava no aceptó la suscripción webhook.", detail: result }, 502);
  return json({ ok: true, subscription: result, callback_url: CALLBACK_URL });
}
