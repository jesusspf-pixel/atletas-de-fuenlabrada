-- Horario oficial Sub-14 para todas sus variantes y pantallas.
update public.training_groups
set schedule_days = 'Lunes a jueves',
    starts_at = '19:00',
    ends_at = '20:00'
where lower(category_label) like 'sub 14%'
   or lower(name) like 'sub 14%';
