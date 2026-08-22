const encoder = new TextEncoder();
const toHex = (buffer: ArrayBuffer) => Array.from(new Uint8Array(buffer)).map(byte => byte.toString(16).padStart(2, "0")).join("");

async function validSignature(payload: string, signature: string, secret: string) {
  const parts = Object.fromEntries(signature.split(",").map(part => part.split("=", 2)));
  if (!parts.t || !parts.v1 || Math.abs(Math.floor(Date.now() / 1000) - Number(parts.t)) > 300) return false;
  const key = await crypto.subtle.importKey("raw", encoder.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  return toHex(await crypto.subtle.sign("HMAC", key, encoder.encode(`${parts.t}.${payload}`))) === parts.v1;
}

export async function onRequestPost(context: any) {
  const env = context.env as { STRIPE_WEBHOOK_SECRET?: string; SUPABASE_URL?: string; SUPABASE_SERVICE_ROLE_KEY?: string };
  const payload = await context.request.text(); const signature = context.request.headers.get("stripe-signature") || "";
  if (!env.STRIPE_WEBHOOK_SECRET || !env.SUPABASE_URL || !env.SUPABASE_SERVICE_ROLE_KEY || !(await validSignature(payload, signature, env.STRIPE_WEBHOOK_SECRET))) return new Response("Invalid webhook", { status: 400 });
  const event = JSON.parse(payload) as { type?: string; data?: { object?: { id?: string; metadata?: { order_id?: string } } } };
  if (event.type === "checkout.session.completed") {
    const session = event.data?.object; const orderId = session?.metadata?.order_id;
    if (orderId) await fetch(`${env.SUPABASE_URL}/rest/v1/club_orders?id=eq.${encodeURIComponent(orderId)}`, { method: "PATCH", headers: { apikey: env.SUPABASE_SERVICE_ROLE_KEY, authorization: `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`, "content-type": "application/json", Prefer: "return=minimal" }, body: JSON.stringify({ status: "paid", payment_status: "paid", stripe_checkout_session_id: session?.id, updated_at: new Date().toISOString() }) });
  }
  return new Response("ok");
}
