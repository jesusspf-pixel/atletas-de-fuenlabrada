const json = (body: unknown, status = 200) => Response.json(body, { status });

export async function onRequestPost(context: any) {
  const env = context.env;
  if (!env.SUPABASE_URL || !env.SUPABASE_SERVICE_ROLE_KEY) return json({ error: "Push no configurado." }, 503);
  const bearer = context.request.headers.get("authorization");
  if (!bearer) return json({ error: "Inicia sesión." }, 401);
  const auth = await fetch(`${env.SUPABASE_URL}/auth/v1/user`, { headers: { apikey: env.SUPABASE_SERVICE_ROLE_KEY, authorization: bearer } });
  const user = await auth.json().catch(() => null) as { id?: string } | null;
  if (!auth.ok || !user?.id) return json({ error: "Sesión no válida." }, 401);
  const subscription = await context.request.json().catch(() => null) as { endpoint?: string; type?: string; platform?: string; token?: string } | null;
  if (!subscription?.endpoint) return json({ error: "Suscripción no válida." }, 400);
  const headers = { apikey: env.SUPABASE_SERVICE_ROLE_KEY, authorization: `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`, "content-type": "application/json", Prefer: "resolution=merge-duplicates,return=minimal" };
  const native = subscription.type === "native" && subscription.token && ["ios", "android"].includes(subscription.platform || "");
  const table = native ? "native_push_subscriptions" : "push_subscriptions";
  const conflict = native ? "platform,token" : "endpoint";
  const record = native
    ? { profile_id: user.id, platform: subscription.platform, token: subscription.token, updated_at: new Date().toISOString() }
    : { profile_id: user.id, endpoint: subscription.endpoint, subscription, user_agent: context.request.headers.get("user-agent"), updated_at: new Date().toISOString() };
  const save = await fetch(`${env.SUPABASE_URL}/rest/v1/${table}?on_conflict=${conflict}`, { method: "POST", headers, body: JSON.stringify(record) });
  return save.ok ? json({ ok: true }) : json({ error: "No se pudo guardar el dispositivo." }, 502);
}
