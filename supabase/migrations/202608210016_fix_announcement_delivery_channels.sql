-- Corrige funciones que seguían usando el nombre antiguo `channels`.
-- La columna real de public.announcements es `delivery_channels`.

create or replace function public.send_message_to_athlete_coach(target_athlete_id uuid, message_body text)
returns integer language plpgsql security definer set search_path = public as $$
declare
  target public.athletes;
  recipient_id uuid;
  notice_id uuid;
  recipient_count integer := 0;
begin
  if auth.uid() is null then raise exception 'Inicia sesión primero.'; end if;
  select * into target from public.athletes where id = target_athlete_id;
  if not found then raise exception 'No se encontró el atleta.'; end if;
  if not (
    target.user_profile_id = auth.uid()
    or exists (select 1 from public.families f where f.id = target.family_id and f.primary_profile_id = auth.uid())
  ) then raise exception 'No puedes enviar mensajes sobre este atleta.'; end if;
  if length(trim(coalesce(message_body, ''))) = 0 then raise exception 'Escribe un mensaje.'; end if;

  insert into public.announcements(title, body, audience, delivery_channels, published_at, created_by)
  values (
    concat('Mensaje de familia · ', target.first_name, ' ', target.last_name),
    trim(message_body), 'individual', array['app']::text[], now(), auth.uid()
  ) returning id into notice_id;

  for recipient_id in
    select distinct tgc.coach_profile_id
    from public.training_group_coaches tgc
    where tgc.training_group_id = target.training_group_id
  loop
    insert into public.coach_messages(athlete_id, from_profile_id, to_profile_id, body)
      values (target.id, auth.uid(), recipient_id, trim(message_body));
    insert into public.announcement_deliveries(announcement_id, recipient_profile_id, channel, delivery_status)
      values (notice_id, recipient_id, 'app', 'sent') on conflict do nothing;
    recipient_count := recipient_count + 1;
  end loop;

  if recipient_count = 0 then
    for recipient_id in select id from public.profiles where role in ('owner', 'admin') loop
      insert into public.coach_messages(athlete_id, from_profile_id, to_profile_id, body)
        values (target.id, auth.uid(), recipient_id, trim(message_body));
      insert into public.announcement_deliveries(announcement_id, recipient_profile_id, channel, delivery_status)
        values (notice_id, recipient_id, 'app', 'sent') on conflict do nothing;
      recipient_count := recipient_count + 1;
    end loop;
  end if;
  return recipient_count;
end;
$$;

revoke all on function public.send_message_to_athlete_coach(uuid, text) from public;
grant execute on function public.send_message_to_athlete_coach(uuid, text) to authenticated;

create or replace function public.notify_admins_new_athlete()
returns trigger language plpgsql security definer set search_path = public as $$
declare notice_id uuid; recipient_id uuid; source_profile_id uuid;
begin
  select coalesce(new.user_profile_id, f.primary_profile_id) into source_profile_id
  from public.families f where f.id = new.family_id;

  if source_profile_id is null then
    select id into source_profile_id
    from public.profiles
    where role in ('owner', 'admin')
    order by created_at
    limit 1;
  end if;
  if source_profile_id is null then return new; end if;

  insert into public.announcements(title, body, audience, delivery_channels, published_at, created_by)
  values (
    'Nueva inscripción',
    concat(new.first_name, ' ', new.last_name, ' ha enviado una inscripción para revisión.'),
    'individual', array['app']::text[], now(), source_profile_id
  ) returning id into notice_id;

  for recipient_id in select id from public.profiles where role in ('owner', 'admin') loop
    insert into public.announcement_deliveries(announcement_id, recipient_profile_id, channel, delivery_status)
      values (notice_id, recipient_id, 'app', 'sent') on conflict do nothing;
  end loop;
  return new;
end;
$$;
