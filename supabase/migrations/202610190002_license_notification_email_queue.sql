-- Allow the scheduled notification worker to deliver the one-off federation
-- licence notice queued by club administration.
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
       and a.title in (
         'Inscripción recibida',
         'Inscripción validada',
         'Licencia federativa tramitada y camiseta de competición'
       )
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
