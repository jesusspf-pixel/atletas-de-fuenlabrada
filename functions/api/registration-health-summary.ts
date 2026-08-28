const json = (body: unknown, status = 200) => Response.json(body, { status, headers: { "cache-control": "no-store" } });
async function sha256(value: string) { const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value)); return Array.from(new Uint8Array(digest)).map(byte => byte.toString(16).padStart(2, "0")).join(""); }
const count = (rows: unknown) => Array.isArray(rows) ? rows.length : 0;

export async function onRequestGet(context: any) {
  if (await sha256(context.request.headers.get("x-audit-key") || "") !== "c2e43c32190ae9124527f84fd926dfd922271a4a226c4e2e12a1aadf9967f719") return json({ error: "Not found" }, 404);
  const env = context.env as { SUPABASE_URL?: string; VITE_SUPABASE_URL?: string; SUPABASE_SERVICE_ROLE_KEY?: string; STRIPE_SECRET_KEY?: string };
  const base = env.SUPABASE_URL || env.VITE_SUPABASE_URL; const key = env.SUPABASE_SERVICE_ROLE_KEY;
  if (!base || !key || !env.STRIPE_SECRET_KEY) return json({ error: "Services unavailable" }, 503);
  const cutoff = new Date(Date.now() - 3 * 60 * 60 * 1000);
  const cutoffIso = cutoff.toISOString(); const dbHeaders = { apikey: key, authorization: `Bearer ${key}` };
  const [usersResponse, profilesResponse, auditsResponse, invitationsResponse, stripeResponse] = await Promise.all([
    fetch(`${base}/auth/v1/admin/users?page=1&per_page=1000`, { headers: dbHeaders }),
    fetch(`${base}/rest/v1/profiles?created_at=gte.${encodeURIComponent(cutoffIso)}&select=id,created_at`, { headers: dbHeaders }),
    fetch(`${base}/rest/v1/audit_log?created_at=gte.${encodeURIComponent(cutoffIso)}&action=in.(registration_submitted,adult_registration_submitted)&select=id,created_at,action`, { headers: dbHeaders }),
    fetch(`${base}/rest/v1/family_renewal_invitations?select=id,created_at,used_at,delivery_status`, { headers: dbHeaders }),
    fetch(`https://api.stripe.com/v1/events?created[gte]=${Math.floor(cutoff.getTime()/1000)}&limit=100`, { headers: { authorization: `Bearer ${env.STRIPE_SECRET_KEY}` } }),
  ]);
  const usersPayload = await usersResponse.json().catch(() => ({})) as { users?: Array<{ created_at?: string; email_confirmed_at?: string | null }> };
  const recentUsers = (usersPayload.users || []).filter(user => user.created_at && user.created_at >= cutoffIso);
  const profiles = await profilesResponse.json().catch(() => []); const audits = await auditsResponse.json().catch(() => []);
  const invitations = await invitationsResponse.json().catch(() => []) as Array<{ created_at?: string; used_at?: string | null; delivery_status?: string }>;
  const stripeEvents = ((await stripeResponse.json().catch(() => ({}))) as { data?: Array<{ type?: string }> }).data || [];
  const stripeTypes = stripeEvents.reduce<Record<string,number>>((acc,event) => { const type=event.type||"unknown"; acc[type]=(acc[type]||0)+1; return acc; },{});
  return json({ cutoff: cutoffIso, auth: { created: recentUsers.length, confirmed: recentUsers.filter(user => user.email_confirmed_at).length }, profilesCreated: count(profiles), registrationsSubmitted: count(audits), invitations: { total: invitations.length, usedLast3h: invitations.filter(item => item.used_at && item.used_at >= cutoffIso).length, sent: invitations.filter(item => item.delivery_status === "sent").length, failed: invitations.filter(item => item.delivery_status === "failed").length, pending: invitations.filter(item => ["pending","sending"].includes(item.delivery_status || "")).length }, stripeEvents: stripeTypes });
}
