import { consumePublicRateLimit } from "./_public-rate-limit";

const json = (body: unknown, status = 200) => Response.json(body, {
  status,
  headers: {
    "cache-control": "no-store",
    "x-recovery-flow": "secure-email-v2",
  },
});
const CANONICAL_ORIGIN = "https://atletasdefuenlabrada.com";
const GENERIC_SUCCESS = {
  ok: true,
  message: "Si existe una cuenta con ese correo, recibirás un enlace para crear una contraseña nueva. Revisa también Spam.",
};

const escapeHtml = (value: string) => value.replace(/[&<>"']/g, (character) => ({
  "&": "&amp;",
  "<": "&lt;",
  ">": "&gt;",
  '"': "&quot;",
  "'": "&#039;",
})[character] || character);

export async function onRequestPost(context: any) {
  const env = context.env as {
    SUPABASE_URL?: string;
    SUPABASE_SERVICE_ROLE_KEY?: string;
    RESEND_API_KEY?: string;
  };
  if (!env.SUPABASE_URL || !env.SUPABASE_SERVICE_ROLE_KEY || !env.RESEND_API_KEY) {
    return json({ error: "El servicio de recuperación no está disponible ahora mismo." }, 503);
  }
  const payload = await context.request.json().catch(() => ({})) as { email?: string };
  const email = String(payload.email || "").trim().toLowerCase();
  if (!email || !email.includes("@")) return json({ error: "Introduce un correo electrónico válido." }, 400);
  const allowed = await consumePublicRateLimit(context.request, env, "password-reset", email, 3, 3600);
  if (!allowed) return json({ error: "Has solicitado demasiados correos. Espera antes de intentarlo de nuevo." }, 429);

  const linkResponse = await fetch(`${env.SUPABASE_URL}/auth/v1/admin/generate_link`, {
    method: "POST",
    headers: {
      apikey: env.SUPABASE_SERVICE_ROLE_KEY,
      authorization: `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`,
      "content-type": "application/json",
    },
    body: JSON.stringify({
      type: "recovery",
      email,
      redirect_to: `${CANONICAL_ORIGIN}/?reset-password=1`,
    }),
  });

  const linkDetail = await linkResponse.json().catch(() => null) as {
    action_link?: string;
    msg?: string;
    message?: string;
    error_description?: string;
    error_code?: string;
  } | null;

  if (!linkResponse.ok) {
    const raw = linkDetail?.msg || linkDetail?.message || linkDetail?.error_description || "";
    if (/user not found|no user|not exist/i.test(raw)) return json(GENERIC_SUCCESS);
    if (/rate limit|too many|seconds/i.test(raw)) {
      return json({ error: "Espera al menos un minuto antes de solicitar otro correo." }, 429);
    }
    return json({ error: "No hemos podido preparar el enlace de recuperación. Inténtalo de nuevo en unos minutos." }, 502);
  }

  if (!linkDetail?.action_link) {
    return json({ error: "No hemos podido preparar el enlace de recuperación. Inténtalo de nuevo en unos minutos." }, 502);
  }

  const actionLink = linkDetail.action_link;
  const safeActionLink = escapeHtml(actionLink);
  const mailResponse = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      authorization: `Bearer ${env.RESEND_API_KEY}`,
      "content-type": "application/json",
    },
    body: JSON.stringify({
      from: "Club Atletas de Fuenlabrada <info@atletasdefuenlabrada.com>",
      reply_to: "info@atletasdefuenlabrada.com",
      to: [email],
      subject: "Crea una nueva contraseña · Atletas de Fuenlabrada",
      text: `Hemos recibido una solicitud para crear una nueva contraseña.\n\nAbre este enlace seguro: ${actionLink}\n\nEl enlace es de un solo uso y caduca en una hora. Si no has solicitado este cambio, ignora este correo.`,
      html: `<div style="font-family:Arial,sans-serif;color:#10233f;line-height:1.65;max-width:640px;margin:auto"><h2 style="color:#1559b2">Crea una nueva contraseña</h2><p>Hemos recibido una solicitud para crear una nueva contraseña de tu cuenta del Club Atletas de Fuenlabrada.</p><p style="margin:28px 0"><a href="${safeActionLink}" style="background:#1559b2;color:#fff;text-decoration:none;padding:12px 20px;border-radius:999px;font-weight:700">Crear nueva contraseña</a></p><p style="font-size:13px;color:#617087">El enlace es de un solo uso y caduca en una hora. Si no has solicitado este cambio, ignora este correo.</p><hr style="border:0;border-top:1px solid #dbe6f2"><p style="font-size:13px;color:#617087">Club Atletas de Fuenlabrada</p></div>`,
    }),
  });

  if (!mailResponse.ok) {
    const detail = await mailResponse.json().catch(() => null) as { message?: string } | null;
    const raw = detail?.message || "";
    if (/rate limit|too many|seconds/i.test(raw)) return json({ error: "Espera al menos un minuto antes de solicitar otro correo." }, 429);
    return json({ error: "No hemos podido enviar el correo de recuperación. Inténtalo de nuevo en unos minutos." }, 502);
  }

  return json(GENERIC_SUCCESS);
}
