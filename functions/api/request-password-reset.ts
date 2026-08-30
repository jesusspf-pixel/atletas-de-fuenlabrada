import { consumePublicRateLimit } from "./_public-rate-limit";

const json = (body: unknown, status = 200) => Response.json(body, { status });
const CANONICAL_ORIGIN = "https://atletasdefuenlabrada.com";

export async function onRequestPost(context: any) {
  const env = context.env as { SUPABASE_URL?: string; SUPABASE_SERVICE_ROLE_KEY?: string };
  if (!env.SUPABASE_URL || !env.SUPABASE_SERVICE_ROLE_KEY) {
    return json({ error: "El servicio de recuperación no está disponible ahora mismo." }, 503);
  }
  const payload = await context.request.json().catch(() => ({})) as { email?: string };
  const email = String(payload.email || "").trim().toLowerCase();
  if (!email || !email.includes("@")) return json({ error: "Introduce un correo electrónico válido." }, 400);
  const allowed = await consumePublicRateLimit(context.request, env, "password-reset", email, 3, 3600);
  if (!allowed) return json({ error: "Has solicitado demasiados correos. Espera antes de intentarlo de nuevo." }, 429);

  const response = await fetch(`${env.SUPABASE_URL}/auth/v1/recover?redirect_to=${encodeURIComponent(`${CANONICAL_ORIGIN}/?reset-password=1`)}`, {
    method: "POST",
    headers: {
      apikey: env.SUPABASE_SERVICE_ROLE_KEY,
      authorization: `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`,
      "content-type": "application/json",
    },
    body: JSON.stringify({ email }),
  });

  if (!response.ok) {
    const detail = await response.json().catch(() => null) as { msg?: string; message?: string } | null;
    const raw = detail?.msg || detail?.message || "";
    if (/rate limit|too many|seconds/i.test(raw)) return json({ error: "Espera al menos un minuto antes de solicitar otro correo." }, 429);
    return json({ error: "No hemos podido enviar el correo de recuperación. Inténtalo de nuevo en unos minutos." }, 502);
  }

  return json({ ok: true, message: "Si existe una cuenta con ese correo, recibirás un enlace para crear una contraseña nueva. Revisa también Spam." });
}
