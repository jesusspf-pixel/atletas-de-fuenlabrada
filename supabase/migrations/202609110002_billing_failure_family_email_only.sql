-- Los avisos de impago por correo se dirigen a la familia. Administración ya
-- dispone del aviso dentro de la aplicación y no necesita una copia por email.

create or replace function public.skip_admin_billing_failure_email()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.channel = 'email'
     and exists (
       select 1 from public.profiles p
        where p.id = new.recipient_profile_id
          and p.role in ('owner', 'admin')
     )
     and exists (
       select 1 from public.announcements a
        where a.id = new.announcement_id
          and (
            a.title like 'Cobro rechazado · intento %'
            or a.title = 'Baja pendiente por impago'
          )
     ) then
    return null;
  end if;
  return new;
end;
$$;

drop trigger if exists announcement_deliveries_skip_admin_billing_email
  on public.announcement_deliveries;
create trigger announcement_deliveries_skip_admin_billing_email
before insert on public.announcement_deliveries
for each row execute function public.skip_admin_billing_failure_email();

create or replace function public.billing_failure_notification_recipients(
  target_draft_id uuid,
  target_attempt_number integer
)
returns table (
  announcement_id uuid,
  recipient_profile_id uuid,
  email text,
  is_admin boolean
)
language sql
stable
security definer
set search_path = public
as $$
  select d.announcement_id,
         d.recipient_profile_id,
         lower(trim(p.email)) as email,
         false as is_admin
    from public.billing_failure_alerts a
    join public.announcement_deliveries d
      on d.announcement_id = a.announcement_id
     and d.channel = 'email'
    join public.profiles p on p.id = d.recipient_profile_id
   where a.draft_id = target_draft_id
     and a.attempt_number = target_attempt_number
     and p.role not in ('owner', 'admin')
     and nullif(trim(p.email), '') is not null
   order by d.recipient_profile_id;
$$;

revoke all on function public.billing_failure_notification_recipients(uuid, integer) from public;
grant execute on function public.billing_failure_notification_recipients(uuid, integer) to service_role;
