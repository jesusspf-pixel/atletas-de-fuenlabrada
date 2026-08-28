type Env = { SUPABASE_URL?: string; SUPABASE_SERVICE_ROLE_KEY?: string; RESEND_API_KEY?: string };

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json; charset=utf-8" } });

export const onRequestPost: PagesFunction<Env> = async ({ request, env }) => {
  if (!env.SUPABASE_URL || !env.SUPABASE_SERVICE_ROLE_KEY) return json({ error: "El servicio de acceso no está configurado." }, 503);
  const authorization = request.headers.get("authorization") || "";
  if (!authorization.startsWith("Bearer ")) return json({ error: "Inicia sesión de nuevo." }, 401);
  const auth = await fetch(`${env.SUPABASE_URL}/auth/v1/user`, { headers: { apikey: env.SUPABASE_SERVICE_ROLE_KEY, authorization } });
  const parent = await auth.json().catch(() => null) as { id?: string } | null;
  if (!auth.ok || !parent?.id) return json({ error: "La sesión ha caducado." }, 401);
  const body = await request.json().catch(() => ({})) as { athleteId?: string; email?: string };
  const email = String(body.email || "").trim().toLowerCase();
  if (!body.athleteId || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return json({ error: "Indica un correo válido para el atleta." }, 400);
  const serviceHeaders = { apikey: env.SUPABASE_SERVICE_ROLE_KEY, authorization: `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`, "content-type": "application/json" };
  const owned = await fetch(`${env.SUPABASE_URL}/rest/v1/athletes?id=eq.${encodeURIComponent(body.athleteId)}&select=id,first_name,last_name,training_category,user_profile_id,families!inner(primary_profile_id)`, { headers: serviceHeaders });
  const rows = await owned.json().catch(() => []) as Array<{ id: string; first_name: string; last_name: string; training_category?: string; user_profile_id?: string | null; families?: { primary_profile_id?: string } }>;
  const athlete = rows.find(item => item.families?.primary_profile_id === parent.id);
  if (!athlete) return json({ error: "No puedes gestionar el acceso de este atleta." }, 403);
  if (["Sub 6", "Sub 8", "Sub 10", "Sub 12"].includes(athlete.training_category || "")) return json({ error: "El acceso individual está disponible desde Sub 14." }, 400);
  if (athlete.user_profile_id) return json({ error: "Este atleta ya tiene un acceso individual vinculado." }, 409);

  const redirectTo = `${new URL(request.url).origin}/?access=1`;
  const invite = await fetch(`${env.SUPABASE_URL}/auth/v1/invite?redirect_to=${encodeURIComponent(redirectTo)}`, {
    method: "POST",
    headers: serviceHeaders,
    body: JSON.stringify({ email, data: { role: "minor_athlete", athlete_id: athlete.id } }),
  });
  const invited = await invite.json().catch(() => null) as { id?: string; msg?: string; message?: string } | null;
  if (!invite.ok || !invited?.id) return json({ error: invited?.msg || invited?.message || "No se pudo enviar la invitación. Comprueba si ese correo ya tiene una cuenta." }, invite.status || 502);

  const link = await fetch(`${env.SUPABASE_URL}/rest/v1/rpc/link_minor_athlete_access`, {
    method: "POST",
    headers: { ...serviceHeaders, authorization },
    body: JSON.stringify({ target_athlete_id: athlete.id, target_profile_id: invited.id, target_email: email }),
  });
  if (!link.ok) {
    const detail = await link.json().catch(() => null) as { message?: string } | null;
    return json({ error: detail?.message || "La invitación se creó, pero no se pudo vincular al atleta." }, 502);
  }
  return json({ ok: true, email });
};
