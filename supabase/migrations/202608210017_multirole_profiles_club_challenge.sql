-- Macro actualización: cuenta multirrol, perfil deportivo personalizable y Club Challenge.

create table if not exists public.profile_roles (
  profile_id uuid not null references public.profiles(id) on delete cascade,
  role public.user_role not null,
  created_at timestamptz not null default now(),
  primary key (profile_id, role)
);

insert into public.profile_roles(profile_id, role)
select id, role from public.profiles
on conflict do nothing;

alter table public.profile_roles enable row level security;
drop policy if exists "profile roles own or admin read" on public.profile_roles;
create policy "profile roles own or admin read" on public.profile_roles
  for select using (profile_id = auth.uid() or public.is_admin());

create table if not exists public.athlete_profile_settings (
  athlete_id uuid primary key references public.athletes(id) on delete cascade,
  avatar_url text,
  cover_url text,
  bio text,
  challenge_opt_in boolean not null default false,
  show_activity_to_club boolean not null default false,
  updated_at timestamptz not null default now()
);

alter table public.athlete_profile_settings enable row level security;
drop policy if exists "athlete profile settings readable" on public.athlete_profile_settings;
drop policy if exists "athlete profile settings owner write" on public.athlete_profile_settings;
create policy "athlete profile settings readable" on public.athlete_profile_settings
  for select using (
    public.is_admin()
    or exists (
      select 1 from public.athletes a left join public.families f on f.id = a.family_id
      where a.id = athlete_profile_settings.athlete_id
      and (a.user_profile_id = auth.uid() or f.primary_profile_id = auth.uid() or public.coaches_group(a.training_group_id))
    )
    or challenge_opt_in
  );
create policy "athlete profile settings owner write" on public.athlete_profile_settings
  for all using (
    exists (select 1 from public.athletes a where a.id = athlete_profile_settings.athlete_id and a.user_profile_id = auth.uid())
  ) with check (
    exists (select 1 from public.athletes a where a.id = athlete_profile_settings.athlete_id and a.user_profile_id = auth.uid())
  );

grant select, insert, update on public.athlete_profile_settings to authenticated;

insert into storage.buckets (id, name, public)
values ('athlete-profiles', 'athlete-profiles', true)
on conflict (id) do update set public = true;

drop policy if exists "athlete profile images public read" on storage.objects;
drop policy if exists "athlete profile images own upload" on storage.objects;
drop policy if exists "athlete profile images own update" on storage.objects;
drop policy if exists "athlete profile images own delete" on storage.objects;
create policy "athlete profile images public read" on storage.objects
  for select using (bucket_id = 'athlete-profiles');
create policy "athlete profile images own upload" on storage.objects
  for insert with check (bucket_id = 'athlete-profiles' and (storage.foldername(name))[1] = auth.uid()::text);
create policy "athlete profile images own update" on storage.objects
  for update using (bucket_id = 'athlete-profiles' and (storage.foldername(name))[1] = auth.uid()::text);
create policy "athlete profile images own delete" on storage.objects
  for delete using (bucket_id = 'athlete-profiles' and (storage.foldername(name))[1] = auth.uid()::text);

-- Permite que una familia ya registrada añada a la misma persona como atleta adulto
-- sin crear otra cuenta ni perder su rol de padre/madre/tutor.
create or replace function public.register_self_as_adult_athlete(payload jsonb)
returns uuid language plpgsql security definer set search_path = public as $$
declare
  v_profile_id uuid := auth.uid();
  v_athlete_id uuid;
  v_email text := coalesce(auth.jwt() ->> 'email', '');
begin
  if v_profile_id is null then raise exception 'Inicia sesión primero.'; end if;
  select id into v_athlete_id from public.athletes where user_profile_id = v_profile_id limit 1;
  if v_athlete_id is not null then return v_athlete_id; end if;

  insert into public.athletes(
    user_profile_id, first_name, last_name, birth_date, federative_sex, dni_nie,
    club_status, license_status, medical_notes
  ) values (
    v_profile_id,
    payload ->> 'first_name', payload ->> 'last_name', (payload ->> 'birth_date')::date,
    payload ->> 'federative_sex', nullif(payload ->> 'dni_nie',''),
    'pending_review', 'pending', nullif(payload ->> 'health_notes','')
  ) returning id into v_athlete_id;

  insert into public.profile_roles(profile_id, role) values (v_profile_id, 'adult_athlete') on conflict do nothing;
  insert into public.athlete_profile_settings(athlete_id) values (v_athlete_id) on conflict do nothing;
  insert into public.audit_log(actor_id, entity_type, entity_id, action, metadata)
  values (v_profile_id, 'athlete', v_athlete_id, 'self_registered_as_adult_athlete', jsonb_build_object('email', v_email));
  return v_athlete_id;
end;
$$;
revoke all on function public.register_self_as_adult_athlete(jsonb) from public;
grant execute on function public.register_self_as_adult_athlete(jsonb) to authenticated;

create or replace view public.club_challenge_weekly
with (security_invoker = true)
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
group by a.id, a.first_name, a.last_name, a.training_group_id, tg.name;

grant select on public.club_challenge_weekly to authenticated;

create table if not exists public.athlete_achievements (
  id uuid primary key default gen_random_uuid(),
  athlete_id uuid not null references public.athletes(id) on delete cascade,
  achievement_key text not null,
  title text not null,
  description text,
  earned_at timestamptz not null default now(),
  metadata jsonb not null default '{}'::jsonb,
  unique (athlete_id, achievement_key)
);
alter table public.athlete_achievements enable row level security;
drop policy if exists "achievements visible" on public.athlete_achievements;
create policy "achievements visible" on public.athlete_achievements for select using (
  public.is_admin() or exists (
    select 1 from public.athletes a left join public.families f on f.id=a.family_id
    where a.id=athlete_achievements.athlete_id
      and (a.user_profile_id=auth.uid() or f.primary_profile_id=auth.uid() or public.coaches_group(a.training_group_id))
  ) or exists (
    select 1 from public.athlete_profile_settings s where s.athlete_id=athlete_achievements.athlete_id and s.challenge_opt_in=true
  )
);
grant select on public.athlete_achievements to authenticated;
