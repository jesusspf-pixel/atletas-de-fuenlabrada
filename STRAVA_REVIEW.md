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
3. Configure preview-only Supabase and Strava credentials. Stripe credentials
   must remain absent from this project.
4. Use `https://strava-review.atletasdefuenlabrada.com` as the stable preview
   host. The callback is derived as
   `https://strava-review.atletasdefuenlabrada.com/api/strava-callback`, which
   remains within the existing Strava authorization callback domain
   `atletasdefuenlabrada.com`.
5. Test with a dedicated reviewer athlete account.

## Deployed isolation

- Pages project: `atletas-strava-review`.
- Review Worker: `club-atletas-strava-review-daily`; it fails closed unless
  `REVIEW_ENVIRONMENT=strava-review`.
- Retention job: Supabase `pg_cron` job `strava-review-retention-daily`, at
  `01:40 UTC` every day. This is kept in the isolated review database because
  the Cloudflare Free account already uses its five available cron triggers.
- The production Pages project, production database, billing Worker, Stripe
  credentials, and payment schedules are not used by this environment.

## Acceptance checks

- An athlete can connect and see only their own recent runs.
- A coach, admin, guardian, or different athlete cannot read the integration or
  activity rows, even by calling Supabase directly.
- A bicycle or walking activity is not retained.
- Disconnect removes the authorization in Strava and leaves no local activity,
  token, or integration row.
- The AI planner and performance insight continue to work from manual training
  feedback when Strava is disconnected.
