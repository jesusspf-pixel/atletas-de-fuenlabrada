create table if not exists public.coach_profile_settings(
  profile_id uuid primary key references public.profiles(id) on delete cascade,
  avatar_url text, cover_url text, bio text, public_phone text,
  updated_at timestamptz not null default now()
);
alter table public.coach_profile_settings enable row level security;
create policy "coach profiles authenticated read" on public.coach_profile_settings for select using(auth.uid() is not null);
create policy "coach profile owner write" on public.coach_profile_settings for all using(profile_id=auth.uid()) with check(profile_id=auth.uid());
grant select,insert,update on public.coach_profile_settings to authenticated;

drop policy if exists "competitions coaches create" on public.competition_events;
create policy "competitions coaches create" on public.competition_events for insert with check(
  created_by=auth.uid() and exists(select 1 from public.profiles p where p.id=auth.uid() and p.role='coach')
);
drop policy if exists "competitions coaches update own" on public.competition_events;
create policy "competitions coaches update own" on public.competition_events for update using(
  created_by=auth.uid() and exists(select 1 from public.profiles p where p.id=auth.uid() and p.role='coach')
) with check(created_by=auth.uid());

drop policy if exists "announcements admins or coach group" on public.announcements;
create policy "announcements admins or restricted coach" on public.announcements for insert with check(
  public.is_admin() or (
    created_by=auth.uid() and exists(select 1 from public.profiles p where p.id=auth.uid() and p.role='coach') and (
      (audience='group' and public.coaches_group(training_group_id)) or audience in('individual','staff')
    )
  )
);
