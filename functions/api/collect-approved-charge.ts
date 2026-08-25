const json = (body: unknown, status = 200) => Response.json(body, { status, headers: { "cache-control": "no-store" } });
type Env = { STRIPE_SECRET_KEY?: string; SUPABASE_URL?: string; SUPABASE_SERVICE_ROLE_KEY?: string; VITE_SUPABASE_PUBLISHABLE_KEY?: string; RESEND_API_KEY?: string };
const dbHeaders = (env: Env) => ({ apikey: env.SUPABASE_SERVICE_ROLE_KEY!, authorization: `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`, "content-type": "application/json" });
async function email(env: Env, to: string, subject: string, html: string) {
  if (!env.RESEND_API_KEY || !to) return;
  await fetch("https://api.resend.com/emails", { method: "POST", headers: { authorization: `Bearer ${env.RESEND_API_KEY}`, "content-type": "application/json" }, body: JSON.stringify({ from: "Club Atletas de Fuenlabrada <info@atletasdefuenlabrada.com>", to: [to], subject, html }) });
}
export async function onRequestPost(context: any) {
  const env = context.env as Env; const authorization = context.request.headers.get("authorization") || "";
  if (!env.STRIPE_SECRET_KEY || !env.SUPABASE_URL || !env.SUPABASE_SERVICE_ROLE_KEY || !authorization.startsWith("Bearer ")) return json({ error: "El servicio de cobro no está disponible." }, 503);
  const body = await context.request.json().catch(() => ({})) as { draftId?: string };
  if (!body.draftId) return json({ error: "Falta el cobro de matrícula." }, 400);
  const auth = await fetch(`${env.SUPABASE_URL}/auth/v1/user`, { headers: { apikey: env.VITE_SUPABASE_PUBLISHABLE_KEY || env.SUPABASE_SERVICE_ROLE_KEY, authorization } });
  const user = await auth.json().catch(() => null) as { id?: string } | null;
  if (!auth.ok || !user?.id) return json({ error: "La sesión ha caducado." }, 401);
  const profile = await fetch(`${env.SUPABASE_URL}/rest/v1/profiles?id=eq.${user.id}&select=role`, { headers: dbHeaders(env) });
  const role = (await profile.json().catch(() => []))?.[0]?.role;
  if (!['owner','admin'].includes(role)) return json({ error: "Solo administración puede validar un alta." }, 403);

  const drafts = await fetch(`${env.SUPABASE_URL}/rest/v1/billing_charge_drafts?id=eq.${encodeURIComponent(body.draftId)}&select=id,membership_id,athlete_id,payer_profile_id,charge_kind,approved_amount_cents,calculated_amount_cents,status`, { headers: dbHeaders(env) });
  const draft = (await drafts.json().catch(() => []))?.[0];
  if (!draft || draft.charge_kind !== 'enrolment') return json({ error: "No se encontró la matrícula." }, 404);
  if (!['approved','failed','paid'].includes(draft.status)) return json({ error: "La matrícula no está aprobada para cobrar." }, 409);
  if (draft.status === 'paid') {
    const finalized = await fetch(`${env.SUPABASE_URL}/rest/v1/rpc/finalize_paid_registration`, { method: "POST", headers: dbHeaders(env), body: JSON.stringify({ target_draft_id: draft.id }) });
    return finalized.ok ? json({ ok: true, paid: true }) : json({ error: "La matrícula está cobrada, pero el alta necesita reintentar la activación." }, 502);
  }
  const amount = Number(draft.approved_amount_cents ?? draft.calculated_amount_cents);
  if (!Number.isInteger(amount) || amount <= 0 || amount > 100000) return json({ error: "El importe de matrícula no es válido." }, 409);
  const customerResponse = await fetch(`${env.SUPABASE_URL}/rest/v1/stripe_customers?profile_id=eq.${draft.payer_profile_id}&select=stripe_customer_id`, { headers: dbHeaders(env) });
  const customerId = (await customerResponse.json().catch(() => []))?.[0]?.stripe_customer_id;
  let failure = "La cuenta no tiene una tarjeta válida en Stripe.";
  if (customerId) {
    const customerResponse = await fetch(`https://api.stripe.com/v1/customers/${encodeURIComponent(customerId)}`, { headers: { authorization: `Bearer ${env.STRIPE_SECRET_KEY}` } });
    const customer = await customerResponse.json().catch(() => ({})) as { invoice_settings?: { default_payment_method?: string } };
    const method = customer.invoice_settings?.default_payment_method;
    if (customerResponse.ok && method) {
      const params = new URLSearchParams({ amount: String(amount), currency: "eur", customer: customerId, payment_method: method, confirm: "true", off_session: "true", description: "Matrícula · Club Atletas de Fuenlabrada", "metadata[billing_charge_draft_id]": draft.id, "metadata[membership_id]": draft.membership_id });
      const paymentResponse = await fetch("https://api.stripe.com/v1/payment_intents", { method: "POST", headers: { authorization: `Bearer ${env.STRIPE_SECRET_KEY}`, "content-type": "application/x-www-form-urlencoded", "Idempotency-Key": `club-enrolment-${draft.id}` }, body: params });
      const payment = await paymentResponse.json().catch(() => ({})) as { id?: string; status?: string; error?: { message?: string } };
      if (paymentResponse.ok && payment.status === 'succeeded') {
        const marked = await fetch(`${env.SUPABASE_URL}/rest/v1/billing_charge_drafts?id=eq.${draft.id}`, { method: "PATCH", headers: { ...dbHeaders(env), Prefer: "return=minimal" }, body: JSON.stringify({ status: "paid", provider_reference: payment.id, admin_note: null, updated_at: new Date().toISOString() }) });
        const finalized = marked.ok ? await fetch(`${env.SUPABASE_URL}/rest/v1/rpc/finalize_paid_registration`, { method: "POST", headers: dbHeaders(env), body: JSON.stringify({ target_draft_id: draft.id }) }) : null;
        return marked.ok && finalized?.ok ? json({ ok: true, paid: true }) : json({ error: "Stripe ha cobrado la matrícula, pero el alta necesita reintentar la activación." }, 502);
      }
      failure = payment.error?.message || "El banco ha rechazado el pago de la matrícula.";
    }
  }
  const retryAt = new Date(Date.now() + 86400000).toISOString();
  await Promise.all([
    fetch(`${env.SUPABASE_URL}/rest/v1/billing_charge_drafts?id=eq.${draft.id}`, { method: "PATCH", headers: { ...dbHeaders(env), Prefer: "return=minimal" }, body: JSON.stringify({ status: "failed", admin_note: failure.slice(0,500), next_attempt_at: retryAt, updated_at: new Date().toISOString() }) }),
    fetch(`${env.SUPABASE_URL}/rest/v1/athletes?id=eq.${draft.athlete_id}`, { method: "PATCH", headers: { ...dbHeaders(env), Prefer: "return=minimal" }, body: JSON.stringify({ club_status: "pending_review" }) }),
    fetch(`${env.SUPABASE_URL}/rest/v1/memberships?id=eq.${draft.membership_id}`, { method: "PATCH", headers: { ...dbHeaders(env), Prefer: "return=minimal" }, body: JSON.stringify({ fee_provider: "paused", billing_started_on: null }) }),
    fetch(`${env.SUPABASE_URL}/rest/v1/billing_charge_drafts?membership_id=eq.${draft.membership_id}&charge_kind=eq.recurring&status=eq.approved`, { method: "DELETE", headers: { ...dbHeaders(env), Prefer: "return=minimal" } }),
  ]);
  const payer = await fetch(`${env.SUPABASE_URL}/rest/v1/profiles?id=eq.${draft.payer_profile_id}&select=email`, { headers: dbHeaders(env) });
  const payerEmail = (await payer.json().catch(() => []))?.[0]?.email || "";
  const settings = await fetch(`${env.SUPABASE_URL}/rest/v1/club_settings?id=eq.true&select=registration_notification_email,contact_email`, { headers: dbHeaders(env) });
  const setting = (await settings.json().catch(() => []))?.[0] || {};
  await Promise.all([
    email(env, payerEmail, "No hemos podido validar tu alta", `<p>Tu alta no se ha podido validar porque el banco ha rechazado el pago de la matrícula.</p><p>Revisa la tarjeta o el saldo. Volveremos a intentarlo pasadas 24 horas.</p>`),
    email(env, setting.registration_notification_email || setting.contact_email || "info@atletasdefuenlabrada.com", "Pago rechazado en una validación", `<p>El alta sigue pendiente porque Stripe ha rechazado la matrícula.</p><p>Motivo: ${failure.replace(/[<>&]/g, '')}</p>`),
  ]);
  return json({ error: "El banco ha rechazado la matrícula. El atleta sigue pendiente y se reintentará pasadas 24 horas." }, 402);
}
