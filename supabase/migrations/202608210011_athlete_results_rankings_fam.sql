-- Resultados deportivos, mejores marcas, rankings internos y base de importación FAM.

alter table public.athletes add column if not exists federation_license text;
create index if not exists athletes_federation_license_idx on public.athletes(federation_license);

create table if not exists public.athletics_events (
  id uuid primary key default gen_random_uuid(),
  code text not null unique,
  name text not null,
  discipline text not null default 'track' check (discipline in ('track','field','road','cross','combined','other')),
  result_kind text not null default 'time' check (result_kind in ('time','distance','height','points','position','other')),
  sort_direction text not null default 'asc' check (sort_direction in ('asc','desc')),
  active boolean not null default true,
  created_at timestamptz not null default now()
);

create table if not exists public.athlete_results (
  id uuid primary key default gen_random_uuid(),
  athlete_id uuid references public.athletes(id) on delete set null,
  external_athlete_name text,
  federation_license text,
  athletics_event_id uuid not null references public.athletics_events(id),
  competition_name text not null,
  competition_date date not null,
  venue text,
  season text,
  category_label text,
  result_text text not null,
  result_value numeric,
  result_unit text,
  position integer,
  wind numeric,
  round_label text,
  official boolean not null default true,
  source text not null default 'manual' check (source in ('manual','fam','rfea','training','other')),
  source_url text,
  source_external_id text,
  source_club_name text,
  verified boolean not null default false,
  imported_at timestamptz,
  created_by uuid references public.profiles(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index if not exists athlete_results_source_unique on public.athlete_results(source, source_external_id) where source_external_id is not null;
create index if not exists athlete_results_athlete_idx on public.athlete_results(athlete_id, competition_date desc);
create index if not exists athlete_results_event_idx on public.athlete_results(athletics_event_id, result_value);
create index if not exists athlete_results_license_idx on public.athlete_results(federation_license);

create table if not exists public.federation_import_sources (
  id uuid primary key default gen_random_uuid(),
  federation text not null check (federation in ('FAM','RFEA')),
  competition_name text not null,
  competition_date date not null,
  calendar_url text,
  results_url text,
  status text not null default 'pending' check (status in ('pending','waiting_results','processing','imported','needs_review','failed')),
  last_checked_at timestamptz,
  imported_at timestamptz,
  error_message text,
  created_at timestamptz not null default now(),
  unique (federation, competition_name, competition_date)
);

create table if not exists public.federation_import_settings (
  id boolean primary key default true check (id),
  fam_enabled boolean not null default true,
  rfea_enabled boolean not null default false,
  club_code text not null default 'M420',
  accepted_club_names text[] not null default array[
    'CLUB DEPORTIVO BASICO ATLETAS DE FUENLABRADA',
    'CLUB DEPORTIVO BÁSICO ATLETAS DE FUENLABRADA',
    'ATLETAS DE FUENLABRADA',
    'ATLETISMO URJC FUENLABRADA',
    'URJC FUENLABRADA'
  ]::text[],
  rejected_club_names text[] not null default array[
    'CLUB ATLETISMO FUENLABRADA',
    'CLUB DE ATLETISMO FUENLABRADA'
  ]::text[],
  history_from date not null default date '2024-09-01',
  updated_at timestamptz not null default now()
);
insert into public.federation_import_settings(id) values (true) on conflict (id) do nothing;

create table if not exists public.coach_athlete_notes (
  id uuid primary key default gen_random_uuid(),
  athlete_id uuid not null references public.athletes(id) on delete cascade,
  coach_profile_id uuid not null references public.profiles(id) on delete cascade,
  body text not null,
  private_to_staff boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.athletics_events enable row level security;
alter table public.athlete_results enable row level security;
alter table public.federation_import_sources enable row level security;
alter table public.federation_import_settings enable row level security;
alter table public.coach_athlete_notes enable row level security;

create policy "athletics events authenticated read" on public.athletics_events for select using (auth.uid() is not null);
create policy "athletics events admins manage" on public.athletics_events for all using (public.is_admin()) with check (public.is_admin());

create policy "results visible to athlete family staff" on public.athlete_results for select using (
  public.is_admin()
  or exists (
    select 1 from public.athletes a left join public.families f on f.id = a.family_id
    where a.id = athlete_results.athlete_id
      and (a.user_profile_id = auth.uid() or f.primary_profile_id = auth.uid() or public.coaches_group(a.training_group_id))
  )
);
create policy "results admins insert" on public.athlete_results for insert with check (public.is_admin());
create policy "results coach training insert" on public.athlete_results for insert with check (
  source = 'training' and created_by = auth.uid() and exists (
    select 1 from public.athletes a where a.id = athlete_id and public.coaches_group(a.training_group_id)
  )
);
create policy "results admins update" on public.athlete_results for update using (public.is_admin()) with check (public.is_admin());

create policy "import sources admins" on public.federation_import_sources for all using (public.is_admin()) with check (public.is_admin());
create policy "import settings admins" on public.federation_import_settings for all using (public.is_admin()) with check (public.is_admin());

create policy "coach notes staff read" on public.coach_athlete_notes for select using (
  public.is_admin() or exists (
    select 1 from public.athletes a where a.id = coach_athlete_notes.athlete_id and public.coaches_group(a.training_group_id)
  )
);
create policy "coach notes own group insert" on public.coach_athlete_notes for insert with check (
  coach_profile_id = auth.uid() and exists (
    select 1 from public.athletes a where a.id = athlete_id and public.coaches_group(a.training_group_id)
  )
);
create policy "coach notes own update" on public.coach_athlete_notes for update using (coach_profile_id = auth.uid() or public.is_admin()) with check (coach_profile_id = auth.uid() or public.is_admin());
create policy "coach notes own delete" on public.coach_athlete_notes for delete using (coach_profile_id = auth.uid() or public.is_admin());

create or replace view public.athlete_personal_bests as
select distinct on (r.athlete_id, r.athletics_event_id)
  r.athlete_id,
  r.athletics_event_id,
  e.code as event_code,
  e.name as event_name,
  r.result_text,
  r.result_value,
  r.result_unit,
  r.competition_name,
  r.competition_date,
  r.venue,
  r.season,
  r.source,
  r.official
from public.athlete_results r
join public.athletics_events e on e.id = r.athletics_event_id
where r.athlete_id is not null and r.result_value is not null
order by r.athlete_id, r.athletics_event_id,
  case when e.sort_direction = 'asc' then r.result_value end asc nulls last,
  case when e.sort_direction = 'desc' then r.result_value end desc nulls last,
  r.competition_date desc;

create or replace view public.club_event_rankings as
select
  r.athletics_event_id,
  e.code as event_code,
  e.name as event_name,
  r.season,
  r.category_label,
  r.athlete_id,
  a.first_name,
  a.last_name,
  r.result_text,
  r.result_value,
  r.result_unit,
  r.competition_name,
  r.competition_date,
  dense_rank() over (
    partition by r.athletics_event_id, r.season, r.category_label
    order by
      case when e.sort_direction = 'asc' then r.result_value end asc nulls last,
      case when e.sort_direction = 'desc' then r.result_value end desc nulls last
  ) as ranking_position
from public.athlete_results r
join public.athletics_events e on e.id = r.athletics_event_id
join public.athletes a on a.id = r.athlete_id
where r.official and r.verified and r.result_value is not null;

grant select on public.athlete_personal_bests to authenticated;
grant select on public.club_event_rankings to authenticated;

insert into public.athletics_events(code,name,discipline,result_kind,sort_direction) values
('60M','60 m','track','time','asc'),
('100M','100 m','track','time','asc'),
('200M','200 m','track','time','asc'),
('300M','300 m','track','time','asc'),
('400M','400 m','track','time','asc'),
('500M','500 m','track','time','asc'),
('600M','600 m','track','time','asc'),
('800M','800 m','track','time','asc'),
('1000M','1000 m','track','time','asc'),
('1500M','1500 m','track','time','asc'),
('LONG','Longitud','field','distance','desc'),
('HIGH','Altura','field','height','desc'),
('SHOT','Peso','field','distance','desc'),
('CROSS','Cross','cross','position','asc')
on conflict (code) do nothing;
