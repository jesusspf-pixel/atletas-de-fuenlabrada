type Env = { SUPABASE_URL?: string; SUPABASE_SERVICE_ROLE_KEY?: string };
const json = (body: unknown, status = 200) => Response.json(body, {
  status, headers: { "Cache-Control": "private, no-store", Vary: "Authorization" },
});

// Fetch one dossier only after verifying the session and the current database role.
// This does not grant database write permissions or expose credentials to the client.
export async function onRequestGet({ request, env }: { request: Request; env: Env }) {
  if (!env.SUPABASE_URL || !env.SUPABASE_SERVICE_ROLE_KEY) return json({ error: "Servicio no disponible." }, 503);
  const authorization = request.headers.get("authorization") || "";
  if (!/^Bearer \S+$/i.test(authorization)) return json({ error: "Inicia sesión de nuevo." }, 401);
  try {
    const auth = await fetch(`${env.SUPABASE_URL}/auth/v1/user`, {
      headers: { apikey: env.SUPABASE_SERVICE_ROLE_KEY, authorization },
    });
    if (!auth.ok) return json({ error: "La sesión ha caducado." }, 401);
    const user = await auth.json() as { id?: string };
    if (!user.id) return json({ error: "Sesión no válida." }, 401);
    const headers = { apikey: env.SUPABASE_SERVICE_ROLE_KEY, authorization: `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}` };
    async function rows<T>(table: string, params: Record<string, string>): Promise<T[]> {
      const response = await fetch(`${env.SUPABASE_URL}/rest/v1/${table}?${new URLSearchParams(params)}`, { headers });
      if (!response.ok) throw new Error("No se pudo consultar la ficha.");
      return await response.json() as T[];
    }
    const [caller] = await rows<{ role: string }>("profiles", { id: `eq.${user.id}`, select: "role", limit: "1" });
    if (!caller || !["owner", "admin", "administrative_viewer"].includes(caller.role)) {
      return json({ error: "No tienes permiso para consultar estas fichas." }, 403);
    }
    const athleteId = new URL(request.url).searchParams.get("athleteId") || "";
    if (!/^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(athleteId)) return json({ error: "Atleta no válido." }, 400);
    const [athlete] = await rows<Record<string, unknown>>("athletes", {
      id: `eq.${athleteId}`, limit: "1",
      select: "id,first_name,last_name,birth_date,federative_sex,dni_nie,club_status,license_status,license_number,federation_license,training_category,official_competition_category,federation_license_requested,training_groups(name),profiles:user_profile_id(full_name,email,phone),families!athletes_family_id_fkey(relationship_to_athlete,dni_nie,address_line,postal_code,locality,province,emergency_phone,profiles:profiles!families_primary_profile_id_fkey(full_name,email,phone),family_guardians(relationship,access_status,profiles:profiles!family_guardians_profile_id_fkey(full_name,email,phone))),federation_license_applications(status,training_category,competition_category,submitted_at,form_data)",
    });
    if (!athlete) return json({ error: "No se ha encontrado el atleta." }, 404);
    return json({ athlete });
  } catch {
    return json({ error: "No se pudo cargar la ficha completa. Inténtalo de nuevo." }, 502);
  }
}
