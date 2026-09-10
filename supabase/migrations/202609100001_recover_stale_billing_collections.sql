-- Recupera de forma idempotente los cobros que quedaron reclamados cuando el
-- Worker alcanzó su límite de subpeticiones. Al conservar attempt_count, el
-- Worker reutiliza exactamente la misma Idempotency-Key de Stripe y evita
-- duplicar un cargo cuya respuesta se hubiera perdido.

drop function if exists public.claim_due_billing_charges(integer);

create function public.claim_due_billing_charges(batch_limit integer default 4)
returns table(
  id uuid,
  membership_id uuid,
  athlete_id uuid,
  payer_profile_id uuid,
  charge_kind text,
  approved_amount_cents integer,
  calculated_amount_cents integer,
  attempt_number integer,
  delinquency_deadline date,
  is_final_attempt boolean,
  athlete_first_name text,
  athlete_last_name text
)
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.role() <> 'service_role' then
    raise exception 'Solo el servicio automático de cobros puede reclamar cuotas.';
  end if;

  return query
  with due as (
    select d.id, d.status as previous_status
      from public.billing_charge_drafts d
     where coalesce(d.approved_amount_cents, d.calculated_amount_cents) > 0
       and (
         (d.status = 'approved' and d.scheduled_for <= current_date)
         or (d.status = 'failed' and d.attempt_count < 3 and d.next_attempt_at <= now())
         or (
           d.status = 'failed'
           and d.attempt_count >= 3
           and d.final_attempt_at is null
           and current_date >= coalesce(d.delinquency_deadline, d.scheduled_for + 14)
         )
         or (
           d.status = 'collecting'
           and coalesce(d.last_attempt_at, d.updated_at) <= now() - interval '20 minutes'
         )
       )
     order by
       case when d.status = 'collecting' then 0 else 1 end,
       coalesce(d.next_attempt_at, d.last_attempt_at, d.scheduled_for::timestamptz),
       d.created_at
     for update skip locked
     limit greatest(1, least(coalesce(batch_limit, 4), 4))
  ), claimed as (
    update public.billing_charge_drafts d
       set status = 'collecting',
           attempt_count = case
             when due.previous_status = 'collecting' then d.attempt_count
             else d.attempt_count + 1
           end,
           last_attempt_at = now(),
           final_attempt_at = case
             when due.previous_status <> 'collecting' and d.attempt_count >= 3 then now()
             else d.final_attempt_at
           end,
           updated_at = now()
      from due
     where d.id = due.id
     returning d.*
  )
  select c.id, c.membership_id, c.athlete_id, c.payer_profile_id,
         c.charge_kind, c.approved_amount_cents, c.calculated_amount_cents,
         c.attempt_count, c.delinquency_deadline, (c.final_attempt_at is not null),
         a.first_name, a.last_name
    from claimed c
    join public.athletes a on a.id = c.athlete_id;
end;
$$;

revoke all on function public.claim_due_billing_charges(integer) from public;
grant execute on function public.claim_due_billing_charges(integer) to service_role;
