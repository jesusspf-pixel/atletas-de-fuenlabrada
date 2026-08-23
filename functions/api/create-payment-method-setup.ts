const json = (body: unknown, status = 200) => Response.json(body, { status, headers: { "cache-control": "no-store" } });

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

  const serviceHeaders = env.SUPABASE_SERVICE_ROLE_KEY
    ? { apikey: env.SUPABASE_SERVICE_ROLE_KEY, authorization: `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`, "content-type": "application/json" }
    : null;
  let customerId: string | undefined;
  if (serviceHeaders) {
    const saved = await fetch(`${supabaseUrl}/rest/v1/stripe_customers?profile_id=eq.${encodeURIComponent(user.id)}&select=stripe_customer_id`, { headers: serviceHeaders });
    const [row] = await saved.json().catch(() => []) as { stripe_customer_id?: string }[];
    customerId = row?.stripe_customer_id;
  }
  if (!customerId) {
    const query = encodeURIComponent(`metadata['profile_id']:'${user.id}'`);
    const existing = await stripe(env.STRIPE_SECRET_KEY, `customers/search?query=${query}&limit=1`);
    if (!existing.response.ok) return json({ error: "No se pudo preparar tu ficha de pago." }, 502);
    customerId = existing.data.data?.[0]?.id as string | undefined;
  }
  if (!customerId) {
    const params = new URLSearchParams({ "metadata[profile_id]": user.id });
    if (user.email) params.set("email", user.email);
    const created = await stripe(env.STRIPE_SECRET_KEY, "customers", { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" }, body: params });
    if (!created.response.ok || typeof created.data.id !== "string") return json({ error: "No se pudo preparar tu ficha de pago." }, 502);
    customerId = created.data.id;
  }
  if (serviceHeaders) {
    await fetch(`${supabaseUrl}/rest/v1/stripe_customers?on_conflict=profile_id`, {
      method: "POST",
      headers: { ...serviceHeaders, Prefer: "resolution=merge-duplicates,return=minimal" },
      body: JSON.stringify({ profile_id: user.id, stripe_customer_id: customerId, updated_at: new Date().toISOString() }),
    });
  }

  const origin = new URL(context.request.url).origin;
  const params = new URLSearchParams({
    mode: "setup",
    customer: customerId,
    success_url: `${origin}/?access=1&section=Cuotas&payment_method=updated`,
    cancel_url: `${origin}/?access=1&section=Cuotas&payment_method=cancelled`,
    "metadata[profile_id]": user.id,
    integration_identifier: `club_payment_method_${crypto.randomUUID().replace(/-/g, "").slice(0, 8)}`,
  });
  const checkout = await stripe(env.STRIPE_SECRET_KEY, "checkout/sessions", { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" }, body: params });
  if (!checkout.response.ok || typeof checkout.data.url !== "string") return json({ error: checkout.data.error?.message || "No se pudo abrir Stripe." }, 502);
  return json({ url: checkout.data.url });
}
