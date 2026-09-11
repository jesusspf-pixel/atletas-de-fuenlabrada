interface Env {
  SUPABASE_URL: string;
  SUPABASE_SERVICE_ROLE_KEY: string;
  VITE_SUPABASE_PUBLISHABLE_KEY?: string;
  RESEND_API_KEY: string;
}

type AuthUser = { id: string; email?: string | null; deleted_at?: string | null };
type Announcement = { id: string; title: string; body: string; created_by: string };
type Delivery = { recipient_profile_id: string };

const json = (body: unknown, status = 200) => Response.json(body, {
  status,
  headers: { "cache-control": "no-store" },
});

const escapeHtml = (value: string) => value.replace(/[&<>"']/g, (character) => ({
  "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#039;",
})[character] || character);

export const onRequestPost: PagesFunction<Env> = async ({ request, env }) => {
  if (!env.SUPABASE_URL || !env.SUPABASE_SERVICE_ROLE_KEY || !env.RESEND_API_KEY)
    return json({ ok: false, error: "El correo operativo no está configurado." }, 503);

  const authorization = request.headers.get("authorization") || "";
  if (!authorization.startsWith("Bearer ")) return json({ ok: false, error: "Sesión caducada." }, 401);

  const serviceHeaders = {
    apikey: env.SUPABASE_SERVICE_ROLE_KEY,
    authorization: `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`,
  };
  const authResponse = await fetch(`${env.SUPABASE_URL}/auth/v1/user`, {
    headers: {
      apikey: env.VITE_SUPABASE_PUBLISHABLE_KEY || env.SUPABASE_SERVICE_ROLE_KEY,
      authorization,
    },
  });
  const caller = await authResponse.json().catch(() => null) as { id?: string } | null;
  if (!authResponse.ok || !caller?.id) return json({ ok: false, error: "Sesión caducada." }, 401);

  const input = await request.json().catch(() => null) as { announcementId?: string } | null;
  if (!input?.announcementId) return json({ ok: false, error: "Falta el aviso." }, 400);

  const [announcementResponse, profileResponse] = await Promise.all([
    fetch(`${env.SUPABASE_URL}/rest/v1/announcements?id=eq.${encodeURIComponent(input.announcementId)}&select=id,title,body,created_by&limit=1`, { headers: serviceHeaders }),
    fetch(`${env.SUPABASE_URL}/rest/v1/profiles?id=eq.${caller.id}&select=role&limit=1`, { headers: serviceHeaders }),
  ]);
  const announcement = ((await announcementResponse.json().catch(() => [])) as Announcement[])[0];
  const role = ((await profileResponse.json().catch(() => [])) as { role?: string }[])[0]?.role || "";
  if (!announcement) return json({ ok: false, error: "El aviso todavía no está preparado." }, 409);
  if (announcement.created_by !== caller.id && !["owner", "admin"].includes(role))
    return json({ ok: false, error: "No puedes enviar este aviso." }, 403);

  const deliveriesResponse = await fetch(
    `${env.SUPABASE_URL}/rest/v1/announcement_deliveries?announcement_id=eq.${announcement.id}&channel=eq.email&delivery_status=eq.pending&select=recipient_profile_id&order=recipient_profile_id.asc`,
    { headers: serviceHeaders },
  );
  const deliveries = await deliveriesResponse.json().catch(() => []) as Delivery[];
  if (!deliveriesResponse.ok) return json({ ok: false, error: "No se pudieron leer los destinatarios." }, 502);
  if (!deliveries.length) return json({ ok: true, sent: 0, alreadySent: true });

  const usersResponse = await fetch(`${env.SUPABASE_URL}/auth/v1/admin/users?page=1&per_page=1000`, { headers: serviceHeaders });
  const usersPayload = await usersResponse.json().catch(() => null) as { users?: AuthUser[] } | AuthUser[] | null;
  if (!usersResponse.ok || !usersPayload) return json({ ok: false, error: "No se pudieron obtener los correos." }, 502);
  const users = Array.isArray(usersPayload) ? usersPayload : usersPayload.users || [];
  const emailById = new Map(users.filter((user) => user.email && !user.deleted_at).map((user) => [user.id, user.email!.trim().toLowerCase()]));
  const recipients = deliveries
    .map((delivery) => ({ id: delivery.recipient_profile_id, email: emailById.get(delivery.recipient_profile_id) }))
    .filter((recipient): recipient is { id: string; email: string } => Boolean(recipient.email));

  const safeTitle = escapeHtml(announcement.title);
  const safeBody = escapeHtml(announcement.body).replace(/\n/g, "<br>");
  let sent = 0;
  for (let index = 0; index < recipients.length; index += 100) {
    const batchRecipients = recipients.slice(index, index + 100);
    const messages = batchRecipients.map(({ email }) => ({
      from: "Club Atletas de Fuenlabrada <info@atletasdefuenlabrada.com>",
      reply_to: "info@atletasdefuenlabrada.com",
      to: [email],
      subject: announcement.title,
      text: `${announcement.body}\n\nAccede a tu perfil: https://atletasdefuenlabrada.com/`,
      html: `<div style="font-family:Arial,sans-serif;color:#10233f;line-height:1.65;max-width:640px;margin:auto"><h2 style="color:#1559b2">${safeTitle}</h2><p>${safeBody}</p><p style="margin:28px 0"><a href="https://atletasdefuenlabrada.com/" style="background:#1559b2;color:#fff;text-decoration:none;padding:12px 20px;border-radius:999px;font-weight:700">Abrir mi perfil</a></p><hr style="border:0;border-top:1px solid #dbe6f2"><p style="font-size:13px;color:#617087">Club Atletas de Fuenlabrada</p></div>`,
    }));
    const response = await fetch("https://api.resend.com/emails/batch", {
      method: "POST",
      headers: {
        authorization: `Bearer ${env.RESEND_API_KEY}`,
        "content-type": "application/json",
        "Idempotency-Key": `club-event/${announcement.id}/${Math.floor(index / 100)}`,
      },
      body: JSON.stringify(messages),
    });
    if (!response.ok) {
      const detail = await response.json().catch(() => null) as { message?: string } | null;
      return json({ ok: false, error: detail?.message || "El proveedor no aceptó el aviso.", sent }, 502);
    }

    const ids = batchRecipients.map((recipient) => recipient.id).join(",");
    const trackingResponse = await fetch(
      `${env.SUPABASE_URL}/rest/v1/announcement_deliveries?announcement_id=eq.${announcement.id}&channel=eq.email&recipient_profile_id=in.(${ids})`,
      {
        method: "PATCH",
        headers: { ...serviceHeaders, "content-type": "application/json", Prefer: "return=minimal" },
        body: JSON.stringify({ delivery_status: "sent" }),
      },
    );
    if (!trackingResponse.ok) return json({ ok: false, error: "El correo salió, pero no se pudo cerrar su seguimiento.", sent: sent + batchRecipients.length }, 502);
    sent += batchRecipients.length;
  }

  return json({ ok: true, sent, withoutEmail: deliveries.length - recipients.length });
};

