-- Reinicio lógico y reversible del Challenge. No borra actividades deportivas.
create table if not exists public.club_challenge_reset_settings (
  singleton boolean primary key default true check(singleton),
  reset_from date not null,
  protected_athlete_id uuid not null references public.athletes(id) on delete restrict,
  updated_at timestamptz not null default now()
);
alter table public.club_challenge_reset_settings enable row level security;
insert into public.club_challenge_reset_settings(singleton,reset_from,protected_athlete_id)
values(true,current_date-1,'662ff7d3-f4aa-4d9e-89a9-9601ef177877')
on conflict(singleton) do update set reset_from=excluded.reset_from,protected_athlete_id=excluded.protected_athlete_id,updated_at=now();
revoke all on public.club_challenge_reset_settings from anon,authenticated;

drop view if exists public.club_challenge_weekly;
create view public.club_challenge_weekly with (security_invoker=false) as
select a.id athlete_id,a.first_name,a.last_name,a.training_group_id,tg.name group_name,
 count(act.id)::integer activities,coalesce(sum(act.distance_m),0)::numeric distance_m,
 coalesce(sum(act.moving_time_s),0)::bigint moving_time_s,coalesce(sum(act.elevation_gain_m),0)::numeric elevation_gain_m,
 case when coalesce(sum(act.distance_m),0)>0 then coalesce(sum(act.moving_time_s),0)/(coalesce(sum(act.distance_m),0)/1000.0) end pace_seconds_per_km,
 s.avatar_url,count(distinct act.started_at::date)::integer active_days,coalesce(sum(act.relative_effort),0)::numeric relative_effort
from public.athletes a
cross join public.club_challenge_reset_settings cfg
join public.athlete_profile_settings s on s.athlete_id=a.id and s.challenge_opt_in=true and s.show_activity_to_club=true
left join public.training_groups tg on tg.id=a.training_group_id
left join public.external_sport_activities act on act.athlete_id=a.id
 and act.started_at>=date_trunc('week',now()) and act.started_at<date_trunc('week',now())+interval '7 days'
 and (a.id=cfg.protected_athlete_id or act.started_at::date>=cfg.reset_from)
 and lower(coalesce(act.activity_type,'')) in ('run','trailrun','virtualrun','wheelchair')
group by a.id,a.first_name,a.last_name,a.training_group_id,tg.name,s.avatar_url;
revoke all on public.club_challenge_weekly from anon;
grant select on public.club_challenge_weekly to authenticated;

drop view if exists public.club_challenge_season;
create view public.club_challenge_season with (security_invoker=false) as
with cfg as (select reset_from,protected_athlete_id from public.club_challenge_reset_settings), eligible as (
 select a.id athlete_id,a.first_name,a.last_name,a.training_group_id,tg.name group_name,s.avatar_url
 from public.athletes a join public.athlete_profile_settings s on s.athlete_id=a.id and s.challenge_opt_in=true and s.show_activity_to_club=true
 left join public.training_groups tg on tg.id=a.training_group_id
), filtered as (
 select act.* from public.external_sport_activities act,cfg
 where (act.athlete_id=cfg.protected_athlete_id or act.started_at::date>=cfg.reset_from)
 and lower(coalesce(act.activity_type,'')) in ('run','trailrun','virtualrun','wheelchair')
), activity_days as (
 select distinct athlete_id,started_at::date activity_day from filtered
), numbered as (
 select athlete_id,activity_day,activity_day-row_number() over(partition by athlete_id order by activity_day)::int island from activity_days
), longest as (
 select athlete_id,max(streak_days)::integer longest_streak_days from (select athlete_id,island,count(*)::integer streak_days from numbered group by athlete_id,island) x group by athlete_id
), totals as (
 select athlete_id,count(id)::integer activities,coalesce(sum(distance_m),0)::numeric distance_m,
 coalesce(sum(moving_time_s),0)::bigint moving_time_s,coalesce(sum(elevation_gain_m),0)::numeric elevation_gain_m,
 coalesce(sum(relative_effort),0)::numeric relative_effort from filtered group by athlete_id
)
select e.athlete_id,e.first_name,e.last_name,e.training_group_id,e.group_name,e.avatar_url,
 coalesce(t.activities,0)::integer activities,coalesce(t.distance_m,0)::numeric distance_m,
 coalesce(t.moving_time_s,0)::bigint moving_time_s,coalesce(t.elevation_gain_m,0)::numeric elevation_gain_m,
 (select count(*)::integer from activity_days d where d.athlete_id=e.athlete_id) active_days,
 coalesce(l.longest_streak_days,0)::integer longest_streak_days,coalesce(t.relative_effort,0)::numeric relative_effort
from eligible e left join totals t on t.athlete_id=e.athlete_id left join longest l on l.athlete_id=e.athlete_id;
revoke all on public.club_challenge_season from anon;
grant select on public.club_challenge_season to authenticated;

drop view if exists public.club_challenge_recent_achievements;
create view public.club_challenge_recent_achievements with (security_invoker=false) as
with cfg as (select reset_from,protected_athlete_id from public.club_challenge_reset_settings), eligible as (
 select a.id athlete_id,a.first_name,a.last_name,tg.name group_name,s.avatar_url
 from public.athletes a join public.athlete_profile_settings s on s.athlete_id=a.id and s.challenge_opt_in=true and s.show_activity_to_club=true
 left join public.training_groups tg on tg.id=a.training_group_id
), acts as (
 select act.athlete_id,act.started_at,act.distance_m,sum(coalesce(act.distance_m,0)) over(partition by act.athlete_id order by act.started_at,act.id) cumulative_m
 from public.external_sport_activities act,cfg
 where (act.athlete_id=cfg.protected_athlete_id or act.started_at::date>=cfg.reset_from)
 and lower(coalesce(act.activity_type,'')) in ('run','trailrun','virtualrun','wheelchair')
), thresholds(target_km) as (values(50),(100),(200),(300),(400),(500),(750),(1000)), distance_awards as (
 select e.athlete_id,e.first_name,e.last_name,e.group_name,e.avatar_url,'distance_'||t.target_km achievement_key,
 case when t.target_km=1000 then '1.000 km · Corona de la temporada' else t.target_km||' km acumulados' end title,min(a.started_at) earned_at
 from eligible e cross join thresholds t join acts a on a.athlete_id=e.athlete_id and a.cumulative_m>=t.target_km*1000
 group by e.athlete_id,e.first_name,e.last_name,e.group_name,e.avatar_url,t.target_km
), days as (select distinct athlete_id,started_at::date activity_day from acts), islands as (
 select athlete_id,activity_day,activity_day-row_number() over(partition by athlete_id order by activity_day)::int island from days
), streak_awards as (
 select e.athlete_id,e.first_name,e.last_name,e.group_name,e.avatar_url,'streak_4' achievement_key,'Cuatro días seguidos' title,min(x.earned_at)::timestamptz earned_at
 from eligible e join (select athlete_id,island,max(activity_day) earned_at,count(*) days from islands group by athlete_id,island having count(*)>=4) x on x.athlete_id=e.athlete_id
 group by e.athlete_id,e.first_name,e.last_name,e.group_name,e.avatar_url
)
select * from distance_awards union all select * from streak_awards;
revoke all on public.club_challenge_recent_achievements from anon;
grant select on public.club_challenge_recent_achievements to authenticated;
