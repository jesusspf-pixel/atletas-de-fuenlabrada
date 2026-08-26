do $$
declare
  target_a uuid;
  target_b uuid;
  legacy record;
begin
  select id into target_a from public.training_groups where name in ('Máster A','Master A') and active=true order by created_at desc limit 1;
  select id into target_b from public.training_groups where name in ('Máster B','Master B') and active=true order by created_at desc limit 1;

  if target_a is not null then
    for legacy in select id from public.training_groups where upper(name)='MASTER A' and id<>target_a loop
      update public.athletes set training_group_id=target_a where training_group_id=legacy.id;
      insert into public.training_group_coaches(training_group_id,coach_profile_id)
      select target_a,coach_profile_id from public.training_group_coaches where training_group_id=legacy.id on conflict do nothing;
      delete from public.training_group_coaches where training_group_id=legacy.id;
      update public.training_groups set active=false,name='Archivo Máster A' where id=legacy.id;
    end loop;
    update public.training_groups set name='Máster Running A',category_label='Absoluto / Máster' where id=target_a;
  end if;

  if target_b is not null then
    for legacy in select id from public.training_groups where upper(name)='MASTER B' and id<>target_b loop
      update public.athletes set training_group_id=target_b where training_group_id=legacy.id;
      insert into public.training_group_coaches(training_group_id,coach_profile_id)
      select target_b,coach_profile_id from public.training_group_coaches where training_group_id=legacy.id on conflict do nothing;
      delete from public.training_group_coaches where training_group_id=legacy.id;
      update public.training_groups set active=false,name='Archivo Máster B' where id=legacy.id;
    end loop;
    update public.training_groups set name='Máster Running B',category_label='Absoluto / Máster' where id=target_b;
  end if;
end $$;
