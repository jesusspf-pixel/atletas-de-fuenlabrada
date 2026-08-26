const json = (body: unknown, status = 200) => Response.json(body, { status });

export async function onRequestPost(context: any) {
  const env = context.env;
  if (!env.SUPABASE_URL || !env.SUPABASE_SERVICE_ROLE_KEY) return json({ error: "Servicio no configurado." }, 503);
  const bearer = context.request.headers.get("authorization");
  if (!bearer) return json({ error: "Inicia sesión para proteger tu cuenta." }, 401);
  const auth = await fetch(`${env.SUPABASE_URL}/auth/v1/user`, { headers: { apikey: env.SUPABASE_SERVICE_ROLE_KEY, authorization: bearer } });
  const user = await auth.json().catch(() => null) as { id?: string; email?: string } | null;
  if (!auth.ok || !user?.id) return json({ error: "La sesión no es válida." }, 401);
  const headers = { apikey: env.SUPABASE_SERVICE_ROLE_KEY, authorization: `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`, "content-type": "application/json", Prefer: "resolution=merge-duplicates,return=minimal" };
  const saved = await fetch(`${env.SUPABASE_URL}/rest/v1/account_deletion_requests?on_conflict=profile_id`, { method: "POST", headers, body: JSON.stringify({ profile_id: user.id, email: user.email || null, status: "requested", requested_at: new Date().toISOString(), updated_at: new Date().toISOString() }) });
  return saved.ok ? json({ ok: true }) : json({ error: "No se pudo registrar la solicitud." }, 502);
}
