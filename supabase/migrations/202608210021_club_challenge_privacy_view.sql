-- El Challenge expone solo estadísticas agregadas de atletas que han dado consentimiento.
-- Las actividades individuales mantienen su RLS original y no se abren al resto del club.

create or replace view public.club_challenge_weekly
with (security_invoker = false)
as
select
  a.id as athlete_id,
  a.first_name,
  a.last_name,
  a.training_group_id,
  tg.name as group_name,
  count(act.id)::integer as activities,
  coalesce(sum(act.distance_m),0)::numeric as distance_m,
  coalesce(sum(act.moving_time_s),0)::bigint as moving_time_s,
  coalesce(sum(act.elevation_gain_m),0)::numeric as elevation_gain_m,
  case when coalesce(sum(act.distance_m),0) > 0
    then coalesce(sum(act.moving_time_s),0) / (coalesce(sum(act.distance_m),0) / 1000.0)
    else null end as pace_seconds_per_km
from public.athletes a
join public.athlete_profile_settings s on s.athlete_id = a.id and s.challenge_opt_in = true and s.show_activity_to_club = true
left join public.training_groups tg on tg.id = a.training_group_id
left join public.external_sport_activities act on act.athlete_id = a.id
  and act.started_at >= date_trunc('week', now())
  and act.started_at < date_trunc('week', now()) + interval '7 days'
  and lower(coalesce(act.activity_type,'')) in ('run','trailrun','virtualrun','wheelchair')
group by a.id, a.first_name, a.last_name, a.training_group_id, tg.name;

revoke all on public.club_challenge_weekly from anon;
grant select on public.club_challenge_weekly to authenticated;
