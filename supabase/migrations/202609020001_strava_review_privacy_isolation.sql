-- Review-only migration for the isolated Strava preview environment.
-- Never apply this migration to the production database without a separate
-- product decision: it intentionally disables club-wide Strava sharing.

drop policy if exists "external integrations visible to athlete family staff"
  on public.athlete_external_integrations;
drop policy if exists "external activities visible to athlete family staff"
  on public.external_sport_activities;
drop policy if exists "additional guardians see external activities"
  on public.external_sport_activities;

create policy "strava integration visible only to authorizing athlete"
on public.athlete_external_integrations
for select
using (
  provider <> 'strava'
  or exists (
    select 1
    from public.athletes a
    where a.id = athlete_external_integrations.athlete_id
      and a.user_profile_id = auth.uid()
  )
);

create policy "strava activities visible only to authorizing athlete"
on public.external_sport_activities
for select
using (
  provider <> 'strava'
  or exists (
    select 1
    from public.athletes a
    where a.id = external_sport_activities.athlete_id
      and a.user_profile_id = auth.uid()
  )
);

-- Achievements and challenge views are derived from connected activity data;
-- they are not exposed in the Strava review build.
drop policy if exists "achievements visible" on public.athlete_achievements;
create policy "connected achievements visible only to athlete"
on public.athlete_achievements
for select
using (
  exists (
    select 1
    from public.athletes a
    where a.id = athlete_achievements.athlete_id
      and a.user_profile_id = auth.uid()
  )
);

revoke all on public.club_challenge_weekly from authenticated;
revoke all on public.club_challenge_season from authenticated;
revoke all on public.club_challenge_recent_achievements from authenticated;

comment on table public.external_sport_activities is
  'Review environment: Strava runs are private to the authorizing athlete, retained for at most 7 days, never supplied to AI, and deleted on disconnect/revocation.';

create or replace function public.purge_expired_strava_review_data()
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  removed integer;
begin
  delete from public.external_sport_activities
  where provider = 'strava'
    and started_at < now() - interval '7 days';
  get diagnostics removed = row_count;

  delete from public.external_oauth_states
  where provider = 'strava'
    and expires_at < now();

  return removed;
end;
$$;

revoke all on function public.purge_expired_strava_review_data() from public;
revoke all on function public.purge_expired_strava_review_data() from authenticated;
grant execute on function public.purge_expired_strava_review_data() to service_role;
