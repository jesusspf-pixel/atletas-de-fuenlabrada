const encoder = new TextEncoder();
const toHex = (buffer: ArrayBuffer) => Array.from(new Uint8Array(buffer)).map(byte => byte.toString(16).padStart(2, "0")).join("");

async function validSignature(payload: string, signature: string, secret: string) {
  const parts = Object.fromEntries(signature.split(",").map(part => part.split("=", 2)));
  if (!parts.t || !parts.v1 || Math.abs(Math.floor(Date.now() / 1000) - Number(parts.t)) > 300) return false;
  const key = await crypto.subtle.importKey("raw", encoder.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  return toHex(await crypto.subtle.sign("HMAC", key, encoder.encode(`${parts.t}.${payload}`))) === parts.v1;
}

export async function onRequestPost(context: any) {
  const env = context.env as { STRIPE_WEBHOOK_SECRET?: string; STRIPE_SECRET_KEY?: string; SUPABASE_URL?: string; SUPABASE_SERVICE_ROLE_KEY?: string };
  const payload = await context.request.text(); const signature = context.request.headers.get("stripe-signature") || "";
  if (!env.STRIPE_WEBHOOK_SECRET || !env.SUPABASE_URL || !env.SUPABASE_SERVICE_ROLE_KEY || !(await validSignature(payload, signature, env.STRIPE_WEBHOOK_SECRET))) return new Response("Invalid webhook", { status: 400 });
  const event = JSON.parse(payload) as { type?: string; data?: { object?: { id?: string; mode?: string; customer?: string; setup_intent?: string; metadata?: { order_id?: string; billing_charge_draft_id?: string } } } };
  if (event.type === "checkout.session.completed") {
    const session = event.data?.object; const orderId = session?.metadata?.order_id;
    const draftId = session?.metadata?.billing_charge_draft_id;
    if (orderId) await fetch(`${env.SUPABASE_URL}/rest/v1/club_orders?id=eq.${encodeURIComponent(orderId)}`, { method: "PATCH", headers: { apikey: env.SUPABASE_SERVICE_ROLE_KEY, authorization: `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`, "content-type": "application/json", Prefer: "return=minimal" }, body: JSON.stringify({ status: "paid", payment_status: "paid", stripe_checkout_session_id: session?.id, updated_at: new Date().toISOString() }) });
    if (draftId) await fetch(`${env.SUPABASE_URL}/rest/v1/billing_charge_drafts?id=eq.${encodeURIComponent(draftId)}`, { method: "PATCH", headers: { apikey: env.SUPABASE_SERVICE_ROLE_KEY, authorization: `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`, "content-type": "application/json", Prefer: "return=minimal" }, body: JSON.stringify({ status: "paid", provider_reference: session?.id, updated_at: new Date().toISOString() }) });
    if (session?.mode === "setup" && session.customer && session.setup_intent && env.STRIPE_SECRET_KEY) {
      const intent = await fetch(`https://api.stripe.com/v1/setup_intents/${encodeURIComponent(session.setup_intent)}`, { headers: { authorization: `Bearer ${env.STRIPE_SECRET_KEY}` } });
      const setup = await intent.json().catch(() => null) as { payment_method?: string } | null;
      if (intent.ok && setup?.payment_method) {
        const params = new URLSearchParams({ "invoice_settings[default_payment_method]": setup.payment_method });
        await fetch(`https://api.stripe.com/v1/customers/${encodeURIComponent(session.customer)}`, { method: "POST", headers: { authorization: `Bearer ${env.STRIPE_SECRET_KEY}`, "content-type": "application/x-www-form-urlencoded" }, body: params });
        const customer = await fetch(`https://api.stripe.com/v1/customers/${encodeURIComponent(session.customer)}`, { headers: { authorization: `Bearer ${env.STRIPE_SECRET_KEY}` } });
        const customerData = await customer.json().catch(() => null) as { metadata?: { profile_id?: string } } | null;
        const profileId = customerData?.metadata?.profile_id;
        if (profileId) await fetch(`${env.SUPABASE_URL}/rest/v1/rpc/record_saved_payment_method`, { method: "POST", headers: { apikey: env.SUPABASE_SERVICE_ROLE_KEY, authorization: `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`, "content-type": "application/json" }, body: JSON.stringify({ target_profile_id: profileId, target_customer_id: session.customer }) });
      }
    }
  }
  return new Response("ok");
}
