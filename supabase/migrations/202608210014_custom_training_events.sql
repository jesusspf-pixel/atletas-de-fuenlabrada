-- Pruebas de entrenamiento ampliadas y creación segura de pruebas personalizadas.

insert into public.athletics_events(code,name,discipline,result_kind,sort_direction) values
('30M','30 m','track','time','asc'),
('40M','40 m','track','time','asc'),
('50M','50 m','track','time','asc'),
('80M','80 m','track','time','asc'),
('150M','150 m','track','time','asc'),
('2000M','2000 m','track','time','asc'),
('MULTI5','Pentasalto · 5 apoyos','field','distance','desc'),
('MULTI10','Multisalto · 10 apoyos','field','distance','desc')
on conflict (code) do nothing;

create or replace function public.ensure_training_event(custom_name text, custom_result_kind text default 'time')
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  cleaned_name text := trim(custom_name);
  kind text := lower(trim(coalesce(custom_result_kind, 'time')));
  event_code text;
  event_id uuid;
  direction text;
begin
  if auth.uid() is null then raise exception 'Inicia sesión.'; end if;
  if not exists (select 1 from public.profiles where id = auth.uid() and role in ('owner','admin','coach')) then
    raise exception 'Solo administración o entrenadores pueden crear pruebas de entrenamiento.';
  end if;
  if length(cleaned_name) < 2 then raise exception 'Indica el nombre de la prueba.'; end if;
  if kind not in ('time','distance','points','position','other') then kind := 'other'; end if;
  direction := case when kind in ('distance','points') then 'desc' else 'asc' end;
  event_code := 'CUSTOM_' || upper(substr(md5(lower(cleaned_name) || ':' || kind), 1, 16));

  insert into public.athletics_events(code,name,discipline,result_kind,sort_direction,active)
  values (event_code, cleaned_name, 'other', kind, direction, true)
  on conflict (code) do update set name = excluded.name, active = true
  returning id into event_id;

  return event_id;
end;
$$;

revoke all on function public.ensure_training_event(text,text) from public;
grant execute on function public.ensure_training_event(text,text) to authenticated;
