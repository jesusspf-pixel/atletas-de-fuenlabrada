-- Gestión completa de competiciones y conversaciones bidireccionales.

drop policy if exists "competitions authenticated read" on public.competition_events;
create policy "competitions authenticated read"
on public.competition_events for select using (
  auth.uid() is not null
  and (published or public.is_admin() or created_by = auth.uid())
);

drop policy if exists "competitions publisher insert" on public.competition_events;
create policy "competitions publisher insert"
on public.competition_events for insert with check (
  created_by = auth.uid()
  and exists (
    select 1 from public.profiles p
    where p.id = auth.uid() and p.role in ('owner','admin','coach')
  )
);

drop policy if exists "competitions publisher update" on public.competition_events;
create policy "competitions publisher update"
on public.competition_events for update using (
  public.is_admin() or created_by = auth.uid()
) with check (
  public.is_admin() or created_by = auth.uid()
);

drop policy if exists "competitions publisher delete" on public.competition_events;
create policy "competitions publisher delete"
on public.competition_events for delete using (
  public.is_admin() or created_by = auth.uid()
);

drop policy if exists "competition entries publisher read" on public.competition_entries;
create policy "competition entries publisher read"
on public.competition_entries for select using (
  public.is_admin() or exists (
    select 1 from public.competition_events e
    where e.id = competition_event_id and e.created_by = auth.uid()
  )
);

drop policy if exists "athletes competition publisher read" on public.athletes;

create or replace function public.can_read_competition_athlete(target_athlete_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.competition_entries ce
    join public.competition_events e on e.id = ce.competition_event_id
    where ce.athlete_id = target_athlete_id
      and (public.is_admin() or e.created_by = auth.uid())
  )
$$;

revoke all on function public.can_read_competition_athlete(uuid) from public;
grant execute on function public.can_read_competition_athlete(uuid) to authenticated;

create policy "athletes competition publisher read"
on public.athletes for select using (
  public.can_read_competition_athlete(id)
);

drop policy if exists "club documents competition publisher insert" on public.club_documents;
create policy "club documents competition publisher insert"
on public.club_documents for insert with check (
  document_type = 'competition_circular'
  and competition_event_id is not null
  and uploaded_by = auth.uid()
  and exists (
    select 1 from public.competition_events e
    where e.id = competition_event_id
      and (public.is_admin() or e.created_by = auth.uid())
  )
);

drop policy if exists "club documents competition publisher delete" on public.club_documents;
create policy "club documents competition publisher delete"
on public.club_documents for delete using (
  document_type = 'competition_circular'
  and competition_event_id is not null
  and exists (
    select 1 from public.competition_events e
    where e.id = competition_event_id
      and (public.is_admin() or e.created_by = auth.uid())
  )
);

drop policy if exists "club competition storage publisher delete" on storage.objects;
create policy "club competition storage publisher delete"
on storage.objects for delete using (
  bucket_id = 'club-private-documents'
  and (storage.foldername(name))[1] = 'competitions'
  and exists (
    select 1 from public.competition_events e
    where e.id::text = (storage.foldername(name))[2]
      and (public.is_admin() or e.created_by = auth.uid())
  )
);

alter table public.announcements drop constraint if exists announcements_action_type_check;
alter table public.announcements add constraint announcements_action_type_check
  check (action_type is null or action_type in ('shop_order','communication'));

create or replace function public.send_family_message(target_athlete_id uuid, message_body text)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  target public.athletes;
  notice_id uuid;
  recipient_id uuid;
begin
  if auth.uid() is null then raise exception 'Inicia sesión primero.'; end if;
  if length(trim(coalesce(message_body, ''))) = 0 then raise exception 'Escribe un mensaje.'; end if;

  select * into target from public.athletes where id = target_athlete_id;
  if not found then raise exception 'No se encontró el atleta.'; end if;
  if not (
    target.user_profile_id = auth.uid()
    or exists (
      select 1 from public.families f
      where f.id = target.family_id and f.primary_profile_id = auth.uid()
    )
  ) then raise exception 'No puedes enviar mensajes sobre este atleta.'; end if;

  insert into public.announcements(
    title, body, audience, delivery_channels, published_at, created_by, action_type
  ) values (
    concat('Mensaje de familia · ', target.first_name, ' ', target.last_name),
    trim(message_body), 'individual', array['app','email']::text[], now(), auth.uid(), 'communication'
  ) returning id into notice_id;

  for recipient_id in
    select distinct recipient from (
      select tgc.coach_profile_id as recipient
      from public.training_group_coaches tgc
      where tgc.training_group_id = target.training_group_id
      union
      select p.id from public.profiles p where p.role in ('owner','admin')
    ) recipients
  loop
    insert into public.coach_messages(athlete_id, from_profile_id, to_profile_id, body)
    values (target.id, auth.uid(), recipient_id, trim(message_body));
    insert into public.announcement_deliveries(
      announcement_id, recipient_profile_id, channel, delivery_status
    ) values (notice_id, recipient_id, 'app', 'sent') on conflict do nothing;
  end loop;

  for recipient_id in select id from public.profiles where role in ('owner','admin') loop
    insert into public.announcement_deliveries(
      announcement_id, recipient_profile_id, channel, delivery_status
    ) values (notice_id, recipient_id, 'email', 'pending') on conflict do nothing;
  end loop;

  return notice_id;
end;
$$;

revoke all on function public.send_family_message(uuid, text) from public;
grant execute on function public.send_family_message(uuid, text) to authenticated;

create or replace function public.reply_to_announcement(target_announcement_id uuid, reply_body text)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  original public.announcements;
  reply_id uuid;
  recipient_id uuid;
begin
  if auth.uid() is null then raise exception 'Inicia sesión primero.'; end if;
  if length(trim(coalesce(reply_body, ''))) = 0 then raise exception 'Escribe una respuesta.'; end if;
  if not exists (
    select 1 from public.profiles p
    where p.id = auth.uid() and p.role in ('owner','admin','coach')
  ) then raise exception 'No tienes permiso para responder este aviso.'; end if;

  select * into original from public.announcements where id = target_announcement_id;
  if not found then raise exception 'No se encontró el aviso original.'; end if;
  if not public.is_admin() and not exists (
    select 1 from public.announcement_deliveries d
    where d.announcement_id = target_announcement_id
      and d.recipient_profile_id = auth.uid()
  ) then raise exception 'Este aviso no está dirigido a tu cuenta.'; end if;

  insert into public.announcements(
    title, body, audience, delivery_channels, published_at, created_by, action_type, action_id
  ) values (
    concat('Respuesta · ', original.title), trim(reply_body), 'individual',
    array['app','email']::text[], now(), auth.uid(), 'communication', target_announcement_id
  ) returning id into reply_id;

  if original.created_by <> auth.uid() then
    insert into public.announcement_deliveries(
      announcement_id, recipient_profile_id, channel, delivery_status
    ) values
      (reply_id, original.created_by, 'app', 'sent'),
      (reply_id, original.created_by, 'email', 'pending')
    on conflict do nothing;
  end if;

  for recipient_id in select id from public.profiles where role in ('owner','admin') loop
    insert into public.announcement_deliveries(
      announcement_id, recipient_profile_id, channel, delivery_status
    ) values
      (reply_id, recipient_id, 'app', 'sent'),
      (reply_id, recipient_id, 'email', 'pending')
    on conflict do nothing;
  end loop;

  return reply_id;
end;
$$;

revoke all on function public.reply_to_announcement(uuid, text) from public;
grant execute on function public.reply_to_announcement(uuid, text) to authenticated;
