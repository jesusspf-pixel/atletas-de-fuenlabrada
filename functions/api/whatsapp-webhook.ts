type Env = {
  ANTHROPIC_API_KEY?: string;
  META_GRAPH_VERSION?: string;
  SUPABASE_SERVICE_ROLE_KEY?: string;
  SUPABASE_URL?: string;
  WHATSAPP_ACCESS_TOKEN?: string;
  WHATSAPP_APP_SECRET?: string;
  WHATSAPP_PHONE_NUMBER_ID?: string;
  WHATSAPP_VERIFY_TOKEN?: string;
};

const dbHeaders = (env: Env) => ({
  apikey: env.SUPABASE_SERVICE_ROLE_KEY || "",
  authorization: `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY || ""}`,
  "content-type": "application/json",
});
const json = (value: unknown, status = 200) => Response.json(value, { status });
const text = (message: any) => message?.text?.body?.trim() || message?.button?.text?.trim() || message?.interactive?.button_reply?.title?.trim() || message?.interactive?.list_reply?.title?.trim() || "";

function bytes(hex: string) {
  return new Uint8Array((hex.match(/.{1,2}/g) || []).map(value => parseInt(value, 16)));
}
async function validSignature(request: Request, raw: string, secret?: string) {
  const header = request.headers.get("x-hub-signature-256");
  if (!secret || !header?.startsWith("sha256=")) return false;
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const expected = new Uint8Array(await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(raw)));
  const received = bytes(header.slice(7));
  if (expected.length !== received.length) return false;
  let difference = 0;
  for (let index = 0; index < expected.length; index += 1) difference |= expected[index] ^ received[index];
  return difference === 0;
}

async function conversation(env: Env, whatsappId: string, contactName?: string) {
  const headers = dbHeaders(env);
  const found = await fetch(`${env.SUPABASE_URL}/rest/v1/whatsapp_conversations?whatsapp_id=eq.${encodeURIComponent(whatsappId)}&select=id&limit=1`, { headers });
  const current = (await found.json().catch(() => []))[0];
  if (current?.id) return current.id as string;
  const created = await fetch(`${env.SUPABASE_URL}/rest/v1/whatsapp_conversations`, {
    method: "POST", headers: { ...headers, Prefer: "return=representation" },
    body: JSON.stringify({ whatsapp_id: whatsappId, contact_name: contactName || null }),
  });
  return (await created.json().catch(() => []))[0]?.id as string | undefined;
}

async function saveMessage(env: Env, conversationId: string, direction: "inbound" | "outbound", body: string, providerId?: string, raw?: unknown) {
  const headers = dbHeaders(env);
  if (providerId) {
    const duplicate = await fetch(`${env.SUPABASE_URL}/rest/v1/whatsapp_messages?provider_message_id=eq.${encodeURIComponent(providerId)}&select=id&limit=1`, { headers });
    if ((await duplicate.json().catch(() => [])).length) return false;
  }
  const response = await fetch(`${env.SUPABASE_URL}/rest/v1/whatsapp_messages`, {
    method: "POST", headers, body: JSON.stringify({ conversation_id: conversationId, direction, body, provider_message_id: providerId || null, raw: raw || null }),
  });
  return response.ok;
}

async function context(env: Env, conversationId: string) {
  const headers = dbHeaders(env);
  const [messagesResponse, groupsResponse, settingsResponse] = await Promise.all([
    fetch(`${env.SUPABASE_URL}/rest/v1/whatsapp_messages?conversation_id=eq.${conversationId}&select=direction,body&order=created_at.desc&limit=12`, { headers }),
    fetch(`${env.SUPABASE_URL}/rest/v1/training_groups?active=eq.true&select=name,category_label,schedule_days,starts_at,ends_at&order=name`, { headers }),
    fetch(`${env.SUPABASE_URL}/rest/v1/club_settings?id=eq.true&select=club_name,season_label,registration_open,registration_message,contact_email,contact_phone`, { headers }),
  ]);
  const messages = (await messagesResponse.json().catch(() => [])).reverse();
  const groups = await groupsResponse.json().catch(() => []);
  const settings = (await settingsResponse.json().catch(() => []))[0] || {};
  return { messages, groups, settings };
}

async function answer(env: Env, conversationId: string) {
  const current = await context(env, conversationId);
  const system = `Eres la persona de atención por WhatsApp del Club Atletas de Fuenlabrada. Hablas español de España, de forma cercana, clara y natural. Nunca digas que eres una IA.

Información confirmada:
- Instalación: Estadio Raúl González, Universidad Rey Juan Carlos (URJC), Fuenlabrada.
- Inscripción: https://atletasdefuenlabrada.com
- Datos actuales del club: ${JSON.stringify(current.settings)}
- Grupos y horarios actuales: ${JSON.stringify(current.groups)}

Reglas:
- Responde solo con información confirmada. Para menores, pide el año de nacimiento antes de asignar grupo; la edad sola no basta.
- No inventes precios, plazas, entrenadores, pruebas, licencias, adaptaciones o disponibilidad.
- Si algo no está confirmado, es una petición sensible, de salud/necesidades de apoyo, plazas, precios concretos, licencias, reclamaciones o requiere decisión, di de forma natural que prefieres confirmarlo y que lo consultas con la Junta Directiva; te contactarán en cuanto tengan respuesta.
- No pidas diagnósticos ni datos médicos. Ante TEA u otra necesidad, agradece que lo comenten, ofrece trasladarlo a Junta Directiva y, solo si ayuda, pregunta qué apoyo práctico consideran importante.
- Sé breve: normalmente 2 a 5 frases y una sola pregunta útil.
Devuelve únicamente JSON válido: {"reply":"...","needs_board_followup":true|false,"category":"...","board_summary":"..."}. Marca needs_board_followup true cuando haya que trasladarlo a Junta Directiva.`;
  const response = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: { "content-type": "application/json", "x-api-key": env.ANTHROPIC_API_KEY || "", "anthropic-version": "2023-06-01" },
    body: JSON.stringify({
      model: "claude-haiku-4-5-20251001", max_tokens: 500, system,
      messages: current.messages.map((item: any) => ({ role: item.direction === "inbound" ? "user" : "assistant", content: item.body })),
    }),
  });
  const data = await response.json().catch(() => null) as any;
  if (!response.ok) throw new Error(data?.error?.message || "Claude no ha podido responder.");
  const output = data?.content?.find((item: any) => item.type === "text")?.text || "";
  try { return JSON.parse(output) as { reply: string; needs_board_followup?: boolean; category?: string; board_summary?: string }; }
  catch { return { reply: output || "Gracias por escribirnos. Lo consulto con la Junta Directiva y te contactarán en cuanto tengan respuesta.", needs_board_followup: true, category: "consulta", board_summary: "Respuesta no estructurada del agente." }; }
}

async function send(env: Env, to: string, body: string) {
  const response = await fetch(`https://graph.facebook.com/${env.META_GRAPH_VERSION || "v25.0"}/${env.WHATSAPP_PHONE_NUMBER_ID}/messages`, {
    method: "POST",
    headers: { authorization: `Bearer ${env.WHATSAPP_ACCESS_TOKEN}`, "content-type": "application/json" },
    body: JSON.stringify({ messaging_product: "whatsapp", to, type: "text", text: { preview_url: false, body } }),
  });
  const data = await response.json().catch(() => null) as any;
  if (!response.ok) throw new Error(data?.error?.message || "No se pudo enviar el WhatsApp.");
  return data?.messages?.[0]?.id as string | undefined;
}

async function handle(env: Env, message: any, contact?: any) {
  const incoming = text(message);
  if (!incoming || !message?.from) return;
  const id = await conversation(env, message.from, contact?.profile?.name);
  if (!id || !(await saveMessage(env, id, "inbound", incoming, message.id, message))) return;
  const result = await answer(env, id);
  const reply = String(result.reply || "").trim() || "Gracias por escribirnos. Lo consulto con la Junta Directiva y te contactarán en cuanto tengan respuesta.";
  const providerId = await send(env, message.from, reply);
  await saveMessage(env, id, "outbound", reply, providerId);
  if (result.needs_board_followup) {
    await fetch(`${env.SUPABASE_URL}/rest/v1/whatsapp_board_requests`, {
      method: "POST", headers: dbHeaders(env),
      body: JSON.stringify({ conversation_id: id, category: result.category || "consulta", summary: result.board_summary || incoming }),
    });
  }
}

export async function onRequestGet(context: any) {
  const env = context.env as Env;
  const url = new URL(context.request.url);
  if (url.searchParams.get("hub.mode") === "subscribe" && url.searchParams.get("hub.verify_token") === env.WHATSAPP_VERIFY_TOKEN) {
    return new Response(url.searchParams.get("hub.challenge") || "", { status: 200 });
  }
  return json({ error: "Verificación no válida." }, 403);
}

export async function onRequestPost(context: any) {
  const env = context.env as Env;
  if (!env.ANTHROPIC_API_KEY || !env.SUPABASE_URL || !env.SUPABASE_SERVICE_ROLE_KEY || !env.WHATSAPP_ACCESS_TOKEN || !env.WHATSAPP_APP_SECRET || !env.WHATSAPP_PHONE_NUMBER_ID) return json({ error: "Configuración incompleta." }, 503);
  const raw = await context.request.text();
  if (!(await validSignature(context.request, raw, env.WHATSAPP_APP_SECRET))) return json({ error: "Firma no válida." }, 401);
  const payload = JSON.parse(raw || "{}");
  const jobs: Promise<void>[] = [];
  for (const entry of payload.entry || []) for (const change of entry.changes || []) {
    const contacts = new Map((change.value?.contacts || []).map((contact: any) => [contact.wa_id, contact]));
    for (const message of change.value?.messages || []) jobs.push(handle(env, message, contacts.get(message.from)));
  }
  const work = Promise.all(jobs).then(() => undefined).catch(console.error);
  if (context.waitUntil) context.waitUntil(work); else await work;
  return json({ received: true });
}
