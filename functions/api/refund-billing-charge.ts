type Env = {
  STRIPE_SECRET_KEY?: string;
  SUPABASE_URL?: string;
  SUPABASE_SERVICE_ROLE_KEY?: string;
  VITE_SUPABASE_PUBLISHABLE_KEY?: string;
};

const json = (body: unknown, status = 200) =>
  Response.json(body, { status, headers: { "cache-control": "no-store" } });

const dbHeaders = (env: Env) => ({
  apikey: env.SUPABASE_SERVICE_ROLE_KEY!,
  authorization: `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`,
  "content-type": "application/json",
});

export const onRequestPost: PagesFunction<Env> = async ({ request, env }) => {
  const authorization = request.headers.get("authorization") || "";
  if (!env.STRIPE_SECRET_KEY || !env.SUPABASE_URL || !env.SUPABASE_SERVICE_ROLE_KEY || !authorization.startsWith("Bearer ")) {
    return json({ error: "El servicio de reembolsos no está disponible." }, 503);
  }
  const body = (await request.json().catch(() => ({}))) as { draftId?: string; reason?: string };
  const reason = (body.reason || "").trim();
  if (!body.draftId || reason.length < 10 || reason.length > 300) return json({ error: "Indica el cargo y un motivo válido." }, 400);

  const authResponse = await fetch(`${env.SUPABASE_URL}/auth/v1/user`, {
    headers: { apikey: env.VITE_SUPABASE_PUBLISHABLE_KEY || env.SUPABASE_SERVICE_ROLE_KEY, authorization },
  });
  const user = (await authResponse.json().catch(() => null)) as { id?: string } | null;
  if (!authResponse.ok || !user?.id) return json({ error: "La sesión ha caducado." }, 401);
  const headers = dbHeaders(env);
  const profileResponse = await fetch(`${env.SUPABASE_URL}/rest/v1/profiles?id=eq.${encodeURIComponent(user.id)}&select=role`, { headers });
  const role = (await profileResponse.json().catch(() => []))?.[0]?.role;
  if (!["owner", "admin"].includes(role)) return json({ error: "Solo administración puede reembolsar cargos." }, 403);

  const draftResponse = await fetch(`${env.SUPABASE_URL}/rest/v1/billing_charge_drafts?id=eq.${encodeURIComponent(body.draftId)}&select=id,status,provider_reference,approved_amount_cents,calculated_amount_cents`, { headers });
  const draft = (await draftResponse.json().catch(() => []))?.[0];
  if (!draft) return json({ error: "No se encontró el cargo." }, 404);
  if (draft.status !== "paid" || !String(draft.provider_reference || "").startsWith("pi_")) {
    return json({ error: "Este movimiento no es un cobro reembolsable de Stripe." }, 409);
  }

  const amount = Number(draft.approved_amount_cents ?? draft.calculated_amount_cents);
  const params = new URLSearchParams({
    payment_intent: draft.provider_reference,
    amount: String(amount),
    reason: "requested_by_customer",
    "metadata[billing_charge_draft_id]": draft.id,
    "metadata[admin_reason]": reason,
  });
  const refundResponse = await fetch("https://api.stripe.com/v1/refunds", {
    method: "POST",
    headers: {
      authorization: `Bearer ${env.STRIPE_SECRET_KEY}`,
      "content-type": "application/x-www-form-urlencoded",
      "Idempotency-Key": `club-refund-${draft.id}`,
    },
    body: params,
  });
  const refund = (await refundResponse.json().catch(() => ({}))) as { id?: string; status?: string; error?: { message?: string } };
  if (!refundResponse.ok || !refund.id) return json({ error: refund.error?.message || "Stripe no pudo realizar el reembolso." }, 502);

  const marked = await fetch(`${env.SUPABASE_URL}/rest/v1/billing_charge_drafts?id=eq.${encodeURIComponent(draft.id)}`, {
    method: "PATCH",
    headers: { ...headers, Prefer: "return=minimal" },
    body: JSON.stringify({
      status: "cancelled",
      admin_note: `Reembolsado en Stripe (${refund.id}). ${reason}`,
      override_reason: `Reembolso administrativo: ${reason}`,
      updated_at: new Date().toISOString(),
    }),
  });
  if (!marked.ok) return json({ error: `Stripe ha reembolsado el cargo (${refund.id}), pero el histórico necesita revisión manual.` }, 502);
  return json({ ok: true, refundId: refund.id, status: refund.status || "succeeded" });
};
