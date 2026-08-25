type Env = {
  MAINTENANCE_EXPORT_TOKEN?: string;
  SUPABASE_URL?: string;
  SUPABASE_SERVICE_ROLE_KEY?: string;
};

const tables = [
  "profiles", "profile_roles", "families", "athletes", "memberships",
  "billing_charge_drafts", "payment_ledger", "registration_payment_methods",
  "stripe_customers", "consents", "health_declarations",
  "athlete_profile_settings", "athlete_external_integrations",
  "athlete_integration_tokens", "external_sport_activities",
  "external_oauth_states", "federation_license_applications",
  "athlete_achievements", "athlete_results", "attendance_records",
  "attendance_sessions", "coach_athlete_messages", "coach_messages",
  "coach_athlete_notes", "competition_entries", "club_orders",
  "club_order_items", "announcement_reads", "announcement_dismissals",
  "announcement_deliveries", "family_notification_preferences",
  "invitations", "invitation_links"
] as const;

export async function onRequestGet(context: { request: Request; env: Env }) {
  const { request, env } = context;
  const supplied = request.headers.get("authorization") || "";
  if (!env.MAINTENANCE_EXPORT_TOKEN || supplied !== `Bearer ${env.MAINTENANCE_EXPORT_TOKEN}`) {
    return Response.json({ error: "Not found" }, { status: 404 });
  }
  if (!env.SUPABASE_URL || !env.SUPABASE_SERVICE_ROLE_KEY) {
    return Response.json({ error: "Maintenance unavailable" }, { status: 503 });
  }

  const headers = {
    apikey: env.SUPABASE_SERVICE_ROLE_KEY,
    authorization: `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`,
  };
  const backup: Record<string, unknown> = {};
  const errors: Record<string, string> = {};

  const usersResponse = await fetch(`${env.SUPABASE_URL}/auth/v1/admin/users?page=1&per_page=1000`, { headers });
  if (usersResponse.ok) {
    const usersPayload = await usersResponse.json() as { users?: unknown[] } | unknown[];
    backup.auth_users = Array.isArray(usersPayload) ? usersPayload : usersPayload.users || [];
  } else {
    errors.auth_users = `HTTP ${usersResponse.status}`;
  }

  for (const table of tables) {
    const response = await fetch(`${env.SUPABASE_URL}/rest/v1/${table}?select=*`, { headers });
    if (response.ok) backup[table] = await response.json();
    else errors[table] = `HTTP ${response.status}`;
  }

  return Response.json({
    generated_at: new Date().toISOString(),
    project: new URL(env.SUPABASE_URL).hostname.split(".")[0],
    keep_email: "jesusspf@gmail.com",
    backup,
    errors,
  }, { headers: { "cache-control": "no-store" } });
}
