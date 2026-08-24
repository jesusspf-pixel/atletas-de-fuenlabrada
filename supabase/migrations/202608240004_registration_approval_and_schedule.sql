-- Altas nuevas: matrícula al validar y calendario de temporada automático.
-- Las cuotas recurrentes se crean para consulta/revisión; nunca se cobran en este trigger.

alter table public.club_billing_rules
  add column if not exists enrolment_cents integer not null default 4500 check (enrolment_cents >= 0);

create unique index if not exists billing_charge_drafts_period_unique
  on public.billing_charge_drafts(membership_id, charge_kind, period_starts_on, period_ends_on)
  where charge_kind = 'recurring' and status not in ('cancelled', 'waived');

create or replace function public.approve_registration_and_schedule(target_athlete_id uuid, waive_enrolment boolean default false)
returns table(enrolment_draft_id uuid, athlete_id uuid)
language plpgsql security definer set search_path = public as $$
declare
  m public.memberships%rowtype;
  r public.club_billing_rules%rowtype;
  payer uuid;
  season_start int;
  cursor_date date;
  period_start date;
  period_end date;
  amount integer;
begin
  if not public.is_admin() then raise exception 'Solo administración puede validar una inscripción.'; end if;
  select * into m from public.memberships where athlete_id = target_athlete_id order by created_at desc limit 1 for update;
  if not found then raise exception 'No se ha encontrado la cuota de este atleta.'; end if;
  select * into r from public.club_billing_rules where id = true;
  select coalesce(a.user_profile_id, f.primary_profile_id) into payer from public.athletes a left join public.families f on f.id = a.family_id where a.id = target_athlete_id;

  update public.athletes set club_status = 'active' where id = target_athlete_id;
  update public.memberships set billing_started_on = current_date, fee_provider = 'stripe', enrolment_fee_cents = case when waive_enrolment then 0 else r.enrolment_cents end, enrolment_fee_status = case when waive_enrolment then 'paid' else 'approved' end where id = m.id;

  if waive_enrolment then
    insert into public.billing_charge_drafts(membership_id,athlete_id,payer_profile_id,charge_kind,scheduled_for,calculated_amount_cents,approved_amount_cents,status,calculation_snapshot)
    values(m.id,target_athlete_id,payer,'enrolment',current_date,0,0,'waived',jsonb_build_object('reason','Matrícula exenta por administración'))
    on conflict do nothing;
  else
    insert into public.billing_charge_drafts(membership_id,athlete_id,payer_profile_id,charge_kind,scheduled_for,calculated_amount_cents,approved_amount_cents,status,calculation_snapshot)
    values(m.id,target_athlete_id,payer,'enrolment',current_date,r.enrolment_cents,r.enrolment_cents,'approved',jsonb_build_object('reason','Matrícula de alta nueva'))
    returning id into enrolment_draft_id;
  end if;

  season_start := case when extract(month from current_date) >= 7 then extract(year from current_date)::int else extract(year from current_date)::int - 1 end;
  if m.plan = 'monthly' then
    cursor_date := greatest(date_trunc('month', current_date)::date, make_date(season_start,9,1));
    if extract(day from current_date) > r.half_rate_through_day then cursor_date := (date_trunc('month', cursor_date) + interval '1 month')::date; end if;
    while cursor_date <= make_date(season_start + 1,6,1) loop
      amount := case when cursor_date = date_trunc('month', current_date)::date and extract(day from current_date) > r.full_rate_through_day then round(r.monthly_cents / 2.0) else r.monthly_cents end;
      insert into public.billing_charge_drafts(membership_id,athlete_id,payer_profile_id,charge_kind,period_starts_on,period_ends_on,scheduled_for,calculated_amount_cents,approved_amount_cents,status,calculation_snapshot)
      values(m.id,target_athlete_id,payer,'recurring',cursor_date,(cursor_date + interval '1 month - 1 day')::date,cursor_date,amount,amount,'awaiting_admin',jsonb_build_object('plan','monthly','automatic',true)) on conflict do nothing;
      cursor_date := (cursor_date + interval '1 month')::date;
    end loop;
  else
    foreach cursor_date in array array[make_date(season_start,9,1),make_date(season_start,12,1),make_date(season_start + 1,3,1)] loop
      if cursor_date >= date_trunc('month', current_date)::date then
        period_start := cursor_date; period_end := case when extract(month from cursor_date)=3 then make_date(season_start+1,6,30) else (cursor_date + interval '3 months - 1 day')::date end;
        amount := case when extract(month from cursor_date)=9 then r.term_autumn_cents when extract(month from cursor_date)=12 then r.term_winter_cents else r.term_spring_cents end;
        insert into public.billing_charge_drafts(membership_id,athlete_id,payer_profile_id,charge_kind,period_starts_on,period_ends_on,scheduled_for,calculated_amount_cents,approved_amount_cents,status,calculation_snapshot)
        values(m.id,target_athlete_id,payer,'recurring',period_start,period_end,cursor_date,amount,amount,'awaiting_admin',jsonb_build_object('plan','term','automatic',true)) on conflict do nothing;
      end if;
    end loop;
  end if;
  athlete_id := target_athlete_id;
  return next;
end $$;

revoke all on function public.approve_registration_and_schedule(uuid,boolean) from public;
grant execute on function public.approve_registration_and_schedule(uuid,boolean) to authenticated;

create or replace function public.sync_billing_authorization()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.status = 'approved' and old.status is distinct from 'approved' and new.charge_kind = 'recurring' then
    update public.memberships set billing_authorized = true, billing_authorized_at = now(), billing_authorized_by = auth.uid() where id = new.membership_id;
    new.approved_by := coalesce(new.approved_by, auth.uid()); new.approved_at := coalesce(new.approved_at, now());
  end if;
  if new.status = 'paid' and old.status is distinct from 'paid' and new.charge_kind = 'enrolment' then
    update public.memberships set enrolment_fee_status = 'paid' where id = new.membership_id;
  end if;
  new.updated_at := now(); return new;
end $$;
