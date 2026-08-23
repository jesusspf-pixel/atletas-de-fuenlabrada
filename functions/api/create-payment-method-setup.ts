const json = (body: unknown, status = 200) =>
  Response.json(body, { status, headers: { "cache-control": "no-store" } });

type Env = {
  STRIPE_SECRET_KEY?: string;
  SUPABASE_URL?: string;
  SUPABASE_SERVICE_ROLE_KEY?: string;
};

async function stripePost(secret: string, path: string, params: URLSearchParams) {
  const response = await fetch(`https://api.stripe.com/v1/${path}`, {
    method: "POST",
    headers: {
      authorization: `Bearer ${secret}`,
      "content-type": "application/x-www-form-urlencoded",
    },
    body: params,
  });
  return { response, data: await response.json().catch(() => ({})) as Record<string, any> };
}

export async function onRequestPost(context: any) {
  try {
    const env = context.env as Env;
    if (!env.STRIPE_SECRET_KEY || !env.SUPABASE_URL || !env.SUPABASE_SERVICE_ROLE_KEY) {
      return json({ error: "El servicio de tarjeta no está configurado todavía." }, 503);
    }

    const authorization = context.request.headers.get("authorization") || "";
    if (!authorization.startsWith("Bearer ")) return json({ error: "Inicia sesión para añadir la tarjeta." }, 401);

    const serviceHeaders = {
      apikey: env.SUPABASE_SERVICE_ROLE_KEY,
      authorization: `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`,
      "content-type": "application/json",
    };
    const auth = await fetch(`${env.SUPABASE_URL}/auth/v1/user`, {
      headers: { apikey: env.SUPABASE_SERVICE_ROLE_KEY, authorization },
    });
    const user = await auth.json().catch(() => null) as { id?: string; email?: string } | null;
    if (!auth.ok || !user?.id) return json({ error: "Tu sesión ha caducado. Vuelve a entrar antes de añadir la tarjeta." }, 401);

    const profileResponse = await fetch(
      `${env.SUPABASE_URL}/rest/v1/profiles?id=eq.${encodeURIComponent(user.id)}&select=email,full_name`,
      { headers: serviceHeaders },
    );
    const [profile] = await profileResponse.json().catch(() => []) as { email?: string; full_name?: string }[];

    const savedResponse = await fetch(
      `${env.SUPABASE_URL}/rest/v1/stripe_customers?profile_id=eq.${encodeURIComponent(user.id)}&select=stripe_customer_id`,
      { headers: serviceHeaders },
    );
    const [saved] = await savedResponse.json().catch(() => []) as { stripe_customer_id?: string }[];
    let customerId = saved?.stripe_customer_id;

    if (!customerId) {
      const customerParams = new URLSearchParams({ "metadata[profile_id]": user.id });
      const email = profile?.email || user.email;
      if (email) customerParams.set("email", email);
      if (profile?.full_name) customerParams.set("name", profile.full_name);
      const created = await stripePost(env.STRIPE_SECRET_KEY, "customers", customerParams);
      if (!created.response.ok || typeof created.data.id !== "string") {
        return json({ error: created.data.error?.message || "Stripe no pudo preparar tu ficha de pago." }, 502);
      }
      customerId = created.data.id;
      // This mapping is used later by the automatic approved-charge workflow.
      await fetch(`${env.SUPABASE_URL}/rest/v1/stripe_customers?on_conflict=profile_id`, {
        method: "POST",
        headers: { ...serviceHeaders, Prefer: "resolution=merge-duplicates,return=minimal" },
        body: JSON.stringify({ profile_id: user.id, stripe_customer_id: customerId, updated_at: new Date().toISOString() }),
      });
    }

    const origin = new URL(context.request.url).origin;
    const checkoutParams = new URLSearchParams({
      mode: "setup",
      customer: customerId,
      success_url: `${origin}/?access=1&section=Cuotas&payment_method=updated`,
      cancel_url: `${origin}/?access=1&section=Cuotas&payment_method=cancelled`,
      "metadata[profile_id]": user.id,
    });
    const checkout = await stripePost(env.STRIPE_SECRET_KEY, "checkout/sessions", checkoutParams);
    if (!checkout.response.ok || typeof checkout.data.url !== "string") {
      return json({ error: checkout.data.error?.message || "Stripe no pudo abrir el formulario de tarjeta." }, 502);
    }
    return json({ url: checkout.data.url });
  } catch {
    return json({ error: "No se pudo preparar el formulario de tarjeta. Inténtalo de nuevo." }, 502);
  }
}
