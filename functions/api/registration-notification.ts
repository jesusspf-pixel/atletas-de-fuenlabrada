const json = (body: unknown, status = 200) => Response.json(body, { status });
export async function onRequestPost(context: any) {
  const env = context.env as { SUPABASE_URL?: string; SUPABASE_SERVICE_ROLE_KEY?: string; VITE_SUPABASE_PUBLISHABLE_KEY?: string; RESEND_API_KEY?: string };
  const authorization = context.request.headers.get("authorization") || "";
  if (!env.SUPABASE_URL || !env.SUPABASE_SERVICE_ROLE_KEY || !env.RESEND_API_KEY || !authorization.startsWith("Bearer ")) return json({ ok: false }, 503);
  const auth = await fetch(`${env.SUPABASE_URL}/auth/v1/user`, { headers: { apikey: env.VITE_SUPABASE_PUBLISHABLE_KEY || env.SUPABASE_SERVICE_ROLE_KEY, authorization } });
  const user = await auth.json().catch(() => null) as { id?: string; email?: string } | null;
  if (!auth.ok || !user?.id) return json({ ok: false }, 401);
  const headers = { apikey: env.SUPABASE_SERVICE_ROLE_KEY, authorization: `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}` };
  const [ownResponse,familyResponse] = await Promise.all([
    fetch(`${env.SUPABASE_URL}/rest/v1/athletes?user_profile_id=eq.${user.id}&select=first_name,last_name,created_at&order=created_at.desc&limit=10`, { headers }),
    fetch(`${env.SUPABASE_URL}/rest/v1/families?primary_profile_id=eq.${user.id}&select=id&order=created_at.desc&limit=5`, { headers }),
  ]);
  const own = await ownResponse.json().catch(() => []) as { first_name:string;last_name:string;created_at:string }[];
  const familyIds = ((await familyResponse.json().catch(() => [])) as { id:string }[]).map(item=>item.id);
  let familyAthletes: { first_name:string;last_name:string;created_at:string }[] = [];
  if (familyIds.length) {
    const response = await fetch(`${env.SUPABASE_URL}/rest/v1/athletes?family_id=in.(${familyIds.join(',')})&select=first_name,last_name,created_at&order=created_at.desc&limit=20`, { headers });
    familyAthletes = await response.json().catch(() => []) as typeof familyAthletes;
  }
  const recent = [...own,...familyAthletes].filter(a => Date.now()-new Date(a.created_at).getTime()<300000);
  if (!recent.length) return json({ ok: true });
  const settings = await fetch(`${env.SUPABASE_URL}/rest/v1/club_settings?id=eq.true&select=registration_notification_email,contact_email`, { headers });
  const setting = (await settings.json().catch(() => []))?.[0] || {};
  const to = setting.registration_notification_email || setting.contact_email || "info@atletasdefuenlabrada.com";
  await fetch("https://api.resend.com/emails", { method: "POST", headers: { authorization: `Bearer ${env.RESEND_API_KEY}`, "content-type": "application/json" }, body: JSON.stringify({ from: "Club Atletas de Fuenlabrada <info@atletasdefuenlabrada.com>", to: [to], subject: "Nueva alta en el club", html: `<p>Se ha recibido una nueva inscripción:</p><p><strong>${recent.map(a=>`${a.first_name} ${a.last_name}`).join(', ')}</strong></p><p>Accede al panel de administración para revisarla.</p>` }) });
  return json({ ok: true });
}
