const json = (body: unknown, status = 200) =>
  Response.json(body, { status, headers: { "cache-control": "no-store" } });

type Env = {
  STRIPE_SECRET_KEY?: string;
  SUPABASE_URL?: string;
  VITE_SUPABASE_URL?: string;
  SUPABASE_SERVICE_ROLE_KEY?: string;
  VITE_SUPABASE_PUBLISHABLE_KEY?: string;
  VITE_SUPABASE_ANON_KEY?: string;
};

function issuerFromToken(token: string) {
  try {
    const encoded = token.split(".")[1];
    if (!encoded) return "";
    const padded = encoded.replace(/-/g, "+").replace(/_/g, "/").padEnd(Math.ceil(encoded.length / 4) * 4, "=");
    const payload = JSON.parse(atob(padded)) as { iss?: unknown };
    const issuer = typeof payload.iss === "string" ? payload.iss.replace(/\/auth\/v1\/?$/, "") : "";
    return issuer.startsWith("https://") && new URL(issuer).hostname.endsWith(".supabase.co") ? issuer : "";
  } catch {
    return "";
  }
}

export async function onRequestPost(context: any) {
  try {
    const env = context.env as Env;
    const authorization = context.request.headers.get("authorization") || "";
    const body = await context.request.json().catch(() => ({})) as { checkoutSessionId?: unknown };

    if (!env.STRIPE_SECRET_KEY || !authorization.startsWith("Bearer ")) {
      return json({ error: "No se pudo verificar la tarjeta." }, 401);
    }
    if (typeof body.checkoutSessionId !== "string" || !body.checkoutSessionId.startsWith("cs_")) {
      return json({ error: "No se recibió la confirmación de Stripe." }, 400);
    }

    const token = authorization.slice(7);
    const supabaseUrl = env.SUPABASE_URL || env.VITE_SUPABASE_URL || issuerFromToken(token);
    const apiKey = env.SUPABASE_SERVICE_ROLE_KEY || env.VITE_SUPABASE_PUBLISHABLE_KEY || env.VITE_SUPABASE_ANON_KEY;
    if (!supabaseUrl || !apiKey || !env.SUPABASE_SERVICE_ROLE_KEY) {
      return json({ error: "La conexión segura de pagos no está disponible." }, 503);
    }

    const auth = await fetch(`${supabaseUrl}/auth/v1/user`, {
      headers: { apikey: apiKey, authorization },
    });
    const user = await auth.json().catch(() => null) as { id?: string } | null;
    if (!auth.ok || !user?.id) return json({ error: "Tu sesión ha caducado. Vuelve a entrar." }, 401);

    const checkout = await fetch(`https://api.stripe.com/v1/checkout/sessions/${encodeURIComponent(body.checkoutSessionId)}`, {
      headers: { authorization: `Bearer ${env.STRIPE_SECRET_KEY}` },
    });
    const session = await checkout.json().catch(() => null) as {
      mode?: string; status?: string; customer?: string; setup_intent?: string;
    } | null;
    if (!checkout.ok || session?.mode !== "setup" || session.status !== "complete" || !session.customer || !session.setup_intent) {
      return json({ error: "Stripe todavía no ha confirmado la tarjeta. Inténtalo de nuevo en unos segundos." }, 409);
    }

    const customer = await fetch(`https://api.stripe.com/v1/customers/${encodeURIComponent(session.customer)}`, {
      headers: { authorization: `Bearer ${env.STRIPE_SECRET_KEY}` },
    });
    const customerData = await customer.json().catch(() => null) as { metadata?: { profile_id?: string } } | null;
    if (!customer.ok || customerData?.metadata?.profile_id !== user.id) {
      return json({ error: "La tarjeta no corresponde a esta cuenta." }, 403);
    }

    const intent = await fetch(`https://api.stripe.com/v1/setup_intents/${encodeURIComponent(session.setup_intent)}`, {
      headers: { authorization: `Bearer ${env.STRIPE_SECRET_KEY}` },
    });
    const setupIntent = await intent.json().catch(() => null) as { payment_method?: string; status?: string } | null;
    if (!intent.ok || setupIntent?.status !== "succeeded" || !setupIntent.payment_method) {
      return json({ error: "Stripe no pudo dejar preparada la tarjeta." }, 409);
    }

    const setDefault = new URLSearchParams({ "invoice_settings[default_payment_method]": setupIntent.payment_method });
    const defaultResponse = await fetch(`https://api.stripe.com/v1/customers/${encodeURIComponent(session.customer)}`, {
      method: "POST",
      headers: { authorization: `Bearer ${env.STRIPE_SECRET_KEY}`, "content-type": "application/x-www-form-urlencoded" },
      body: setDefault,
    });
    if (!defaultResponse.ok) return json({ error: "No se pudo establecer la tarjeta para los cobros." }, 502);

    const recorded = await fetch(`${supabaseUrl}/rest/v1/rpc/record_saved_payment_method`, {
      method: "POST",
      headers: {
        apikey: env.SUPABASE_SERVICE_ROLE_KEY,
        authorization: `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({ target_profile_id: user.id, target_customer_id: session.customer }),
    });
    if (!recorded.ok) return json({ error: "La tarjeta está en Stripe, pero no se pudo registrar en el club." }, 502);

    return json({ ready: true });
  } catch (error) {
    console.error("Stripe setup confirmation failed", error instanceof Error ? error.message : "unknown error");
    return json({ error: "No se pudo confirmar la tarjeta. Inténtalo de nuevo." }, 502);
  }
}
