const json = (body: unknown, status = 200) => Response.json(body, { status, headers: { "cache-control": "no-store" } });

async function sha256(value: string) {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return Array.from(new Uint8Array(digest)).map(byte => byte.toString(16).padStart(2, "0")).join("");
}

export async function onRequestGet(context: any) {
  const supplied = context.request.headers.get("x-audit-key") || "";
  if (await sha256(supplied) !== "c2e43c32190ae9124527f84fd926dfd922271a4a226c4e2e12a1aadf9967f719") return json({ error: "Not found" }, 404);
  const env = context.env as { SUPABASE_URL?: string; VITE_SUPABASE_URL?: string; SUPABASE_SERVICE_ROLE_KEY?: string };
  const base = env.SUPABASE_URL || env.VITE_SUPABASE_URL;
  const key = env.SUPABASE_SERVICE_ROLE_KEY;
  if (!base || !key) return json({ error: "Database unavailable" }, 503);
  const today = new Date().toISOString().slice(0, 10);
  const query = new URLSearchParams({
    select: "id,status,scheduled_for,approved_amount_cents,calculated_amount_cents,attempt_count,last_attempt_at,next_attempt_at,athletes(first_name,last_name),memberships(plan)",
    scheduled_for: `lte.${today}`,
    status: "in.(approved,collecting,failed)",
    order: "scheduled_for.asc",
  });
  const response = await fetch(`${base}/rest/v1/billing_charge_drafts?${query}`, {
    headers: { apikey: key, authorization: `Bearer ${key}` },
  });
  const rows = await response.json().catch(() => []);
  return json({ today, rows: response.ok ? rows : [], databaseStatus: response.status }, response.ok ? 200 : 502);
}
