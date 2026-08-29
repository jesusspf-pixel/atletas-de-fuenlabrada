create table if not exists public.billing_automation_runs(
  id uuid primary key default gen_random_uuid(),
  started_at timestamptz not null default now(),
  completed_at timestamptz,
  status text not null default 'running' check(status in ('running','completed','failed')),
  processed_count integer not null default 0,
  paid_count integer not null default 0,
  failed_count integer not null default 0,
  error_message text,
  trigger_source text not null default 'scheduled'
);

create index if not exists billing_automation_runs_started_at_idx
  on public.billing_automation_runs(started_at desc);

alter table public.billing_automation_runs enable row level security;
drop policy if exists "billing automation runs admins read" on public.billing_automation_runs;
create policy "billing automation runs admins read"
  on public.billing_automation_runs for select
  using (public.is_admin());

revoke all on public.billing_automation_runs from anon;
revoke insert,update,delete on public.billing_automation_runs from authenticated;
grant select on public.billing_automation_runs to authenticated;
grant all on public.billing_automation_runs to service_role;
