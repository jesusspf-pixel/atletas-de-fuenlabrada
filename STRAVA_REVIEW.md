# Strava review preview

This branch is an isolated review artefact. It must not be merged into `main`
or connected to the production Cloudflare/Supabase environment.

## Review guarantees

- Only the authenticated athlete can connect, sync, view, or disconnect their
  own Strava account.
- Only running activities are imported.
- Imported activities are retained for at most 30 days.
- Disconnecting or revoking access deletes the integration, tokens, and all
  imported activities.
- Strava data and Strava-derived metrics are not sent to Claude or any other AI
  provider.
- Coaches, administrators, families, challenges, rankings, and group planning
  never receive Strava data or derived metrics.
- OAuth state expires after ten minutes and tokens remain server-side only.

## Isolated preview setup

1. Create a separate Supabase preview project and apply all migrations,
   including `202609020001_strava_review_privacy_isolation.sql`.
   Start with an empty dataset; do not copy cached AI insights, weekly AI
   proposals, connected accounts, or imported activities from production.
2. Create a Cloudflare Pages preview project for this branch only. Do not reuse
   the production project or production secrets.
3. Configure preview-only Supabase, Strava client, and webhook secrets.
   Deploy a separate copy of `workers/performance-daily` with those preview
   secrets so its daily schedule enforces the 30-day retention function.
4. Set the Strava callback domain to the stable preview host and register
   `/api/strava-callback` as the callback path.
5. Test with a dedicated reviewer athlete account.

## Acceptance checks

- An athlete can connect and see only their own recent runs.
- A coach, admin, guardian, or different athlete cannot read the integration or
  activity rows, even by calling Supabase directly.
- A bicycle or walking activity is not retained.
- Disconnect removes the authorization in Strava and leaves no local activity,
  token, or integration row.
- The AI planner and performance insight continue to work from manual training
  feedback when Strava is disconnected.
