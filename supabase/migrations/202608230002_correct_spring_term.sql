-- Corrige el valor inicial del cuatrimestre marzo-junio.
-- 70 € cada tres meses equivale a 93,33 € para cuatro meses.
update public.club_billing_rules
set term_spring_cents = 9333, updated_at = now()
where id = true and term_spring_cents = 7000;
