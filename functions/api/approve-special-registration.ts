type Env = {
  SUPABASE_URL?: string;
  SUPABASE_SERVICE_ROLE_KEY?: string;
  VITE_SUPABASE_PUBLISHABLE_KEY?: string;
};

type RequestBody = {
  athleteId?: string;
  membershipId?: string;
  enrolmentFeeCents?: number;
  recurringOverrideCents?: number;
  recurringStartsOn?: string;
  recurringOverrideReason?: string;
};

const json = (body: unknown, status = 200) =>
  Response.json(body, { status, headers: { "cache-control": "no-store" } });

const headers = (env: Env) => ({
  apikey: env.SUPABASE_SERVICE_ROLE_KEY!,
  authorization: `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`,
  "content-type": "application/json",
});

const monthSchedule = (startsOn: string) => {
  const start = new Date(`${startsOn}T12:00:00Z`);
  const seasonEndYear = start.getUTCMonth() >= 6 ? start.getUTCFullYear() + 1 : start.getUTCFullYear();
  const dates: string[] = [];
  let year = start.getUTCFullYear();
  let month = start.getUTCMonth();
  while (year < seasonEndYear || (year === seasonEndYear && month <= 5)) {
    dates.push(`${year}-${String(month + 1).padStart(2, "0")}-05`);
    month += 1;
    if (month === 12) {
      month = 0;
      year += 1;
    }
  }
  return dates;
};

export const onRequestPost: PagesFunction<Env> = async ({ request, env }) => {
  const authorization = request.headers.get("authorization") || "";
  if (!env.SUPABASE_URL || !env.SUPABASE_SERVICE_ROLE_KEY || !authorization.startsWith("Bearer ")) {
    return json({ error: "El servicio de altas especiales no está disponible." }, 503);
  }

  const body = (await request.json().catch(() => ({}))) as RequestBody;
  const reason = (body.recurringOverrideReason || "").trim();
  if (!body.athleteId || !body.membershipId) return json({ error: "Falta identificar el alta." }, 400);
  if (!Number.isInteger(body.enrolmentFeeCents) || Number(body.enrolmentFeeCents) < 0 || Number(body.enrolmentFeeCents) > 100000) {
    return json({ error: "La matrícula no es válida." }, 400);
  }
  if (!Number.isInteger(body.recurringOverrideCents) || Number(body.recurringOverrideCents) < 0 || Number(body.recurringOverrideCents) > 100000) {
    return json({ error: "La cuota mensual acordada no es válida." }, 400);
  }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(body.recurringStartsOn || "")) return json({ error: "La fecha del acuerdo no es válida." }, 400);
  if (reason.length < 10 || reason.length > 300) return json({ error: "El motivo de la excepción debe tener entre 10 y 300 caracteres." }, 400);

  const authResponse = await fetch(`${env.SUPABASE_URL}/auth/v1/user`, {
    headers: { apikey: env.VITE_SUPABASE_PUBLISHABLE_KEY || env.SUPABASE_SERVICE_ROLE_KEY, authorization },
  });
  const user = (await authResponse.json().catch(() => null)) as { id?: string } | null;
  if (!authResponse.ok || !user?.id) return json({ error: "La sesión ha caducado." }, 401);

  const dbHeaders = headers(env);
  const profileResponse = await fetch(`${env.SUPABASE_URL}/rest/v1/profiles?id=eq.${encodeURIComponent(user.id)}&select=role`, { headers: dbHeaders });
  const role = (await profileResponse.json().catch(() => []))?.[0]?.role;
  if (!["owner", "admin"].includes(role)) return json({ error: "Solo administración puede validar esta excepción." }, 403);

  const [athleteResponse, membershipResponse, paidRecurringResponse] = await Promise.all([
    fetch(`${env.SUPABASE_URL}/rest/v1/athletes?id=eq.${encodeURIComponent(body.athleteId)}&select=id,user_profile_id,family_id,club_status`, { headers: dbHeaders }),
    fetch(`${env.SUPABASE_URL}/rest/v1/memberships?id=eq.${encodeURIComponent(body.membershipId)}&athlete_id=eq.${encodeURIComponent(body.athleteId)}&select=id,plan,enrolment_fee_cents,first_recurring_charge_mode,first_recurring_charge_cents,billing_started_on,fee_provider`, { headers: dbHeaders }),
    fetch(`${env.SUPABASE_URL}/rest/v1/billing_charge_drafts?membership_id=eq.${encodeURIComponent(body.membershipId)}&charge_kind=eq.recurring&status=eq.paid&select=id&limit=1`, { headers: dbHeaders }),
  ]);
  const athlete = (await athleteResponse.json().catch(() => []))?.[0];
  const membership = (await membershipResponse.json().catch(() => []))?.[0];
  const paidRecurring = await paidRecurringResponse.json().catch(() => []);
  if (!athlete || !membership) return json({ error: "No se encontró la inscripción pendiente." }, 404);
  if (athlete.club_status !== "pending_review") return json({ error: "Esta inscripción ya no está pendiente de validación." }, 409);
  if (Array.isArray(paidRecurring) && paidRecurring.length) return json({ error: "Ya existe una cuota cobrada; revisa el expediente antes de validar." }, 409);

  let payerProfileId = athlete.user_profile_id || null;
  if (!payerProfileId && athlete.family_id) {
    const familyResponse = await fetch(`${env.SUPABASE_URL}/rest/v1/families?id=eq.${encodeURIComponent(athlete.family_id)}&select=primary_profile_id`, { headers: dbHeaders });
    payerProfileId = (await familyResponse.json().catch(() => []))?.[0]?.primary_profile_id || null;
  }
  if (!payerProfileId) return json({ error: "No se encontró al responsable del pago." }, 409);

  const cleanupDrafts = async () => {
    await fetch(`${env.SUPABASE_URL}/rest/v1/billing_charge_drafts?membership_id=eq.${encodeURIComponent(body.membershipId!)}&status=neq.paid`, {
      method: "DELETE",
      headers: { ...dbHeaders, Prefer: "return=minimal" },
    });
  };

  const membershipUpdate = await fetch(`${env.SUPABASE_URL}/rest/v1/memberships?id=eq.${encodeURIComponent(body.membershipId)}`, {
    method: "PATCH",
    headers: { ...dbHeaders, Prefer: "return=minimal" },
    body: JSON.stringify({
      plan: "monthly",
      enrolment_fee_cents: body.enrolmentFeeCents,
      enrolment_fee_status: "approved",
      first_recurring_charge_mode: "custom",
      first_recurring_charge_cents: body.recurringOverrideCents,
      billing_started_on: body.recurringStartsOn,
      fee_provider: "stripe",
      billing_updated_at: new Date().toISOString(),
    }),
  });
  if (!membershipUpdate.ok) return json({ error: "No se pudo guardar el acuerdo económico." }, 502);

  await cleanupDrafts();
  const enrolmentResponse = await fetch(`${env.SUPABASE_URL}/rest/v1/billing_charge_drafts`, {
    method: "POST",
    headers: { ...dbHeaders, Prefer: "return=representation" },
    body: JSON.stringify({
      membership_id: body.membershipId,
      athlete_id: body.athleteId,
      payer_profile_id: payerProfileId,
      charge_kind: "enrolment",
      scheduled_for: new Date().toISOString().slice(0, 10),
      calculated_amount_cents: body.enrolmentFeeCents,
      approved_amount_cents: body.enrolmentFeeCents,
      status: "approved",
      approved_by: user.id,
      approved_at: new Date().toISOString(),
      override_reason: `Descuento familiar aprobado. ${reason}`,
      calculation_snapshot: { approval: "admin_special_agreement", non_reusable_exception: true },
    }),
  });
  const enrolmentDraft = (await enrolmentResponse.json().catch(() => []))?.[0];
  if (!enrolmentResponse.ok || !enrolmentDraft?.id) {
    await cleanupDrafts();
    return json({ error: "No se pudo preparar la matrícula." }, 502);
  }

  const recurringDrafts = monthSchedule(body.recurringStartsOn!).map((scheduledFor) => {
    const [year, month] = scheduledFor.split("-").map(Number);
    const periodEnd = new Date(Date.UTC(year, month, 0)).toISOString().slice(0, 10);
    return {
      membership_id: body.membershipId,
      athlete_id: body.athleteId,
      payer_profile_id: payerProfileId,
      charge_kind: "recurring",
      period_starts_on: `${scheduledFor.slice(0, 7)}-01`,
      period_ends_on: periodEnd,
      scheduled_for: scheduledFor,
      calculated_amount_cents: body.recurringOverrideCents,
      approved_amount_cents: body.recurringOverrideCents,
      discount_cents: 0,
      status: "approved",
      approved_by: user.id,
      approved_at: new Date().toISOString(),
      override_reason: `Excepción individual: ${reason}`,
      calculation_snapshot: {
        plan: "monthly",
        automatic: true,
        approval: "admin_special_agreement",
        recurring_override_cents: body.recurringOverrideCents,
        recurring_starts_on: body.recurringStartsOn,
        recurring_override_reason: reason,
        non_reusable_exception: true,
      },
    };
  });
  if (!recurringDrafts.length) {
    await cleanupDrafts();
    return json({ error: "La fecha del acuerdo queda fuera de la temporada." }, 400);
  }
  const recurringResponse = await fetch(`${env.SUPABASE_URL}/rest/v1/billing_charge_drafts`, {
    method: "POST",
    headers: { ...dbHeaders, Prefer: "return=minimal" },
    body: JSON.stringify(recurringDrafts),
  });
  if (!recurringResponse.ok) {
    await cleanupDrafts();
    return json({ error: "No se pudo crear el calendario mensual especial." }, 502);
  }

  const athleteUpdate = await fetch(`${env.SUPABASE_URL}/rest/v1/athletes?id=eq.${encodeURIComponent(body.athleteId)}`, {
    method: "PATCH",
    headers: { ...dbHeaders, Prefer: "return=minimal" },
    body: JSON.stringify({ club_status: "active" }),
  });
  if (!athleteUpdate.ok) {
    await cleanupDrafts();
    return json({ error: "El calendario se preparó, pero no se pudo activar el alta." }, 502);
  }

  return json({ ok: true, enrolmentDraftId: enrolmentDraft.id, recurringDraftCount: recurringDrafts.length });
};
