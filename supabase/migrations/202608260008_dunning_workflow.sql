alter table public.billing_charge_drafts add column if not exists last_attempt_at timestamptz;
alter table public.billing_charge_drafts add column if not exists final_attempt_at timestamptz;
alter table public.billing_charge_drafts add column if not exists delinquency_deadline date;
alter table public.memberships add column if not exists access_suspended_at timestamptz;
alter table public.memberships add column if not exists suspension_reason text;

alter table public.billing_failure_alerts add column if not exists attempt_number integer not null default 1;
alter table public.billing_failure_alerts drop constraint if exists billing_failure_alerts_pkey;
alter table public.billing_failure_alerts add primary key(draft_id,attempt_number);

update public.billing_charge_drafts
set delinquency_deadline=coalesce(period_starts_on,scheduled_for)+14
where charge_kind='recurring' and delinquency_deadline is null;

drop function if exists public.claim_due_billing_charges(integer);
create function public.claim_due_billing_charges(batch_limit integer default 100)
returns table(id uuid,membership_id uuid,athlete_id uuid,payer_profile_id uuid,charge_kind text,approved_amount_cents integer,calculated_amount_cents integer,attempt_number integer,delinquency_deadline date,is_final_attempt boolean,athlete_first_name text,athlete_last_name text)
language plpgsql security definer set search_path=public as $$
begin
  if auth.role()<>'service_role' then raise exception 'Solo el servicio automático de cobros puede reclamar cuotas.'; end if;
  return query
  with due as (
    select d.id from public.billing_charge_drafts d
    where coalesce(d.approved_amount_cents,d.calculated_amount_cents)>0 and (
      (d.status='approved' and d.scheduled_for<=current_date)
      or (d.status='failed' and d.attempt_count<3 and d.next_attempt_at<=now())
      or (d.status='failed' and d.attempt_count>=3 and d.final_attempt_at is null and current_date>=coalesce(d.delinquency_deadline,d.scheduled_for+14))
    ) order by coalesce(d.next_attempt_at,d.scheduled_for::timestamptz),d.created_at
    for update skip locked limit greatest(1,least(coalesce(batch_limit,100),250))
  ), claimed as (
    update public.billing_charge_drafts d set status='collecting',attempt_count=d.attempt_count+1,last_attempt_at=now(),
      final_attempt_at=case when d.attempt_count>=3 then now() else d.final_attempt_at end,updated_at=now()
    from due where d.id=due.id returning d.*
  )
  select c.id,c.membership_id,c.athlete_id,c.payer_profile_id,c.charge_kind,c.approved_amount_cents,c.calculated_amount_cents,c.attempt_count,c.delinquency_deadline,(c.final_attempt_at is not null),a.first_name,a.last_name
  from claimed c join public.athletes a on a.id=c.athlete_id;
end $$;
revoke all on function public.claim_due_billing_charges(integer) from public;
grant execute on function public.claim_due_billing_charges(integer) to service_role;

create or replace function public.suspend_membership_for_nonpayment(target_membership_id uuid)
returns void language plpgsql security definer set search_path=public as $$
declare target_athlete uuid;
begin
  if auth.role()<>'service_role' then raise exception 'Solo el servicio de cobros puede suspender una membresía.'; end if;
  update public.memberships set billing_status='past_due',access_suspended_at=now(),suspension_reason='Falta de pago tras el intento final del día 15',billing_updated_at=now() where id=target_membership_id returning athlete_id into target_athlete;
  update public.athletes set club_status='inactive' where id=target_athlete;
end $$;
revoke all on function public.suspend_membership_for_nonpayment(uuid) from public;
grant execute on function public.suspend_membership_for_nonpayment(uuid) to service_role;

create or replace function public.notify_failed_billing_charge()
returns trigger language plpgsql security definer set search_path=public as $$
declare notice_id uuid; creator uuid; athlete_name text; amount_text text; recipient uuid;
begin
  if new.status <> 'failed' or old.status = 'failed' then return new; end if;
  if exists(select 1 from public.billing_failure_alerts where draft_id=new.id and attempt_number=new.attempt_count) then return new; end if;
  select id into creator from public.profiles where role in ('owner','admin') order by case when role='owner' then 0 else 1 end limit 1;
  if creator is null then return new; end if;
  select trim(first_name||' '||last_name) into athlete_name from public.athletes where id=new.athlete_id;
  amount_text := to_char(coalesce(new.approved_amount_cents,new.calculated_amount_cents)/100.0,'FM999990D00');
  insert into public.announcements(title,body,audience,delivery_channels,published_at,created_by)
  values(
    case when new.final_attempt_at is not null then 'Baja pendiente por impago' else concat('Cobro rechazado · intento ',new.attempt_count) end,
    concat('Ha fallado el cobro de ',amount_text,' € de ',coalesce(athlete_name,'un atleta'),'. ',coalesce(new.admin_note,'Revisar el pago en Cuotas.')),
    'individual',array['app','email']::text[],now(),creator
  ) returning id into notice_id;
  for recipient in select id from public.profiles where role in ('owner','admin') union select new.payer_profile_id where new.payer_profile_id is not null loop
    insert into public.announcement_deliveries(announcement_id,recipient_profile_id,channel,delivery_status) values(notice_id,recipient,'app','sent') on conflict do nothing;
  end loop;
  insert into public.billing_failure_alerts(draft_id,attempt_number,announcement_id) values(new.id,new.attempt_count,notice_id);
  return new;
end $$;
