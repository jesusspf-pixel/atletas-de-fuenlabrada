-- Ajuste final: la matrícula de alta nueva suma 5 € a la tarifa de renovación.
-- No modifica matrículas ya abonadas.

create or replace function public.enrolment_fee_for_category(raw_category text)
returns integer language plpgsql immutable as $$
declare category text := lower(replace(replace(coalesce(raw_category,''),'á','a'),'é','e'));
begin
  if category ~ 'sub[ -]?6' then return 4500; end if;
  if category ~ 'sub[ -]?(8|10|12|14|16)' then return 6500; end if;
  if category ~ 'sub[ -]?(18|20)' then return 7500; end if;
  if category ~ 'sub[ -]?23|absoluto' then return 9500; end if;
  if category ~ 'master|running' then
    if category ~ 'running|sin licencia' then return 4500; end if;
    return 9500;
  end if;
  raise exception 'No se ha podido calcular la matrícula: categoría sin tarifa (%).', raw_category;
end $$;

-- Actualiza solo altas aún no cobradas y sus borradores no pagados.
update public.memberships m
set enrolment_fee_cents=public.enrolment_fee_for_category(coalesce(a.training_category,tg.category_label))
from public.athletes a left join public.training_groups tg on tg.id=a.training_group_id
where a.id=m.athlete_id and m.enrolment_fee_status is distinct from 'paid';

update public.billing_charge_drafts d
set calculated_amount_cents=m.enrolment_fee_cents,
    approved_amount_cents=m.enrolment_fee_cents,
    calculation_snapshot=coalesce(d.calculation_snapshot,'{}'::jsonb)||jsonb_build_object('reason','Matrícula de alta nueva 2026/27')
from public.memberships m
where d.membership_id=m.id
  and d.charge_kind='enrolment'
  and d.status in ('awaiting_admin','approved');
