-- Prioriza el ranking oficial de la temporada en curso antes del histórico.
alter table public.federation_import_settings
  add column if not exists history_backfill_stage text not null default '2026'
    check (history_backfill_stage in ('2026', '2025', '2024', 'complete'));

update public.federation_import_settings
set
  history_backfill_stage = '2026',
  history_cursor_month = date '2026-01-01',
  import_job_last_error = null
where id = true
  and coalesce(fam_last_scan_at, 'epoch'::timestamptz) < '2026-08-24T17:00:00Z'::timestamptz;
