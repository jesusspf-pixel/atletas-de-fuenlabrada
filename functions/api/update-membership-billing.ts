type Env = {
  SUPABASE_URL?: string;
  SUPABASE_SERVICE_ROLE_KEY?: string;
  VITE_SUPABASE_PUBLISHABLE_KEY?: string;
};

type RequestBody = {
  membershipId?: string;
  plan?: "monthly" | "term";
  enrolmentFeeCents?: number;
  firstChargeMode?: "prorated" | "full" | "custom";
  firstChargeCents?: number | null;
  rebuildSchedule?: boolean;
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
  if (!env.SUPABASE_URL || !env.SUPABASE_SERVICE_ROLE_KEY || !authorization.startsWith("Bearer ")) {
    return json({ error: "El servicio de cuotas no está disponible." }, 503);
  }

  const body = (await request.json().catch(() => ({}))) as RequestBody;
  if (!body.membershipId || !["monthly", "term"].includes(body.plan || "")) {
    return json({ error: "Falta seleccionar una cuota válida." }, 400);
  }
  if (!["prorated", "full", "custom"].includes(body.firstChargeMode || "")) {
    return json({ error: "El criterio de la próxima cuota no es válido." }, 400);
  }
  if (body.firstChargeMode === "custom" && (!Number.isInteger(body.firstChargeCents) || Number(body.firstChargeCents) < 0 || Number(body.firstChargeCents) > 100000)) {
    return json({ error: "Indica un importe personalizado válido." }, 400);
  }
  if (body.enrolmentFeeCents != null && (!Number.isInteger(body.enrolmentFeeCents) || body.enrolmentFeeCents < 0 || body.enrolmentFeeCents > 100000)) {
    return json({ error: "El importe de matrícula no es válido." }, 400);
  }

  const authResponse = await fetch(`${env.SUPABASE_URL}/auth/v1/user`, {
    headers: {
      apikey: env.VITE_SUPABASE_PUBLISHABLE_KEY || env.SUPABASE_SERVICE_ROLE_KEY,
      authorization,
    },
  });
  const user = (await authResponse.json().catch(() => null)) as { id?: string } | null;
  if (!authResponse.ok || !user?.id) return json({ error: "La sesión ha caducado." }, 401);

  const headers = dbHeaders(env);
  const profileResponse = await fetch(`${env.SUPABASE_URL}/rest/v1/profiles?id=eq.${encodeURIComponent(user.id)}&select=role`, { headers });
  const role = (await profileResponse.json().catch(() => []))?.[0]?.role;
  if (!["owner", "admin"].includes(role)) return json({ error: "Solo administración puede modificar cuotas." }, 403);

  const membershipUrl = `${env.SUPABASE_URL}/rest/v1/memberships?id=eq.${encodeURIComponent(body.membershipId)}`;
  const currentResponse = await fetch(`${membershipUrl}&select=id,plan,enrolment_fee_cents,first_recurring_charge_mode,first_recurring_charge_cents`, { headers });
  const current = (await currentResponse.json().catch(() => []))?.[0];
  if (!currentResponse.ok || !current) return json({ error: "No se encontró la cuota del atleta." }, 404);

  if (body.rebuildSchedule) {
    const inProgressResponse = await fetch(
      `${env.SUPABASE_URL}/rest/v1/billing_charge_drafts?membership_id=eq.${encodeURIComponent(body.membershipId)}&status=in.(collecting,checkout_pending)&select=id&limit=1`,
      { headers },
    );
    const inProgress = await inProgressResponse.json().catch(() => []);
    if (Array.isArray(inProgress) && inProgress.length) {
      return json({ error: "Hay un cobro procesándose. Espera a que termine antes de cambiar la cuota." }, 409);
    }
  }

  const firstChargeCents = body.firstChargeMode === "custom" ? body.firstChargeCents : null;
  const update: Record<string, unknown> = {
    plan: body.plan,
    first_recurring_charge_mode: body.firstChargeMode,
    first_recurring_charge_cents: firstChargeCents,
    billing_updated_at: new Date().toISOString(),
  };
  if (body.enrolmentFeeCents != null) update.enrolment_fee_cents = body.enrolmentFeeCents;

  const updateResponse = await fetch(membershipUrl, {
    method: "PATCH",
    headers: { ...headers, Prefer: "return=representation" },
    body: JSON.stringify(update),
  });
  const updated = (await updateResponse.json().catch(() => []))?.[0];
  if (!updateResponse.ok || !updated) return json({ error: "No se pudo guardar la cuota." }, 502);

  if (body.rebuildSchedule) {
    const rebuildResponse = await fetch(`${env.SUPABASE_URL}/rest/v1/rpc/rebuild_membership_fee_schedule`, {
      method: "POST",
      headers,
      body: JSON.stringify({ target_membership_id: body.membershipId }),
    });
    if (!rebuildResponse.ok) {
      await fetch(membershipUrl, {
        method: "PATCH",
        headers: { ...headers, Prefer: "return=minimal" },
        body: JSON.stringify({
          plan: current.plan,
          enrolment_fee_cents: current.enrolment_fee_cents,
          first_recurring_charge_mode: current.first_recurring_charge_mode,
          first_recurring_charge_cents: current.first_recurring_charge_cents,
          billing_updated_at: new Date().toISOString(),
        }),
      });
      const detail = await rebuildResponse.text().catch(() => "");
      return json({ error: detail || "La cuota se guardó, pero no se pudo reconstruir el calendario; se ha restaurado la configuración anterior." }, 502);
    }
  }

  const verificationResponse = await fetch(
    `${membershipUrl}&select=id,plan,enrolment_fee_cents,first_recurring_charge_mode,first_recurring_charge_cents,billing_updated_at`,
    { headers },
  );
  const verified = (await verificationResponse.json().catch(() => []))?.[0];
  const verificationFailed = !verificationResponse.ok
    || !verified
    || verified.plan !== body.plan
    || verified.first_recurring_charge_mode !== body.firstChargeMode
    || (verified.first_recurring_charge_cents ?? null) !== (firstChargeCents ?? null)
    || (body.enrolmentFeeCents != null && verified.enrolment_fee_cents !== body.enrolmentFeeCents);
  if (verificationFailed) {
    return json({ error: "El cambio no pudo verificarse después de guardarlo." }, 502);
  }

  return json({ ok: true, membership: verified, scheduleRebuilt: Boolean(body.rebuildSchedule) });
};
