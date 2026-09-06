interface Env {
  SUPABASE_URL: string;
  SUPABASE_SERVICE_ROLE_KEY: string;
  RESEND_API_KEY: string;
}

type AuthUser = { id: string; email?: string | null; email_confirmed_at?: string | null; deleted_at?: string | null };
type Profile = { id: string; full_name?: string | null };
type Family = { id: string; primary_profile_id: string };
type Athlete = { id: string; user_profile_id?: string | null; family_id?: string | null; first_name: string; last_name: string; club_status: string };

const json = (body: unknown, status = 200) => Response.json(body, { status, headers: { "cache-control": "no-store" } });
const dbHeaders = (env: Env) => ({ apikey: env.SUPABASE_SERVICE_ROLE_KEY, authorization: `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}` });
const rows = async <T>(url: string, headers: Record<string, string>) => {
  const response = await fetch(url, { headers });
  if (!response.ok) throw new Error("No se pudo consultar el estado de las cuentas.");
  return response.json() as Promise<T[]>;
};

export const onRequestPost: PagesFunction<Env> = async ({ request, env }) => {
  const token = request.headers.get("authorization")?.replace(/^Bearer\s+/i, "");
  if (!token) return json({ error: "La sesión ha caducado." }, 401);
  const serviceHeaders = dbHeaders(env);
  const authResponse = await fetch(`${env.SUPABASE_URL}/auth/v1/user`, {
    headers: { apikey: env.SUPABASE_SERVICE_ROLE_KEY, authorization: `Bearer ${token}` },
  });
  const currentUser = await authResponse.json().catch(() => null) as { id?: string } | null;
  if (!authResponse.ok || !currentUser?.id) return json({ error: "La sesión ha caducado." }, 401);
  const profiles = await rows<{ role?: string }>(`${env.SUPABASE_URL}/rest/v1/profiles?id=eq.${currentUser.id}&select=role`, serviceHeaders);
  if (!["owner", "admin"].includes(profiles[0]?.role || "")) return json({ error: "Solo administración puede realizar este envío." }, 403);

  const usersResponse = await fetch(`${env.SUPABASE_URL}/auth/v1/admin/users?page=1&per_page=1000`, { headers: serviceHeaders });
  const payload = await usersResponse.json().catch(() => null) as { users?: AuthUser[] } | AuthUser[] | null;
  if (!usersResponse.ok || !payload) return json({ error: "No se pudo consultar las cuentas." }, 502);
  const users = (Array.isArray(payload) ? payload : payload.users || []).filter(
    (user) => user.email && !user.deleted_at && !user.email_confirmed_at,
  );
  if (!users.length) return json({ sent: 0, active: 0, incomplete: 0 });

  const ids = users.map((user) => user.id);
  const inFilter = `in.(${ids.join(",")})`;
  const [accountProfiles, families] = await Promise.all([
    rows<Profile>(`${env.SUPABASE_URL}/rest/v1/profiles?id=${encodeURIComponent(inFilter)}&select=id,full_name`, serviceHeaders),
    rows<Family>(`${env.SUPABASE_URL}/rest/v1/families?primary_profile_id=${encodeURIComponent(inFilter)}&select=id,primary_profile_id`, serviceHeaders),
  ]);
  const familyIds = families.map((family) => family.id);
  const athleteFilters = [`user_profile_id.${inFilter}`, ...(familyIds.length ? [`family_id.in.(${familyIds.join(",")})`] : [])].join(",");
  const athletes = await rows<Athlete>(
    `${env.SUPABASE_URL}/rest/v1/athletes?or=(${encodeURIComponent(athleteFilters)})&select=id,user_profile_id,family_id,first_name,last_name,club_status`,
    serviceHeaders,
  );
  const familyOwner = new Map(families.map((family) => [family.id, family.primary_profile_id]));
  const profileNames = new Map(accountProfiles.map((profile) => [profile.id, profile.full_name || ""]));
  const accountAthletes = new Map<string, Athlete[]>();
  for (const athlete of athletes) {
    const owner = athlete.user_profile_id || (athlete.family_id ? familyOwner.get(athlete.family_id) : undefined);
    if (owner) accountAthletes.set(owner, [...(accountAthletes.get(owner) || []), athlete]);
  }

  let active = 0;
  let incomplete = 0;
  const messages = users.map((user) => {
    const relatedAthletes = accountAthletes.get(user.id) || [];
    const hasActiveRegistration = relatedAthletes.some((athlete) => athlete.club_status === "active");
    const name = profileNames.get(user.id)?.trim();
    if (hasActiveRegistration) active += 1;
    else incomplete += 1;
    const subject = hasActiveRegistration
      ? "Confirma tu correo para acceder al Club Atletas de Fuenlabrada"
      : "Completa tu registro en el Club Atletas de Fuenlabrada";
    const explanation = hasActiveRegistration
      ? "Tu inscripción en el club está activa, pero todavía falta confirmar tu dirección de correo para que puedas acceder correctamente."
      : "Detectamos que comenzaste a crear tu cuenta, pero el registro no llegó a completarse y todavía no consta ninguna inscripción de atleta asociada.";
    const nextStep = hasActiveRegistration
      ? "Entra en la pantalla de acceso y pulsa «Enviar un nuevo correo de confirmación». Abre el mensaje que recibirás y confirma el correo."
      : "Entra en la pantalla de acceso, pulsa «Enviar un nuevo correo de confirmación» y confirma el correo desde el mensaje que recibirás. Después vuelve a entrar y termina todos los pasos de la inscripción.";
    const greeting = name ? `Hola, ${name}:` : "Hola:";
    const text = `${greeting}\n\n${explanation}\n\n${nextStep}\n\nAcceso: https://atletasdefuenlabrada.com/?access=1\n\nSi sigues teniendo problemas, responde a este correo para que podamos ayudarte.\n\nClub Atletas de Fuenlabrada`;
    const html = `<div style="font-family:Arial,sans-serif;color:#10233f;line-height:1.65;max-width:640px;margin:auto"><h2 style="color:#1559b2">${subject}</h2><p>${greeting}</p><p>${explanation}</p><p>${nextStep}</p><p><a href="https://atletasdefuenlabrada.com/?access=1" style="display:inline-block;padding:12px 18px;border-radius:9px;background:#1559b2;color:#fff;text-decoration:none;font-weight:bold">Abrir acceso del club</a></p><p>Si sigues teniendo problemas, responde a este correo para que podamos ayudarte.</p><hr style="border:0;border-top:1px solid #dbe6f2;margin:28px 0"><p style="font-size:13px;color:#617087">Club Atletas de Fuenlabrada</p></div>`;
    return { from: "Club Atletas de Fuenlabrada <info@atletasdefuenlabrada.com>", reply_to: "info@atletasdefuenlabrada.com", to: [user.email!], subject, text, html };
  });

  const sendResponse = await fetch("https://api.resend.com/emails/batch", {
    method: "POST",
    headers: { authorization: `Bearer ${env.RESEND_API_KEY}`, "content-type": "application/json" },
    body: JSON.stringify(messages),
  });
  if (!sendResponse.ok) {
    const detail = await sendResponse.json().catch(() => null) as { message?: string } | null;
    return json({ error: detail?.message || "El proveedor de correo no aceptó el envío." }, 502);
  }
  return json({ sent: messages.length, active, incomplete });
};
