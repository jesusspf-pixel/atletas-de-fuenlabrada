-- Club Challenge: retos creados por atletas/entrenadores, duelos y métricas seguras.
create table if not exists public.club_challenges (
  id uuid primary key default gen_random_uuid(),
  created_by uuid not null references public.profiles(id) on delete cascade default auth.uid(),
  creator_athlete_id uuid references public.athletes(id) on delete set null,
  title text not null check (char_length(title) between 3 and 80),
  description text not null default '' check (char_length(description) <= 280),
  metric text not null check (metric in ('distance','activities','active_days','elevation','duration','relative_effort')),
  scope text not null check (scope in ('club','group','duel')),
  training_group_id uuid references public.training_groups(id) on delete cascade,
  target_value numeric not null check (target_value > 0),
  starts_on date not null default current_date,
  ends_on date not null,
  status text not null default 'active' check (status in ('active','completed','cancelled')),
  created_at timestamptz not null default now(),
  check (ends_on >= starts_on),
  check ((scope='group' and training_group_id is not null) or scope<>'group')
);

create table if not exists public.club_challenge_participants (
  challenge_id uuid not null references public.club_challenges(id) on delete cascade,
  athlete_id uuid not null references public.athletes(id) on delete cascade,
  status text not null default 'accepted' check (status in ('pending','accepted','declined')),
  invited_by_athlete_id uuid references public.athletes(id) on delete set null,
  joined_at timestamptz not null default now(),
  primary key(challenge_id,athlete_id)
);

alter table public.club_challenges enable row level security;
alter table public.club_challenge_participants enable row level security;

create or replace function public.challenge_can_manage_athlete(target_athlete_id uuid)
returns boolean language sql stable security definer set search_path=public as $$
  select public.is_admin() or exists(
    select 1 from public.athletes a
    where a.id=target_athlete_id and (
      a.user_profile_id=auth.uid()
      or (a.family_id is not null and public.can_access_family(a.family_id))
      or public.coaches_group(a.training_group_id)
    )
  )
$$;

drop policy if exists "challenge authenticated read" on public.club_challenges;
create policy "challenge authenticated read" on public.club_challenges for select using (auth.uid() is not null);
drop policy if exists "challenge participants authenticated read" on public.club_challenge_participants;
create policy "challenge participants authenticated read" on public.club_challenge_participants for select using (auth.uid() is not null);
grant select on public.club_challenges,public.club_challenge_participants to authenticated;

create or replace function public.create_club_challenge(
  challenge_title text, challenge_description text, challenge_metric text,
  challenge_scope text, challenge_target numeric, challenge_starts date,
  challenge_ends date, acting_athlete_id uuid default null,
  target_group_id uuid default null, invited_athlete_id uuid default null
) returns uuid language plpgsql security definer set search_path=public as $$
declare
  new_id uuid; actor_role public.user_role; actor_group uuid; invited_group uuid;
begin
  if auth.uid() is null then raise exception 'Inicia sesión para crear un reto.'; end if;
  select role into actor_role from public.profiles where id=auth.uid();
  if acting_athlete_id is not null then
    if not public.challenge_can_manage_athlete(acting_athlete_id) then raise exception 'No puedes crear retos con este perfil.'; end if;
    select training_group_id into actor_group from public.athletes where id=acting_athlete_id;
  elsif actor_role not in ('owner','admin','coach') then
    raise exception 'Selecciona el atleta que crea el reto.';
  end if;
  if challenge_scope='group' then
    target_group_id:=coalesce(target_group_id,actor_group);
    if target_group_id is null and actor_role='coach' then
      select training_group_id into target_group_id from public.training_group_coaches
      where coach_profile_id=auth.uid() order by is_primary desc nulls last limit 1;
    end if;
    if target_group_id is null then raise exception 'Selecciona un grupo.'; end if;
    if actor_role='coach' and not public.coaches_group(target_group_id) then raise exception 'Solo puedes crear retos para tus grupos.'; end if;
  end if;
  if challenge_scope='duel' then
    if acting_athlete_id is null or invited_athlete_id is null or acting_athlete_id=invited_athlete_id then raise exception 'Selecciona dos compañeros distintos.'; end if;
    select training_group_id into invited_group from public.athletes where id=invited_athlete_id;
    if actor_group is distinct from invited_group then raise exception 'Los duelos son entre compañeros del mismo grupo.'; end if;
  end if;
  insert into public.club_challenges(created_by,creator_athlete_id,title,description,metric,scope,training_group_id,target_value,starts_on,ends_on)
  values(auth.uid(),acting_athlete_id,trim(challenge_title),trim(coalesce(challenge_description,'')),challenge_metric,challenge_scope,target_group_id,challenge_target,challenge_starts,challenge_ends)
  returning id into new_id;
  if challenge_scope='duel' then
    insert into public.club_challenge_participants(challenge_id,athlete_id,status,invited_by_athlete_id)
    values(new_id,acting_athlete_id,'accepted',acting_athlete_id),(new_id,invited_athlete_id,'pending',acting_athlete_id);
  else
    insert into public.club_challenge_participants(challenge_id,athlete_id,status)
    select new_id,a.id,'accepted'
    from public.athletes a join public.athlete_profile_settings s on s.athlete_id=a.id
    where s.challenge_opt_in=true and s.show_activity_to_club=true
      and (challenge_scope='club' or a.training_group_id=target_group_id)
    on conflict do nothing;
  end if;
  return new_id;
end $$;
grant execute on function public.create_club_challenge(text,text,text,text,numeric,date,date,uuid,uuid,uuid) to authenticated;

create or replace function public.join_club_challenge(target_challenge_id uuid,target_athlete_id uuid)
returns void language plpgsql security definer set search_path=public as $$
declare c public.club_challenges;
begin
  if not public.challenge_can_manage_athlete(target_athlete_id) then raise exception 'No puedes inscribir a este atleta.'; end if;
  select * into c from public.club_challenges where id=target_challenge_id and status='active' and ends_on>=current_date;
  if c.id is null or c.scope='duel' then raise exception 'Este reto no admite nuevas inscripciones.'; end if;
  if c.scope='group' and not exists(select 1 from public.athletes where id=target_athlete_id and training_group_id=c.training_group_id) then raise exception 'El reto pertenece a otro grupo.'; end if;
  insert into public.club_challenge_participants(challenge_id,athlete_id,status) values(c.id,target_athlete_id,'accepted')
  on conflict(challenge_id,athlete_id) do update set status='accepted',joined_at=now();
end $$;
grant execute on function public.join_club_challenge(uuid,uuid) to authenticated;

create or replace function public.respond_club_challenge(target_challenge_id uuid,target_athlete_id uuid,accept_invite boolean)
returns void language plpgsql security definer set search_path=public as $$
begin
  if not public.challenge_can_manage_athlete(target_athlete_id) then raise exception 'No puedes responder por este atleta.'; end if;
  update public.club_challenge_participants set status=case when accept_invite then 'accepted' else 'declined' end,joined_at=now()
  where challenge_id=target_challenge_id and athlete_id=target_athlete_id and status='pending';
end $$;
grant execute on function public.respond_club_challenge(uuid,uuid,boolean) to authenticated;

create or replace view public.club_challenge_progress with (security_invoker=false) as
select c.id challenge_id,c.title,c.description,c.metric,c.scope,c.training_group_id,c.target_value,c.starts_on,c.ends_on,c.status,
  p.athlete_id,p.status participant_status,a.first_name,a.last_name,tg.name group_name,s.avatar_url,
  case c.metric
    when 'distance' then coalesce(sum(x.distance_m),0)/1000.0
    when 'activities' then count(x.id)::numeric
    when 'active_days' then count(distinct x.started_at::date)::numeric
    when 'elevation' then coalesce(sum(x.elevation_gain_m),0)
    when 'duration' then coalesce(sum(x.moving_time_s),0)/60.0
    when 'relative_effort' then coalesce(sum(x.relative_effort),0)
  end progress_value
from public.club_challenges c
join public.club_challenge_participants p on p.challenge_id=c.id
join public.athletes a on a.id=p.athlete_id
join public.athlete_profile_settings s on s.athlete_id=a.id and s.challenge_opt_in=true and s.show_activity_to_club=true
left join public.training_groups tg on tg.id=a.training_group_id
left join public.external_sport_activities x on x.athlete_id=a.id and x.started_at::date between c.starts_on and c.ends_on
  and lower(coalesce(x.activity_type,'')) in ('run','trailrun','virtualrun','wheelchair')
group by c.id,p.athlete_id,p.status,a.first_name,a.last_name,tg.name,s.avatar_url;
revoke all on public.club_challenge_progress from anon;
grant select on public.club_challenge_progress to authenticated;

create or replace view public.club_challenge_weekly with (security_invoker=false) as
select a.id athlete_id,a.first_name,a.last_name,a.training_group_id,tg.name group_name,
 count(act.id)::integer activities,coalesce(sum(act.distance_m),0)::numeric distance_m,
 coalesce(sum(act.moving_time_s),0)::bigint moving_time_s,coalesce(sum(act.elevation_gain_m),0)::numeric elevation_gain_m,
 case when coalesce(sum(act.distance_m),0)>0 then coalesce(sum(act.moving_time_s),0)/(coalesce(sum(act.distance_m),0)/1000.0) end pace_seconds_per_km,
 s.avatar_url,count(distinct act.started_at::date)::integer active_days,
 coalesce(sum(act.relative_effort),0)::numeric relative_effort
from public.athletes a join public.athlete_profile_settings s on s.athlete_id=a.id and s.challenge_opt_in=true and s.show_activity_to_club=true
left join public.training_groups tg on tg.id=a.training_group_id
left join public.external_sport_activities act on act.athlete_id=a.id and act.started_at>=date_trunc('week',now()) and act.started_at<date_trunc('week',now())+interval '7 days'
 and lower(coalesce(act.activity_type,'')) in ('run','trailrun','virtualrun','wheelchair')
group by a.id,a.first_name,a.last_name,a.training_group_id,tg.name,s.avatar_url;
revoke all on public.club_challenge_weekly from anon;
grant select on public.club_challenge_weekly to authenticated;
