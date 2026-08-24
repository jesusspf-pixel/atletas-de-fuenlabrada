-- Estado técnico del colector automático de resultados FAM/RFEA.
-- El histórico se recorre por meses, sin lanzar una carga grande de golpe.

alter table public.federation_import_settings
  add column if not exists history_cursor_month date,
  add column if not exists fam_last_scan_at timestamptz,
  add column if not exists rfea_last_scan_at timestamptz,
  add column if not exists import_job_last_error text;

update public.federation_import_settings
set history_cursor_month = coalesce(history_cursor_month, date_trunc('month', history_from)::date)
where id = true;
