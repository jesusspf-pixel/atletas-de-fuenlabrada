-- Un alta solo queda activa cuando Stripe confirma la matrícula.
alter table public.billing_charge_drafts add column if not exists next_attempt_at timestamptz;
alter table public.billing_charge_drafts add column if not exists attempt_count integer not null default 0;
alter table public.club_settings add column if not exists registration_notification_email text;
update public.club_settings set registration_notification_email=coalesce(registration_notification_email,contact_email,'info@atletasdefuenlabrada.com') where id=true;

create or replace function public.finalize_paid_registration(target_draft_id uuid)
returns void language plpgsql security definer set search_path=public as $$
declare d public.billing_charge_drafts%rowtype;
begin
  if auth.role() <> 'service_role' then raise exception 'Solo el servicio de cobros puede finalizar un alta.'; end if;
  select * into d from public.billing_charge_drafts where id=target_draft_id and charge_kind='enrolment' and status='paid' for update;
  if not found then raise exception 'La matrícula aún no está pagada.'; end if;
  update public.athletes set club_status='active' where id=d.athlete_id;
  update public.memberships set fee_provider='stripe',billing_started_on=coalesce(billing_started_on,current_date),enrolment_fee_status='paid' where id=d.membership_id;
  update public.billing_charge_drafts set status='cancelled',admin_note='Sustituido por una matrícula cobrada.' where membership_id=d.membership_id and charge_kind='enrolment' and id<>d.id and status in ('approved','failed');
  perform public.rebuild_membership_fee_schedule(d.membership_id);
end $$;
revoke all on function public.finalize_paid_registration(uuid) from public;
grant execute on function public.finalize_paid_registration(uuid) to service_role;

create or replace function public.claim_due_billing_charges(batch_limit integer default 100)
returns table(id uuid,membership_id uuid,payer_profile_id uuid,charge_kind text,approved_amount_cents integer,calculated_amount_cents integer,athlete_first_name text,athlete_last_name text)
language plpgsql security definer set search_path=public as $$
begin
  if auth.role() <> 'service_role' then raise exception 'Solo el servicio automático de cobros puede reclamar cuotas.'; end if;
  return query
  with due as (
    select d.id from public.billing_charge_drafts d
    where ((d.status='approved' and d.scheduled_for<=current_date) or (d.status='failed' and d.next_attempt_at<=now()))
      and coalesce(d.approved_amount_cents,d.calculated_amount_cents)>0
    order by coalesce(d.next_attempt_at,d.scheduled_for::timestamptz),d.created_at
    for update skip locked limit greatest(1,least(coalesce(batch_limit,100),250))
  ), claimed as (
    update public.billing_charge_drafts d set status='collecting',attempt_count=d.attempt_count+1,updated_at=now() from due where d.id=due.id returning d.*
  )
  select c.id,c.membership_id,c.payer_profile_id,c.charge_kind,c.approved_amount_cents,c.calculated_amount_cents,a.first_name,a.last_name from claimed c join public.athletes a on a.id=c.athlete_id;
end $$;
