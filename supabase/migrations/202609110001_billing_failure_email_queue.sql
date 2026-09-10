-- Recupera los correos que no se pudieron crear para impagos anteriores a la
-- cola garantizada y permite al Worker procesarlos sin reenviar el aviso app.

with current_failed_alerts as (
  select bfa.announcement_id,
         d.id as draft_id,
         d.attempt_count,
         d.payer_profile_id,
         a.user_profile_id,
         a.family_id
    from public.billing_failure_alerts bfa
    join public.billing_charge_drafts d on d.id = bfa.draft_id
    join public.athletes a on a.id = d.athlete_id
   where d.status = 'failed'
     and d.charge_kind = 'recurring'
     and bfa.attempt_number = d.attempt_count
), intended_recipients as (
  select cfa.announcement_id, p.id as recipient_profile_id
    from current_failed_alerts cfa
    cross join lateral (
      select cfa.payer_profile_id where cfa.payer_profile_id is not null
      union
      select cfa.user_profile_id where cfa.user_profile_id is not null
      union
      select f.primary_profile_id
        from public.families f
       where f.id = cfa.family_id
         and f.primary_profile_id is not null
      union
      select fg.profile_id
        from public.family_guardians fg
       where fg.family_id = cfa.family_id
         and fg.access_status = 'active'
    ) p
)
insert into public.announcement_deliveries (
  announcement_id,
  recipient_profile_id,
  channel,
  delivery_status,
  attempt_count,
  updated_at
)
select ir.announcement_id,
       ir.recipient_profile_id,
       'email',
       'pending',
       0,
       now()
  from intended_recipients ir
  join public.profiles p on p.id = ir.recipient_profile_id
 where nullif(trim(p.email), '') is not null
on conflict (announcement_id, recipient_profile_id, channel) do nothing;

create or replace function public.claim_billing_failure_emails(batch_limit integer default 2)
returns table (
  announcement_id uuid,
  recipient_profile_id uuid,
  email text,
  is_admin boolean,
  draft_id uuid,
  attempt_number integer,
  is_final_attempt boolean,
  athlete_first_name text,
  athlete_last_name text,
  reason text
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
  with due_alerts as (
    select bfa.announcement_id, bfa.draft_id, bfa.attempt_number
      from public.billing_failure_alerts bfa
     where exists (
       select 1
         from public.announcement_deliveries ad
        where ad.announcement_id = bfa.announcement_id
          and ad.channel = 'email'
          and (
            ad.delivery_status = 'pending'
            or (ad.delivery_status = 'failed' and ad.attempt_count < 3 and ad.updated_at <= now() - interval '5 minutes')
            or (ad.delivery_status = 'sending' and ad.updated_at <= now() - interval '15 minutes')
          )
     )
     order by bfa.created_at
     limit greatest(1, least(coalesce(batch_limit, 2), 4))
  ), claimed as (
    update public.announcement_deliveries ad
       set delivery_status = 'sending',
           attempt_count = ad.attempt_count + 1,
           last_error = null,
           updated_at = now()
      from due_alerts da
     where ad.announcement_id = da.announcement_id
       and ad.channel = 'email'
       and (
         ad.delivery_status = 'pending'
         or (ad.delivery_status = 'failed' and ad.attempt_count < 3 and ad.updated_at <= now() - interval '5 minutes')
         or (ad.delivery_status = 'sending' and ad.updated_at <= now() - interval '15 minutes')
       )
    returning ad.announcement_id, ad.recipient_profile_id
  )
  select c.announcement_id,
         c.recipient_profile_id,
         lower(trim(p.email)),
         p.role in ('owner', 'admin'),
         bfa.draft_id,
         bfa.attempt_number,
         d.final_attempt_at is not null,
         a.first_name,
         a.last_name,
         coalesce(d.admin_note, 'El banco ha rechazado la cuota.')
    from claimed c
    join public.profiles p on p.id = c.recipient_profile_id
    join public.billing_failure_alerts bfa on bfa.announcement_id = c.announcement_id
    join public.billing_charge_drafts d on d.id = bfa.draft_id
    join public.athletes a on a.id = d.athlete_id
   where nullif(trim(p.email), '') is not null
     and p.role not in ('owner', 'admin')
   order by c.announcement_id, c.recipient_profile_id;
end;
$$;

revoke all on function public.claim_billing_failure_emails(integer) from public;
grant execute on function public.claim_billing_failure_emails(integer) to service_role;

create or replace function public.complete_billing_failure_emails(
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

  update public.announcement_deliveries ad
     set delivery_status = final_status,
         last_error = case
           when final_status = 'failed' then left(coalesce(failure_detail, 'Error de envío.'), 500)
           else null
         end,
         updated_at = now()
    from jsonb_to_recordset(coalesce(claimed_deliveries, '[]'::jsonb))
      as item(announcement_id uuid, recipient_profile_id uuid)
   where ad.announcement_id = item.announcement_id
     and ad.recipient_profile_id = item.recipient_profile_id
     and ad.channel = 'email'
     and ad.delivery_status = 'sending';

  get diagnostics updated_count = row_count;
  return updated_count;
end;
$$;

revoke all on function public.complete_billing_failure_emails(jsonb, text, text) from public;
grant execute on function public.complete_billing_failure_emails(jsonb, text, text) to service_role;
