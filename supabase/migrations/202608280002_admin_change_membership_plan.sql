create or replace function public.change_membership_billing_plan(
  target_membership_id uuid,
  target_plan text
) returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  current_membership public.memberships%rowtype;
begin
  if not public.is_admin() then
    raise exception 'Solo administración puede cambiar el plan de cuotas.';
  end if;
  if target_plan not in ('monthly', 'term') then
    raise exception 'El plan de cuotas no es válido.';
  end if;

  select * into current_membership
  from public.memberships
  where id = target_membership_id
  for update;
  if not found then raise exception 'No se ha encontrado la cuota del atleta.'; end if;
  if current_membership.plan = target_plan then return; end if;

  update public.memberships
  set plan = target_plan,
      billing_updated_at = now()
  where id = target_membership_id;

  -- rebuild_membership_fee_schedule removes only non-paid recurring drafts.
  -- Paid movements and the enrolment charge remain immutable history.
  perform public.rebuild_membership_fee_schedule(target_membership_id);

  insert into public.audit_log(actor_id, entity_type, entity_id, action, metadata)
  values (
    auth.uid(), 'membership', target_membership_id, 'billing_plan_changed',
    jsonb_build_object('from', current_membership.plan, 'to', target_plan)
  );
end;
$$;

revoke all on function public.change_membership_billing_plan(uuid,text) from public;
grant execute on function public.change_membership_billing_plan(uuid,text) to authenticated;
