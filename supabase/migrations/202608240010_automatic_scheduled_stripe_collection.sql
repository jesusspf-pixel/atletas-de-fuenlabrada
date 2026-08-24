-- Cobro automático de cuotas ya aprobadas al validar el alta.
-- El Worker programado reclama cada cuota una sola vez antes de pedir el pago a Stripe.

alter table public.billing_charge_drafts
  drop constraint if exists billing_charge_drafts_status_check;

alter table public.billing_charge_drafts
  add constraint billing_charge_drafts_status_check
  check (status in ('awaiting_admin','approved','collecting','checkout_pending','paid','failed','waived','cancelled'));

create or replace function public.claim_due_billing_charges(batch_limit integer default 100)
returns table(
  id uuid,
  membership_id uuid,
  payer_profile_id uuid,
  charge_kind text,
  approved_amount_cents integer,
  calculated_amount_cents integer,
  athlete_first_name text,
  athlete_last_name text
)
language plpgsql
security definer
set search_path = public
as $$
begin
  -- Esta función se invoca exclusivamente desde el Worker con la service role.
  if auth.role() <> 'service_role' then
    raise exception 'Solo el servicio automático de cobros puede reclamar cuotas.';
  end if;

  return query
  with due as (
    select d.id
      from public.billing_charge_drafts d
     where d.status = 'approved'
       and d.scheduled_for <= current_date
       and coalesce(d.approved_amount_cents, d.calculated_amount_cents) > 0
     order by d.scheduled_for, d.created_at
     for update skip locked
     limit greatest(1, least(coalesce(batch_limit, 100), 250))
  ), claimed as (
    update public.billing_charge_drafts d
       set status = 'collecting',
           updated_at = now()
      from due
     where d.id = due.id
     returning d.*
  )
  select c.id, c.membership_id, c.payer_profile_id, c.charge_kind,
         c.approved_amount_cents, c.calculated_amount_cents,
         a.first_name, a.last_name
    from claimed c
    join public.athletes a on a.id = c.athlete_id;
end;
$$;

revoke all on function public.claim_due_billing_charges(integer) from public;
grant execute on function public.claim_due_billing_charges(integer) to service_role;

create index if not exists billing_charge_drafts_due_collection_idx
  on public.billing_charge_drafts(status, scheduled_for)
  where status = 'approved';
