-- Garantiza que cada impago genere un aviso visible para todos los tutores
-- activos y una entrega de correo trazable. El Worker de cobros cambia las
-- entregas de email de pending a sent/failed tras consultar a Resend.

alter table public.announcement_deliveries
  add column if not exists provider_reference text,
  add column if not exists last_error text,
  add column if not exists updated_at timestamptz not null default now();

create or replace function public.notify_failed_billing_charge()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  notice_id uuid;
  creator uuid;
  athlete_name text;
  amount_text text;
  recipient record;
begin
  if new.status <> 'failed' or old.status = 'failed' then
    return new;
  end if;

  if exists (
    select 1
      from public.billing_failure_alerts
     where draft_id = new.id
       and attempt_number = new.attempt_count
  ) then
    return new;
  end if;

  select id
    into creator
    from public.profiles
   where role in ('owner', 'admin')
   order by case when role = 'owner' then 0 else 1 end
   limit 1;

  if creator is null then
    return new;
  end if;

  select trim(first_name || ' ' || last_name)
    into athlete_name
    from public.athletes
   where id = new.athlete_id;

  amount_text := to_char(
    coalesce(new.approved_amount_cents, new.calculated_amount_cents) / 100.0,
    'FM999990D00'
  );

  insert into public.announcements (
    title, body, audience, delivery_channels, published_at, created_by
  )
  values (
    case
      when new.final_attempt_at is not null then 'Baja pendiente por impago'
      else concat('Cobro rechazado · intento ', new.attempt_count)
    end,
    concat(
      'No hemos podido cobrar ', amount_text, ' € de ',
      coalesce(athlete_name, 'un atleta'),
      '. Revisa la tarjeta o el saldo. El club volverá a intentarlo en la fecha indicada.'
    ),
    'individual',
    array['app', 'email']::text[],
    now(),
    creator
  )
  returning id into notice_id;

  for recipient in
    with athlete_family as (
      select a.family_id, a.user_profile_id
        from public.athletes a
       where a.id = new.athlete_id
    ), intended_recipients as (
      select p.id
        from public.profiles p
       where p.role in ('owner', 'admin')
      union
      select new.payer_profile_id
       where new.payer_profile_id is not null
      union
      select af.user_profile_id
        from athlete_family af
       where af.user_profile_id is not null
      union
      select fg.profile_id
        from athlete_family af
        join public.family_guardians fg on fg.family_id = af.family_id
       where fg.access_status = 'active'
    )
    select p.id, nullif(trim(p.email), '') as email
      from intended_recipients r
      join public.profiles p on p.id = r.id
  loop
    insert into public.announcement_deliveries (
      announcement_id, recipient_profile_id, channel, delivery_status, updated_at
    )
    values (notice_id, recipient.id, 'app', 'sent', now())
    on conflict (announcement_id, recipient_profile_id, channel)
    do update set delivery_status = 'sent', last_error = null, updated_at = now();

    if recipient.email is not null then
      insert into public.announcement_deliveries (
        announcement_id, recipient_profile_id, channel, delivery_status, updated_at
      )
      values (notice_id, recipient.id, 'email', 'pending', now())
      on conflict (announcement_id, recipient_profile_id, channel)
      do update set delivery_status = 'pending', last_error = null, updated_at = now();
    end if;
  end loop;

  insert into public.billing_failure_alerts (
    draft_id, attempt_number, announcement_id
  )
  values (new.id, new.attempt_count, notice_id);

  return new;
end;
$$;

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
         p.role in ('owner', 'admin') as is_admin
    from public.billing_failure_alerts a
    join public.announcement_deliveries d
      on d.announcement_id = a.announcement_id
     and d.channel = 'email'
    join public.profiles p on p.id = d.recipient_profile_id
   where a.draft_id = target_draft_id
     and a.attempt_number = target_attempt_number
     and nullif(trim(p.email), '') is not null
   order by is_admin, d.recipient_profile_id;
$$;

revoke all on function public.billing_failure_notification_recipients(uuid, integer) from public;
grant execute on function public.billing_failure_notification_recipients(uuid, integer) to service_role;

