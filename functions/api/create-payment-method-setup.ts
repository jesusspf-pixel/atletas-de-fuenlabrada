const json = (body: unknown, status = 200) =>
  Response.json(body, { status, headers: { "cache-control": "no-store" } });

type Env = {
  STRIPE_SECRET_KEY?: string;
  SUPABASE_URL?: string;
  SUPABASE_SERVICE_ROLE_KEY?: string;
  VITE_SUPABASE_PUBLISHABLE_KEY?: string;
  VITE_SUPABASE_ANON_KEY?: string;
};

async function stripe(secret: string, path: string, init: RequestInit = {}) {
  const response = await fetch(`https://api.stripe.com/v1/${path}`, {
    ...init,
    headers: { authorization: `Bearer ${secret}`, ...init.headers },
  });
  return { response, data: await response.json().catch(() => ({})) as Record<string, any> };
}

function issuerFromToken(token: string) {
  try {
    const encoded = token.split(".")[1];
    if (!encoded) return "";
    const payload = JSON.parse(atob(encoded.replace(/-/g, "+").replace(/_/g, "/"))) as { iss?: unknown };
    const issuer = typeof payload.iss === "string" ? payload.iss.replace(/\/auth\/v1\/?$/, "") : "";
    return issuer.startsWith("https://") && new URL(issuer).hostname.endsWith(".supabase.co") ? issuer : "";
  } catch {
    return "";
  }
}

export async function onRequestPost(context: any) {
  try {
    const env = context.env as Env;
    if (!env.STRIPE_SECRET_KEY) return json({ error: "El servicio de tarjeta no está disponible todavía." }, 503);

    const authorization = context.request.headers.get("authorization") || "";
    if (!authorization.startsWith("Bearer ")) return json({ error: "Inicia sesión para añadir la tarjeta." }, 401);

    const token = authorization.slice(7);
    const supabaseUrl = env.SUPABASE_URL || issuerFromToken(token);
    const apiKey = env.SUPABASE_SERVICE_ROLE_KEY || env.VITE_SUPABASE_PUBLISHABLE_KEY || env.VITE_SUPABASE_ANON_KEY;
    if (!supabaseUrl || !apiKey) return json({ error: "La conexión de acceso no está preparada todavía." }, 503);

    const auth = await fetch(`${supabaseUrl}/auth/v1/user`, { headers: { authorization, apikey: apiKey } });
    const user = await auth.json().catch(() => null) as { id?: string; email?: string } | null;
    if (!auth.ok || !user?.id) return json({ error: "Tu sesión ha caducado. Vuelve a entrar antes de añadir la tarjeta." }, 401);

    // Stripe is the source of truth. The card setup must not depend on an
    // optional local stripe_customers table, which may not exist yet.
    const query = encodeURIComponent(`metadata['profile_id']:'${user.id}'`);
    const existing = await stripe(env.STRIPE_SECRET_KEY, `customers/search?query=${query}&limit=1`);
    if (!existing.response.ok) return json({ error: "No se pudo preparar tu ficha de pago." }, 502);

    let customerId = existing.data.data?.[0]?.id as string | undefined;
    if (!customerId) {
      const customerParams = new URLSearchParams({ "metadata[profile_id]": user.id });
      if (user.email) customerParams.set("email", user.email);
      const created = await stripe(env.STRIPE_SECRET_KEY, "customers", {
        method: "POST",
        headers: { "content-type": "application/x-www-form-urlencoded" },
        body: customerParams,
      });
      if (!created.response.ok || typeof created.data.id !== "string") {
        return json({ error: "No se pudo preparar tu ficha de pago." }, 502);
      }
      customerId = created.data.id;
    }

    const origin = new URL(context.request.url).origin;
    const checkoutParams = new URLSearchParams({
      mode: "setup",
      customer: customerId,
      success_url: `${origin}/?access=1&section=Cuotas&payment_method=updated`,
      cancel_url: `${origin}/?access=1&section=Cuotas&payment_method=cancelled`,
      "metadata[profile_id]": user.id,
    });
    const checkout = await stripe(env.STRIPE_SECRET_KEY, "checkout/sessions", {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: checkoutParams,
    });
    if (!checkout.response.ok || typeof checkout.data.url !== "string") {
      return json({ error: checkout.data.error?.message || "No se pudo abrir Stripe." }, 502);
    }
    return json({ url: checkout.data.url });
  } catch {
    // Never return an HTML runtime error to the app.
    return json({ error: "No se pudo preparar el formulario de tarjeta. Inténtalo de nuevo." }, 502);
  }
}
