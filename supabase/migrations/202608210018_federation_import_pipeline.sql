-- Pipeline de resultados FAM/RFEA: staging, emparejado por licencia y revisión segura.

create table if not exists public.federation_result_rows (
  id uuid primary key default gen_random_uuid(),
  source_id uuid not null references public.federation_import_sources(id) on delete cascade,
  external_row_id text,
  athlete_name text not null,
  federation_license text,
  club_name text,
  event_code text,
  event_name text,
  result_text text,
  result_value numeric,
  result_unit text,
  position integer,
  category_label text,
  round_label text,
  wind numeric,
  matched_athlete_id uuid references public.athletes(id) on delete set null,
  match_status text not null default 'pending' check (match_status in ('pending','matched','rejected_club','unknown_athlete','unknown_event','imported','needs_review')),
  raw_data jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  unique(source_id, external_row_id)
);

alter table public.federation_result_rows enable row level security;
drop policy if exists "federation rows admins" on public.federation_result_rows;
create policy "federation rows admins" on public.federation_result_rows for all using (public.is_admin()) with check (public.is_admin());

create index if not exists federation_result_rows_license_idx on public.federation_result_rows(federation_license);
create index if not exists federation_result_rows_status_idx on public.federation_result_rows(match_status);

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
  if not public.is_admin() then raise exception 'Solo administración puede procesar resultados federativos.'; end if;
  select * into settings from public.federation_import_settings where id=true;
  select * into source_row from public.federation_import_sources where id=source_uuid;
  if not found then raise exception 'Fuente no encontrada.'; end if;

  update public.federation_import_sources set status='processing', last_checked_at=now(), error_message=null where id=source_uuid;

  for row_item in select * from public.federation_result_rows where source_id=source_uuid and match_status not in ('imported','rejected_club') loop
    accepted := exists(select 1 from unnest(settings.accepted_club_names) n where upper(trim(n)) = upper(trim(coalesce(row_item.club_name,''))))
      or upper(coalesce(row_item.club_name,'')) like '%URJC%FUENLABRADA%'
      or upper(coalesce(row_item.club_name,'')) like '%ATLETAS%FUENLABRADA%';
    rejected := exists(select 1 from unnest(settings.rejected_club_names) n where upper(trim(n)) = upper(trim(coalesce(row_item.club_name,''))))
      or upper(coalesce(row_item.club_name,'')) = 'CLUB ATLETISMO FUENLABRADA';

    if rejected or not accepted then
      update public.federation_result_rows set match_status='rejected_club' where id=row_item.id;
      continue;
    end if;

    athlete_uuid := null;
    if nullif(trim(coalesce(row_item.federation_license,'')),'') is not null then
      select id into athlete_uuid from public.athletes where upper(trim(federation_license)) = upper(trim(row_item.federation_license)) limit 1;
    end if;
    if athlete_uuid is null then
      select id into athlete_uuid from public.athletes
      where upper(trim(first_name || ' ' || last_name)) = upper(trim(row_item.athlete_name)) limit 1;
    end if;
    if athlete_uuid is null then
      update public.federation_result_rows set match_status='unknown_athlete' where id=row_item.id;
      review_count := review_count + 1;
      continue;
    end if;

    event_uuid := null;
    if row_item.event_code is not null then select id into event_uuid from public.athletics_events where upper(code)=upper(row_item.event_code) limit 1; end if;
    if event_uuid is null and row_item.event_name is not null then select id into event_uuid from public.athletics_events where upper(name)=upper(row_item.event_name) limit 1; end if;
    if event_uuid is null then
      update public.federation_result_rows set matched_athlete_id=athlete_uuid, match_status='unknown_event' where id=row_item.id;
      review_count := review_count + 1;
      continue;
    end if;

    insert into public.athlete_results(
      athlete_id, external_athlete_name, federation_license, athletics_event_id,
      competition_name, competition_date, season, category_label, result_text,
      result_value, result_unit, position, wind, round_label, official, source,
      source_url, source_external_id, source_club_name, verified, imported_at
    ) values (
      athlete_uuid, row_item.athlete_name, row_item.federation_license, event_uuid,
      source_row.competition_name, source_row.competition_date,
      extract(year from source_row.competition_date)::text, row_item.category_label,
      coalesce(row_item.result_text, row_item.result_value::text, 'Resultado'),
      row_item.result_value, row_item.result_unit, row_item.position, row_item.wind,
      row_item.round_label, true, lower(source_row.federation), source_row.results_url,
      coalesce(row_item.external_row_id, row_item.id::text), row_item.club_name, true, now()
    ) on conflict do nothing;

    update public.federation_result_rows set matched_athlete_id=athlete_uuid, match_status='imported' where id=row_item.id;
    imported_count := imported_count + 1;
  end loop;

  update public.federation_import_sources
  set status=case when review_count>0 then 'needs_review' else 'imported' end,
      imported_at=case when review_count=0 then now() else imported_at end,
      last_checked_at=now()
  where id=source_uuid;

  return jsonb_build_object('imported', imported_count, 'needs_review', review_count);
end;
$$;
revoke all on function public.process_federation_import(uuid) from public;
grant execute on function public.process_federation_import(uuid) to authenticated;
