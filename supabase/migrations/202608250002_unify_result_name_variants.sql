-- Unifica en los rankings las variantes del mismo nombre:
-- Ejemplo: "Leyre Romero" y "Leyre Romero Arranz".
-- La clave usa nombre + primer apellido, solo cuando coinciden prueba, día, marca, categoría y superficie.

create or replace function public.result_ranking_identity(full_name text)
returns text
language sql
immutable
set search_path = public
as $$
  select nullif(
    substring(
      btrim(
        regexp_replace(
          upper(coalesce(full_name, '')),
          '[^A-ZÁÉÍÓÚÜÑ]+',
          ' ',
          'g'
        )
      )
      from '^[^ ]+( [^ ]+)?'
    ),
    ''
  );
$$;

drop view if exists public.club_event_rankings;

create view public.club_event_rankings
with (security_invoker = true)
as
with source_rows as (
  select
    r.athletics_event_id,
    e.code as event_code,
    e.name as event_name,
    r.season,
    r.category_label,
    r.competition_environment,
    r.athlete_id,
    a.first_name,
    a.last_name,
    coalesce(nullif(btrim(r.external_athlete_name), ''), btrim(a.first_name || ' ' || a.last_name)) as athlete_name,
    r.result_text,
    r.result_value,
    r.result_unit,
    r.competition_name,
    r.competition_date,
    public.result_ranking_identity(
      coalesce(nullif(btrim(r.external_athlete_name), ''), btrim(a.first_name || ' ' || a.last_name))
    ) as identity_key
  from public.athlete_results r
  join public.athletics_events e on e.id = r.athletics_event_id
  join public.athletes a on a.id = r.athlete_id
  where r.official
    and r.verified
    and r.result_value is not null
),
deduplicated as (
  select distinct on (
    athletics_event_id,
    season,
    category_label,
    competition_environment,
    competition_date,
    result_value,
    identity_key
  ) *
  from source_rows
  order by
    athletics_event_id,
    season,
    category_label,
    competition_environment,
    competition_date,
    result_value,
    identity_key,
    length(athlete_name) desc
)
select
  athletics_event_id,
  event_code,
  event_name,
  season,
  category_label,
  competition_environment,
  athlete_id,
  first_name,
  last_name,
  athlete_name,
  result_text,
  result_value,
  result_unit,
  competition_name,
  competition_date,
  dense_rank() over (
    partition by athletics_event_id, season, category_label, competition_environment
    order by result_value
  ) as ranking_position
from deduplicated;

grant select on public.club_event_rankings to authenticated;
