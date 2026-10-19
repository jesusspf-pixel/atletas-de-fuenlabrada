import { competitionClosed, eligibleCompetitionTest } from "../../src/lib/competitionRegistration";
type Env = { SUPABASE_URL?: string; SUPABASE_SERVICE_ROLE_KEY?: string };
type Athlete = { id: string; first_name: string; last_name: string; family_id: string | null; user_profile_id: string | null; birth_date: string | null; federative_sex: string | null };
type Event = { id: string; title: string; starts_at: string; internal_deadline: string | null; published: boolean; created_by: string };
type Test = { id: string; name: string; active: boolean; eligible_categories: string[]; eligible_sex: string; min_birth_year: number | null; max_birth_year: number | null };
const uuid = (value: unknown): value is string => typeof value === "string" && /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(value);
const json = (body: unknown, status = 200) => Response.json(body, { status, headers: { "Cache-Control": "private, no-store", Vary: "Authorization" } });
const entryFields = "id,competition_event_id,athlete_id,requested_events,status,notes";

export async function onRequest({ request, env }: { request: Request; env: Env }) {
  if (!["GET", "POST", "PATCH"].includes(request.method)) return json({ error: "Método no permitido." }, 405);
  if (!env.SUPABASE_URL || !env.SUPABASE_SERVICE_ROLE_KEY) return json({ error: "Servicio no disponible." }, 503);
  const authorization = request.headers.get("authorization") || "";
  if (!/^Bearer \S+$/i.test(authorization)) return json({ error: "Inicia sesión de nuevo." }, 401);
  try {
    const auth = await fetch(`${env.SUPABASE_URL}/auth/v1/user`, { headers: { apikey: env.SUPABASE_SERVICE_ROLE_KEY, authorization } });
    if (!auth.ok) return json({ error: "La sesión ha caducado. Vuelve a entrar." }, 401);
    const user = await auth.json() as { id?: string };
    if (!user.id) return json({ error: "Sesión no válida." }, 401);
    const headers = { apikey: env.SUPABASE_SERVICE_ROLE_KEY, authorization: `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`, "content-type": "application/json" };
    async function db<T>(table: string, params: Record<string, string>, init: RequestInit = {}): Promise<T[]> {
      const response = await fetch(`${env.SUPABASE_URL}/rest/v1/${table}?${new URLSearchParams(params)}`, { ...init, headers: { ...headers, ...init.headers } });
      if (!response.ok) throw new Error("Database request failed");
      const text = await response.text();
      return text ? JSON.parse(text) as T[] : [];
    }
    if (request.method === "PATCH") {
      const body = await request.json().catch(() => null) as { entryId?: unknown; status?: unknown } | null;
      if (!body || !uuid(body.entryId) || !["approved", "rejected"].includes(String(body.status))) {
        return json({ error: "Revisión no válida." }, 400);
      }
      const status = body.status as "approved" | "rejected";
      const [reviewer] = await db<{ id: string; role: string }>("profiles", { id: `eq.${user.id}`, select: "id,role", limit: "1" });
      const [entry] = await db<{ id: string; competition_event_id: string; athlete_id: string; requested_events: string[]; requested_by: string | null; status: string; notes: string | null }>(
        "competition_entries",
        { id: `eq.${body.entryId}`, select: "id,competition_event_id,athlete_id,requested_events,requested_by,status,notes", limit: "1" },
      );
      if (!reviewer || !entry) return json({ error: "Solicitud no encontrada." }, 404);
      const [[event], [athlete]] = await Promise.all([
        db<Event>("competition_events", { id: `eq.${entry.competition_event_id}`, select: "id,title,starts_at,internal_deadline,published,created_by", limit: "1" }),
        db<Athlete>("athletes", { id: `eq.${entry.athlete_id}`, select: "id,first_name,last_name,family_id,user_profile_id,birth_date,federative_sex", limit: "1" }),
      ]);
      const canReview = reviewer.role === "owner" || reviewer.role === "admin" || (reviewer.role === "coach" && event?.created_by === user.id);
      if (!canReview) return json({ error: "Solo el entrenador que publicó la competición o administración puede revisar esta solicitud." }, 403);
      if (!event || !athlete) return json({ error: "No se han encontrado los datos de la inscripción." }, 404);
      if (entry.status !== "requested") return json({ error: "Esta solicitud ya ha sido revisada." }, 409);

      const updated = await db<{ id: string; competition_event_id: string; athlete_id: string; requested_events: string[]; status: string; notes: string | null }>(
        "competition_entries",
        { id: `eq.${entry.id}`, status: "eq.requested", select: entryFields },
        {
          method: "PATCH",
          headers: { Prefer: "return=representation" },
          body: JSON.stringify({ status, reviewed_by: user.id, reviewed_at: new Date().toISOString() }),
        },
      );
      if (!updated.length) return json({ error: "La solicitud ya no estaba pendiente. Recarga la pantalla." }, 409);

      const testRows = entry.requested_events?.length
        ? await db<{ id: string; name: string }>("competition_event_tests", { id: `in.(${entry.requested_events.join(",")})`, select: "id,name" })
        : [];
      const testNames = testRows.map(test => test.name).join(", ");
      const notificationTitle = status === "approved" ? "Inscripción confirmada" : "Solicitud de inscripción revisada";
      const notificationBody = status === "approved"
        ? `${athlete.first_name} ${athlete.last_name} ha quedado inscrito/a en «${event.title}»${testNames ? ` para: ${testNames}` : ""}.`
        : `La solicitud de ${athlete.first_name} ${athlete.last_name} para «${event.title}» no ha sido aprobada. Contacta con el club si necesitas más información.`;
      let notificationPending = false;
      if (entry.requested_by) {
        try {
          const [announcement] = await db<{ id: string }>("announcements", { select: "id" }, {
            method: "POST",
            headers: { Prefer: "return=representation" },
            body: JSON.stringify({
              title: notificationTitle,
              body: notificationBody,
              audience: "individual",
              delivery_channels: ["app", "email"],
              published_at: new Date().toISOString(),
              created_by: user.id,
            }),
          });
          if (!announcement) throw new Error("Notification unavailable");
          await db("announcement_deliveries", {}, {
            method: "POST",
            headers: { Prefer: "return=minimal" },
            body: JSON.stringify(["app", "email"].map(channel => ({
              announcement_id: announcement.id,
              recipient_profile_id: entry.requested_by,
              channel,
              delivery_status: channel === "app" ? "sent" : "pending",
            }))),
          });
        } catch {
          notificationPending = true;
        }
      } else {
        notificationPending = true;
      }
      return json({
        entry: updated[0],
        notificationPending,
        recipientId: entry.requested_by,
        notificationTitle,
        notificationBody,
      });
    }

    // Derive family access from current database links, never from client-supplied roles or IDs.
    const [primary, guardians] = await Promise.all([
      db<{ id: string }>("families", { primary_profile_id: `eq.${user.id}`, select: "id" }),
      db<{ family_id: string }>("family_guardians", { profile_id: `eq.${user.id}`, access_status: "eq.active", select: "family_id" }),
    ]);
    const familyIds = [...new Set([...primary.map(f => f.id), ...guardians.map(g => g.family_id)])];
    const ownFilter = `user_profile_id.eq.${user.id}${familyIds.length ? `,family_id.in.(${familyIds.join(",")})` : ""}`;
    const ownAthletes = await db<Athlete>("athletes", { or: `(${ownFilter})`, select: "id,first_name,last_name,family_id,user_profile_id,birth_date,federative_sex" });
    if (request.method === "GET") {
      const entries = ownAthletes.length ? await db("competition_entries", { athlete_id: `in.(${ownAthletes.map(a => a.id).join(",")})`, select: entryFields }) : [];
      return json({ entries });
    }
    const body = await request.json().catch(() => null) as { eventId?: unknown; athleteId?: unknown; testIds?: unknown } | null;
    if (!body || !uuid(body.eventId) || !uuid(body.athleteId) || !Array.isArray(body.testIds) || body.testIds.length > 50 || !body.testIds.every(uuid)) return json({ error: "Solicitud no válida." }, 400);
    const athlete = ownAthletes.find(a => a.id === body.athleteId);
    if (!athlete) return json({ error: "Solo puedes solicitar inscripción para tus propios atletas." }, 403);
    const [event] = await db<Event>("competition_events", { id: `eq.${body.eventId}`, select: "id,title,starts_at,internal_deadline,published,created_by", limit: "1" });
    if (!event?.published) return json({ error: "La competición no está publicada." }, 404);
    const existing = await db("competition_entries", { competition_event_id: `eq.${event.id}`, athlete_id: `eq.${athlete.id}`, select: entryFields, limit: "1" });
    if (existing.length) return json({ entry: existing[0], alreadySubmitted: true });
    if (competitionClosed(event)) return json({ error: "El plazo de solicitud ha terminado o la competición ya ha comenzado." }, 409);
    const tests = await db<Test>("competition_event_tests", { competition_event_id: `eq.${event.id}`, active: "eq.true", select: "id,name,active,eligible_categories,eligible_sex,min_birth_year,max_birth_year" });
    const testIds = [...new Set(body.testIds as string[])];
    if (!testIds.length) return json({ error: "Selecciona al menos una prueba compatible." }, 400);
    if (testIds.some(id => !tests.some(t => t.id === id && eligibleCompetitionTest(t, athlete, event)))) return json({ error: "Una prueba no corresponde a esta competición o a la edad, categoría y sexo del atleta." }, 400);
    // Ignore duplicate inserts atomically, preserving approved/rejected/registered requests.
    const inserted = await db("competition_entries", { on_conflict: "competition_event_id,athlete_id", select: entryFields }, {
      method: "POST", headers: { Prefer: "resolution=ignore-duplicates,return=representation" },
      body: JSON.stringify({ competition_event_id: event.id, athlete_id: athlete.id, requested_events: testIds, requested_by: user.id, status: "requested" }),
    });
    const saved = inserted.length ? inserted : await db("competition_entries", { competition_event_id: `eq.${event.id}`, athlete_id: `eq.${athlete.id}`, select: entryFields, limit: "1" });
    if (!saved.length) throw new Error("Entry not saved");
    let notificationPending = false;
    if (inserted.length) {
      try {
        const admins = await db<{ id: string }>("profiles", { role: "in.(owner,admin)", select: "id" });
        const [announcement] = await db<{ id: string }>("announcements", { select: "id" }, { method: "POST", headers: { Prefer: "return=representation" }, body: JSON.stringify({
          title: "Solicitud de competición", body: `${athlete.first_name} ${athlete.last_name} solicita participar en «${event.title}»: ${tests.filter(t => testIds.includes(t.id)).map(t => t.name).join(", ") || "solicitud general; pruebas pendientes de concretar"}.`,
          audience: "individual", delivery_channels: ["app", "email"], published_at: new Date().toISOString(), created_by: user.id,
        }) });
        if (!announcement) throw new Error("Notification unavailable");
        const recipients = [...new Set([...admins.map(p => p.id), event.created_by])];
        await db("announcement_deliveries", {}, { method: "POST", headers: { Prefer: "return=minimal" }, body: JSON.stringify(recipients.flatMap(id => ["app", "email"].map(channel => ({ announcement_id: announcement.id, recipient_profile_id: id, channel, delivery_status: channel === "app" ? "sent" : "pending" })))) });
      } catch { notificationPending = true; }
    }
    return json({ entry: saved[0], alreadySubmitted: !inserted.length, notificationPending });
  } catch { return json({ error: "No se pudo completar la operación. Recarga para comprobar si la solicitud quedó guardada y vuelve a intentarlo si no aparece." }, 502); }
}
