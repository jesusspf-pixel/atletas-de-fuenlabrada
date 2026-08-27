-- PostgreSQL infiere las ramas de CASE como text. La columna usa el enum
-- public.club_status, por lo que el resultado debe tiparse explícitamente.
create or replace function public.approve_registration_and_schedule(target_athlete_id uuid, waive_enrolment boolean default false)
returns table(enrolment_draft_id uuid, athlete_id uuid)
language plpgsql security definer set search_path=public as $$
declare
  m public.memberships%rowtype;
  payer uuid;
  fee_cents integer;
  category text;
  effective_waive boolean;
begin
  if not public.is_admin() then raise exception 'Solo administración puede validar una inscripción.'; end if;
  select ms.* into m from public.memberships ms where ms.athlete_id=target_athlete_id order by ms.created_at desc limit 1 for update;
  if not found then raise exception 'No se ha encontrado la cuota de este atleta.'; end if;
  select coalesce(a.user_profile_id,f.primary_profile_id),coalesce(a.training_category,tg.category_label)
    into payer,category
  from public.athletes a left join public.families f on f.id=a.family_id left join public.training_groups tg on tg.id=a.training_group_id
  where a.id=target_athlete_id;
  effective_waive := waive_enrolment or m.enrolment_fee_status='paid';
  fee_cents := coalesce(m.enrolment_fee_cents,public.enrolment_fee_for_athlete(target_athlete_id));
  update public.athletes
    set club_status=(case when effective_waive then 'active' else 'pending_review' end)::public.club_status
    where id=target_athlete_id;
  update public.memberships set billing_started_on=case when effective_waive then coalesce(billing_started_on,current_date) else null end,
    fee_provider=case when effective_waive then 'stripe' else 'paused' end,
    enrolment_fee_cents=case when effective_waive then 0 else fee_cents end,
    enrolment_fee_status=case when effective_waive then 'paid' else 'awaiting_admin' end where id=m.id;
  if effective_waive then
    insert into public.billing_charge_drafts(membership_id,athlete_id,payer_profile_id,charge_kind,scheduled_for,calculated_amount_cents,approved_amount_cents,status,calculation_snapshot)
    values(m.id,target_athlete_id,payer,'enrolment',current_date,0,0,'waived',jsonb_build_object('reason','Matrícula exenta')) on conflict do nothing;
    perform public.rebuild_membership_fee_schedule(m.id);
  else
    select d.id into enrolment_draft_id from public.billing_charge_drafts d where d.membership_id=m.id and d.charge_kind='enrolment' and d.status in ('approved','failed') order by d.created_at desc limit 1;
    if enrolment_draft_id is null and not exists(select 1 from public.billing_charge_drafts d where d.membership_id=m.id and d.charge_kind='enrolment' and d.status='paid') then
      insert into public.billing_charge_drafts(membership_id,athlete_id,payer_profile_id,charge_kind,scheduled_for,calculated_amount_cents,approved_amount_cents,status,calculation_snapshot)
      values(m.id,target_athlete_id,payer,'enrolment',current_date,fee_cents,fee_cents,'approved',jsonb_build_object('reason','Alta nueva','category',category,'payment_first',true)) returning id into enrolment_draft_id;
    elsif enrolment_draft_id is not null then
      update public.billing_charge_drafts set status='approved',calculated_amount_cents=fee_cents,approved_amount_cents=fee_cents,next_attempt_at=null,updated_at=now() where id=enrolment_draft_id;
    end if;
  end if;
  athlete_id:=target_athlete_id;
  return next;
end $$;

revoke all on function public.approve_registration_and_schedule(uuid,boolean) from public;
grant execute on function public.approve_registration_and_schedule(uuid,boolean) to authenticated;
