-- La administración decide cómo se calcula el primer cargo recurrente al
-- validar el alta. La elección queda guardada hasta que la matrícula se cobra
-- y el servicio genera el calendario definitivo.
alter table public.memberships
  add column if not exists first_recurring_charge_mode text not null default 'prorated',
  add column if not exists first_recurring_charge_cents integer;

alter table public.memberships
  drop constraint if exists memberships_first_recurring_charge_mode_check,
  add constraint memberships_first_recurring_charge_mode_check
    check (first_recurring_charge_mode in ('prorated', 'full', 'custom')),
  drop constraint if exists memberships_first_recurring_charge_cents_check,
  add constraint memberships_first_recurring_charge_cents_check
    check (first_recurring_charge_cents is null or first_recurring_charge_cents >= 0),
  drop constraint if exists memberships_custom_first_recurring_charge_check,
  add constraint memberships_custom_first_recurring_charge_check
    check (first_recurring_charge_mode <> 'custom' or first_recurring_charge_cents is not null);

create or replace function public.rebuild_membership_fee_schedule(target_membership_id uuid)
returns void language plpgsql security definer set search_path=public as $$
declare
  m public.memberships%rowtype;
  r public.club_billing_rules%rowtype;
  payer uuid;
  season_start int;
  first_due date;
  due date;
  period_start date;
  period_end date;
  amount int;
  base_amount int;
  period_months numeric;
  remaining_months numeric;
  is_first boolean := true;
begin
  if auth.role() <> 'service_role' and not public.is_admin() then
    raise exception 'Solo administración puede programar cuotas.';
  end if;

  select * into m from public.memberships where id=target_membership_id for update;
  if not found then raise exception 'No existe la cuota.'; end if;

  if m.first_recurring_charge_mode = 'custom' and m.first_recurring_charge_cents is null then
    raise exception 'Indica el importe personalizado de la primera cuota.';
  end if;

  select * into r from public.club_billing_rules where id=true;
  select coalesce(a.user_profile_id,f.primary_profile_id)
    into payer
  from public.athletes a
  left join public.families f on f.id=a.family_id
  where a.id=m.athlete_id;

  season_start:=case
    when extract(month from coalesce(m.billing_started_on,current_date))>=7
      then extract(year from coalesce(m.billing_started_on,current_date))::int
    else extract(year from coalesce(m.billing_started_on,current_date))::int-1
  end;

  delete from public.billing_charge_drafts
  where membership_id=m.id
    and charge_kind='recurring'
    and status in ('awaiting_admin','approved','failed','cancelled','waived');

  if m.plan='monthly' then
    if current_date<=make_date(season_start,9,10) then
      first_due:=make_date(season_start,9,10);
    elsif m.first_recurring_charge_mode='prorated'
      and extract(day from current_date)>r.half_rate_through_day then
      first_due:=(date_trunc('month',current_date)+interval '1 month + 4 days')::date;
    else
      first_due:=current_date;
    end if;

    due:=first_due;
    while due<=make_date(season_start+1,6,5) loop
      amount:=r.monthly_cents;
      if is_first then
        if m.first_recurring_charge_mode='custom' then
          amount:=m.first_recurring_charge_cents;
        elsif m.first_recurring_charge_mode='prorated'
          and extract(day from current_date)>r.full_rate_through_day
          and extract(day from current_date)<=r.half_rate_through_day then
          amount:=round(r.monthly_cents/2.0);
        end if;
      end if;

      period_start:=date_trunc('month',due)::date;
      period_end:=(date_trunc('month',due)+interval '1 month - 1 day')::date;
      insert into public.billing_charge_drafts(
        membership_id,athlete_id,payer_profile_id,charge_kind,
        period_starts_on,period_ends_on,scheduled_for,
        calculated_amount_cents,approved_amount_cents,status,calculation_snapshot
      ) values(
        m.id,m.athlete_id,payer,'recurring',period_start,period_end,due,
        amount,amount,'approved',
        jsonb_build_object(
          'plan','monthly','automatic',true,'approval','registration',
          'first_charge',is_first,'first_charge_mode',m.first_recurring_charge_mode,
          'admin_custom_amount',m.first_recurring_charge_mode='custom'
        )
      ) on conflict do nothing;

      is_first:=false;
      due:=case
        when extract(month from due)=9 then make_date(season_start,10,5)
        else (date_trunc('month',due)+interval '1 month + 4 days')::date
      end;
    end loop;
  else
    foreach due in array array[
      case
        when current_date<=make_date(season_start,9,10) then make_date(season_start,9,10)
        when extract(month from current_date) between 9 and 11 then current_date
        else null
      end,
      make_date(season_start,12,5),
      make_date(season_start+1,3,5)
    ] loop
      if due is not null and due>=current_date then
        if extract(month from due)=12 then
          base_amount:=r.term_winter_cents;
          period_start:=make_date(season_start,12,1);
          period_end:=make_date(season_start+1,2,28);
        elsif extract(month from due)=3 then
          base_amount:=r.term_spring_cents;
          period_start:=make_date(season_start+1,3,1);
          period_end:=make_date(season_start+1,6,30);
        else
          base_amount:=r.term_autumn_cents;
          period_start:=make_date(season_start,9,1);
          period_end:=make_date(season_start,11,30);
        end if;

        amount:=base_amount;
        if is_first then
          if m.first_recurring_charge_mode='custom' then
            amount:=m.first_recurring_charge_cents;
          elsif m.first_recurring_charge_mode='prorated' and current_date>period_start then
            period_months :=
              (extract(year from age(period_end,period_start))::int * 12)
              + extract(month from age(period_end,period_start))::int + 1;
            remaining_months :=
              (extract(year from age(period_end,date_trunc('month',current_date)::date))::int * 12)
              + extract(month from age(period_end,date_trunc('month',current_date)::date))::int + 1;
            if extract(day from current_date)>r.half_rate_through_day then
              remaining_months:=remaining_months-1;
            elsif extract(day from current_date)>r.full_rate_through_day then
              remaining_months:=remaining_months-0.5;
            end if;
            amount:=greatest(0,round(base_amount*remaining_months/period_months));
          end if;
        end if;

        insert into public.billing_charge_drafts(
          membership_id,athlete_id,payer_profile_id,charge_kind,
          period_starts_on,period_ends_on,scheduled_for,
          calculated_amount_cents,approved_amount_cents,status,calculation_snapshot
        ) values(
          m.id,m.athlete_id,payer,'recurring',period_start,period_end,due,
          amount,amount,'approved',
          jsonb_build_object(
            'plan','term','automatic',true,'approval','registration',
            'first_charge',is_first,'first_charge_mode',m.first_recurring_charge_mode,
            'admin_custom_amount',m.first_recurring_charge_mode='custom',
            'full_period_amount_cents',base_amount
          )
        ) on conflict do nothing;

        is_first:=false;
      end if;
    end loop;
  end if;
end $$;

revoke all on function public.rebuild_membership_fee_schedule(uuid) from public;
grant execute on function public.rebuild_membership_fee_schedule(uuid) to authenticated,service_role;

comment on column public.memberships.first_recurring_charge_mode is
  'Criterio elegido al validar el alta: prorrateo por fecha, periodo completo o importe personalizado.';
comment on column public.memberships.first_recurring_charge_cents is
  'Importe exacto, en céntimos, de la primera cuota recurrente cuando el modo es custom.';
