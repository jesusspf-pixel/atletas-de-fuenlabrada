-- Confirma por email y dentro de la aplicación tanto la recepción como la
-- validación de cada inscripción. Las entregas de email quedan en una cola
-- que procesa el Worker programado, por lo que no dependen del navegador.

alter table public.announcement_deliveries
  add column if not exists attempt_count integer not null default 0;

alter table public.announcement_deliveries
  drop constraint if exists announcement_deliveries_delivery_status_check;
alter table public.announcement_deliveries
  add constraint announcement_deliveries_delivery_status_check
  check (delivery_status in ('pending', 'sending', 'sent', 'failed'));

create table if not exists public.registration_lifecycle_alerts (
  athlete_id uuid not null references public.athletes(id) on delete cascade,
  event_type text not null check (event_type in ('submitted', 'validated')),
  announcement_id uuid not null references public.announcements(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (athlete_id, event_type)
);

alter table public.registration_lifecycle_alerts enable row level security;

create or replace function public.registration_contact_profiles(target_athlete_id uuid)
returns table (profile_id uuid, email text)
language sql
stable
security definer
set search_path = public
as $$
  with athlete_contact as (
    select a.user_profile_id, a.family_id
      from public.athletes a
     where a.id = target_athlete_id
  ), intended as (
    select ac.user_profile_id as profile_id
      from athlete_contact ac
     where ac.user_profile_id is not null
    union
    select f.primary_profile_id
      from athlete_contact ac
      join public.families f on f.id = ac.family_id
     where f.primary_profile_id is not null
    union
    select fg.profile_id
      from athlete_contact ac
      join public.family_guardians fg on fg.family_id = ac.family_id
     where fg.access_status = 'active'
  )
  select p.id, nullif(trim(p.email), '')
    from intended i
    join public.profiles p on p.id = i.profile_id;
$$;

revoke all on function public.registration_contact_profiles(uuid) from public;
grant execute on function public.registration_contact_profiles(uuid) to service_role;

create or replace function public.queue_registration_lifecycle_notice(
  target_athlete_id uuid,
  target_event_type text,
  source_profile_id uuid default null
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  notice_id uuid;
  athlete_name text;
  creator uuid;
  recipient record;
  notice_title text;
  notice_body text;
begin
  if target_event_type not in ('submitted', 'validated') then
    raise exception 'Tipo de aviso de inscripción no válido.';
  end if;

  select trim(a.first_name || ' ' || a.last_name)
    into athlete_name
    from public.athletes a
   where a.id = target_athlete_id;
  if athlete_name is null then return null; end if;

  select coalesce(
    source_profile_id,
    (select rc.profile_id from public.registration_contact_profiles(target_athlete_id) rc limit 1),
    (select p.id from public.profiles p where p.role in ('owner', 'admin') order by case when p.role = 'owner' then 0 else 1 end limit 1)
  ) into creator;
  if creator is null then return null; end if;

  select rla.announcement_id
    into notice_id
    from public.registration_lifecycle_alerts rla
   where rla.athlete_id = target_athlete_id
     and rla.event_type = target_event_type;
  if notice_id is not null then return notice_id; end if;

  if target_event_type = 'submitted' then
    notice_title := 'Inscripción recibida';
    notice_body := concat(
      'Hemos recibido la inscripción de ', athlete_name,
      '. El club la revisará y te avisaremos cuando esté validada. No necesitas volver a enviarla.'
    );
  else
    notice_title := 'Inscripción validada';
    notice_body := concat(
      '¡Bienvenido/a al Club Atletas de Fuenlabrada! La inscripción de ', athlete_name,
      ' ha sido validada. Ya puedes acceder a tu perfil y utilizar los servicios disponibles en la aplicación.'
    );
  end if;

  insert into public.announcements (
    title, body, audience, delivery_channels, published_at, created_by
  ) values (
    notice_title, notice_body, 'individual', array['app', 'email']::text[], now(), creator
  ) returning id into notice_id;

  insert into public.registration_lifecycle_alerts (
    athlete_id, event_type, announcement_id
  ) values (target_athlete_id, target_event_type, notice_id);

  for recipient in
    select * from public.registration_contact_profiles(target_athlete_id)
  loop
    insert into public.announcement_deliveries (
      announcement_id, recipient_profile_id, channel, delivery_status, updated_at
    ) values (notice_id, recipient.profile_id, 'app', 'sent', now())
    on conflict (announcement_id, recipient_profile_id, channel)
    do update set delivery_status = 'sent', last_error = null, updated_at = now();

    if recipient.email is not null then
      insert into public.announcement_deliveries (
        announcement_id, recipient_profile_id, channel, delivery_status, updated_at
      ) values (notice_id, recipient.profile_id, 'email', 'pending', now())
      on conflict (announcement_id, recipient_profile_id, channel)
      do nothing;
    end if;
  end loop;

  return notice_id;
end;
$$;

revoke all on function public.queue_registration_lifecycle_notice(uuid, text, uuid) from public;
grant execute on function public.queue_registration_lifecycle_notice(uuid, text, uuid) to service_role;

create or replace function public.notify_admins_new_athlete()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  admin_notice_id uuid;
  recipient_id uuid;
  source_profile_id uuid;
begin
  select coalesce(new.user_profile_id, f.primary_profile_id)
    into source_profile_id
    from public.families f
   where f.id = new.family_id;
  if source_profile_id is null then
    select id into source_profile_id
      from public.profiles
     where role in ('owner', 'admin')
     order by created_at
     limit 1;
  end if;
  if source_profile_id is null then return new; end if;

  insert into public.announcements (
    title, body, audience, delivery_channels, published_at, created_by
  ) values (
    'Nueva inscripción',
    concat(new.first_name, ' ', new.last_name, ' ha enviado una inscripción para revisión.'),
    'individual', array['app']::text[], now(), source_profile_id
  ) returning id into admin_notice_id;

  for recipient_id in
    select id from public.profiles where role in ('owner', 'admin')
  loop
    insert into public.announcement_deliveries (
      announcement_id, recipient_profile_id, channel, delivery_status
    ) values (admin_notice_id, recipient_id, 'app', 'sent')
    on conflict do nothing;
  end loop;

  perform public.queue_registration_lifecycle_notice(new.id, 'submitted', source_profile_id);
  return new;
end;
$$;

drop trigger if exists athletes_notify_registration_validated on public.athletes;
create or replace function public.notify_registration_validated()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.club_status = 'active' and old.club_status is distinct from 'active' then
    perform public.queue_registration_lifecycle_notice(new.id, 'validated', null);
  end if;
  return new;
end;
$$;

create trigger athletes_notify_registration_validated
after update of club_status on public.athletes
for each row execute function public.notify_registration_validated();

create or replace function public.claim_registration_lifecycle_emails(batch_limit integer default 40)
returns table (
  announcement_id uuid,
  recipient_profile_id uuid,
  email text,
  subject text,
  body text
)
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.role() <> 'service_role' then
    raise exception 'Solo el servicio de notificaciones puede reclamar correos.';
  end if;

  return query
  with due as (
    select d.announcement_id, d.recipient_profile_id
      from public.announcement_deliveries d
      join public.announcements a on a.id = d.announcement_id
     where d.channel = 'email'
       and a.title in ('Inscripción recibida', 'Inscripción validada')
       and (
         d.delivery_status = 'pending'
         or (d.delivery_status = 'failed' and d.attempt_count < 3 and d.updated_at <= now() - interval '5 minutes')
         or (d.delivery_status = 'sending' and d.updated_at <= now() - interval '15 minutes')
       )
     order by d.created_at
     for update of d skip locked
     limit greatest(1, least(coalesce(batch_limit, 40), 80))
  ), claimed as (
    update public.announcement_deliveries d
       set delivery_status = 'sending',
           attempt_count = d.attempt_count + 1,
           last_error = null,
           updated_at = now()
      from due
     where d.announcement_id = due.announcement_id
       and d.recipient_profile_id = due.recipient_profile_id
       and d.channel = 'email'
    returning d.announcement_id, d.recipient_profile_id
  )
  select c.announcement_id,
         c.recipient_profile_id,
         p.email,
         a.title,
         a.body
    from claimed c
    join public.announcements a on a.id = c.announcement_id
    join public.profiles p on p.id = c.recipient_profile_id
   where nullif(trim(p.email), '') is not null;
end;
$$;

revoke all on function public.claim_registration_lifecycle_emails(integer) from public;
grant execute on function public.claim_registration_lifecycle_emails(integer) to service_role;

create or replace function public.complete_registration_lifecycle_emails(
  claimed_deliveries jsonb,
  final_status text,
  failure_detail text default null
)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  updated_count integer;
begin
  if auth.role() <> 'service_role' then
    raise exception 'Solo el servicio de notificaciones puede completar correos.';
  end if;
  if final_status not in ('sent', 'failed') then
    raise exception 'Estado final de correo no válido.';
  end if;

  update public.announcement_deliveries d
     set delivery_status = final_status,
         last_error = case when final_status = 'failed' then left(coalesce(failure_detail, 'Error de envío.'), 500) else null end,
         updated_at = now()
    from jsonb_to_recordset(coalesce(claimed_deliveries, '[]'::jsonb))
      as item(announcement_id uuid, recipient_profile_id uuid)
   where d.announcement_id = item.announcement_id
     and d.recipient_profile_id = item.recipient_profile_id
     and d.channel = 'email'
     and d.delivery_status = 'sending';

  get diagnostics updated_count = row_count;
  return updated_count;
end;
$$;

revoke all on function public.complete_registration_lifecycle_emails(jsonb, text, text) from public;
grant execute on function public.complete_registration_lifecycle_emails(jsonb, text, text) to service_role;
