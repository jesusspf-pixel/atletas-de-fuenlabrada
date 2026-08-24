-- Base editable para el ranking histórico oficial.
-- Los datos automáticos de FAM/RFEA entrarán aquí después de una revisión administrativa.

create table if not exists public.historical_athletes (
  id uuid primary key default gen_random_uuid(),
  canonical_name text not null,
  linked_athlete_id uuid references public.athletes(id) on delete set null,
  birth_year integer,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists historical_athletes_canonical_name_key
  on public.historical_athletes (lower(canonical_name));

create table if not exists public.official_performances (
  id uuid primary key default gen_random_uuid(),
  historical_athlete_id uuid not null references public.historical_athletes(id) on delete cascade,
  discipline text not null,
  category text,
  season text,
  metric_type text not null default 'time'
    check (metric_type in ('time','distance','weight')),
  performance_value numeric,
  performance_display text not null,
  result_date date,
  competition_name text,
  source text not null default 'manual'
    check (source in ('FAM','RFEA','manual')),
  source_url text,
  source_club_name text,
  source_identity text unique,
  review_status text not null default 'pending'
    check (review_status in ('pending','reviewed','hidden')),
  notes text,
  created_by uuid references public.profiles(id) on delete set null,
  updated_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists official_performances_ranking_idx
  on public.official_performances (review_status, season, category, discipline, performance_value);

create table if not exists public.official_import_blocks (
  id uuid primary key default gen_random_uuid(),
  blocked_name text not null,
  source text check (source in ('FAM','RFEA','manual')),
  reason text,
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now()
);

create unique index if not exists official_import_blocks_name_source_key
  on public.official_import_blocks (lower(blocked_name), coalesce(source, ''));

alter table public.historical_athletes enable row level security;
alter table public.official_performances enable row level security;
alter table public.official_import_blocks enable row level security;

drop policy if exists "Administracion gestiona atletas historicos" on public.historical_athletes;
create policy "Administracion gestiona atletas historicos"
on public.historical_athletes
for all to authenticated
using (public.is_admin())
with check (public.is_admin());

drop policy if exists "Administracion gestiona ranking oficial" on public.official_performances;
create policy "Administracion gestiona ranking oficial"
on public.official_performances
for all to authenticated
using (public.is_admin())
with check (public.is_admin());

drop policy if exists "Publico consulta ranking revisado" on public.official_performances;
create policy "Publico consulta ranking revisado"
on public.official_performances
for select to anon, authenticated
using (review_status = 'reviewed');

drop policy if exists "Administracion gestiona bloqueos de importacion" on public.official_import_blocks;
create policy "Administracion gestiona bloqueos de importacion"
on public.official_import_blocks
for all to authenticated
using (public.is_admin())
with check (public.is_admin());

-- Mantiene la auditoría básica tanto al crear como al editar desde el panel.
create or replace function public.touch_historical_ranking_rows()
returns trigger
language plpgsql
security invoker
set search_path = public
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists touch_historical_athletes on public.historical_athletes;
create trigger touch_historical_athletes
before update on public.historical_athletes
for each row execute function public.touch_historical_ranking_rows();

drop trigger if exists touch_official_performances on public.official_performances;
create trigger touch_official_performances
before update on public.official_performances
for each row execute function public.touch_historical_ranking_rows();
