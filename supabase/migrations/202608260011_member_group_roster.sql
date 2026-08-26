create or replace function public.get_member_group_roster(target_group_id uuid)
returns table(person_type text, person_id uuid, display_name text, avatar_url text)
language sql
security definer
set search_path = public
stable
as $$
  with allowed as (
    select exists (
      select 1 from public.athletes a
      left join public.families f on f.id = a.family_id
      where a.training_group_id = target_group_id
        and (a.user_profile_id = auth.uid() or f.primary_profile_id = auth.uid())
    ) or public.is_staff() as ok
  )
  select 'coach', p.id, coalesce(nullif(p.full_name, ''), 'Entrenador'), cps.avatar_url
  from allowed, public.training_group_coaches tgc
  join public.profiles p on p.id = tgc.coach_profile_id
  left join public.coach_profile_settings cps on cps.profile_id = p.id
  where allowed.ok and tgc.training_group_id = target_group_id
  union all
  select 'athlete', a.id, trim(a.first_name || ' ' || a.last_name), aps.avatar_url
  from allowed, public.athletes a
  left join public.athlete_profile_settings aps on aps.athlete_id = a.id
  where allowed.ok and a.training_group_id = target_group_id and a.club_status = 'active'
  order by 1 desc, 3;
$$;

revoke all on function public.get_member_group_roster(uuid) from public;
grant execute on function public.get_member_group_roster(uuid) to authenticated;
