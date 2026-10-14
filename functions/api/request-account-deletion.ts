const allowedOrigins = new Set(["https://atletasdefuenlabrada.com", "https://www.atletasdefuenlabrada.com", "https://localhost", "capacitor://localhost"]);
const cors = (request: Request) => {
  const origin = request.headers.get("origin") || "";
  return allowedOrigins.has(origin) ? { "access-control-allow-origin": origin, "access-control-allow-headers": "authorization, content-type", "access-control-allow-methods": "POST, OPTIONS", vary: "Origin" } : {};
};
const reply = (request: Request, body: unknown, status = 200) => Response.json(body, { status, headers: { ...cors(request), "cache-control": "no-store" } });

export async function onRequestOptions(context: any) {
  return new Response(null, { status: 204, headers: cors(context.request) });
}

export async function onRequestPost(context: any) {
  const request = context.request as Request;
  const env = context.env as { SUPABASE_URL?: string; SUPABASE_SERVICE_ROLE_KEY?: string; RESEND_API_KEY?: string };
  if (!env.SUPABASE_URL || !env.SUPABASE_SERVICE_ROLE_KEY || !env.RESEND_API_KEY) return reply(request, { error: "El servicio no está disponible ahora mismo." }, 503);
  const authorization = request.headers.get("authorization") || "";
  if (!authorization.startsWith("Bearer ")) return reply(request, { error: "Inicia sesión de nuevo." }, 401);
  const authResponse = await fetch(`${env.SUPABASE_URL}/auth/v1/user`, { headers: { apikey: env.SUPABASE_SERVICE_ROLE_KEY, authorization } });
  const user = await authResponse.json().catch(() => null) as { id?: string; email?: string } | null;
  if (!authResponse.ok || !user?.id || !user.email) return reply(request, { error: "No se pudo verificar la cuenta." }, 401);
  const serviceHeaders = { apikey: env.SUPABASE_SERVICE_ROLE_KEY, authorization: `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}` };
  const profileResponse = await fetch(`${env.SUPABASE_URL}/rest/v1/profiles?id=eq.${encodeURIComponent(user.id)}&select=full_name,role`, { headers: serviceHeaders });
  const [profile] = await profileResponse.json().catch(() => []) as { full_name?: string | null; role?: string }[];
  const requestedAt = new Date().toISOString();
  const subject = `Solicitud de eliminación de cuenta · ${user.email}`;
  const internalText = `Se ha iniciado desde la aplicación una solicitud de eliminación de cuenta.\n\nUsuario: ${profile?.full_name || "Sin nombre"}\nCorreo: ${user.email}\nID: ${user.id}\nRol: ${profile?.role || "sin rol"}\nFecha: ${requestedAt}\n\nVerificar identidad, revisar obligaciones de conservación y completar la supresión o anonimización en un máximo de 30 días.`;
  const userText = `Hola${profile?.full_name ? ` ${profile.full_name}` : ""}:\n\nHemos recibido tu solicitud de eliminación de la cuenta de Atletas de Fuenlabrada. Revisaremos las obligaciones legales de conservación y completaremos la supresión o anonimización, como máximo, en 30 días.\n\nSi no has realizado esta solicitud, responde inmediatamente a este correo.\n\nClub Atletas de Fuenlabrada`;
  const sendResponse = await fetch("https://api.resend.com/emails/batch", {
    method: "POST",
    headers: { authorization: `Bearer ${env.RESEND_API_KEY}`, "content-type": "application/json" },
    body: JSON.stringify([
      { from: "Club Atletas de Fuenlabrada <info@atletasdefuenlabrada.com>", reply_to: "info@atletasdefuenlabrada.com", to: ["info@atletasdefuenlabrada.com"], subject, text: internalText },
      { from: "Club Atletas de Fuenlabrada <info@atletasdefuenlabrada.com>", reply_to: "info@atletasdefuenlabrada.com", to: [user.email], subject: "Hemos recibido tu solicitud de eliminación", text: userText },
    ]),
  });
  if (!sendResponse.ok) return reply(request, { error: "No se pudo registrar la solicitud. Inténtalo de nuevo." }, 502);
  return reply(request, { ok: true, message: "Solicitud registrada. Te hemos enviado una confirmación por correo y la completaremos como máximo en 30 días." });
}
