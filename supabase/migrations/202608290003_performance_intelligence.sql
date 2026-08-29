alter table public.external_sport_activities add column if not exists relative_effort numeric;
alter table public.external_sport_activities add column if not exists average_cadence numeric;
alter table public.external_sport_activities add column if not exists max_speed_mps numeric;

create table if not exists public.athlete_training_feedback (
  id uuid primary key default gen_random_uuid(), athlete_id uuid not null references public.athletes(id) on delete cascade,
  external_activity_id uuid references public.external_sport_activities(id) on delete set null, session_date date not null default current_date,
  completed boolean not null default true, duration_minutes integer check (duration_minutes between 0 and 1440), distance_m numeric check (distance_m is null or distance_m >= 0),
  rpe smallint check (rpe between 1 and 10), average_heartrate smallint check (average_heartrate between 30 and 250),
  sleep_quality smallint check (sleep_quality between 1 and 5), fatigue_feeling smallint check (fatigue_feeling between 1 and 5),
  muscle_soreness smallint check (muscle_soreness between 1 and 5), mood smallint check (mood between 1 and 5),
  pain_or_discomfort boolean not null default false, pain_notes text, sensations text,
  created_by uuid not null references public.profiles(id), created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);
alter table public.athlete_training_feedback enable row level security;
create index if not exists athlete_training_feedback_date_idx on public.athlete_training_feedback(athlete_id,session_date desc);
create policy "performance feedback visible to athlete family staff" on public.athlete_training_feedback for select using (public.is_admin() or exists(select 1 from public.athletes a where a.id=athlete_id and (a.user_profile_id=auth.uid() or (a.family_id is not null and public.can_access_family(a.family_id)) or public.coaches_group(a.training_group_id))));
create policy "athlete family records performance feedback" on public.athlete_training_feedback for insert with check (created_by=auth.uid() and exists(select 1 from public.athletes a where a.id=athlete_id and (a.user_profile_id=auth.uid() or (a.family_id is not null and public.can_access_family(a.family_id)))));
create policy "feedback managed by author or staff" on public.athlete_training_feedback for update using (created_by=auth.uid() or public.is_admin() or exists(select 1 from public.athletes a where a.id=athlete_id and public.coaches_group(a.training_group_id)));
grant select,insert,update on public.athlete_training_feedback to authenticated;
