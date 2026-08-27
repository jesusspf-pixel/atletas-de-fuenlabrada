-- La finalización posterior al pago la ejecuta service_role. El generador de
-- calendario debe aceptar tanto al servicio como a un administrador humano.
create or replace function public.rebuild_membership_fee_schedule(target_membership_id uuid)
returns void language plpgsql security definer set search_path=public as $$
declare m public.memberships%rowtype; r public.club_billing_rules%rowtype; payer uuid; season_start int; first_due date; due date; period_end date; amount int;
begin
 if auth.role() <> 'service_role' and not public.is_admin() then raise exception 'Solo administración puede programar cuotas.'; end if;
 select * into m from public.memberships where id=target_membership_id for update; if not found then raise exception 'No existe la cuota.'; end if;
 select * into r from public.club_billing_rules where id=true; select coalesce(a.user_profile_id,f.primary_profile_id) into payer from public.athletes a left join public.families f on f.id=a.family_id where a.id=m.athlete_id;
 season_start:=case when extract(month from coalesce(m.billing_started_on,current_date))>=7 then extract(year from coalesce(m.billing_started_on,current_date))::int else extract(year from coalesce(m.billing_started_on,current_date))::int-1 end;
 delete from public.billing_charge_drafts where membership_id=m.id and charge_kind='recurring' and status in ('awaiting_admin','approved','failed','cancelled','waived');
 if m.plan='monthly' then
  if current_date<=make_date(season_start,9,10) then first_due:=make_date(season_start,9,10);
  elsif extract(month from current_date)=9 and extract(day from current_date)<=r.half_rate_through_day then first_due:=current_date;
  elsif extract(month from current_date)=9 then first_due:=make_date(season_start,10,5);
  else first_due:=current_date; end if;
  due:=first_due;
  while due<=make_date(season_start+1,6,5) loop
   amount:=r.monthly_cents; if due=first_due and extract(day from current_date)>r.full_rate_through_day and extract(day from current_date)<=r.half_rate_through_day then amount:=round(r.monthly_cents/2.0); end if;
   period_end:=(date_trunc('month',due)+interval '1 month - 1 day')::date;
   insert into public.billing_charge_drafts(membership_id,athlete_id,payer_profile_id,charge_kind,period_starts_on,period_ends_on,scheduled_for,calculated_amount_cents,approved_amount_cents,status,calculation_snapshot)
   values(m.id,m.athlete_id,payer,'recurring',date_trunc('month',due)::date,period_end,due,amount,amount,'approved',jsonb_build_object('plan','monthly','automatic',true,'approval','registration')) on conflict do nothing;
   due:=case when extract(month from due)=9 then make_date(season_start,10,5) else (date_trunc('month',due)+interval '1 month + 4 days')::date end;
  end loop;
 else
  foreach due in array array[case when current_date<=make_date(season_start,9,10) then make_date(season_start,9,10) when extract(month from current_date) between 9 and 11 then current_date else null end,make_date(season_start,12,5),make_date(season_start+1,3,5)] loop
   if due is not null and due>=current_date then
    amount:=case when extract(month from due)=12 then r.term_winter_cents when extract(month from due)=3 then r.term_spring_cents else r.term_autumn_cents end;
    period_end:=case when extract(month from due)=3 then make_date(season_start+1,6,30) when extract(month from due)=12 then make_date(season_start+1,2,28) else make_date(season_start,11,30) end;
    insert into public.billing_charge_drafts(membership_id,athlete_id,payer_profile_id,charge_kind,period_starts_on,period_ends_on,scheduled_for,calculated_amount_cents,approved_amount_cents,status,calculation_snapshot)
    values(m.id,m.athlete_id,payer,'recurring',date_trunc('month',due)::date,period_end,due,amount,amount,'approved',jsonb_build_object('plan','term','automatic',true,'approval','registration')) on conflict do nothing;
   end if;
  end loop;
 end if;
end $$;

revoke all on function public.rebuild_membership_fee_schedule(uuid) from public;
grant execute on function public.rebuild_membership_fee_schedule(uuid) to authenticated,service_role;
