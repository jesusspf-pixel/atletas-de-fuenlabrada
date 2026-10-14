const allowedOrigins = new Set(["https://atletasdefuenlabrada.com", "https://www.atletasdefuenlabrada.com", "https://localhost", "capacitor://localhost"]);
const cors = (request: Request) => { const origin = request.headers.get("origin") || ""; return allowedOrigins.has(origin) ? { "access-control-allow-origin": origin, "access-control-allow-headers": "authorization, content-type", "access-control-allow-methods": "POST, OPTIONS", vary: "Origin" } : {}; };
const reply = (request: Request, body: unknown, status = 200) => Response.json(body, { status, headers: { ...cors(request), "cache-control": "no-store" } });
const clean = (value: unknown, max: number) => String(value || "").trim().slice(0, max);

export async function onRequestPost(context: any) {
  const request = context.request as Request;
  const env = context.env as { SUPABASE_URL?: string; SUPABASE_SERVICE_ROLE_KEY?: string; RESEND_API_KEY?: string };
  if (!env.SUPABASE_URL || !env.SUPABASE_SERVICE_ROLE_KEY || !env.RESEND_API_KEY) return reply(request, { error: "Servicio no disponible." }, 503);
  const authorization = request.headers.get("authorization") || "";
  if (!authorization.startsWith("Bearer ")) return reply(request, { error: "Inicia sesión." }, 401);
  const authResponse = await fetch(`${env.SUPABASE_URL}/auth/v1/user`, { headers: { apikey: env.SUPABASE_SERVICE_ROLE_KEY, authorization } });
  const user = await authResponse.json().catch(() => null) as { id?: string; email?: string } | null;
  if (!authResponse.ok || !user?.id) return reply(request, { error: "Sesión no válida." }, 401);
  const body = await request.json().catch(() => null) as { targetAthleteId?: string; reason?: string; location?: string } | null;
  const targetAthleteId = clean(body?.targetAthleteId, 80);
  const reason = clean(body?.reason, 500);
  if (!targetAthleteId || reason.length < 3) return reply(request, { error: "Indica el motivo." }, 400);
  const subject = "Denuncia de contenido en Club Challenge";
  const text = `Una persona usuaria ha solicitado revisar un perfil.\n\nAtleta denunciado: ${targetAthleteId}\nUsuario que informa: ${user.id} (${user.email || "sin correo"})\nUbicación: ${clean(body?.location, 80)}\nMotivo: ${reason}\nFecha: ${new Date().toISOString()}\n\nRevisar y responder con prontitud.`;
  const send = await fetch("https://api.resend.com/emails", { method: "POST", headers: { authorization: `Bearer ${env.RESEND_API_KEY}`, "content-type": "application/json" }, body: JSON.stringify({ from: "Club Atletas de Fuenlabrada <info@atletasdefuenlabrada.com>", reply_to: "info@atletasdefuenlabrada.com", to: ["info@atletasdefuenlabrada.com"], subject, text }) });
  return send.ok ? reply(request, { ok: true }) : reply(request, { error: "No se pudo enviar la denuncia." }, 502);
}

export async function onRequestOptions(context: any) { return new Response(null, { status: 204, headers: cors(context.request) }); }
