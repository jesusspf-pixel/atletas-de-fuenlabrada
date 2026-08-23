const json = (body: unknown, status = 200) => Response.json(body, { status });

const feeByCategory = (raw: string | null | undefined) => {
  const value = (raw || "").toLowerCase().replace(/[_-]/g, " ").replace(/\s+/g, " ").trim();
  if (!value) return null;
  if (value.includes("sub 6") || value.includes("sub-6")) return 4500;
  if (["sub 8","sub 10","sub 12","sub 14","sub 16"].some(x => value.includes(x) || value.includes(x.replace(" ", "-")))) return 6500;
  if (["sub 18","sub 20"].some(x => value.includes(x) || value.includes(x.replace(" ", "-")))) return 7500;
  if (["sub 23","absoluto"].some(x => value.includes(x) || value.includes(x.replace(" ", "-")))) return 9500;
  if (value.includes("master") || value.includes("máster")) return value.includes("running") || value.includes("sin licencia") ? 4500 : 9500;
  if (value.includes("running")) return 4500;
  return null;
};

const stripePost = async (secret: string, path: string, params: URLSearchParams) => {
  const response = await fetch(`https://api.stripe.com/v1/${path}`, {
    method: "POST",
    headers: { authorization: `Bearer ${secret}`, "content-type": "application/x-www-form-urlencoded" },
    body: params,
  });
  const data = await response.json().catch(() => ({}));
  return { response, data };
};

export async function onRequestPost(context: any) {
  const env = context.env as { STRIPE_SECRET_KEY?: string; SUPABASE_URL?: string; SUPABASE_SERVICE_ROLE_KEY?: string };
  if (!env.STRIPE_SECRET_KEY || !env.SUPABASE_URL || !env.SUPABASE_SERVICE_ROLE_KEY) {
    return json({ error: "Stripe todavía no está configurado en el entorno de producción." }, 503);
  }

  const bearer = context.request.headers.get("authorization") || "";
  if (!bearer) return json({ error: "Inicia sesión para configurar el pago." }, 401);
  const { membershipId } = await context.request.json().catch(() => ({})) as { membershipId?: string };
  if (!membershipId) return json({ error: "Falta la cuota que se quiere activar." }, 400);

  const serviceHeaders = {
    apikey: env.SUPABASE_SERVICE_ROLE_KEY,
    authorization: `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`,
    "content-type": "application/json",
  };
  const authResponse = await fetch(`${env.SUPABASE_URL}/auth/v1/user`, { headers: { apikey: env.SUPABASE_SERVICE_ROLE_KEY, authorization: bearer } });
  const user = await authResponse.json().catch(() => null) as { id?: string; email?: string } | null;
  if (!authResponse.ok || !user?.id) return json({ error: "La sesión ya no es válida." }, 401);

  const query = `id,athlete_id,season,plan,enrolment_fee_status,enrolment_fee_cents,fee_provider,billing_status,stripe_subscription_id,athletes(id,first_name,last_name,user_profile_id,family_id,training_category,official_competition_category,training_groups(category_label),families(primary_profile_id))`;
  const membershipResponse = await fetch(`${env.SUPABASE_URL}/rest/v1/memberships?id=eq.${encodeURIComponent(membershipId)}&select=${encodeURIComponent(query)}`, { headers: serviceHeaders });
  const [membership] = await membershipResponse.json().catch(() => []) as any[];
  if (!membershipResponse.ok || !membership) return json({ error: "No se encontró esa cuota." }, 404);

  const athlete = membership.athletes;
  const ownerProfileId = athlete?.user_profile_id || athlete?.families?.primary_profile_id;
  if (!athlete || ownerProfileId !== user.id) return json({ error: "No puedes activar el cobro de esta cuota." }, 403);
  if (membership.stripe_subscription_id && membership.billing_status === "active") return json({ error: "Esta cuota ya tiene una suscripción activa." }, 409);
  if (!['monthly','term'].includes(membership.plan)) return json({ error: "El tipo de cuota no es válido para Stripe." }, 400);

  const priceResponse = await fetch(`${env.SUPABASE_URL}/rest/v1/club_billing_prices?id=eq.true&select=monthly_cents,term_cents,currency`, { headers: serviceHeaders });
  const [prices] = await priceResponse.json().catch(() => []) as any[];
  if (!prices) return json({ error: "Falta la configuración de precios del club." }, 503);
  const recurringAmount = membership.plan === "monthly" ? Number(prices.monthly_cents) : Number(prices.term_cents);
  const intervalCount = membership.plan === "monthly" ? 1 : 3;

  let enrolmentFee = membership.enrolment_fee_status === "paid" ? 0 : Number(membership.enrolment_fee_cents || 0);
  if (!enrolmentFee && membership.enrolment_fee_status !== "paid") {
    const category = athlete.training_category || athlete.official_competition_category || athlete.training_groups?.category_label || null;
    enrolmentFee = feeByCategory(category) || 0;
    if (!enrolmentFee) return json({ error: "Antes de cobrar hay que asignar la categoría del atleta para calcular correctamente la matrícula." }, 409);
  }

  const profileResponse = await fetch(`${env.SUPABASE_URL}/rest/v1/profiles?id=eq.${encodeURIComponent(user.id)}&select=id,email,full_name`, { headers: serviceHeaders });
  const [profile] = await profileResponse.json().catch(() => []) as any[];
  const customerResponse = await fetch(`${env.SUPABASE_URL}/rest/v1/stripe_customers?profile_id=eq.${encodeURIComponent(user.id)}&select=stripe_customer_id`, { headers: serviceHeaders });
  const [savedCustomer] = await customerResponse.json().catch(() => []) as any[];
  let customerId = savedCustomer?.stripe_customer_id as string | undefined;

  if (!customerId) {
    const customerParams = new URLSearchParams();
    customerParams.set("email", profile?.email || user.email || "");
    if (profile?.full_name) customerParams.set("name", profile.full_name);
    customerParams.set("metadata[profile_id]", user.id);
    const created = await stripePost(env.STRIPE_SECRET_KEY, "customers", customerParams);
    if (!created.response.ok || !created.data?.id) return json({ error: created.data?.error?.message || "Stripe no pudo crear el cliente." }, 502);
    customerId = created.data.id;
    await fetch(`${env.SUPABASE_URL}/rest/v1/stripe_customers?on_conflict=profile_id`, {
      method: "POST", headers: { ...serviceHeaders, Prefer: "resolution=merge-duplicates,return=minimal" },
      body: JSON.stringify({ profile_id: user.id, stripe_customer_id: customerId, updated_at: new Date().toISOString() }),
    });
  }

  const origin = new URL(context.request.url).origin;
  const params = new URLSearchParams();
  params.set("mode", "subscription");
  params.set("customer", customerId);
  params.set("success_url", `${origin}/?section=Cuotas&billing=success&session_id={CHECKOUT_SESSION_ID}`);
  params.set("cancel_url", `${origin}/?section=Cuotas&billing=cancelled`);
  params.set("line_items[0][price_data][currency]", prices.currency || "eur");
  params.set("line_items[0][price_data][product_data][name]", membership.plan === "monthly" ? "Cuota mensual · Club Atletas de Fuenlabrada" : "Cuota trimestral · Club Atletas de Fuenlabrada");
  params.set("line_items[0][price_data][unit_amount]", String(recurringAmount));
  params.set("line_items[0][price_data][recurring][interval]", "month");
  params.set("line_items[0][price_data][recurring][interval_count]", String(intervalCount));
  params.set("line_items[0][quantity]", "1");
  if (enrolmentFee > 0) {
    params.set("line_items[1][price_data][currency]", prices.currency || "eur");
    params.set("line_items[1][price_data][product_data][name]", `Matrícula ${membership.season} · ${athlete.first_name} ${athlete.last_name}`);
    params.set("line_items[1][price_data][unit_amount]", String(enrolmentFee));
    params.set("line_items[1][quantity]", "1");
  }
  params.set("metadata[membership_id]", membership.id);
  params.set("metadata[athlete_id]", membership.athlete_id);
  params.set("metadata[profile_id]", user.id);
  params.set("subscription_data[metadata][membership_id]", membership.id);
  params.set("subscription_data[metadata][athlete_id]", membership.athlete_id);
  params.set("subscription_data[metadata][profile_id]", user.id);

  const checkout = await stripePost(env.STRIPE_SECRET_KEY, "checkout/sessions", params);
  if (!checkout.response.ok || !checkout.data?.url) return json({ error: checkout.data?.error?.message || "Stripe no pudo iniciar la suscripción." }, 502);

  await fetch(`${env.SUPABASE_URL}/rest/v1/memberships?id=eq.${encodeURIComponent(membership.id)}`, {
    method: "PATCH",
    headers: { ...serviceHeaders, Prefer: "return=minimal" },
    body: JSON.stringify({
      stripe_checkout_session_id: checkout.data.id,
      enrolment_fee_cents: enrolmentFee,
      stripe_price_amount_cents: recurringAmount,
      billing_status: "checkout_pending",
      fee_provider: "stripe",
      billing_updated_at: new Date().toISOString(),
    }),
  });

  return json({
    url: checkout.data.url,
    summary: {
      athlete: `${athlete.first_name} ${athlete.last_name}`,
      enrolment_cents: enrolmentFee,
      recurring_cents: recurringAmount,
      recurring_every_months: intervalCount,
      total_today_cents: enrolmentFee + recurringAmount,
    },
  });
}
