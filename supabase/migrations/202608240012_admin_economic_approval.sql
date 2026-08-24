-- Respeta el importe final de matrícula fijado por administración antes de validar el alta.
create or replace function public.approve_registration_and_schedule(target_athlete_id uuid, waive_enrolment boolean default false)
returns table(enrolment_draft_id uuid, athlete_id uuid)
language plpgsql security definer set search_path=public as $$
declare
  m public.memberships%rowtype;
  payer uuid;
  fee_cents integer;
  category text;
begin
  if not public.is_admin() then
    raise exception 'Solo administración puede validar una inscripción.';
  end if;

  select ms.* into m
  from public.memberships ms
  where ms.athlete_id=target_athlete_id
  order by ms.created_at desc
  limit 1
  for update;

  if not found then
    raise exception 'No se ha encontrado la cuota de este atleta.';
  end if;

  select coalesce(a.user_profile_id,f.primary_profile_id),coalesce(a.training_category,tg.category_label)
  into payer,category
  from public.athletes a
  left join public.families f on f.id=a.family_id
  left join public.training_groups tg on tg.id=a.training_group_id
  where a.id=target_athlete_id;

  -- Administración puede ajustar la matrícula antes de aprobar.
  fee_cents := coalesce(m.enrolment_fee_cents, public.enrolment_fee_for_category(category));

  update public.athletes
  set club_status='active'
  where id=target_athlete_id;

  update public.memberships
  set billing_started_on=coalesce(billing_started_on,current_date),
      fee_provider='stripe',
      enrolment_fee_cents=case when waive_enrolment then 0 else fee_cents end,
      enrolment_fee_status=case when waive_enrolment then 'paid' else enrolment_fee_status end
  where id=m.id;

  if waive_enrolment then
    insert into public.billing_charge_drafts(
      membership_id,athlete_id,payer_profile_id,charge_kind,scheduled_for,
      calculated_amount_cents,approved_amount_cents,status,calculation_snapshot
    )
    values(
      m.id,target_athlete_id,payer,'enrolment',current_date,0,0,'waived',
      jsonb_build_object('reason','Matrícula exenta')
    )
    on conflict do nothing;
  else
    select d.id into enrolment_draft_id
    from public.billing_charge_drafts d
    where d.membership_id=m.id
      and d.charge_kind='enrolment'
      and d.status='approved'
    order by d.created_at desc
    limit 1;

    if enrolment_draft_id is null
      and not exists(
        select 1 from public.billing_charge_drafts d
        where d.membership_id=m.id
          and d.charge_kind='enrolment'
          and d.status='paid'
      )
    then
      insert into public.billing_charge_drafts(
        membership_id,athlete_id,payer_profile_id,charge_kind,scheduled_for,
        calculated_amount_cents,approved_amount_cents,status,calculation_snapshot
      )
      values(
        m.id,target_athlete_id,payer,'enrolment',current_date,fee_cents,fee_cents,'approved',
        jsonb_build_object('reason','Alta nueva','category',category,'admin_adjusted',m.enrolment_fee_cents is not null)
      )
      returning id into enrolment_draft_id;
    end if;
  end if;

  perform public.rebuild_membership_fee_schedule(m.id);
  athlete_id:=target_athlete_id;
  return next;
end $$;
