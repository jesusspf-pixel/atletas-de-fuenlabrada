create table if not exists public.club_financial_entries (
  id uuid primary key default gen_random_uuid(),
  entry_type text not null check (entry_type in ('income','expense')),
  status text not null default 'paid' check (status in ('forecast','paid','cancelled')),
  entry_date date not null default current_date,
  category text not null,
  concept text not null,
  counterparty text,
  amount_cents integer not null check (amount_cents >= 0),
  payment_method text not null default 'bank_transfer',
  reference text,
  notes text,
  season text not null default '2026-2027',
  created_by uuid not null default auth.uid() references public.profiles(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists club_financial_entries_date_idx on public.club_financial_entries(entry_date desc);
create index if not exists club_financial_entries_type_status_idx on public.club_financial_entries(entry_type,status);
alter table public.club_financial_entries enable row level security;

drop policy if exists "financial entries admin read" on public.club_financial_entries;
create policy "financial entries admin read" on public.club_financial_entries for select using (public.is_admin());
drop policy if exists "financial entries admin insert" on public.club_financial_entries;
create policy "financial entries admin insert" on public.club_financial_entries for insert with check (public.is_admin());
drop policy if exists "financial entries admin update" on public.club_financial_entries;
create policy "financial entries admin update" on public.club_financial_entries for update using (public.is_admin()) with check (public.is_admin());
drop policy if exists "financial entries admin delete" on public.club_financial_entries;
create policy "financial entries admin delete" on public.club_financial_entries for delete using (public.is_admin());

