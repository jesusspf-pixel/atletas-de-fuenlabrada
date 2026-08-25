-- Club Challenge: clasificación de temporada, fotos, rachas y retos entre grupos.
create or replace view public.club_challenge_weekly
with (security_invoker = false)
as
select a.id athlete_id, a.first_name, a.last_name, a.training_group_id, tg.name group_name,
  count(act.id)::integer activities, coalesce(sum(act.distance_m),0)::numeric distance_m,
  coalesce(sum(act.moving_time_s),0)::bigint moving_time_s,
  coalesce(sum(act.elevation_gain_m),0)::numeric elevation_gain_m,
  case when coalesce(sum(act.distance_m),0)>0 then coalesce(sum(act.moving_time_s),0)/(coalesce(sum(act.distance_m),0)/1000.0) end pace_seconds_per_km,
  s.avatar_url
from public.athletes a
join public.athlete_profile_settings s on s.athlete_id=a.id and s.challenge_opt_in=true and s.show_activity_to_club=true
left join public.training_groups tg on tg.id=a.training_group_id
left join public.external_sport_activities act on act.athlete_id=a.id
  and act.started_at>=date_trunc('week',now()) and act.started_at<date_trunc('week',now())+interval '7 days'
  and lower(coalesce(act.activity_type,'')) in ('run','trailrun','virtualrun','wheelchair')
group by a.id,a.first_name,a.last_name,a.training_group_id,tg.name,s.avatar_url;
revoke all on public.club_challenge_weekly from anon;
grant select on public.club_challenge_weekly to authenticated;

create or replace view public.club_challenge_season with (security_invoker=false) as
with eligible as (
  select a.id athlete_id,a.first_name,a.last_name,a.training_group_id,tg.name group_name,s.avatar_url
  from public.athletes a join public.athlete_profile_settings s on s.athlete_id=a.id and s.challenge_opt_in=true and s.show_activity_to_club=true
  left join public.training_groups tg on tg.id=a.training_group_id
), activity_days as (
  select distinct act.athlete_id,act.started_at::date activity_day from public.external_sport_activities act
  where act.started_at>=make_date(case when extract(month from current_date)>=8 then extract(year from current_date)::int else extract(year from current_date)::int-1 end,8,1)
    and lower(coalesce(act.activity_type,'')) in ('run','trailrun','virtualrun','wheelchair')
), numbered as (
  select athlete_id,activity_day,activity_day-row_number() over(partition by athlete_id order by activity_day)::int island from activity_days
), longest as (
  select athlete_id,max(streak_days)::integer longest_streak_days from (select athlete_id,island,count(*)::integer streak_days from numbered group by athlete_id,island) x group by athlete_id
), totals as (
  select act.athlete_id,count(act.id)::integer activities,coalesce(sum(act.distance_m),0)::numeric distance_m,
    coalesce(sum(act.moving_time_s),0)::bigint moving_time_s,coalesce(sum(act.elevation_gain_m),0)::numeric elevation_gain_m
  from public.external_sport_activities act
  where act.started_at>=make_date(case when extract(month from current_date)>=8 then extract(year from current_date)::int else extract(year from current_date)::int-1 end,8,1)
    and lower(coalesce(act.activity_type,'')) in ('run','trailrun','virtualrun','wheelchair') group by act.athlete_id
)
select e.athlete_id,e.first_name,e.last_name,e.training_group_id,e.group_name,e.avatar_url,
  coalesce(t.activities,0)::integer activities,coalesce(t.distance_m,0)::numeric distance_m,
  coalesce(t.moving_time_s,0)::bigint moving_time_s,coalesce(t.elevation_gain_m,0)::numeric elevation_gain_m,
  (select count(*)::integer from activity_days d where d.athlete_id=e.athlete_id) active_days,
  coalesce(l.longest_streak_days,0)::integer longest_streak_days
from eligible e left join totals t on t.athlete_id=e.athlete_id left join longest l on l.athlete_id=e.athlete_id;
revoke all on public.club_challenge_season from anon;
grant select on public.club_challenge_season to authenticated;
