type Env = {
  SUPABASE_SERVICE_ROLE_KEY?: string;
  RESEND_API_KEY?: string;
};

type Message = {
  to?: string;
  subject?: string;
  text?: string;
  html?: string;
};

const json = (body: unknown, status = 200) => Response.json(body, {
  status,
  headers: { "cache-control": "no-store" },
});

const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export async function onRequestPost(context: any) {
  const env = context.env as Env;
  const authorization = context.request.headers.get("authorization") || "";
  const expected = env.SUPABASE_SERVICE_ROLE_KEY
    ? `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`
    : "";

  if (!expected || authorization !== expected) {
    return json({ ok: false, error: "No autorizado." }, 401);
  }
  if (!env.RESEND_API_KEY) {
    return json({ ok: false, error: "El proveedor de correo no está configurado." }, 503);
  }

  const payload = await context.request.json().catch(() => null) as { messages?: Message[] } | null;
  const requested = Array.isArray(payload?.messages) ? payload!.messages : [];
  if (!requested.length || requested.length > 80) {
    return json({ ok: false, error: "Lote de correo no válido." }, 400);
  }

  const messages = requested.map((message) => ({
    from: "Club Atletas de Fuenlabrada <info@atletasdefuenlabrada.com>",
    reply_to: "info@atletasdefuenlabrada.com",
    to: [String(message.to || "").trim().toLowerCase()],
    subject: String(message.subject || "").trim().slice(0, 180),
    text: String(message.text || "").slice(0, 10_000),
    html: String(message.html || "").slice(0, 30_000),
  }));

  if (messages.some((message) => !emailPattern.test(message.to[0]) || !message.subject || (!message.text && !message.html))) {
    return json({ ok: false, error: "Hay mensajes incompletos en el lote." }, 400);
  }

  const incomingKey = context.request.headers.get("idempotency-key") || "";
  const idempotencyKey = /^[a-z0-9_./:-]{12,220}$/i.test(incomingKey)
    ? incomingKey
    : `club-notifications/${crypto.randomUUID()}`;

  const response = await fetch("https://api.resend.com/emails/batch", {
    method: "POST",
    headers: {
      authorization: `Bearer ${env.RESEND_API_KEY}`,
      "content-type": "application/json",
      "Idempotency-Key": idempotencyKey,
    },
    body: JSON.stringify(messages),
  });
  const result = await response.json().catch(() => ({}));
  if (!response.ok) {
    return json({ ok: false, error: (result as any)?.message || `Resend respondió ${response.status}.` }, 502);
  }
  return json({ ok: true, count: messages.length });
}

