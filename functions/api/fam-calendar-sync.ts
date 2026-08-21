const json = (body: unknown, status = 200) => Response.json(body, { status });

const text = (html: string) => html.replace(/<script[\s\S]*?<\/script>/gi, " ").replace(/<style[\s\S]*?<\/style>/gi, " ").replace(/<[^>]+>/g, " ").replace(/&nbsp;/gi, " ").replace(/&amp;/gi, "&").replace(/\s+/g, " ").trim();
const absolute = (href: string) => new URL(href.replace(/&amp;/g, "&"), "https://www.atletismomadrid.com/").toString();

function rowsFromCalendar(html: string, year: number) {
  const rows: { competition_name: string; competition_date: string; calendar_url: string; results_url: string }[] = [];
  const rowRegex = /<tr[^>]*>([\s\S]*?)<\/tr>/gi;
  let rowMatch: RegExpExecArray | null;
  while ((rowMatch = rowRegex.exec(html))) {
    const row = rowMatch[1];
    const resultLink = [...row.matchAll(/<a[^>]+href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi)].find(match => /resul/i.test(text(match[2])));
    if (!resultLink) continue;
    const cells = [...row.matchAll(/<td[^>]*>([\s\S]*?)<\/td>/gi)].map(match => text(match[1])).filter(Boolean);
    if (cells.length < 2) continue;
    const dateCell = cells.find(value => /\b\d{1,2}(?:y\d{1,2})?\.\d{2}\b/.test(value));
    if (!dateCell) continue;
    const dateMatch = dateCell.match(/(\d{1,2})(?:y\d{1,2})?\.(\d{2})/);
    if (!dateMatch) continue;
    const day = Number(dateMatch[1]); const month = Number(dateMatch[2]);
    const competition = cells.find(value => value !== dateCell && !/^(regl|insc|resul|AL|PC|C|R|M|O|TR)/i.test(value) && value.length > 4);
    if (!competition) continue;
    rows.push({ competition_name: competition, competition_date: `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`, calendar_url: "", results_url: absolute(resultLink[1]) });
  }
  return rows;
}

export async function onRequestPost(context: any) {
  const env = context.env as { SUPABASE_URL?: string; SUPABASE_SERVICE_ROLE_KEY?: string };
  if (!env.SUPABASE_URL || !env.SUPABASE_SERVICE_ROLE_KEY) return json({ error: "Falta la conexión segura con Supabase." }, 503);
  const bearer = context.request.headers.get("authorization");
  if (!bearer) return json({ error: "Inicia sesión como administrador." }, 401);
  const auth = await fetch(`${env.SUPABASE_URL}/auth/v1/user`, { headers: { apikey: env.SUPABASE_SERVICE_ROLE_KEY, authorization: bearer } });
  const user = await auth.json().catch(() => null) as { id?: string } | null;
  if (!auth.ok || !user?.id) return json({ error: "Sesión no válida." }, 401);
  const serviceHeaders = { apikey: env.SUPABASE_SERVICE_ROLE_KEY, authorization: `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`, "content-type": "application/json" };
  const profileResponse = await fetch(`${env.SUPABASE_URL}/rest/v1/profiles?id=eq.${encodeURIComponent(user.id)}&select=role`, { headers: serviceHeaders });
  const [profile] = await profileResponse.json().catch(() => []) as { role?: string }[];
  if (!profile || !["owner", "admin"].includes(profile.role || "")) return json({ error: "Solo administración puede lanzar la sincronización FAM." }, 403);

  const body = await context.request.json().catch(() => ({})) as { year?: number; month?: number };
  const now = new Date(); const year = Number(body.year || now.getUTCFullYear()); const month = Number(body.month || now.getUTCMonth() + 1);
  if (year < 2024 || year > 2100 || month < 1 || month > 12) return json({ error: "Año o mes no válido." }, 400);
  const calendarUrl = `https://www.atletismomadrid.com/index.php?Itemid=111&ano=${year}&id=3292&mes=${String(month).padStart(2, "0")}&option=com_content&view=article`;
  const response = await fetch(calendarUrl, { headers: { "user-agent": "Club Atletas de Fuenlabrada results sync/1.0" } });
  if (!response.ok) return json({ error: `FAM respondió ${response.status}.` }, 502);
  const html = await response.text();
  const rows = rowsFromCalendar(html, year).map(row => ({ ...row, calendar_url: calendarUrl, federation: "FAM", status: "waiting_results", last_checked_at: new Date().toISOString() }));
  if (!rows.length) return json({ found: 0, queued: 0, calendarUrl });

  const upsert = await fetch(`${env.SUPABASE_URL}/rest/v1/federation_import_sources?on_conflict=federation,competition_name,competition_date`, { method: "POST", headers: { ...serviceHeaders, Prefer: "resolution=merge-duplicates,return=representation" }, body: JSON.stringify(rows) });
  const saved = await upsert.json().catch(() => []);
  if (!upsert.ok) return json({ error: "No se pudo guardar la cola FAM.", detail: saved }, 502);
  return json({ found: rows.length, queued: Array.isArray(saved) ? saved.length : rows.length, calendarUrl, sources: saved });
}
