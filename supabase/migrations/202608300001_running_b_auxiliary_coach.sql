-- Running B: responsable principal y auxiliar con edición de planes.
create or replace function public.configure_running_b_staff()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  normalized_email text := lower(regexp_replace(coalesce(new.email,''), '\s+', '', 'g'));
  target_group record;
begin
  if normalized_email not in ('eatletismourjc@gmail.com','mividamisangre1@gmail.com') then return new; end if;
  for target_group in
    select id from public.training_groups
    where lower(regexp_replace(name, '\s+', ' ', 'g')) in ('running b','máster running b','master running b')
  loop
    insert into public.training_group_coaches(training_group_id,coach_profile_id,is_primary)
    values(target_group.id,new.id,normalized_email='eatletismourjc@gmail.com')
    on conflict(training_group_id,coach_profile_id)
    do update set is_primary=excluded.is_primary;
  end loop;
  return new;
end;
$$;

drop trigger if exists configure_running_b_staff_on_profile on public.profiles;
create trigger configure_running_b_staff_on_profile
after insert or update of email on public.profiles
for each row execute function public.configure_running_b_staff();

-- Aplica también la configuración a las cuentas si ya existen.
update public.profiles set email=email
where lower(regexp_replace(email, '\s+', '', 'g')) in ('eatletismourjc@gmail.com','mividamisangre1@gmail.com');

create or replace function public.can_plan_group(group_id uuid)
returns boolean language sql stable security definer set search_path = public
as $$
  select public.is_admin() or exists (
    select 1
    from public.training_groups training_group
    join public.profiles profile on profile.id=auth.uid()
    where training_group.id=group_id
      and (
        (
          lower(regexp_replace(training_group.name, '\s+', ' ', 'g')) in ('running a','máster running a','master running a')
          and lower(regexp_replace(profile.email, '\s+', '', 'g'))='eatletismourjc@gmail.com'
        )
        or (
          lower(regexp_replace(training_group.name, '\s+', ' ', 'g')) not in ('running a','máster running a','master running a')
          and public.coaches_group(group_id)
        )
      )
  )
$$;

drop function if exists public.get_member_group_roster(uuid);
create function public.get_member_group_roster(target_group_id uuid)
returns table(person_type text, person_id uuid, display_name text, avatar_url text, role_label text)
language sql
security definer
set search_path = public
stable
as $$
  with allowed as (
    select exists (
      select 1 from public.athletes a
      left join public.families f on f.id=a.family_id
      where a.training_group_id=target_group_id
        and (a.user_profile_id=auth.uid() or f.primary_profile_id=auth.uid())
    ) or public.is_staff() as ok
  )
  select 'coach',p.id,coalesce(nullif(p.full_name,''),p.email),cps.avatar_url,
    case when tgc.is_primary then 'Entrenador' else 'Auxiliar' end
  from allowed,public.training_group_coaches tgc
  join public.profiles p on p.id=tgc.coach_profile_id
  left join public.coach_profile_settings cps on cps.profile_id=p.id
  where allowed.ok and tgc.training_group_id=target_group_id
  union all
  select 'athlete',a.id,trim(a.first_name||' '||a.last_name),aps.avatar_url,'Atleta'
  from allowed,public.athletes a
  left join public.athlete_profile_settings aps on aps.athlete_id=a.id
  where allowed.ok and a.training_group_id=target_group_id and a.club_status='active'
  order by 1 desc,3;
$$;

revoke all on function public.get_member_group_roster(uuid) from public;
grant execute on function public.get_member_group_roster(uuid) to authenticated;
