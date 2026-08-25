create table if not exists public.push_subscriptions(
  id uuid primary key default gen_random_uuid(), profile_id uuid not null references public.profiles(id) on delete cascade,
  endpoint text not null unique, subscription jsonb not null, user_agent text, created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);
alter table public.push_subscriptions enable row level security;
create policy "push subscription owner manage" on public.push_subscriptions for all using(profile_id=auth.uid()) with check(profile_id=auth.uid());
revoke all on public.push_subscriptions from anon,authenticated;
create index if not exists push_subscriptions_profile_idx on public.push_subscriptions(profile_id);
