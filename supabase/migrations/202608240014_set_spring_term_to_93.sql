-- La cuota trimestral de marzo a junio cubre cuatro meses: 93 €.
update public.club_billing_rules
set term_spring_cents = 9300,
    updated_at = now()
where id = true;

-- Corrige los calendarios ya programados que aún no se han cobrado.
update public.billing_charge_drafts
set calculated_amount_cents = 9300,
    approved_amount_cents = 9300,
    calculation_snapshot = coalesce(calculation_snapshot, '{}'::jsonb) || jsonb_build_object('term_spring_amount_cents', 9300)
where charge_kind = 'recurring'
  and calculation_snapshot ->> 'plan' = 'term'
  and extract(month from period_starts_on) = 3
  and status in ('awaiting_admin','approved','failed','cancelled','waived');
