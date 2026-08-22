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
  const payload = await context.request.text();
  const signature = context.request.headers.get("stripe-signature") || "";
  if (!env.STRIPE_WEBHOOK_SECRET || !env.SUPABASE_URL || !env.SUPABASE_SERVICE_ROLE_KEY || !(await validSignature(payload, signature, env.STRIPE_WEBHOOK_SECRET))) {
    return new Response("Invalid webhook", { status: 400 });
  }

  const event = JSON.parse(payload) as { type?: string; data?: { object?: any } };
  const object = event.data?.object || {};
  const headers = {
    apikey: env.SUPABASE_SERVICE_ROLE_KEY,
    authorization: `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`,
    "content-type": "application/json",
    Prefer: "return=minimal",
  };

  if (event.type === "checkout.session.completed") {
    const orderId = object.metadata?.order_id;
    if (orderId) {
      await fetch(`${env.SUPABASE_URL}/rest/v1/club_orders?id=eq.${encodeURIComponent(orderId)}`, {
        method: "PATCH",
        headers,
        body: JSON.stringify({ status: "paid", payment_status: "paid", stripe_checkout_session_id: object.id, updated_at: new Date().toISOString() }),
      });
    }

    const membershipId = object.metadata?.membership_id;
    if (membershipId) {
      await fetch(`${env.SUPABASE_URL}/rest/v1/memberships?id=eq.${encodeURIComponent(membershipId)}`, {
        method: "PATCH",
        headers,
        body: JSON.stringify({
          stripe_checkout_session_id: object.id,
          stripe_subscription_id: typeof object.subscription === "string" ? object.subscription : object.subscription?.id || null,
          billing_status: "active",
          enrolment_fee_status: "paid",
          fee_provider: "stripe",
          billing_updated_at: new Date().toISOString(),
        }),
      });
    }
  }

  if (event.type === "invoice.paid" || event.type === "invoice.payment_failed") {
    const subscriptionId = typeof object.subscription === "string" ? object.subscription : object.subscription?.id;
    if (subscriptionId) {
      const nextBilling = object.lines?.data?.find((line: any) => line.period?.end)?.period?.end;
      await fetch(`${env.SUPABASE_URL}/rest/v1/memberships?stripe_subscription_id=eq.${encodeURIComponent(subscriptionId)}`, {
        method: "PATCH",
        headers,
        body: JSON.stringify({
          billing_status: event.type === "invoice.paid" ? "active" : "past_due",
          next_billing_on: nextBilling ? new Date(Number(nextBilling) * 1000).toISOString().slice(0, 10) : null,
          billing_updated_at: new Date().toISOString(),
        }),
      });
    }
  }

  if (event.type === "customer.subscription.deleted") {
    const subscriptionId = object.id;
    if (subscriptionId) {
      await fetch(`${env.SUPABASE_URL}/rest/v1/memberships?stripe_subscription_id=eq.${encodeURIComponent(subscriptionId)}`, {
        method: "PATCH",
        headers,
        body: JSON.stringify({ billing_status: "cancelled", next_billing_on: null, billing_updated_at: new Date().toISOString() }),
      });
    }
  }

  return new Response("ok");
}
