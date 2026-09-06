interface Env {
  SUPABASE_URL: string;
  SUPABASE_SERVICE_ROLE_KEY: string;
  RESEND_API_KEY: string;
}

type AuthUser = { id: string; email?: string | null; deleted_at?: string | null };

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json; charset=utf-8" },
  });

const escapeHtml = (value: string) =>
  value.replace(/[&<>"']/g, (character) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#039;",
  })[character] || character);

export const onRequestPost: PagesFunction<Env> = async ({ request, env }) => {
  const token = request.headers.get("authorization")?.replace(/^Bearer\s+/i, "");
  if (!token) return json({ error: "La sesión ha caducado." }, 401);

  const authHeaders = { apikey: env.SUPABASE_SERVICE_ROLE_KEY, authorization: `Bearer ${token}` };
  const serviceHeaders = { apikey: env.SUPABASE_SERVICE_ROLE_KEY, authorization: `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}` };
  const userResponse = await fetch(`${env.SUPABASE_URL}/auth/v1/user`, { headers: authHeaders });
  const user = await userResponse.json().catch(() => null) as { id?: string } | null;
  if (!userResponse.ok || !user?.id) return json({ error: "La sesión ha caducado." }, 401);

  const profileResponse = await fetch(`${env.SUPABASE_URL}/rest/v1/profiles?id=eq.${user.id}&select=role&limit=1`, { headers: serviceHeaders });
  const profiles = await profileResponse.json().catch(() => []) as { role?: string }[];
  if (!profiles.some((profile) => ["owner", "admin"].includes(profile.role || "")))
    return json({ error: "Solo administración puede realizar un envío general." }, 403);

  const input = await request.json().catch(() => null) as { announcementId?: string } | null;
  if (!input?.announcementId) return json({ error: "Falta el aviso que se debe enviar." }, 400);
  const announcementResponse = await fetch(
    `${env.SUPABASE_URL}/rest/v1/announcements?id=eq.${encodeURIComponent(input.announcementId)}&select=id,title,body,audience&limit=1`,
    { headers: serviceHeaders },
  );
  const announcements = await announcementResponse.json().catch(() => []) as { id: string; title: string; body: string; audience: string }[];
  const announcement = announcements[0];
  if (!announcement || announcement.audience !== "club")
    return json({ error: "El aviso no corresponde a todo el club." }, 400);

  const usersResponse = await fetch(`${env.SUPABASE_URL}/auth/v1/admin/users?page=1&per_page=1000`, { headers: serviceHeaders });
  const usersPayload = await usersResponse.json().catch(() => null) as { users?: AuthUser[] } | AuthUser[] | null;
  if (!usersResponse.ok || !usersPayload) return json({ error: "No se pudo obtener la lista de correos." }, 502);
  const users = Array.isArray(usersPayload) ? usersPayload : usersPayload.users || [];
  const existingResponse = await fetch(
    `${env.SUPABASE_URL}/rest/v1/announcement_deliveries?announcement_id=eq.${encodeURIComponent(announcement.id)}&channel=eq.email&delivery_status=eq.sent&select=recipient_profile_id`,
    { headers: serviceHeaders },
  );
  const existing = await existingResponse.json().catch(() => []) as { recipient_profile_id: string }[];
  const deliveredIds = new Set(existing.map((item) => item.recipient_profile_id));
  const recipients = users
    .filter((item) => item.email && !item.deleted_at && !deliveredIds.has(item.id))
    .filter((item, index, all) => all.findIndex((candidate) => candidate.email?.trim().toLowerCase() === item.email?.trim().toLowerCase()) === index)
    .map((item) => ({ id: item.id, email: item.email!.trim().toLowerCase() }));
  if (!recipients.length) return json({ sent: 0, registered: users.filter((item) => item.email && !item.deleted_at).length, alreadySent: true });

  const safeTitle = escapeHtml(announcement.title);
  const safeBody = escapeHtml(announcement.body).replace(/\n/g, "<br>");
  const messages = recipients.map(({ email }) => ({
    from: "Club Atletas de Fuenlabrada <info@atletasdefuenlabrada.com>",
    reply_to: "info@atletasdefuenlabrada.com",
    to: [email],
    subject: announcement.title,
    text: announcement.body,
    html: `<div style="font-family:Arial,sans-serif;color:#10233f;line-height:1.65;max-width:640px;margin:auto"><h2 style="color:#1559b2">${safeTitle}</h2><p>${safeBody}</p><hr style="border:0;border-top:1px solid #dbe6f2;margin:28px 0"><p style="font-size:13px;color:#617087">Club Atletas de Fuenlabrada</p></div>`,
  }));

  let sent = 0;
  for (let index = 0; index < messages.length; index += 100) {
    const batch = messages.slice(index, index + 100);
    const response = await fetch("https://api.resend.com/emails/batch", {
      method: "POST",
      headers: { authorization: `Bearer ${env.RESEND_API_KEY}`, "content-type": "application/json" },
      body: JSON.stringify(batch),
    });
    if (!response.ok) {
      const detail = await response.json().catch(() => null) as { message?: string } | null;
      return json({ error: detail?.message || "El proveedor de correo no aceptó el envío.", sent }, 502);
    }
    const delivered = recipients.slice(index, index + batch.length).map((recipient) => ({
      announcement_id: announcement.id,
      recipient_profile_id: recipient.id,
      channel: "email",
      delivery_status: "sent",
    }));
    const trackingResponse = await fetch(`${env.SUPABASE_URL}/rest/v1/announcement_deliveries?on_conflict=announcement_id,recipient_profile_id,channel`, {
      method: "POST",
      headers: { ...serviceHeaders, "content-type": "application/json", Prefer: "resolution=merge-duplicates" },
      body: JSON.stringify(delivered),
    });
    if (!trackingResponse.ok) return json({ error: "El correo salió, pero no se pudo registrar todo el seguimiento.", sent: sent + batch.length }, 502);
    sent += batch.length;
  }
  return json({ sent, registered: recipients.length + deliveredIds.size });
};
