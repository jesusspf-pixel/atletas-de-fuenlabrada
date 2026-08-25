-- Una invitación de entrenador puede conceder acceso a varios grupos.
alter table public.invitation_links add column if not exists training_group_ids uuid[] not null default '{}';

create or replace function public.create_staff_invitation_multi(target_email text,target_role public.user_role,target_group_ids uuid[] default '{}')
returns public.invitation_links language plpgsql security definer set search_path=public as $$
declare created public.invitation_links; clean_groups uuid[];
begin
  if not public.is_admin() then raise exception 'Solo un administrador puede invitar al equipo.'; end if;
  if target_role not in ('admin','coach') then raise exception 'Solo se puede invitar a administradores o entrenadores.'; end if;
  select coalesce(array_agg(id),'{}'::uuid[]) into clean_groups from public.training_groups where id=any(coalesce(target_group_ids,'{}'::uuid[])) and active=true;
  insert into public.invitation_links(email,role,training_group_id,training_group_ids,created_by)
  values(nullif(lower(trim(target_email)),''),target_role,null,case when target_role='coach' then clean_groups else '{}'::uuid[] end,auth.uid()) returning * into created;
  return created;
end; $$;
revoke all on function public.create_staff_invitation_multi(text,public.user_role,uuid[]) from public;
grant execute on function public.create_staff_invitation_multi(text,public.user_role,uuid[]) to authenticated;

create or replace function public.accept_staff_invitation(invitation_token uuid)
returns public.user_role language plpgsql security definer set search_path=public as $$
declare invite public.invitation_links; user_email text; demo_athlete_id uuid; target_group uuid;
begin
  if auth.uid() is null then raise exception 'Inicia sesión antes de aceptar la invitación.'; end if;
  user_email:=lower(coalesce(auth.jwt()->>'email',''));
  select * into invite from public.invitation_links where token=invitation_token and accepted_at is null and expires_at>now() for update;
  if not found then raise exception 'La invitación no existe, ha caducado o ya se utilizó.'; end if;
  if invite.email is not null and lower(invite.email)<>user_email then raise exception 'Esta invitación corresponde a otro correo electrónico.'; end if;
  insert into public.profiles(id,email,full_name,phone,role,is_demo)
  values(auth.uid(),user_email,case when invite.role='adult_athlete' then 'Atleta de demostración' end,case when invite.role='adult_athlete' then '600000000' end,invite.role,invite.role='adult_athlete')
  on conflict(id) do update set email=excluded.email,role=excluded.role,is_demo=excluded.is_demo,updated_at=now();
  if invite.role='coach' then
    for target_group in select unnest(case when cardinality(invite.training_group_ids)>0 then invite.training_group_ids when invite.training_group_id is not null then array[invite.training_group_id] else '{}'::uuid[] end)
    loop insert into public.training_group_coaches(training_group_id,coach_profile_id) values(target_group,auth.uid()) on conflict do nothing; end loop;
  elsif invite.role='adult_athlete' then
    select id into demo_athlete_id from public.athletes where user_profile_id=auth.uid();
    if demo_athlete_id is null then
      insert into public.athletes(user_profile_id,first_name,last_name,birth_date,federative_sex,club_status,license_status,training_group_id)
      values(auth.uid(),'Atleta','Demo',date '2000-01-01','M','active','active',(select id from public.training_groups where active order by name limit 1)) returning id into demo_athlete_id;
      insert into public.memberships(athlete_id,season,plan,enrolment_fee_status,fee_provider,starts_on) values(demo_athlete_id,'2026/27','monthly','paid','paused',current_date) on conflict(athlete_id,season) do nothing;
    end if;
  end if;
  update public.invitation_links set accepted_at=now() where id=invite.id;
  return invite.role;
end; $$;
revoke all on function public.accept_staff_invitation(uuid) from public;
grant execute on function public.accept_staff_invitation(uuid) to authenticated;

-- Feed no intrusivo de logros, calculado desde las actividades de quienes participan.
create or replace view public.club_challenge_recent_achievements with (security_invoker=false) as
with eligible as (
  select a.id athlete_id,a.first_name,a.last_name,tg.name group_name,s.avatar_url
  from public.athletes a join public.athlete_profile_settings s on s.athlete_id=a.id and s.challenge_opt_in=true and s.show_activity_to_club=true
  left join public.training_groups tg on tg.id=a.training_group_id
), acts as (
  select act.athlete_id,act.started_at,act.distance_m,
    sum(coalesce(act.distance_m,0)) over(partition by act.athlete_id order by act.started_at,act.id) cumulative_m
  from public.external_sport_activities act
  where act.started_at>=make_date(case when extract(month from current_date)>=8 then extract(year from current_date)::int else extract(year from current_date)::int-1 end,8,1)
    and lower(coalesce(act.activity_type,'')) in ('run','trailrun','virtualrun','wheelchair')
), thresholds(target_km) as (values(50),(100),(200),(300),(400),(500),(750),(1000)), distance_awards as (
  select e.athlete_id,e.first_name,e.last_name,e.group_name,e.avatar_url,'distance_'||t.target_km achievement_key,
    case when t.target_km=1000 then '1.000 km · Corona de la temporada' else t.target_km||' km acumulados' end title,min(a.started_at) earned_at
  from eligible e cross join thresholds t join acts a on a.athlete_id=e.athlete_id and a.cumulative_m>=t.target_km*1000
  group by e.athlete_id,e.first_name,e.last_name,e.group_name,e.avatar_url,t.target_km
), days as (
  select distinct athlete_id,started_at::date activity_day from acts
), islands as (
  select athlete_id,activity_day,activity_day-row_number() over(partition by athlete_id order by activity_day)::int island from days
), streak_awards as (
  select e.athlete_id,e.first_name,e.last_name,e.group_name,e.avatar_url,'streak_4' achievement_key,'Cuatro días seguidos' title,min(x.earned_at)::timestamptz earned_at
  from eligible e join (select athlete_id,island,max(activity_day) earned_at,count(*) days from islands group by athlete_id,island having count(*)>=4) x on x.athlete_id=e.athlete_id
  group by e.athlete_id,e.first_name,e.last_name,e.group_name,e.avatar_url
)
select * from distance_awards union all select * from streak_awards;
revoke all on public.club_challenge_recent_achievements from anon;
grant select on public.club_challenge_recent_achievements to authenticated;
