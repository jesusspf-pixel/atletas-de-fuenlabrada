-- Piloto Running A: criterio persistente y propuestas semanales privadas.
-- Ninguna propuesta se publica automáticamente: el entrenador debe revisarla
-- y publicar después el plan definitivo desde el planificador habitual.

create table if not exists public.training_ai_planner_settings (
  training_group_id uuid primary key references public.training_groups(id) on delete cascade,
  planner_profile_id uuid not null references public.profiles(id) on delete cascade,
  enabled boolean not null default false,
  starting_point text not null default '',
  objective text not null default '',
  target_date date,
  constraints text not null default '',
  methodology text not null default '',
  updated_at timestamptz not null default now(),
  updated_by uuid references public.profiles(id)
);

create table if not exists public.training_ai_weekly_proposals (
  id uuid primary key default gen_random_uuid(),
  training_group_id uuid not null references public.training_groups(id) on delete cascade,
  week_starts_on date not null,
  title text not null,
  sessions jsonb not null default '{}'::jsonb,
  rationale text not null default '',
  aggregate_snapshot jsonb not null default '{}'::jsonb,
  status text not null default 'draft' check (status in ('draft','accepted','rejected')),
  source text not null default 'automatic_sunday' check (source in ('automatic_sunday','manual')),
  created_for uuid not null references public.profiles(id) on delete cascade,
  reviewed_by uuid references public.profiles(id),
  reviewed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (training_group_id, week_starts_on)
);

create table if not exists public.training_plan_athlete_adjustments (
  id uuid primary key default gen_random_uuid(),
  training_plan_id uuid not null references public.training_plans(id) on delete cascade,
  athlete_id uuid not null references public.athletes(id) on delete cascade,
  load_modifier_percent integer not null default 0 check (load_modifier_percent between -50 and 50),
  note text not null default '',
  created_by uuid not null references public.profiles(id),
  updated_at timestamptz not null default now(),
  unique (training_plan_id, athlete_id)
);

create index if not exists training_ai_weekly_proposals_review_idx
  on public.training_ai_weekly_proposals(created_for, status, week_starts_on desc);

alter table public.training_ai_planner_settings enable row level security;
alter table public.training_ai_weekly_proposals enable row level security;
alter table public.training_plan_athlete_adjustments enable row level security;

drop policy if exists "planner settings private read" on public.training_ai_planner_settings;
create policy "planner settings private read"
on public.training_ai_planner_settings for select
using (public.is_admin() or planner_profile_id = auth.uid());

drop policy if exists "planner settings private manage" on public.training_ai_planner_settings;
create policy "planner settings private manage"
on public.training_ai_planner_settings for all
using (public.is_admin() or planner_profile_id = auth.uid())
with check (
  public.is_admin()
  or (planner_profile_id = auth.uid() and public.can_plan_group(training_group_id))
);

drop policy if exists "weekly proposals private read" on public.training_ai_weekly_proposals;
create policy "weekly proposals private read"
on public.training_ai_weekly_proposals for select
using (public.is_admin() or created_for = auth.uid());

drop policy if exists "weekly proposals private review" on public.training_ai_weekly_proposals;
create policy "weekly proposals private review"
on public.training_ai_weekly_proposals for update
using (public.is_admin() or created_for = auth.uid())
with check (
  public.is_admin()
  or (created_for = auth.uid() and public.can_plan_group(training_group_id))
);

drop policy if exists "athlete adjustments visible to athlete and staff" on public.training_plan_athlete_adjustments;
create policy "athlete adjustments visible to athlete and staff"
on public.training_plan_athlete_adjustments for select
using (
  public.is_admin()
  or exists (
    select 1 from public.athletes athlete
    left join public.families family on family.id = athlete.family_id
    where athlete.id = training_plan_athlete_adjustments.athlete_id
      and (
        athlete.user_profile_id = auth.uid()
        or family.primary_profile_id = auth.uid()
        or public.coaches_group(athlete.training_group_id)
      )
  )
);

drop policy if exists "athlete adjustments managed by planner" on public.training_plan_athlete_adjustments;
create policy "athlete adjustments managed by planner"
on public.training_plan_athlete_adjustments for all
using (
  public.is_admin()
  or exists (
    select 1
    from public.training_plans plan
    where plan.id = training_plan_id
      and public.can_plan_group(plan.training_group_id)
  )
)
with check (
  public.is_admin()
  or exists (
    select 1
    from public.training_plans plan
    join public.athletes athlete on athlete.id = training_plan_athlete_adjustments.athlete_id
    where plan.id = training_plan_id
      and athlete.training_group_id = plan.training_group_id
      and public.can_plan_group(plan.training_group_id)
  )
);

-- Configuración inicial del piloto ya acordada para Running A.
insert into public.training_ai_planner_settings(
  training_group_id,
  planner_profile_id,
  enabled,
  starting_point,
  objective,
  target_date,
  constraints,
  methodology,
  updated_by
)
select
  training_group.id,
  planner.id,
  true,
  'Grupo adulto que vuelve al entrenamiento después del verano. La entrada debe ser progresiva, con base aeróbica, fortalecimiento general, pies, tendones y rodillas, evitando al principio el trabajo de calidad exigente.',
  'Llegar en buena forma a las carreras de San Silvestre del 31 de diciembre, construyendo antes una base aeróbica sólida, fuerza general y continuidad sin picos bruscos de carga.',
  '2026-12-31'::date,
  'Se puede entrenar de lunes a jueves y añadir una sesión el sábado, dejando preferentemente el domingo de descanso. Hay pista, exterior, fosos, gradas, arrastres, vallas, conos y balones medicinales.',
  'Planificación de grupo conservadora y progresiva. Adaptar la siguiente semana a la respuesta real de quienes aporten actividades de carrera o sensaciones. La propuesta siempre requiere revisión del entrenador.',
  planner.id
from public.training_groups training_group
cross join public.profiles planner
where lower(regexp_replace(training_group.name, '\s+', ' ', 'g')) = 'running a'
  and lower(regexp_replace(planner.email, '\s+', '', 'g')) = 'eatletismourjc@gmail.com'
on conflict (training_group_id) do update set
  planner_profile_id = excluded.planner_profile_id,
  enabled = true,
  updated_at = now(),
  updated_by = excluded.updated_by;

comment on table public.training_ai_weekly_proposals is
  'Borradores privados generados para revisión. Nunca son planes publicados.';
