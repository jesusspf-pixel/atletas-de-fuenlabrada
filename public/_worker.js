const json = (body, status = 200) => Response.json(body, { status, headers: { "content-type": "application/json; charset=utf-8" } });

const stripePost = async (secret, path, params) => {
  const response = await fetch(`https://api.stripe.com/v1/${path}`, {
    method: "POST",
    headers: { authorization: `Bearer ${secret}`, "content-type": "application/x-www-form-urlencoded" },
    body: params,
  });
  return { response, data: await response.json().catch(() => ({})) };
};

const integrationId = () => `club_payment_method_${Array.from(crypto.getRandomValues(new Uint8Array(8))).map(value => String.fromCharCode(97 + (value % 26))).join("")}`;

async function createPaymentMethodSetup(request, env) {
  if (!env.STRIPE_SECRET_KEY || !env.SUPABASE_URL || !env.SUPABASE_SERVICE_ROLE_KEY) return json({ error: "Stripe no está configurado en producción." }, 503);

  const bearer = request.headers.get("authorization") || "";
  const authResponse = await fetch(`${env.SUPABASE_URL}/auth/v1/user`, {
    headers: { apikey: env.SUPABASE_SERVICE_ROLE_KEY, authorization: bearer },
  });
  const user = await authResponse.json().catch(() => null);
  if (!authResponse.ok || !user?.id) return json({ error: "Tu sesión ha caducado. Entra de nuevo antes de añadir la tarjeta." }, 401);

  const customerParams = new URLSearchParams();
  customerParams.set("email", user.email || "");
  customerParams.set("metadata[profile_id]", user.id);
  const customer = await stripePost(env.STRIPE_SECRET_KEY, "customers", customerParams);
  if (!customer.response.ok || !customer.data?.id) return json({ error: customer.data?.error?.message || "Stripe no pudo preparar tu ficha de pago." }, 502);

  const origin = new URL(request.url).origin;
  const checkoutParams = new URLSearchParams();
  checkoutParams.set("mode", "setup");
  checkoutParams.set("customer", customer.data.id);
  checkoutParams.set("success_url", `${origin}/?payment_method=updated`);
  checkoutParams.set("cancel_url", `${origin}/?payment_method=cancelled`);
  checkoutParams.set("integration_identifier", integrationId());
  const checkout = await stripePost(env.STRIPE_SECRET_KEY, "checkout/sessions", checkoutParams);
  if (!checkout.response.ok || !checkout.data?.url) return json({ error: checkout.data?.error?.message || "Stripe no pudo abrir la pantalla segura." }, 502);

  return json({ url: checkout.data.url });
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (url.pathname === "/api/create-payment-method-setup") {
      if (request.method !== "POST") return json({ error: "Método no permitido." }, 405);
      try {
        return await createPaymentMethodSetup(request, env);
      } catch (error) {
        return json({ error: `Error al abrir Stripe: ${error instanceof Error ? error.message : "error inesperado"}` }, 500);
      }
    }
    return env.ASSETS.fetch(request);
  },
};
