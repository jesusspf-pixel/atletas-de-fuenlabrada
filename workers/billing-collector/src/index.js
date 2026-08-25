const jsonHeaders = { "content-type": "application/json" };

async function supabase(env, path, init = {}) {
  const response = await fetch(`${env.SUPABASE_URL}${path}`, {
    ...init,
    headers: {
      apikey: env.SUPABASE_SERVICE_ROLE_KEY,
      authorization: `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`,
      ...jsonHeaders,
      ...(init.headers || {}),
    },
  });
  return { response, data: await response.json().catch(() => null) };
}

async function stripe(env, path, init = {}) {
  const response = await fetch(`https://api.stripe.com/v1/${path}`, {
    ...init,
    headers: { authorization: `Bearer ${env.STRIPE_SECRET_KEY}`, ...(init.headers || {}) },
  });
  return { response, data: await response.json().catch(() => ({})) };
}

async function mark(env, id, status, payload = {}) {
  return supabase(env, `/rest/v1/billing_charge_drafts?id=eq.${encodeURIComponent(id)}`, {
    method: "PATCH",
    headers: { Prefer: "return=minimal" },
    body: JSON.stringify({ status, updated_at: new Date().toISOString(), ...payload }),
  });
}

async function finalizeRegistration(env, draftId) {
  return supabase(env, "/rest/v1/rpc/finalize_paid_registration", { method: "POST", body: JSON.stringify({ target_draft_id: draftId }) });
}

async function sendEmail(env, to, subject, html) {
  if (!env.RESEND_API_KEY || !to) return;
  await fetch("https://api.resend.com/emails", { method: "POST", headers: { authorization: `Bearer ${env.RESEND_API_KEY}`, "content-type": "application/json" }, body: JSON.stringify({ from: "Club Atletas de Fuenlabrada <info@atletasdefuenlabrada.com>", to: [to], subject, html }) });
}

async function collectOne(env, draft) {
  const amount = Number(draft.approved_amount_cents ?? draft.calculated_amount_cents);
  if (!Number.isInteger(amount) || amount <= 0) {
    await mark(env, draft.id, "failed", { admin_note: "Importe automático no válido." });
    return;
  }
  if (!draft.payer_profile_id) {
    await mark(env, draft.id, "failed", { admin_note: "No hay persona pagadora asociada." });
    return;
  }

  const customerResult = await supabase(env, `/rest/v1/stripe_customers?profile_id=eq.${encodeURIComponent(draft.payer_profile_id)}&select=stripe_customer_id`);
  const customerId = customerResult.data?.[0]?.stripe_customer_id;
  if (!customerResult.response.ok || !customerId) {
    await mark(env, draft.id, "failed", { admin_note: "La familia no tiene una tarjeta válida en Stripe." });
    return;
  }

  const customer = await stripe(env, `customers/${encodeURIComponent(customerId)}`);
  const defaultMethod = customer.data?.invoice_settings?.default_payment_method;
  if (!customer.response.ok || !defaultMethod) {
    await mark(env, draft.id, "failed", { admin_note: "La familia debe actualizar su tarjeta en Stripe." });
    return;
  }

  const athleteName = [draft.athlete_first_name, draft.athlete_last_name].filter(Boolean).join(" ") || "atleta";
  const params = new URLSearchParams({
    amount: String(amount),
    currency: "eur",
    customer: customerId,
    payment_method: defaultMethod,
    confirm: "true",
    off_session: "true",
    description: `${draft.charge_kind === "enrolment" ? "Matrícula" : "Cuota"} · Club Atletas de Fuenlabrada · ${athleteName}`,
    "metadata[billing_charge_draft_id]": draft.id,
    "metadata[membership_id]": draft.membership_id,
  });
  const payment = await stripe(env, "payment_intents", {
    method: "POST",
    headers: {
      "content-type": "application/x-www-form-urlencoded",
      // El cron puede reintentarse: esta clave evita un doble cargo.
      "Idempotency-Key": `club-fee-${draft.id}`,
    },
    body: params,
  });

  if (payment.response.ok && payment.data?.status === "succeeded") {
    await mark(env, draft.id, "paid", { provider_reference: payment.data.id, admin_note: null });
    if (draft.charge_kind === "enrolment") await finalizeRegistration(env, draft.id);
    return;
  }
  const error = typeof payment.data?.error?.message === "string" ? payment.data.error.message : "Stripe no ha podido completar el cobro.";
  await mark(env, draft.id, "failed", { admin_note: error.slice(0, 500), next_attempt_at: new Date(Date.now() + 86400000).toISOString() });
  if (draft.charge_kind === "enrolment") {
    const payer = await supabase(env, `/rest/v1/profiles?id=eq.${encodeURIComponent(draft.payer_profile_id)}&select=email`);
    const settings = await supabase(env, "/rest/v1/club_settings?id=eq.true&select=registration_notification_email,contact_email");
    const payerEmail = payer.data?.[0]?.email;
    const clubEmail = settings.data?.[0]?.registration_notification_email || settings.data?.[0]?.contact_email || "info@atletasdefuenlabrada.com";
    await Promise.all([
      sendEmail(env, payerEmail, "No hemos podido validar tu alta", "<p>El banco ha rechazado el pago de la matrícula. Tu alta continúa pendiente.</p><p>Revisa la tarjeta o el saldo. Volveremos a intentarlo pasadas 24 horas.</p>"),
      sendEmail(env, clubEmail, "Nuevo rechazo al reintentar una matrícula", `<p>La matrícula de ${athleteName} continúa rechazada y el alta sigue pendiente.</p>`),
    ]);
  }
}

async function run(env) {
  if (!env.SUPABASE_URL || !env.SUPABASE_SERVICE_ROLE_KEY || !env.STRIPE_SECRET_KEY) {
    throw new Error("Faltan secretos del servicio de cobros.");
  }
  const claimed = await supabase(env, "/rest/v1/rpc/claim_due_billing_charges", {
    method: "POST",
    body: JSON.stringify({ batch_limit: 100 }),
  });
  if (!claimed.response.ok) throw new Error(`No se pudieron reclamar cuotas: ${JSON.stringify(claimed.data)}`);
  for (const draft of claimed.data || []) await collectOne(env, draft);
}

export default {
  async scheduled(_controller, env, ctx) {
    ctx.waitUntil(run(env).catch(error => {
      console.error("Automatic billing run failed", error instanceof Error ? error.message : String(error));
      throw error;
    }));
  },
  async fetch(request, env) {
    // Solo para probar el Worker tras instalar los secretos. No expone cobros
    // ni permite lanzar la recaudación desde Internet.
    if (new URL(request.url).pathname === "/health") return new Response("ok");
    return new Response("Not found", { status: 404 });
  },
};
