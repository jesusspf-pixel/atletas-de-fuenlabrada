-- Seguimiento real de cada sesión planificada. Una misma sesión puede combinar
-- datos importados (Strava/Garmin) con sensaciones introducidas por el atleta.

create table if not exists public.training_session_feedback (
  id uuid primary key default gen_random_uuid(),
  training_plan_id uuid not null references public.training_plans(id) on delete cascade,
  athlete_id uuid not null references public.athletes(id) on delete cascade,
  external_activity_id uuid references public.external_sport_activities(id) on delete set null,
  session_date date not null,
  plan_day text not null,
  completion_status text not null default 'completed'
    check (completion_status in ('completed','partial','not_completed')),
  source text not null default 'manual'
    check (source in ('manual','strava','garmin','mixed')),
  activity_type text,
  duration_minutes integer check (duration_minutes is null or duration_minutes between 0 and 1440),
  distance_m numeric check (distance_m is null or distance_m >= 0),
  elevation_gain_m numeric check (elevation_gain_m is null or elevation_gain_m >= 0),
  average_heartrate integer check (average_heartrate is null or average_heartrate between 30 and 250),
  max_heartrate integer check (max_heartrate is null or max_heartrate between 30 and 250),
  rpe smallint check (rpe is null or rpe between 1 and 10),
  feeling smallint check (feeling is null or feeling between 1 and 5),
  fatigue_before smallint check (fatigue_before is null or fatigue_before between 1 and 5),
  fatigue_after smallint check (fatigue_after is null or fatigue_after between 1 and 5),
  pain_level text not null default 'none'
    check (pain_level in ('none','mild','moderate','high')),
  pain_area text,
  strength_volume text,
  strength_intensity smallint check (strength_intensity is null or strength_intensity between 1 and 10),
  not_completed_reason text,
  athlete_notes text,
  created_by uuid not null references public.profiles(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (training_plan_id, athlete_id, plan_day)
);

alter table public.training_session_feedback enable row level security;

create policy "session feedback visible to athlete family and staff"
on public.training_session_feedback for select using (
  public.is_admin()
  or exists (
    select 1
    from public.athletes a
    left join public.families f on f.id = a.family_id
    where a.id = training_session_feedback.athlete_id
      and (
        a.user_profile_id = auth.uid()
        or f.primary_profile_id = auth.uid()
        or public.coaches_group(a.training_group_id)
      )
  )
);

create policy "session feedback created by athlete or family"
on public.training_session_feedback for insert with check (
  created_by = auth.uid()
  and exists (
    select 1
    from public.athletes a
    left join public.families f on f.id = a.family_id
    where a.id = training_session_feedback.athlete_id
      and (a.user_profile_id = auth.uid() or f.primary_profile_id = auth.uid())
  )
);

create policy "session feedback updated by athlete family or staff"
on public.training_session_feedback for update using (
  public.is_admin()
  or exists (
    select 1
    from public.athletes a
    left join public.families f on f.id = a.family_id
    where a.id = training_session_feedback.athlete_id
      and (
        a.user_profile_id = auth.uid()
        or f.primary_profile_id = auth.uid()
        or public.coaches_group(a.training_group_id)
      )
  )
) with check (
  public.is_admin()
  or exists (
    select 1 from public.athletes a
    where a.id = training_session_feedback.athlete_id
      and (a.user_profile_id = auth.uid() or public.coaches_group(a.training_group_id))
  )
  or exists (
    select 1 from public.athletes a join public.families f on f.id = a.family_id
    where a.id = training_session_feedback.athlete_id and f.primary_profile_id = auth.uid()
  )
);

grant select, insert, update on public.training_session_feedback to authenticated;
create index if not exists training_session_feedback_athlete_date_idx
  on public.training_session_feedback(athlete_id, session_date desc);
create index if not exists training_session_feedback_plan_idx
  on public.training_session_feedback(training_plan_id, plan_day);
