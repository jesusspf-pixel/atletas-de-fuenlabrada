-- Horario oficial 2026/27 para los grupos de competición desde Sub 16.
-- Running conserva su horario propio aunque su categoría sea Absoluto / Máster.
update public.training_groups
set
  schedule_days = 'Lunes a jueves',
  starts_at = '19:00',
  ends_at = '21:00'
where active = true
  and lower(coalesce(name, '') || ' ' || coalesce(category_label, '')) !~ 'running'
  and lower(coalesce(name, '') || ' ' || coalesce(category_label, ''))
    ~ 'sub[ -]?(16|18|20|23)|absolut';
