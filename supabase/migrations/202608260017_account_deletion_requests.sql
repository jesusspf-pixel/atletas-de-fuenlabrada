create table if not exists public.account_deletion_requests (
  id uuid primary key default gen_random_uuid(),
  profile_id uuid not null unique references public.profiles(id) on delete cascade,
  email text,
  status text not null default 'requested' check (status in ('requested','processing','completed','cancelled')),
  requested_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  completed_at timestamptz
);

alter table public.account_deletion_requests enable row level security;
revoke all on public.account_deletion_requests from anon, authenticated;
create index if not exists account_deletion_requests_status_idx on public.account_deletion_requests(status, requested_at);
