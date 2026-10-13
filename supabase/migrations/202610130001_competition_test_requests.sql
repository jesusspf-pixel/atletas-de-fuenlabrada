-- Solicitudes de inscripción por prueba, filtradas por edad, categoría FAM y sexo.

create table if not exists public.competition_event_tests (
  id uuid primary key default gen_random_uuid(),
  competition_event_id uuid not null references public.competition_events(id) on delete cascade,
  name text not null,
  eligible_categories text[] not null default '{}',
  eligible_sex text not null default 'all' check (eligible_sex in ('all','female','male')),
  min_birth_year integer,
  max_birth_year integer,
  notes text,
  sort_order integer not null default 0,
  active boolean not null default true,
  created_by uuid not null references public.profiles(id),
  created_at timestamptz not null default now(),
  unique (competition_event_id, name, eligible_sex)
);

create index if not exists competition_event_tests_event_idx
  on public.competition_event_tests(competition_event_id, active, sort_order);

alter table public.competition_event_tests enable row level security;

drop policy if exists "competition tests authenticated read" on public.competition_event_tests;
create policy "competition tests authenticated read"
on public.competition_event_tests for select using (
  auth.uid() is not null and exists (
    select 1 from public.competition_events e
    where e.id = competition_event_id
      and (e.published or public.is_admin() or e.created_by = auth.uid())
  )
);

drop policy if exists "competition tests publisher manage" on public.competition_event_tests;
create policy "competition tests publisher manage"
on public.competition_event_tests for all using (
  public.is_admin() or exists (
    select 1 from public.competition_events e
    where e.id = competition_event_id and e.created_by = auth.uid()
  )
) with check (
  public.is_admin() or exists (
    select 1 from public.competition_events e
    where e.id = competition_event_id and e.created_by = auth.uid()
  )
);

drop policy if exists "competition entry review admin or group coach" on public.competition_entries;
create policy "competition entry review admin publisher or group coach"
on public.competition_entries for update using (
  public.is_admin()
  or exists (
    select 1 from public.competition_events e
    where e.id = competition_event_id and e.created_by = auth.uid()
  )
  or exists (
    select 1 from public.athletes a
    where a.id = athlete_id and public.coaches_group(a.training_group_id)
  )
) with check (
  public.is_admin()
  or exists (
    select 1 from public.competition_events e
    where e.id = competition_event_id and e.created_by = auth.uid()
  )
  or exists (
    select 1 from public.athletes a
    where a.id = athlete_id and public.coaches_group(a.training_group_id)
  )
);

create or replace function public.request_competition_entry(
  target_event_id uuid,
  target_athlete_id uuid,
  target_test_ids uuid[]
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  target_family_id uuid;
  target_name text;
  target_birth_date date;
  target_category text;
  target_sex text;
  event_name text;
  event_year integer;
  event_publisher uuid;
  test_id uuid;
  requested_test_names text;
  announcement_id uuid;
  recipient_id uuid;
  channel_name text;
begin
  select e.title, extract(year from e.starts_at)::integer, e.created_by
    into event_name, event_year, event_publisher
  from public.competition_events e
  where e.id = target_event_id
    and e.published
    and (e.internal_deadline is null or e.internal_deadline > now());
  if not found then
    raise exception 'La competición no está disponible o el plazo interno ha terminado.';
  end if;

  select a.family_id, a.first_name || ' ' || a.last_name, a.birth_date,
         coalesce(a.official_competition_category, public.category_for_year(a.birth_date, event_year)),
         lower(coalesce(a.federative_sex, ''))
    into target_family_id, target_name, target_birth_date, target_category, target_sex
  from public.athletes a
  where a.id = target_athlete_id;
  if not found then raise exception 'No se ha encontrado el atleta.'; end if;

  if not exists (
    select 1 from public.families f
    where f.id = target_family_id and f.primary_profile_id = auth.uid()
  ) and not exists (
    select 1 from public.athletes a
    where a.id = target_athlete_id and a.user_profile_id = auth.uid()
  ) then
    raise exception 'Solo puede solicitar pruebas para sus propios atletas.';
  end if;

  if target_test_ids is null or cardinality(target_test_ids) = 0 then
    raise exception 'Seleccione al menos una prueba.';
  end if;

  foreach test_id in array target_test_ids loop
    if not exists (
      select 1
      from public.competition_event_tests t
      where t.id = test_id
        and t.competition_event_id = target_event_id
        and t.active
        and (t.min_birth_year is null or extract(year from target_birth_date)::integer >= t.min_birth_year)
        and (t.max_birth_year is null or extract(year from target_birth_date)::integer <= t.max_birth_year)
        and (
          cardinality(t.eligible_categories) = 0
          or exists (
            select 1 from unnest(t.eligible_categories) c
            where lower(regexp_replace(c, '[^a-zA-Z0-9]', '', 'g')) =
                  lower(regexp_replace(target_category, '[^a-zA-Z0-9]', '', 'g'))
          )
        )
        and (
          t.eligible_sex = 'all'
          or (t.eligible_sex = 'female' and target_sex in ('f','female','femenino','mujer'))
          or (t.eligible_sex = 'male' and target_sex in ('m','male','masculino','hombre'))
        )
    ) then
      raise exception 'Una de las pruebas seleccionadas no corresponde a la edad, categoría o sexo federativo del atleta.';
    end if;
  end loop;

  select string_agg(t.name, ', ' order by t.sort_order, t.name)
    into requested_test_names
  from public.competition_event_tests t
  where t.id = any(target_test_ids);

  insert into public.competition_entries(
    competition_event_id, athlete_id, requested_events, requested_by, status,
    reviewed_by, reviewed_at, notes
  ) values (
    target_event_id, target_athlete_id, to_jsonb(target_test_ids), auth.uid(), 'requested',
    null, null, null
  )
  on conflict (competition_event_id, athlete_id) do update set
    requested_events = excluded.requested_events,
    requested_by = excluded.requested_by,
    status = 'requested',
    reviewed_by = null,
    reviewed_at = null,
    notes = null;

  insert into public.announcements(
    title, body, audience, delivery_channels, published_at, created_by
  ) values (
    'Solicitud de competición',
    target_name || ' solicita inscribirse en «' || event_name || '»: ' || requested_test_names || '.',
    'individual', array['app','email']::text[], now(), auth.uid()
  ) returning id into announcement_id;

  for recipient_id in
    select distinct p.id from public.profiles p where p.role in ('owner','admin')
    union
    select event_publisher where event_publisher is not null
  loop
    foreach channel_name in array array['app','email']::text[] loop
      insert into public.announcement_deliveries(
        announcement_id, recipient_profile_id, channel, delivery_status
      ) values (
        announcement_id, recipient_id, channel_name,
        case when channel_name = 'email' then 'pending' else 'sent' end
      ) on conflict do nothing;
    end loop;
  end loop;
end;
$$;

revoke all on function public.request_competition_entry(uuid, uuid, uuid[]) from public;
grant execute on function public.request_competition_entry(uuid, uuid, uuid[]) to authenticated;
