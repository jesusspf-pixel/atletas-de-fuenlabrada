const json = (body: unknown, status = 200) => Response.json(body, { status, headers: { "cache-control": "no-store" } });

type Env = { SUPABASE_URL?: string; VITE_SUPABASE_URL?: string; SUPABASE_SERVICE_ROLE_KEY?: string };

export async function onRequestPost(context: any) {
  const env = context.env as Env;
  const supabaseUrl = env.SUPABASE_URL || env.VITE_SUPABASE_URL;
  const serviceKey = env.SUPABASE_SERVICE_ROLE_KEY;
  const authorization = context.request.headers.get("authorization") || "";
  if (!supabaseUrl || !serviceKey) return json({ error: "La validación de renovaciones no está disponible." }, 503);
  if (!authorization.startsWith("Bearer ")) return json({ error: "Inicia sesión para continuar." }, 401);

  const authResponse = await fetch(`${supabaseUrl}/auth/v1/user`, {
    headers: { apikey: serviceKey, authorization },
  });
  const user = await authResponse.json().catch(() => null) as { email?: string } | null;
  if (!authResponse.ok || !user?.email) return json({ error: "La sesión ha caducado." }, 401);

  const body = await context.request.json().catch(() => ({})) as { renewalToken?: unknown };
  const renewalToken = typeof body.renewalToken === "string" && /^[0-9a-f-]{36}$/i.test(body.renewalToken)
    ? body.renewalToken
    : "";
  if (!renewalToken) return json({ error: "La invitación de renovación no es válida." }, 400);

  const query = new URLSearchParams({
    token: `eq.${renewalToken}`,
    email: `ilike.${user.email}`,
    expires_at: `gt.${new Date().toISOString()}`,
    select: "id,used_at",
  });
  const invitationResponse = await fetch(`${supabaseUrl}/rest/v1/family_renewal_invitations?${query}`, {
    headers: { apikey: serviceKey, authorization: `Bearer ${serviceKey}` },
  });
  const invitations = await invitationResponse.json().catch(() => []) as Array<{ id?: string; used_at?: string | null }>;
  const invitation = invitations[0];
  if (!invitationResponse.ok || !invitation?.id) return json({ error: "La invitación no corresponde a este correo o ha caducado." }, 403);

  if (!invitation.used_at) {
    const updateResponse = await fetch(`${supabaseUrl}/rest/v1/family_renewal_invitations?id=eq.${invitation.id}`, {
      method: "PATCH",
      headers: {
        apikey: serviceKey,
        authorization: `Bearer ${serviceKey}`,
        "content-type": "application/json",
        prefer: "return=minimal",
      },
      body: JSON.stringify({ used_at: new Date().toISOString() }),
    });
    if (!updateResponse.ok) return json({ error: "No se pudo aplicar la matrícula ya pagada." }, 502);
  }

  return json({ claimed: true });
}
