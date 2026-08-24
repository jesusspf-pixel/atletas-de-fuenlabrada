-- Diferencia pista cubierta y aire libre en resultados oficiales y evita duplicados
-- La detección se basa en el nombre de competición/lugar: Pista cubierta o PC, Aire libre o AL.

alter table public.athlete_results
  add column if not exists competition_environment text not null default 'unknown'
  check (competition_environment in ('indoor', 'outdoor', 'unknown'));

create or replace function public.detect_competition_environment(
  competition_title text,
  competition_venue text default null
)
returns text
language sql
immutable
set search_path = public
as $$
  select case
    when upper(coalesce(competition_title, '') || ' ' || coalesce(competition_venue, '')) ~
      '(PISTA[[:space:]]+CUBIERTA|\mP[[:space:].-]*C\M|\mPC\M|CUBIERTA)' then 'indoor'
    when upper(coalesce(competition_title, '') || ' ' || coalesce(competition_venue, '')) ~
      '(AIRE[[:space:]]+LIBRE|\mA[[:space:].-]*L\M|\mAL\M)' then 'outdoor'
    else 'unknown'
  end;
$$;

create or replace function public.set_result_competition_environment()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  -- Siempre se deriva del texto recibido; así una corrección del nombre también corrige el tipo.
  new.competition_environment := public.detect_competition_environment(new.competition_name, new.venue);
  return new;
end;
$$;

drop trigger if exists athlete_results_set_environment on public.athlete_results;
create trigger athlete_results_set_environment
before insert or update of competition_name, venue on public.athlete_results
for each row execute function public.set_result_competition_environment();

update public.athlete_results
set competition_environment = public.detect_competition_environment(competition_name, venue);

-- Limpia los duplicados ya importados: mismo atleta, prueba, día y marca.
-- Conserva la fila más completa/verificada y elimina las variantes de nombre del mismo resultado.
with ranked as (
  select
    id,
    row_number() over (
      partition by
        athlete_id,
        athletics_event_id,
        competition_date,
        case
          when result_value is not null then 'value:' || result_value::text
          else 'text:' || lower(btrim(result_text))
        end
      order by
        verified desc,
        imported_at desc nulls last,
        created_at desc,
        id desc
    ) as duplicate_position
  from public.athlete_results
  where official = true
    and athlete_id is not null
)
delete from public.athlete_results result
using ranked
where result.id = ranked.id
  and ranked.duplicate_position > 1;

create unique index if not exists athlete_results_official_same_day_value_unique
  on public.athlete_results(athlete_id, athletics_event_id, competition_date, result_value)
  where official = true and athlete_id is not null and result_value is not null;

create unique index if not exists athlete_results_official_same_day_text_unique
  on public.athlete_results(athlete_id, athletics_event_id, competition_date, (lower(btrim(result_text))))
  where official = true and athlete_id is not null and result_value is null;

drop view if exists public.athlete_personal_bests;
create view public.athlete_personal_bests
with (security_invoker = true)
as
select distinct on (r.athlete_id, r.athletics_event_id, r.competition_environment)
  r.athlete_id,
  r.athletics_event_id,
  e.code as event_code,
  e.name as event_name,
  r.competition_environment,
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
order by
  r.athlete_id,
  r.athletics_event_id,
  r.competition_environment,
  case when e.sort_direction = 'asc' then r.result_value end asc nulls last,
  case when e.sort_direction = 'desc' then r.result_value end desc nulls last,
  r.competition_date desc;

drop view if exists public.club_event_rankings;
create view public.club_event_rankings
with (security_invoker = true)
as
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
  r.result_text,
  r.result_value,
  r.result_unit,
  r.competition_name,
  r.competition_date,
  dense_rank() over (
    partition by r.athletics_event_id, r.season, r.category_label, r.competition_environment
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
