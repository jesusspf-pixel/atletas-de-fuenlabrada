const json = (body: unknown, status = 200) => Response.json(body, { status, headers: { "cache-control": "no-store" } });
async function sha256(value: string) { const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value)); return Array.from(new Uint8Array(digest)).map(byte => byte.toString(16).padStart(2, "0")).join(""); }

export async function onRequestPost(context: any) {
  if (await sha256(context.request.headers.get("x-audit-key") || "") !== "c2e43c32190ae9124527f84fd926dfd922271a4a226c4e2e12a1aadf9967f719") return json({ error: "Not found" }, 404);
  const env = context.env as { SUPABASE_URL?: string; VITE_SUPABASE_URL?: string; SUPABASE_SERVICE_ROLE_KEY?: string; STRIPE_SECRET_KEY?: string };
  const base = env.SUPABASE_URL || env.VITE_SUPABASE_URL; const key = env.SUPABASE_SERVICE_ROLE_KEY;
  if (!base || !key || !env.STRIPE_SECRET_KEY) return json({ error: "Services unavailable" }, 503);
  const draftId = "e48cf245-caf7-4c87-9e5d-50ef48816484";
  const tomorrow = "2026-08-29";
  const dbHeaders = { apikey: key, authorization: `Bearer ${key}`, "content-type": "application/json" };
  const update = await fetch(`${base}/rest/v1/billing_charge_drafts?id=eq.${draftId}&status=eq.approved`, { method: "PATCH", headers: { ...dbHeaders, prefer: "return=representation" }, body: JSON.stringify({ scheduled_for: tomorrow, updated_at: new Date().toISOString() }) });
  const updated = await update.json().catch(() => []);
  if (!update.ok || !updated.length) return json({ error: "The approved test charge could not be rescheduled", status: update.status }, 409);

  const since = Math.floor(Date.now() / 1000) - 172800;
  const eventsResponse = await fetch(`https://api.stripe.com/v1/events?created[gte]=${since}&limit=100`, { headers: { authorization: `Bearer ${env.STRIPE_SECRET_KEY}` } });
  const eventsPayload = await eventsResponse.json().catch(() => ({})) as { data?: Array<any> };
  const relevant = (eventsPayload.data || []).filter(event => String(event.type || "").startsWith("setup_intent.") || String(event.type || "").startsWith("checkout.session.")).map(event => ({
    created: event.created,
    type: event.type,
    status: event.data?.object?.status || null,
    failure_code: event.data?.object?.last_setup_error?.code || null,
    failure_message: event.data?.object?.last_setup_error?.message || null,
  }));
  return json({ rescheduled: updated[0], stripeEvents: relevant });
}
