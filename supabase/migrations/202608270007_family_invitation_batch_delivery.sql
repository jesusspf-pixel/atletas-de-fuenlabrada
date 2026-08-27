create table if not exists public.family_invitation_delivery_batches (
  id uuid primary key default gen_random_uuid(),
  token uuid not null default gen_random_uuid() unique,
  created_by uuid not null references public.profiles(id),
  status text not null default 'pending' check (status in ('pending','processing','completed','partial','failed')),
  total_count integer not null default 0,
  sent_count integer not null default 0,
  failed_count integer not null default 0,
  result jsonb not null default '{}'::jsonb,
  expires_at timestamptz not null default now() + interval '1 day',
  created_at timestamptz not null default now(),
  completed_at timestamptz
);

alter table public.family_invitation_delivery_batches enable row level security;
drop policy if exists "invitation batches admins read" on public.family_invitation_delivery_batches;
create policy "invitation batches admins read" on public.family_invitation_delivery_batches
for select using (public.is_admin());

alter table public.family_renewal_invitations
  add column if not exists delivery_batch_id uuid references public.family_invitation_delivery_batches(id),
  add column if not exists delivery_status text not null default 'pending' check (delivery_status in ('pending','sending','sent','failed')),
  add column if not exists delivery_error text,
  add column if not exists delivered_at timestamptz;

create index if not exists family_renewal_invitations_delivery_batch_idx
on public.family_renewal_invitations(delivery_batch_id);
