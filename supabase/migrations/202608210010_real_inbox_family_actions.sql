-- Bandeja real por usuario: leer no borra el aviso, quitarlo solo lo oculta
-- para esa persona. También añade mensajes de familias a entrenadores.

create table if not exists public.announcement_reads (
  announcement_id uuid not null references public.announcements(id) on delete cascade,
  profile_id uuid not null references public.profiles(id) on delete cascade,
  read_at timestamptz not null default now(),
  primary key (announcement_id, profile_id)
);
alter table public.announcement_reads enable row level security;
drop policy if exists "announcement reads own read" on public.announcement_reads;
drop policy if exists "announcement reads own write" on public.announcement_reads;
create policy "announcement reads own read" on public.announcement_reads
  for select using (profile_id = auth.uid());
create policy "announcement reads own write" on public.announcement_reads
  for insert with check (profile_id = auth.uid());

create table if not exists public.coach_messages (
  id uuid primary key default gen_random_uuid(),
  athlete_id uuid not null references public.athletes(id) on delete cascade,
  from_profile_id uuid not null references public.profiles(id) on delete cascade,
  to_profile_id uuid not null references public.profiles(id) on delete cascade,
  body text not null check (length(trim(body)) > 0),
  created_at timestamptz not null default now(),
  read_at timestamptz
);
alter table public.coach_messages enable row level security;
drop policy if exists "coach messages own access" on public.coach_messages;
drop policy if exists "coach messages admins access" on public.coach_messages;
create policy "coach messages own access" on public.coach_messages
  for select using (from_profile_id = auth.uid() or to_profile_id = auth.uid());
create policy "coach messages admins access" on public.coach_messages
  for select using (public.is_admin());

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

  insert into public.announcements(title, body, audience, channels, published_at, created_by)
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

-- Corrige la notificación de nueva inscripción, incluso si se ejecutó la
-- migración anterior con el nombre antiguo de columna.
create or replace function public.notify_admins_new_athlete()
returns trigger language plpgsql security definer set search_path = public as $$
declare notice_id uuid; recipient_id uuid; source_profile_id uuid;
begin
  select coalesce(new.user_profile_id, f.primary_profile_id) into source_profile_id
  from public.families f where f.id = new.family_id;
  if source_profile_id is null then select id into source_profile_id from public.profiles where role in ('owner', 'admin') order by created_at limit 1; end if;
  if source_profile_id is null then return new; end if;
  insert into public.announcements(title, body, audience, channels, published_at, created_by)
  values ('Nueva inscripción', concat(new.first_name, ' ', new.last_name, ' ha enviado una inscripción para revisión.'), 'individual', array['app']::text[], now(), source_profile_id)
  returning id into notice_id;
  for recipient_id in select id from public.profiles where role in ('owner', 'admin') loop
    insert into public.announcement_deliveries(announcement_id, recipient_profile_id, channel, delivery_status)
      values (notice_id, recipient_id, 'app', 'sent') on conflict do nothing;
  end loop;
  return new;
end;
$$;
