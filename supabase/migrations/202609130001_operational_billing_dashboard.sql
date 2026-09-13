-- Centro operativo de cobros: recordatorios manuales y resolución trazable
-- de pagos recibidos fuera de Stripe.

create table if not exists public.billing_admin_actions (
  id uuid primary key default gen_random_uuid(),
  draft_id uuid not null references public.billing_charge_drafts(id) on delete cascade,
  action_type text not null check (action_type in ('reminder_sent','manual_payment','waived','cancelled')),
  payment_method text check (payment_method is null or payment_method in ('bank_transfer','cash','card','direct_debit','other')),
  external_reference text,
  notes text,
  announcement_id uuid references public.announcements(id) on delete set null,
  details jsonb not null default '{}'::jsonb,
  created_by uuid not null default auth.uid() references public.profiles(id),
  created_at timestamptz not null default now()
);

create index if not exists billing_admin_actions_draft_idx
  on public.billing_admin_actions(draft_id, created_at desc);

alter table public.billing_admin_actions enable row level security;

drop policy if exists "billing actions admin read" on public.billing_admin_actions;
create policy "billing actions admin read" on public.billing_admin_actions
  for select using (public.is_admin());

drop policy if exists "billing actions admin insert" on public.billing_admin_actions;
create policy "billing actions admin insert" on public.billing_admin_actions
  for insert with check (public.is_admin());

create or replace function public.resolve_billing_charge_manually(
  target_draft_id uuid,
  target_payment_method text,
  target_reference text,
  target_notes text default null
) returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  target public.billing_charge_drafts%rowtype;
  action_id uuid := gen_random_uuid();
begin
  if not public.is_admin() then
    raise exception 'Solo administración puede resolver un cobro.';
  end if;
  if target_payment_method not in ('bank_transfer','cash','card','direct_debit','other') then
    raise exception 'Método de pago no válido.';
  end if;
  if nullif(trim(target_reference), '') is null then
    raise exception 'Indica una referencia o justificante del pago.';
  end if;

  select * into target
    from public.billing_charge_drafts
   where id = target_draft_id
   for update;

  if not found then raise exception 'No se encontró el cargo.'; end if;
  if target.status = 'paid' then raise exception 'Este cargo ya consta como pagado.'; end if;
  if target.status = 'collecting' then
    raise exception 'Stripe está procesando este cobro. Espera antes de resolverlo manualmente.';
  end if;
  if target.status in ('cancelled','waived') then
    raise exception 'Un cargo cancelado o exento no se puede marcar como pagado.';
  end if;

  insert into public.billing_admin_actions(
    id, draft_id, action_type, payment_method, external_reference, notes, details
  ) values (
    action_id, target.id, 'manual_payment', target_payment_method,
    trim(target_reference), nullif(trim(coalesce(target_notes,'')), ''),
    jsonb_build_object(
      'previous_status', target.status,
      'amount_cents', coalesce(target.approved_amount_cents,target.calculated_amount_cents)
    )
  );

  update public.billing_charge_drafts
     set status = 'paid',
         provider_reference = concat('manual:', action_id),
         next_attempt_at = null,
         admin_note = concat(
           'Pago registrado por administración · ', target_payment_method,
           ' · ', trim(target_reference),
           case when nullif(trim(coalesce(target_notes,'')), '') is not null
             then concat(' · ', trim(target_notes)) else '' end
         ),
         updated_at = now()
   where id = target.id;

  if target.charge_kind = 'enrolment' then
    update public.athletes set club_status = 'active' where id = target.athlete_id;
    update public.memberships
       set billing_started_on = coalesce(billing_started_on,current_date),
           enrolment_fee_status = 'paid', billing_status = 'active',
           access_suspended_at = null, suspension_reason = null, billing_updated_at = now()
     where id = target.membership_id;
    update public.billing_charge_drafts
       set status = 'cancelled', admin_note = 'Sustituido por una matrícula pagada por otro medio.', updated_at = now()
     where membership_id = target.membership_id and charge_kind = 'enrolment'
       and id <> target.id and status in ('approved','failed','checkout_pending','awaiting_admin');
    perform public.rebuild_membership_fee_schedule(target.membership_id);
  else
    update public.memberships
       set billing_status = 'active', access_suspended_at = null,
           suspension_reason = null, billing_updated_at = now()
     where id = target.membership_id;
    update public.athletes set club_status = 'active'
     where id = target.athlete_id and club_status <> 'active';
  end if;

  return action_id;
end;
$$;

revoke all on function public.resolve_billing_charge_manually(uuid,text,text,text) from public;
grant execute on function public.resolve_billing_charge_manually(uuid,text,text,text) to authenticated;

create or replace function public.create_billing_manual_reminder(target_draft_id uuid)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  target public.billing_charge_drafts%rowtype;
  notice_id uuid;
  existing_notice uuid;
  athlete_name text;
  amount_text text;
  recipient record;
begin
  if not public.is_admin() then
    raise exception 'Solo administración puede enviar recordatorios de cobro.';
  end if;

  select * into target from public.billing_charge_drafts where id = target_draft_id;
  if not found then raise exception 'No se encontró el cargo.'; end if;
  if target.status not in ('failed','checkout_pending','approved','awaiting_admin') then
    raise exception 'Este cargo no está pendiente de pago.';
  end if;

  select announcement_id into existing_notice
    from public.billing_admin_actions
   where draft_id = target.id and action_type = 'reminder_sent'
     and details->>'sent_on' = current_date::text
   order by created_at desc limit 1;
  if existing_notice is not null then return existing_notice; end if;

  select trim(first_name || ' ' || last_name) into athlete_name
    from public.athletes where id = target.athlete_id;
  amount_text := to_char(coalesce(target.approved_amount_cents,target.calculated_amount_cents) / 100.0, 'FM999990D00');

  insert into public.announcements(title,body,audience,delivery_channels,published_at,created_by)
  values (
    'Recordatorio de pago pendiente',
    concat('Está pendiente el pago de ', amount_text, ' € de ', coalesce(athlete_name,'un atleta'),
      '. Revisa la tarjeta o ponte en contacto con el club si ya lo has abonado por otro medio.'),
    'individual', array['app','email']::text[], now(), auth.uid()
  ) returning id into notice_id;

  for recipient in
    with athlete_context as (
      select a.user_profile_id, a.family_id from public.athletes a where a.id = target.athlete_id
    ), recipients as (
      select target.payer_profile_id as id where target.payer_profile_id is not null
      union select ac.user_profile_id from athlete_context ac where ac.user_profile_id is not null
      union select f.primary_profile_id from athlete_context ac join public.families f on f.id=ac.family_id
      union select fg.profile_id from athlete_context ac join public.family_guardians fg on fg.family_id=ac.family_id where fg.access_status='active'
    )
    select distinct p.id, nullif(trim(p.email),'') as email
      from recipients r join public.profiles p on p.id=r.id
  loop
    insert into public.announcement_deliveries(announcement_id,recipient_profile_id,channel,delivery_status,updated_at)
    values(notice_id,recipient.id,'app','sent',now())
    on conflict(announcement_id,recipient_profile_id,channel) do nothing;
    if recipient.email is not null then
      insert into public.announcement_deliveries(announcement_id,recipient_profile_id,channel,delivery_status,updated_at)
      values(notice_id,recipient.id,'email','pending',now())
      on conflict(announcement_id,recipient_profile_id,channel) do nothing;
    end if;
  end loop;

  insert into public.billing_admin_actions(draft_id,action_type,announcement_id,details)
  values(target.id,'reminder_sent',notice_id,jsonb_build_object('sent_on',current_date::text));

  return notice_id;
end;
$$;

revoke all on function public.create_billing_manual_reminder(uuid) from public;
grant execute on function public.create_billing_manual_reminder(uuid) to authenticated;
