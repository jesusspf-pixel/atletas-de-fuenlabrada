-- Hace que los resultados federativos históricos puedan mostrarse aunque el atleta
-- ya no tenga cuenta activa en la plataforma, y mantiene una sola mejor marca por atleta.

alter table public.federation_result_rows
  add column if not exists competition_date date,
  add column if not exists venue text,
  add column if not exists birth_date date;

insert into public.athletics_events(code,name,discipline,result_kind,sort_direction) values
  ('50M','50 m','track','time','asc'),
  ('80M','80 m','track','time','asc'),
  ('3000M','3000 m','track','time','asc'),
  ('300MH','300 m vallas','track','time','asc'),
  ('JAVELIN','Jabalina','field','distance','desc')
on conflict (code) do nothing;

create or replace function public.process_federation_import(source_uuid uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  settings public.federation_import_settings;
  source_row public.federation_import_sources;
  row_item public.federation_result_rows;
  athlete_uuid uuid;
  event_uuid uuid;
  accepted boolean;
  rejected boolean;
  imported_count integer := 0;
  review_count integer := 0;
begin
  if not (public.is_admin() or auth.role() = 'service_role') then
    raise exception 'No autorizado para procesar resultados federativos.';
  end if;
  select * into settings from public.federation_import_settings where id=true;
  select * into source_row from public.federation_import_sources where id=source_uuid;
  if not found then raise exception 'Fuente no encontrada.'; end if;

  update public.federation_import_sources
  set status='processing', last_checked_at=now(), error_message=null where id=source_uuid;

  for row_item in
    select * from public.federation_result_rows
    where source_id=source_uuid and match_status not in ('imported','rejected_club')
  loop
    accepted := exists(select 1 from unnest(settings.accepted_club_names) n
      where upper(trim(n)) = upper(trim(coalesce(row_item.club_name,''))))
      or upper(coalesce(row_item.club_name,'')) like '%URJC%FUENLABRADA%'
      or upper(coalesce(row_item.club_name,'')) like '%ATLETAS%FUENLABRADA%';
    rejected := exists(select 1 from unnest(settings.rejected_club_names) n
      where upper(trim(n)) = upper(trim(coalesce(row_item.club_name,''))))
      or upper(coalesce(row_item.club_name,'')) in ('CLUB ATLETISMO FUENLABRADA','CLUB DE ATLETISMO FUENLABRADA');
    if rejected or not accepted then
      update public.federation_result_rows set match_status='rejected_club' where id=row_item.id;
      continue;
    end if;

    athlete_uuid := null;
    if nullif(trim(coalesce(row_item.federation_license,'')),'') is not null then
      select id into athlete_uuid from public.athletes
      where upper(trim(federation_license))=upper(trim(row_item.federation_license)) limit 1;
    end if;
    if athlete_uuid is null then
      select id into athlete_uuid from public.athletes
      where upper(trim(first_name || ' ' || last_name))=upper(trim(row_item.athlete_name)) limit 1;
    end if;

    event_uuid := null;
    if row_item.event_code is not null then
      select id into event_uuid from public.athletics_events where upper(code)=upper(row_item.event_code) limit 1;
    end if;
    if event_uuid is null and row_item.event_name is not null then
      select id into event_uuid from public.athletics_events where upper(name)=upper(row_item.event_name) limit 1;
    end if;
    if event_uuid is null then
      update public.federation_result_rows
      set matched_athlete_id=athlete_uuid, match_status='unknown_event' where id=row_item.id;
      review_count := review_count + 1;
      continue;
    end if;

    insert into public.athlete_results(
      athlete_id,external_athlete_name,federation_license,athletics_event_id,
      competition_name,competition_date,venue,season,category_label,result_text,
      result_value,result_unit,position,wind,round_label,official,source,source_url,
      source_external_id,source_club_name,verified,imported_at
    ) values (
      athlete_uuid,row_item.athlete_name,row_item.federation_license,event_uuid,
      source_row.competition_name,coalesce(row_item.competition_date,source_row.competition_date),
      row_item.venue,extract(year from coalesce(row_item.competition_date,source_row.competition_date))::text,
      row_item.category_label,coalesce(row_item.result_text,row_item.result_value::text,'Resultado'),
      row_item.result_value,row_item.result_unit,row_item.position,row_item.wind,row_item.round_label,
      true,lower(source_row.federation),source_row.results_url,
      coalesce(row_item.external_row_id,row_item.id::text),row_item.club_name,true,now()
    ) on conflict do nothing;
    update public.federation_result_rows
    set matched_athlete_id=athlete_uuid,match_status='imported' where id=row_item.id;
    imported_count := imported_count + 1;
  end loop;
  update public.federation_import_sources
  set status=case when review_count>0 then 'needs_review' else 'imported' end,
      imported_at=now(),last_checked_at=now()
  where id=source_uuid;
  return jsonb_build_object('imported', imported_count,'needs_review',review_count);
end;
$$;
revoke all on function public.process_federation_import(uuid) from public;
grant execute on function public.process_federation_import(uuid) to authenticated, service_role;

-- The projection adds athlete_name before result_text, so PostgreSQL cannot
-- replace the previous view in place. Recreate it explicitly for clean
-- environment bootstraps such as the isolated Strava review project.
drop view if exists public.club_event_rankings;
create view public.club_event_rankings as
with eligible as (
  select r.*,e.code as event_code,e.name as event_name,e.sort_direction,
    coalesce(r.athlete_id::text,upper(trim(r.external_athlete_name))) as athlete_key
  from public.athlete_results r join public.athletics_events e on e.id=r.athletics_event_id
  where r.official and r.verified and r.result_value is not null
), best as (
  select distinct on (athletics_event_id,season,category_label,athlete_key) *
  from eligible
  order by athletics_event_id,season,category_label,athlete_key,
    case when sort_direction='asc' then result_value end asc nulls last,
    case when sort_direction='desc' then result_value end desc nulls last,
    competition_date desc
)
select b.athletics_event_id,b.event_code,b.event_name,b.season,b.category_label,b.athlete_id,
  coalesce(a.first_name,split_part(b.external_athlete_name,' ',1)) as first_name,
  coalesce(a.last_name,nullif(trim(regexp_replace(b.external_athlete_name,'^\\S+\\s*','')),'')) as last_name,
  coalesce(nullif(trim(concat_ws(' ',a.first_name,a.last_name)),''),b.external_athlete_name) as athlete_name,
  b.result_text,b.result_value,b.result_unit,b.competition_name,b.competition_date,
  dense_rank() over(partition by b.athletics_event_id,b.season,b.category_label order by
    case when b.sort_direction='asc' then b.result_value end asc nulls last,
    case when b.sort_direction='desc' then b.result_value end desc nulls last) as ranking_position
from best b left join public.athletes a on a.id=b.athlete_id;

grant select on public.club_event_rankings to authenticated;
