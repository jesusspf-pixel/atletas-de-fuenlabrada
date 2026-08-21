const json = (body: unknown, status = 200) => Response.json(body, { status });
const CANONICAL_ORIGIN = "https://atletasdefuenlabrada.com";

export async function onRequestPost(context: any) {
  const env = context.env as { SUPABASE_URL?: string; SUPABASE_SERVICE_ROLE_KEY?: string };
  if (!env.SUPABASE_URL || !env.SUPABASE_SERVICE_ROLE_KEY) {
    return json({ error: "El servicio de correo no está disponible en este momento." }, 503);
  }

  const payload = await context.request.json().catch(() => ({})) as { email?: string };
  const email = String(payload.email || "").trim().toLowerCase();
  if (!email || !email.includes("@")) return json({ error: "Introduce un correo electrónico válido." }, 400);

  const response = await fetch(`${env.SUPABASE_URL}/auth/v1/resend`, {
    method: "POST",
    headers: {
      apikey: env.SUPABASE_SERVICE_ROLE_KEY,
      authorization: `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`,
      "content-type": "application/json",
    },
    body: JSON.stringify({
      type: "signup",
      email,
      options: { email_redirect_to: CANONICAL_ORIGIN },
    }),
  });

  if (!response.ok) {
    const detail = await response.json().catch(() => null) as { msg?: string; message?: string; error_description?: string; error_code?: string } | null;
    const raw = detail?.msg || detail?.message || detail?.error_description || "";
    if (/rate limit|too many|seconds/i.test(raw)) {
      return json({ error: "Espera al menos un minuto antes de solicitar otro correo de confirmación." }, 429);
    }
    return json({
      error: "No hemos podido enviar el correo de confirmación. Prueba de nuevo en unos minutos o contacta con el club.",
      code: detail?.error_code || "resend_failed",
    }, 502);
  }

  return json({ ok: true, message: "Correo de confirmación enviado. Revisa también Spam o Correo no deseado." });
}
