const encoder = new TextEncoder();
const toHex = (buffer: ArrayBuffer) => Array.from(new Uint8Array(buffer)).map(byte => byte.toString(16).padStart(2, "0")).join("");

async function validSignature(payload: string, signature: string, secret: string) {
  const parts = Object.fromEntries(signature.split(",").map(part => part.split("=", 2)));
  if (!parts.t || !parts.v1 || Math.abs(Math.floor(Date.now() / 1000) - Number(parts.t)) > 300) return false;
  const key = await crypto.subtle.importKey("raw", encoder.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  return toHex(await crypto.subtle.sign("HMAC", key, encoder.encode(`${parts.t}.${payload}`))) === parts.v1;
}

export async function onRequestPost(context: any) {
  const env = context.env as { STRIPE_WEBHOOK_SECRET?: string; STRIPE_SECRET_KEY?: string; SUPABASE_URL?: string; SUPABASE_SERVICE_ROLE_KEY?: string; RESEND_API_KEY?: string };
  const payload = await context.request.text(); const signature = context.request.headers.get("stripe-signature") || "";
  if (!env.STRIPE_WEBHOOK_SECRET || !env.SUPABASE_URL || !env.SUPABASE_SERVICE_ROLE_KEY || !(await validSignature(payload, signature, env.STRIPE_WEBHOOK_SECRET))) return new Response("Invalid webhook", { status: 400 });
  const event = JSON.parse(payload) as any;
  if (event.type === "checkout.session.completed") {
    const session = event.data?.object; const orderId = session?.metadata?.order_id;
    const draftId = session?.metadata?.billing_charge_draft_id;
    if (orderId) await fetch(`${env.SUPABASE_URL}/rest/v1/club_orders?id=eq.${encodeURIComponent(orderId)}`, { method: "PATCH", headers: { apikey: env.SUPABASE_SERVICE_ROLE_KEY, authorization: `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`, "content-type": "application/json", Prefer: "return=minimal" }, body: JSON.stringify({ status: "paid", payment_status: "paid", stripe_checkout_session_id: session?.id, updated_at: new Date().toISOString() }) });
    if (draftId) await fetch(`${env.SUPABASE_URL}/rest/v1/billing_charge_drafts?id=eq.${encodeURIComponent(draftId)}`, { method: "PATCH", headers: { apikey: env.SUPABASE_SERVICE_ROLE_KEY, authorization: `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`, "content-type": "application/json", Prefer: "return=minimal" }, body: JSON.stringify({ status: "paid", provider_reference: session?.id, updated_at: new Date().toISOString() }) });
    if (session?.mode === "subscription" && session?.metadata?.membership_id && session?.subscription) {
      await fetch(`${env.SUPABASE_URL}/rest/v1/memberships?id=eq.${encodeURIComponent(session.metadata.membership_id)}`, { method: "PATCH", headers: { apikey: env.SUPABASE_SERVICE_ROLE_KEY, authorization: `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`, "content-type": "application/json", Prefer: "return=minimal" }, body: JSON.stringify({ stripe_subscription_id: session.subscription, billing_status: "active", fee_provider: "stripe", billing_updated_at: new Date().toISOString() }) });
    }
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
  if (event.type === "invoice.payment_failed") {
    const invoice = event.data?.object || {};
    const subscriptionId = typeof invoice.subscription === "string" ? invoice.subscription : invoice.parent?.subscription_details?.subscription;
    const reason = invoice.last_finalization_error?.message || invoice.last_payment_error?.message || "Stripe ha indicado que el banco rechazó la cuota.";
    const headers = { apikey: env.SUPABASE_SERVICE_ROLE_KEY, authorization: `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`, "content-type": "application/json" };
    const membershipResponse = subscriptionId ? await fetch(`${env.SUPABASE_URL}/rest/v1/memberships?stripe_subscription_id=eq.${encodeURIComponent(subscriptionId)}&select=id,athlete_id,athletes(first_name,last_name,user_profile_id,families(primary_profile_id))&limit=1`, { headers }) : null;
    const membership = membershipResponse ? (await membershipResponse.json().catch(() => []))?.[0] : null;
    if (membership) {
      await fetch(`${env.SUPABASE_URL}/rest/v1/memberships?id=eq.${membership.id}`, { method: "PATCH", headers: { ...headers, Prefer: "return=minimal" }, body: JSON.stringify({ billing_status: "past_due", billing_updated_at: new Date().toISOString() }) });
      const draftResponse = await fetch(`${env.SUPABASE_URL}/rest/v1/billing_charge_drafts?membership_id=eq.${membership.id}&charge_kind=eq.recurring&status=in.(approved,checkout_pending)&order=scheduled_for.asc&limit=1&select=id`, { headers });
      const draft = (await draftResponse.json().catch(() => []))?.[0];
      if (draft?.id) await fetch(`${env.SUPABASE_URL}/rest/v1/billing_charge_drafts?id=eq.${draft.id}`, { method: "PATCH", headers: { ...headers, Prefer: "return=minimal" }, body: JSON.stringify({ status: "failed", provider_reference: invoice.id, admin_note: reason.slice(0,500), next_attempt_at: new Date(Date.now()+86400000).toISOString(), updated_at: new Date().toISOString() }) });
      if (env.RESEND_API_KEY) {
        const payerId = membership.athletes?.user_profile_id || membership.athletes?.families?.primary_profile_id;
        const recipients = await fetch(`${env.SUPABASE_URL}/rest/v1/profiles?or=(id.eq.${payerId || "00000000-0000-0000-0000-000000000000"},role.in.(owner,admin))&select=email`, { headers }).then(response => response.json()).catch(() => []);
        const emails = [...new Set((recipients || []).map((row:any)=>row.email).filter(Boolean))];
        if (emails.length) await fetch("https://api.resend.com/emails", { method: "POST", headers: { authorization: `Bearer ${env.RESEND_API_KEY}`, "content-type": "application/json" }, body: JSON.stringify({ from: "Club Atletas de Fuenlabrada <info@atletasdefuenlabrada.com>", to: emails, subject: "Cuota rechazada · Club Atletas de Fuenlabrada", html: `<p>Stripe ha rechazado una cuota de ${membership.athletes?.first_name || "un atleta"} ${membership.athletes?.last_name || ""}.</p><p>Motivo: ${String(reason).replace(/[<>&]/g, "")}</p><p>El pago queda pendiente de revisión y reintento.</p>` }) });
      }
    }
  }
  return new Response("ok");
}
