const json = (body: unknown, status = 200) => Response.json(body, { status });

const stripePost = async (secret: string, path: string, params: URLSearchParams) => {
  const response = await fetch(`https://api.stripe.com/v1/${path}`, {
    method: "POST",
    headers: { authorization: `Bearer ${secret}`, "content-type": "application/x-www-form-urlencoded" },
    body: params,
  });
  return { response, data: await response.json().catch(() => ({})) };
};

const integrationId = () => `club_billing_${Array.from(crypto.getRandomValues(new Uint8Array(8))).map(value => String.fromCharCode(97 + (value % 26))).join("")}`;

export async function onRequestPost(context: any) {
  const env = context.env as { STRIPE_SECRET_KEY?: string; SUPABASE_URL?: string; SUPABASE_SERVICE_ROLE_KEY?: string };
  if (!env.STRIPE_SECRET_KEY || !env.SUPABASE_URL || !env.SUPABASE_SERVICE_ROLE_KEY) return json({ error: "Stripe todavía no está configurado." }, 503);

  const bearer = context.request.headers.get("authorization") || "";
  const { draftId } = await context.request.json().catch(() => ({})) as { draftId?: string };
  if (!bearer || !draftId) return json({ error: "Inicia sesión y selecciona un cobro aprobado." }, 401);

  const serviceHeaders = { apikey: env.SUPABASE_SERVICE_ROLE_KEY, authorization: `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`, "content-type": "application/json" };
  const authResponse = await fetch(`${env.SUPABASE_URL}/auth/v1/user`, { headers: { apikey: env.SUPABASE_SERVICE_ROLE_KEY, authorization: bearer } });
  const user = await authResponse.json().catch(() => null) as { id?: string; email?: string } | null;
  if (!authResponse.ok || !user?.id) return json({ error: "La sesión ya no es válida." }, 401);

  const draftQuery = "id,membership_id,payer_profile_id,charge_kind,status,approved_amount_cents,calculated_amount_cents,athletes(first_name,last_name)";
  const draftResponse = await fetch(`${env.SUPABASE_URL}/rest/v1/billing_charge_drafts?id=eq.${encodeURIComponent(draftId)}&select=${encodeURIComponent(draftQuery)}`, { headers: serviceHeaders });
  const [draft] = await draftResponse.json().catch(() => []) as any[];
  if (!draftResponse.ok || !draft) return json({ error: "No se encontró el cobro." }, 404);
  if (draft.status !== "approved") return json({ error: "Solo se puede preparar un pago cuando la cuota está aprobada." }, 409);

  const roleResponse = await fetch(`${env.SUPABASE_URL}/rest/v1/profiles?id=eq.${encodeURIComponent(user.id)}&select=role`, { headers: serviceHeaders });
  const [profile] = await roleResponse.json().catch(() => []) as any[];
  const manager = ["owner", "admin"].includes(profile?.role);
  if (!manager && draft.payer_profile_id !== user.id) return json({ error: "No puedes abrir este pago." }, 403);

  const amount = Number(draft.approved_amount_cents ?? draft.calculated_amount_cents);
  if (!Number.isInteger(amount) || amount <= 0) return json({ error: "El importe aprobado no es válido." }, 409);

  const payerResponse = await fetch(`${env.SUPABASE_URL}/rest/v1/profiles?id=eq.${encodeURIComponent(draft.payer_profile_id || user.id)}&select=id,email,full_name`, { headers: serviceHeaders });
  const [payer] = await payerResponse.json().catch(() => []) as any[];
  const customerResponse = await fetch(`${env.SUPABASE_URL}/rest/v1/stripe_customers?profile_id=eq.${encodeURIComponent(draft.payer_profile_id || user.id)}&select=stripe_customer_id`, { headers: serviceHeaders });
  const [savedCustomer] = await customerResponse.json().catch(() => []) as any[];
  let customerId = savedCustomer?.stripe_customer_id as string | undefined;

  if (!customerId) {
    const customerParams = new URLSearchParams();
    customerParams.set("email", payer?.email || user.email || "");
    if (payer?.full_name) customerParams.set("name", payer.full_name);
    customerParams.set("metadata[profile_id]", draft.payer_profile_id || user.id);
    const created = await stripePost(env.STRIPE_SECRET_KEY, "customers", customerParams);
    if (!created.response.ok || !created.data?.id) return json({ error: created.data?.error?.message || "Stripe no pudo crear el cliente." }, 502);
    customerId = created.data.id;
    await fetch(`${env.SUPABASE_URL}/rest/v1/stripe_customers?on_conflict=profile_id`, { method: "POST", headers: { ...serviceHeaders, Prefer: "resolution=merge-duplicates,return=minimal" }, body: JSON.stringify({ profile_id: draft.payer_profile_id || user.id, stripe_customer_id: customerId, updated_at: new Date().toISOString() }) });
  }

  const athleteName = [draft.athletes?.first_name, draft.athletes?.last_name].filter(Boolean).join(" ") || "atleta";
  const origin = new URL(context.request.url).origin;
  const params = new URLSearchParams();
  params.set("mode", "payment");
  params.set("customer", customerId);
  params.set("success_url", `${origin}/?section=Cuotas&charge=success`);
  params.set("cancel_url", `${origin}/?section=Cuotas&charge=cancelled`);
  params.set("line_items[0][price_data][currency]", "eur");
  params.set("line_items[0][price_data][product_data][name]", `${draft.charge_kind === "enrolment" ? "Matrícula" : "Cuota"} · Club Atletas de Fuenlabrada · ${athleteName}`);
  params.set("line_items[0][price_data][unit_amount]", String(amount));
  params.set("line_items[0][quantity]", "1");
  params.set("metadata[billing_charge_draft_id]", draft.id);
  params.set("metadata[membership_id]", draft.membership_id);
  params.set("payment_intent_data[metadata][billing_charge_draft_id]", draft.id);
  params.set("payment_intent_data[setup_future_usage]", "off_session");
  params.set("integration_identifier", integrationId());

  const checkout = await stripePost(env.STRIPE_SECRET_KEY, "checkout/sessions", params);
  if (!checkout.response.ok || !checkout.data?.url) return json({ error: checkout.data?.error?.message || "Stripe no pudo preparar el pago." }, 502);
  await fetch(`${env.SUPABASE_URL}/rest/v1/billing_charge_drafts?id=eq.${encodeURIComponent(draft.id)}`, { method: "PATCH", headers: { ...serviceHeaders, Prefer: "return=minimal" }, body: JSON.stringify({ status: "checkout_pending", provider_reference: checkout.data.id, updated_at: new Date().toISOString() }) });
  return json({ url: checkout.data.url });
}
