type Env = {
  SUPABASE_URL?: string;
  SUPABASE_SERVICE_ROLE_KEY?: string;
  RESEND_API_KEY?: string;
  STRIPE_SECRET_KEY?: string;
};

type Athlete = {
  id: string;
  first_name: string;
  last_name: string;
  club_status: string;
  family_id?: string | null;
  user_profile_id?: string | null;
};

type Membership = {
  id: string;
  athlete_id: string;
  plan: "monthly" | "term";
  stripe_subscription_id?: string | null;
  billing_status: string;
  suspension_reason?: string | null;
  ends_on?: string | null;
  created_at?: string;
};

const withdrawalReason = "Baja solicitada por el usuario";

const allowedOrigins = new Set([
  "https://atletasdefuenlabrada.com",
  "https://www.atletasdefuenlabrada.com",
  "https://localhost",
  "capacitor://localhost",
]);

const cors = (request: Request) => {
  const origin = request.headers.get("origin") || "";
  return allowedOrigins.has(origin)
    ? {
        "access-control-allow-origin": origin,
        "access-control-allow-headers": "authorization, content-type",
        "access-control-allow-methods": "GET, POST, OPTIONS",
        vary: "Origin",
      }
    : {};
};

const reply = (request: Request, body: unknown, status = 200) =>
  Response.json(body, {
    status,
    headers: { ...cors(request), "cache-control": "no-store" },
  });

const safe = (value: unknown) =>
  String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");

const madridDate = () =>
  new Intl.DateTimeFormat("en-CA", {
    timeZone: "Europe/Madrid",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());

const dateAtEndOfMonth = (date: string) => {
  const [year, month] = date.split("-").map(Number);
  return new Date(Date.UTC(year, month, 0)).toISOString().slice(0, 10);
};

const inferredCoverageEnd = (
  scheduledFor: string,
  plan: "monthly" | "term",
) => {
  if (plan === "monthly") return dateAtEndOfMonth(scheduledFor);
  const [year, month] = scheduledFor.split("-").map(Number);
  if (month >= 9 && month <= 11) return `${year}-11-30`;
  if (month === 12) return `${year + 1}-02-${new Date(Date.UTC(year + 1, 2, 0)).getUTCDate()}`;
  if (month <= 2) return `${year}-02-${new Date(Date.UTC(year, 2, 0)).getUTCDate()}`;
  return `${year}-06-30`;
};

const dbHeaders = (env: Env) => ({
  apikey: env.SUPABASE_SERVICE_ROLE_KEY!,
  authorization: `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`,
  "content-type": "application/json",
});

const getJson = async <T>(response: Response, fallback: T): Promise<T> =>
  (await response.json().catch(() => fallback)) as T;

async function currentUser(request: Request, env: Env) {
  const authorization = request.headers.get("authorization") || "";
  if (!authorization.startsWith("Bearer ")) return null;
  const response = await fetch(`${env.SUPABASE_URL}/auth/v1/user`, {
    headers: {
      apikey: env.SUPABASE_SERVICE_ROLE_KEY!,
      authorization,
    },
  });
  const user = await getJson<{ id?: string; email?: string } | null>(
    response,
    null,
  );
  return response.ok && user?.id && user.email ? user : null;
}

async function athletesForUser(env: Env, userId: string) {
  const headers = dbHeaders(env);
  const profileResponse = await fetch(
    `${env.SUPABASE_URL}/rest/v1/profiles?id=eq.${encodeURIComponent(userId)}&select=full_name,role`,
    { headers },
  );
  const [profile] = await getJson<
    { full_name?: string | null; role?: string }[]
  >(profileResponse, []);
  if (!profile || !["parent", "adult_athlete", "minor_athlete"].includes(profile.role || "")) {
    return { profile, athletes: [] as Athlete[] };
  }

  const [directResponse, ownedFamiliesResponse, guardedFamiliesResponse] =
    await Promise.all([
      fetch(
        `${env.SUPABASE_URL}/rest/v1/athletes?user_profile_id=eq.${encodeURIComponent(userId)}&select=id,first_name,last_name,club_status,family_id,user_profile_id`,
        { headers },
      ),
      fetch(
        `${env.SUPABASE_URL}/rest/v1/families?primary_profile_id=eq.${encodeURIComponent(userId)}&select=id`,
        { headers },
      ),
      fetch(
        `${env.SUPABASE_URL}/rest/v1/family_guardians?profile_id=eq.${encodeURIComponent(userId)}&access_status=eq.active&select=family_id`,
        { headers },
      ),
    ]);

  const direct = await getJson<Athlete[]>(directResponse, []);
  const ownedFamilies = await getJson<{ id: string }[]>(
    ownedFamiliesResponse,
    [],
  );
  const guardedFamilies = await getJson<{ family_id: string }[]>(
    guardedFamiliesResponse,
    [],
  );
  const familyIds = [
    ...new Set([
      ...ownedFamilies.map((item) => item.id),
      ...guardedFamilies.map((item) => item.family_id),
    ]),
  ];
  let familyAthletes: Athlete[] = [];
  if (familyIds.length) {
    const response = await fetch(
      `${env.SUPABASE_URL}/rest/v1/athletes?family_id=in.(${familyIds.map(encodeURIComponent).join(",")})&select=id,first_name,last_name,club_status,family_id,user_profile_id`,
      { headers },
    );
    familyAthletes = await getJson<Athlete[]>(response, []);
  }
  const athletes = [...direct, ...familyAthletes].filter(
    (athlete, index, rows) =>
      rows.findIndex((candidate) => candidate.id === athlete.id) === index,
  );
  return { profile, athletes };
}

async function finalizeExpiredWithdrawals(env: Env, today: string) {
  const headers = dbHeaders(env);
  const response = await fetch(
    `${env.SUPABASE_URL}/rest/v1/memberships?suspension_reason=eq.${encodeURIComponent(withdrawalReason)}&ends_on=lt.${today}&select=id,athlete_id`,
    { headers },
  );
  const expired = await getJson<{ id: string; athlete_id: string }[]>(
    response,
    [],
  );
  if (!response.ok || !expired.length) return;
  const athleteIds = [...new Set(expired.map((item) => item.athlete_id))];
  const membershipIds = expired.map((item) => item.id);
  const now = new Date().toISOString();
  await Promise.all([
    fetch(
      `${env.SUPABASE_URL}/rest/v1/athletes?id=in.(${athleteIds.join(",")})&club_status=neq.withdrawn`,
      {
        method: "PATCH",
        headers: { ...headers, Prefer: "return=minimal" },
        body: JSON.stringify({ club_status: "withdrawn", updated_at: now }),
      },
    ),
    fetch(
      `${env.SUPABASE_URL}/rest/v1/memberships?id=in.(${membershipIds.join(",")})`,
      {
        method: "PATCH",
        headers: { ...headers, Prefer: "return=minimal" },
        body: JSON.stringify({
          billing_status: "cancelled",
          access_suspended_at: now,
          billing_updated_at: now,
        }),
      },
    ),
  ]);
}

async function withdrawalDates(env: Env, athleteIds: string[]) {
  if (!athleteIds.length) return new Map<string, string>();
  const response = await fetch(
    `${env.SUPABASE_URL}/rest/v1/memberships?athlete_id=in.(${athleteIds.join(",")})&suspension_reason=eq.${encodeURIComponent(withdrawalReason)}&select=athlete_id,ends_on,created_at&order=created_at.desc`,
    { headers: dbHeaders(env) },
  );
  const rows = await getJson<
    { athlete_id: string; ends_on: string | null; created_at: string }[]
  >(response, []);
  const dates = new Map<string, string>();
  rows.forEach((row) => {
    if (row.ends_on && !dates.has(row.athlete_id)) dates.set(row.athlete_id, row.ends_on);
  });
  return dates;
}

export async function onRequestOptions(context: any) {
  return new Response(null, {
    status: 204,
    headers: cors(context.request),
  });
}

export async function onRequestGet(context: any) {
  const request = context.request as Request;
  const env = context.env as Env;
  if (!env.SUPABASE_URL || !env.SUPABASE_SERVICE_ROLE_KEY) {
    return reply(request, { error: "El servicio no está disponible." }, 503);
  }
  const user = await currentUser(request, env);
  if (!user) return reply(request, { error: "Inicia sesión de nuevo." }, 401);
  const today = madridDate();
  await finalizeExpiredWithdrawals(env, today);
  const { athletes } = await athletesForUser(env, user.id!);
  const dates = await withdrawalDates(env, athletes.map((athlete) => athlete.id));
  return reply(request, {
    athletes: athletes.map(({ id, first_name, last_name, club_status }) => ({
      id,
      first_name,
      last_name,
      club_status,
      withdrawal_effective_on: dates.get(id) || null,
    })),
  });
}

export async function onRequestPost(context: any) {
  const request = context.request as Request;
  const env = context.env as Env;
  if (
    !env.SUPABASE_URL ||
    !env.SUPABASE_SERVICE_ROLE_KEY ||
    !env.RESEND_API_KEY
  ) {
    return reply(request, { error: "El servicio no está disponible." }, 503);
  }
  const user = await currentUser(request, env);
  if (!user) return reply(request, { error: "Inicia sesión de nuevo." }, 401);
  const body = (await request.json().catch(() => ({}))) as {
    athleteId?: string;
    confirmation?: string;
    reason?: string;
  };
  if (!body.athleteId || body.confirmation?.trim().toUpperCase() !== "BAJA") {
    return reply(request, { error: "Escribe BAJA para confirmar." }, 400);
  }
  const reason = String(body.reason || "").trim().slice(0, 500);
  const { profile, athletes } = await athletesForUser(env, user.id!);
  if (profile?.role === "minor_athlete") {
    return reply(
      request,
      { error: "La baja de un menor debe solicitarla su padre, madre o tutor." },
      403,
    );
  }
  let athlete = athletes.find((item) => item.id === body.athleteId);
  const isClubAdmin = ["owner", "admin"].includes(profile?.role || "");
  if (!athlete && isClubAdmin) {
    const response = await fetch(
      `${env.SUPABASE_URL}/rest/v1/athletes?id=eq.${encodeURIComponent(body.athleteId)}&select=id,first_name,last_name,club_status,family_id,user_profile_id&limit=1`,
      { headers: dbHeaders(env) },
    );
    [athlete] = await getJson<Athlete[]>(response, []);
  }
  if (!athlete) {
    return reply(request, { error: "No puedes gestionar la baja de este atleta." }, 403);
  }
  if (athlete.club_status === "withdrawn") {
    return reply(request, { ok: true, message: "La baja ya estaba registrada." });
  }

  const headers = dbHeaders(env);
  const membershipResponse = await fetch(
    `${env.SUPABASE_URL}/rest/v1/memberships?athlete_id=eq.${encodeURIComponent(athlete.id)}&select=id,athlete_id,plan,stripe_subscription_id,billing_status,suspension_reason,ends_on,created_at&order=created_at.desc&limit=1`,
    { headers },
  );
  const [membership] = await getJson<Membership[]>(membershipResponse, []);
  if (
    membership?.suspension_reason === withdrawalReason &&
    membership.ends_on
  ) {
    return reply(request, {
      ok: true,
      accessThrough: membership.ends_on,
      message: `La baja ya está programada. El acceso seguirá activo hasta el ${membership.ends_on}.`,
    });
  }
  if (membership?.stripe_subscription_id) {
    if (!env.STRIPE_SECRET_KEY) {
      return reply(
        request,
        { error: "No se pudo detener la suscripción. Contacta con el club." },
        503,
      );
    }
    const stripeResponse = await fetch(
      `https://api.stripe.com/v1/subscriptions/${encodeURIComponent(membership.stripe_subscription_id)}`,
      {
        method: "DELETE",
        headers: { authorization: `Bearer ${env.STRIPE_SECRET_KEY}` },
      },
    );
    if (!stripeResponse.ok && stripeResponse.status !== 404) {
      return reply(
        request,
        { error: "No se pudo detener la suscripción. Contacta con el club." },
        502,
      );
    }
  }

  const now = new Date().toISOString();
  const today = madridDate();
  let accessThrough = today;
  if (membership) {
    const paidResponse = await fetch(
      `${env.SUPABASE_URL}/rest/v1/billing_charge_drafts?membership_id=eq.${encodeURIComponent(membership.id)}&charge_kind=eq.recurring&status=eq.paid&select=period_ends_on,scheduled_for`,
      { headers },
    );
    const paidDrafts = await getJson<
      { period_ends_on: string | null; scheduled_for: string }[]
    >(paidResponse, []);
    for (const draft of paidDrafts) {
      const coveredUntil =
        draft.period_ends_on || inferredCoverageEnd(draft.scheduled_for, membership.plan);
      if (coveredUntil > accessThrough) accessThrough = coveredUntil;
    }
    const cancelDrafts = await fetch(
      `${env.SUPABASE_URL}/rest/v1/billing_charge_drafts?membership_id=eq.${encodeURIComponent(membership.id)}&scheduled_for=gte.${today}&status=in.(awaiting_admin,approved,checkout_pending,failed)`,
      {
        method: "PATCH",
        headers: { ...headers, Prefer: "return=minimal" },
        body: JSON.stringify({
          status: "cancelled",
          admin_note: "Cancelada automáticamente por baja solicitada en la aplicación.",
        }),
      },
    );
    if (!cancelDrafts.ok) {
      return reply(
        request,
        { error: "La baja se ha registrado, pero el club debe revisar los cobros futuros." },
        502,
      );
    }
    const updateMembership = await fetch(
      `${env.SUPABASE_URL}/rest/v1/memberships?id=eq.${encodeURIComponent(membership.id)}`,
      {
        method: "PATCH",
        headers: { ...headers, Prefer: "return=minimal" },
        body: JSON.stringify({
          billing_status: "paused",
          suspension_reason: withdrawalReason,
          access_suspended_at: null,
          ends_on: accessThrough,
          billing_updated_at: now,
        }),
      },
    );
    if (!updateMembership.ok) {
      return reply(
        request,
        { error: "No se pudo cancelar la cuota. Contacta con el club." },
        502,
      );
    }
  } else {
    const updateAthlete = await fetch(
      `${env.SUPABASE_URL}/rest/v1/athletes?id=eq.${encodeURIComponent(athlete.id)}`,
      {
        method: "PATCH",
        headers: { ...headers, Prefer: "return=minimal" },
        body: JSON.stringify({ club_status: "withdrawn", updated_at: now }),
      },
    );
    if (!updateAthlete.ok) {
      return reply(request, { error: "No se pudo registrar la baja." }, 502);
    }
  }
  await fetch(`${env.SUPABASE_URL}/rest/v1/audit_log`, {
    method: "POST",
    headers: { ...headers, Prefer: "return=minimal" },
    body: JSON.stringify({
      actor_id: user.id,
      entity_type: "athlete",
      entity_id: athlete.id,
      action: "self_service_withdrawal",
      metadata: {
        reason: reason || null,
        requested_on: today,
        access_through: accessThrough,
      },
    }),
  });

  const adminsResponse = await fetch(
    `${env.SUPABASE_URL}/rest/v1/profiles?role=in.(owner,admin)&select=id,email`,
    { headers },
  );
  const admins = await getJson<{ id: string; email: string }[]>(
    adminsResponse,
    [],
  );
  const name = `${athlete.first_name} ${athlete.last_name}`.trim();
  let confirmationEmail = user.email;
  let confirmationName = profile?.full_name || "";
  if (isClubAdmin) {
    let payerProfileId = athlete.user_profile_id || null;
    if (!payerProfileId && athlete.family_id) {
      const familyResponse = await fetch(
        `${env.SUPABASE_URL}/rest/v1/families?id=eq.${encodeURIComponent(athlete.family_id)}&select=primary_profile_id&limit=1`,
        { headers },
      );
      const [family] = await getJson<{ primary_profile_id: string | null }[]>(
        familyResponse,
        [],
      );
      payerProfileId = family?.primary_profile_id || null;
    }
    if (payerProfileId) {
      const payerResponse = await fetch(
        `${env.SUPABASE_URL}/rest/v1/profiles?id=eq.${encodeURIComponent(payerProfileId)}&select=full_name,email&limit=1`,
        { headers },
      );
      const [payer] = await getJson<
        { full_name: string | null; email: string }[]
      >(payerResponse, []);
      if (payer?.email) {
        confirmationEmail = payer.email;
        confirmationName = payer.full_name || "";
      }
    }
  }
  const announcementResponse = await fetch(
    `${env.SUPABASE_URL}/rest/v1/announcements`,
    {
      method: "POST",
      headers: { ...headers, Prefer: "return=representation" },
      body: JSON.stringify({
        title: `Baja solicitada · ${name}`,
        body: `${profile?.full_name || user.email} ha solicitado la baja de ${name} desde la aplicación. Mantendrá el acceso hasta el ${accessThrough}, último día cubierto por su cuota.${reason ? ` Motivo: ${reason}` : ""}`,
        audience: "individual",
        published_at: now,
        created_by: user.id,
      }),
    },
  );
  const [announcement] = await getJson<{ id: string }[]>(
    announcementResponse,
    [],
  );
  if (announcement?.id && admins.length) {
    await fetch(`${env.SUPABASE_URL}/rest/v1/announcement_deliveries`, {
      method: "POST",
      headers: { ...headers, Prefer: "return=minimal" },
      body: JSON.stringify(
        admins.map((admin) => ({
          announcement_id: announcement.id,
          recipient_profile_id: admin.id,
          channel: "app",
          delivery_status: "sent",
        })),
      ),
    });
  }

  const subject = `Baja programada · ${name}`;
  const clubHtml = `<p>Se ha solicitado una baja desde la aplicación.</p><p><strong>Atleta:</strong> ${safe(name)}<br><strong>Solicitante:</strong> ${safe(profile?.full_name || user.email)}<br><strong>Correo:</strong> ${safe(user.email)}<br><strong>Solicitada el:</strong> ${safe(today)}<br><strong>Acceso activo hasta:</strong> ${safe(accessThrough)}</p>${reason ? `<p><strong>Motivo:</strong> ${safe(reason)}</p>` : ""}<p>Los cobros futuros han quedado cancelados. Al terminar el periodo ya pagado se desactivará el acceso. El historial permanece conservado.</p>`;
  const userHtml = `<p>Hola${confirmationName ? ` ${safe(confirmationName)}` : ""}:</p><p>Hemos registrado la solicitud de baja de <strong>${safe(name)}</strong>.</p><p>Podrá seguir accediendo y utilizando su cuenta hasta el <strong>${safe(accessThrough)}</strong>, último día cubierto por la cuota ya abonada. Después se desactivará automáticamente.</p><p>No se realizarán nuevos cobros. Los pagos ya realizados y cualquier importe anterior pendiente permanecen en el historial.</p><p>Si no has solicitado esta baja, responde inmediatamente a este correo.</p><p>Club Atletas de Fuenlabrada</p>`;
  const emailResponse = await fetch("https://api.resend.com/emails/batch", {
    method: "POST",
    headers: {
      authorization: `Bearer ${env.RESEND_API_KEY}`,
      "content-type": "application/json",
    },
    body: JSON.stringify([
      {
        from: "Club Atletas de Fuenlabrada <info@atletasdefuenlabrada.com>",
        reply_to: "info@atletasdefuenlabrada.com",
        to: ["info@atletasdefuenlabrada.com"],
        subject,
        html: clubHtml,
      },
      {
        from: "Club Atletas de Fuenlabrada <info@atletasdefuenlabrada.com>",
        reply_to: "info@atletasdefuenlabrada.com",
        to: [confirmationEmail],
        subject: `Confirmación de baja · ${name}`,
        html: userHtml,
      },
    ]),
  });

  return reply(request, {
    ok: true,
    accessThrough,
    message: emailResponse.ok
      ? `La baja de ${name} queda programada. Mantendrá el acceso hasta el ${accessThrough}. Te hemos enviado una confirmación.`
      : `La baja de ${name} queda programada con acceso hasta el ${accessThrough}. El club revisará el aviso interno.`,
  });
}
