const json = (body: unknown, status = 200) => Response.json(body, { status, headers: { "cache-control": "no-store" } });

const stripe = async (secret: string, path: string, init: RequestInit = {}) => {
  const response = await fetch(`https://api.stripe.com/v1/${path}`, {
    ...init,
    headers: { authorization: `Bearer ${secret}`, ...(init.headers || {}) },
  });
  return { response, data: await response.json().catch(() => ({})) };
};

const integrationId = () => `club_billing_${Array.from(crypto.getRandomValues(new Uint8Array(8))).map(value => String.fromCharCode(97 + (value % 26))).join("")}`;

function issuerFromBearer(authorization: string) {
  try {
    const payload = authorization.slice(7).split(".")[1];
    const decoded = atob(payload.replace(/-/g, "+").replace(/_/g, "/") + "=".repeat((4 - (payload.length % 4)) % 4));
    const issuer = JSON.parse(decoded).iss as string | undefined;
    const parsed = issuer ? new URL(issuer) : null;
    return parsed?.protocol === "https:" && parsed.hostname.endsWith(".supabase.co") ? issuer.replace(/\/auth\/v1\/?$/, "") : "";
  } catch {
    return "";
  }
}

export async function onRequestPost(context: { request: Request; env: { STRIPE_SECRET_KEY?: string } }) {
  const { request, env } = context;
  const authorization = request.headers.get("authorization") || "";
  const publicKey = request.headers.get("x-supabase-key") || "";
  const { draftId } = await request.json().catch(() => ({})) as { draftId?: string };
  const issuer = issuerFromBearer(authorization);

  if (!env.STRIPE_SECRET_KEY) return json({ error: "El cobro con tarjeta no está disponible todavía." }, 503);
  if (!authorization.startsWith("Bearer ") || !publicKey || !draftId || !issuer) return json({ error: "Inicia sesión de nuevo antes de preparar el pago." }, 401);

  const authResponse = await fetch(`${issuer}/auth/v1/user`, { headers: { authorization } });
  const user = await authResponse.json().catch(() => null) as { id?: string } | null;
  if (!authResponse.ok || !user?.id) return json({ error: "La sesión ya no es válida." }, 401);

  // No se usa una clave administrativa: la consulta y la actualización se hacen
  // con el usuario actual y las políticas RLS del club son la autorización.
  const dbHeaders = { apikey: publicKey, authorization, "content-type": "application/json" };
  const select = "id,membership_id,payer_profile_id,charge_kind,status,approved_amount_cents,calculated_amount_cents,athletes(first_name,last_name)";
  const draftResponse = await fetch(`${issuer}/rest/v1/billing_charge_drafts?id=eq.${encodeURIComponent(draftId)}&select=${encodeURIComponent(select)}`, { headers: dbHeaders });
  const [draft] = await draftResponse.json().catch(() => []) as any[];
  if (!draftResponse.ok || !draft) return json({ error: "No se encontró el cobro o no tienes permiso para prepararlo." }, 404);
  if (draft.status !== "approved") return json({ error: "Solo se puede preparar un pago cuando la cuota está aprobada." }, 409);

  const amount = Number(draft.approved_amount_cents ?? draft.calculated_amount_cents);
  if (!Number.isInteger(amount) || amount <= 0) return json({ error: "El importe aprobado no es válido." }, 409);

  // El cliente Stripe se busca por la persona pagadora, no por quien administra
  // el cobro. Es el mismo cliente creado al pulsar «Añadir o cambiar tarjeta».
  const payerId = draft.payer_profile_id || user.id;
  const query = encodeURIComponent(`metadata['profile_id']:'${payerId}'`);
  const customers = await stripe(env.STRIPE_SECRET_KEY, `customers/search?query=${query}&limit=1`);
  const customerId = customers.data?.data?.[0]?.id as string | undefined;
  if (!customers.response.ok) return json({ error: customers.data?.error?.message || "No se pudo comprobar la tarjeta en Stripe." }, 502);
  if (!customerId) return json({ error: "La persona pagadora debe añadir primero su tarjeta desde su apartado de Cuotas." }, 409);

  const athleteName = [draft.athletes?.first_name, draft.athletes?.last_name].filter(Boolean).join(" ") || "atleta";
  const origin = new URL(request.url).origin;
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

  const checkout = await stripe(env.STRIPE_SECRET_KEY, "checkout/sessions", {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: params,
  });
  if (!checkout.response.ok || !checkout.data?.url) return json({ error: checkout.data?.error?.message || "Stripe no pudo preparar el pago." }, 502);

  const updateResponse = await fetch(`${issuer}/rest/v1/billing_charge_drafts?id=eq.${encodeURIComponent(draft.id)}`, {
    method: "PATCH",
    headers: { ...dbHeaders, Prefer: "return=minimal" },
    body: JSON.stringify({ status: "checkout_pending", provider_reference: checkout.data.id, updated_at: new Date().toISOString() }),
  });
  if (!updateResponse.ok) return json({ url: checkout.data.url, warning: "El pago está preparado; actualiza la cuota después de completarlo." });
  return json({ url: checkout.data.url });
}
