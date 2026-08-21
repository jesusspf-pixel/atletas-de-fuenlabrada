-- Integraciones deportivas externas (Strava primero; preparada para Garmin/Coros/Polar).

create table if not exists public.athlete_external_integrations (
  id uuid primary key default gen_random_uuid(),
  athlete_id uuid not null references public.athletes(id) on delete cascade,
  provider text not null check (provider in ('strava','garmin','coros','polar','other')),
  provider_athlete_id text,
  scopes text[] not null default '{}',
  status text not null default 'connected' check (status in ('connected','revoked','error','disconnected')),
  connected_by uuid not null references public.profiles(id),
  connected_at timestamptz not null default now(),
  last_synced_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (athlete_id, provider)
);

create table if not exists public.athlete_integration_tokens (
  integration_id uuid primary key references public.athlete_external_integrations(id) on delete cascade,
  access_token text not null,
  refresh_token text not null,
  expires_at bigint not null,
  updated_at timestamptz not null default now()
);

create table if not exists public.external_sport_activities (
  id uuid primary key default gen_random_uuid(),
  integration_id uuid not null references public.athlete_external_integrations(id) on delete cascade,
  athlete_id uuid not null references public.athletes(id) on delete cascade,
  provider text not null check (provider in ('strava','garmin','coros','polar','other')),
  provider_activity_id text not null,
  activity_type text,
  name text,
  started_at timestamptz not null,
  distance_m numeric,
  moving_time_s integer,
  elapsed_time_s integer,
  elevation_gain_m numeric,
  average_speed_mps numeric,
  average_heartrate numeric,
  max_heartrate numeric,
  calories numeric,
  source_url text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (provider, provider_activity_id)
);

create table if not exists public.external_oauth_states (
  state text primary key,
  provider text not null check (provider in ('strava','garmin','coros','polar','other')),
  athlete_id uuid not null references public.athletes(id) on delete cascade,
  profile_id uuid not null references public.profiles(id) on delete cascade,
  expires_at timestamptz not null,
  created_at timestamptz not null default now()
);

alter table public.athlete_external_integrations enable row level security;
alter table public.athlete_integration_tokens enable row level security;
alter table public.external_sport_activities enable row level security;
alter table public.external_oauth_states enable row level security;

create policy "external integrations visible to athlete family staff" on public.athlete_external_integrations for select using (
  public.is_admin() or exists (
    select 1 from public.athletes a left join public.families f on f.id = a.family_id
    where a.id = athlete_external_integrations.athlete_id
      and (a.user_profile_id = auth.uid() or f.primary_profile_id = auth.uid() or public.coaches_group(a.training_group_id))
  )
);

create policy "external activities visible to athlete family staff" on public.external_sport_activities for select using (
  public.is_admin() or exists (
    select 1 from public.athletes a left join public.families f on f.id = a.family_id
    where a.id = external_sport_activities.athlete_id
      and (a.user_profile_id = auth.uid() or f.primary_profile_id = auth.uid() or public.coaches_group(a.training_group_id))
  )
);

-- Tokens y estados OAuth no tienen políticas para usuarios autenticados.
-- Solo los procesos de servidor con service role pueden accederlos.
revoke all on public.athlete_integration_tokens from authenticated;
revoke all on public.external_oauth_states from authenticated;

grant select on public.athlete_external_integrations to authenticated;
grant select on public.external_sport_activities to authenticated;

create index if not exists external_sport_activities_athlete_idx on public.external_sport_activities(athlete_id, started_at desc);
create index if not exists athlete_external_integrations_provider_idx on public.athlete_external_integrations(provider, provider_athlete_id);
