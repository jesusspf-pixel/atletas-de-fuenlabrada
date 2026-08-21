-- Mensajes operativos del entrenador a grupos y atletas concretos.

create table if not exists public.coach_athlete_messages (
  id uuid primary key default gen_random_uuid(),
  coach_profile_id uuid not null references public.profiles(id) on delete cascade,
  training_group_id uuid references public.training_groups(id) on delete cascade,
  athlete_id uuid references public.athletes(id) on delete cascade,
  subject text not null,
  body text not null,
  created_at timestamptz not null default now(),
  check (training_group_id is not null or athlete_id is not null)
);

alter table public.coach_athlete_messages enable row level security;

create policy "coach messages sender admin recipient read" on public.coach_athlete_messages for select using (
  coach_profile_id = auth.uid()
  or public.is_admin()
  or exists (
    select 1 from public.athletes a
    left join public.families f on f.id = a.family_id
    where
      (a.id = coach_athlete_messages.athlete_id or (coach_athlete_messages.athlete_id is null and a.training_group_id = coach_athlete_messages.training_group_id))
      and (a.user_profile_id = auth.uid() or f.primary_profile_id = auth.uid())
  )
);

create policy "coach messages assigned group insert" on public.coach_athlete_messages for insert with check (
  coach_profile_id = auth.uid()
  and (
    (training_group_id is not null and public.coaches_group(training_group_id))
    or exists (select 1 from public.athletes a where a.id = athlete_id and public.coaches_group(a.training_group_id))
  )
);

create policy "coach messages admin insert" on public.coach_athlete_messages for insert with check (public.is_admin());
