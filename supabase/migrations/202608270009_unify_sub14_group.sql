-- Unifica todas las especialidades Sub 14 en un único grupo operativo.
do $$
declare
  target_id uuid;
  legacy record;
  duplicate_session record;
begin
  select id into target_id
  from public.training_groups
  where lower(name) = 'sub 14'
  order by active desc, created_at asc
  limit 1;

  if target_id is null then
    select id into target_id
    from public.training_groups
    where lower(name) like 'sub 14%'
       or lower(category_label) like 'sub 14%'
    order by active desc, created_at asc
    limit 1;
  end if;

  if target_id is null then
    insert into public.training_groups(
      name, category_label, colour, active, schedule_days, starts_at, ends_at, season
    ) values (
      'Sub 14', 'Sub 14', '#078a88', true, 'Lunes a jueves', '19:00', '20:00', '2026'
    ) returning id into target_id;
  end if;

  update public.training_groups
  set name = 'Sub 14', category_label = 'Sub 14', active = true,
      schedule_days = 'Lunes a jueves', starts_at = '19:00', ends_at = '20:00'
  where id = target_id;

  for legacy in
    select id from public.training_groups
    where id <> target_id
      and (lower(name) like 'sub 14%' or lower(category_label) like 'sub 14%')
  loop
    update public.athletes set training_group_id = target_id where training_group_id = legacy.id;

    insert into public.training_group_coaches(training_group_id, coach_profile_id, is_primary)
      select target_id, coach_profile_id, bool_or(is_primary)
      from public.training_group_coaches where training_group_id = legacy.id
      group by coach_profile_id
      on conflict (training_group_id, coach_profile_id)
      do update set is_primary = public.training_group_coaches.is_primary or excluded.is_primary;
    delete from public.training_group_coaches where training_group_id = legacy.id;

    update public.training_plans p set training_group_id = target_id
      where p.training_group_id = legacy.id
        and not exists (
          select 1 from public.training_plans existing
          where existing.training_group_id = target_id
            and existing.week_starts_on = p.week_starts_on
        );
    update public.announcements set training_group_id = target_id where training_group_id = legacy.id;
    for duplicate_session in
      select old_session.id as old_id, current_session.id as current_id
      from public.attendance_sessions old_session
      join public.attendance_sessions current_session
        on current_session.training_group_id = target_id
       and current_session.starts_at = old_session.starts_at
      where old_session.training_group_id = legacy.id
    loop
      insert into public.attendance_records(
        session_id, athlete_id, intention_to_attend, attended, marked_by, marked_at
      )
      select duplicate_session.current_id, athlete_id, intention_to_attend,
             attended, marked_by, marked_at
      from public.attendance_records
      where session_id = duplicate_session.old_id
      on conflict (session_id, athlete_id) do update set
        intention_to_attend = coalesce(excluded.intention_to_attend, public.attendance_records.intention_to_attend),
        attended = coalesce(excluded.attended, public.attendance_records.attended),
        marked_by = coalesce(excluded.marked_by, public.attendance_records.marked_by),
        marked_at = coalesce(excluded.marked_at, public.attendance_records.marked_at);
      delete from public.attendance_sessions where id = duplicate_session.old_id;
    end loop;
    update public.attendance_sessions set training_group_id = target_id where training_group_id = legacy.id;
    update public.club_documents set training_group_id = target_id where training_group_id = legacy.id;
    update public.coach_athlete_messages set training_group_id = target_id where training_group_id = legacy.id;
    update public.invitation_links set training_group_id = target_id where training_group_id = legacy.id;

    update public.training_groups
      set active = false,
          name = 'Archivo Sub 14 ' || left(id::text, 8),
          category_label = 'Archivo Sub 14'
      where id = legacy.id;
  end loop;
end $$;
