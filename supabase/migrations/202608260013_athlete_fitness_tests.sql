create table if not exists public.athlete_fitness_tests (
  id uuid primary key default gen_random_uuid(),
  athlete_id uuid not null references public.athletes(id) on delete cascade,
  test_type text not null default 'device_estimate',
  protocol text,
  status text not null default 'planned' check (status in ('planned','completed','cancelled')),
  scheduled_for date,
  completed_on date,
  vo2_max numeric(5,2) check (vo2_max is null or (vo2_max between 10 and 100)),
  device text,
  notes text,
  created_by uuid references public.profiles(id) on delete set null default auth.uid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists athlete_fitness_tests_athlete_date_idx on public.athlete_fitness_tests(athlete_id, completed_on desc, scheduled_for desc);
alter table public.athlete_fitness_tests enable row level security;

create policy "fitness tests athlete family or staff read" on public.athlete_fitness_tests for select using (
  public.is_admin() or exists (
    select 1 from public.athletes a left join public.families f on f.id = a.family_id
    where a.id = athlete_id and (a.user_profile_id = auth.uid() or f.primary_profile_id = auth.uid() or public.coaches_group(a.training_group_id))
  )
);
create policy "fitness tests athlete records own" on public.athlete_fitness_tests for insert with check (
  created_by = auth.uid() and exists (select 1 from public.athletes a left join public.families f on f.id=a.family_id where a.id=athlete_id and (a.user_profile_id=auth.uid() or f.primary_profile_id=auth.uid()))
);
create policy "fitness tests staff manage" on public.athlete_fitness_tests for all using (
  public.is_admin() or exists (select 1 from public.athletes a where a.id=athlete_id and public.coaches_group(a.training_group_id))
) with check (
  public.is_admin() or exists (select 1 from public.athletes a where a.id=athlete_id and public.coaches_group(a.training_group_id))
);
