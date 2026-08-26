create table if not exists public.native_push_subscriptions (
  id uuid primary key default gen_random_uuid(),
  profile_id uuid not null references public.profiles(id) on delete cascade,
  platform text not null check (platform in ('ios','android')),
  token text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(platform, token)
);

alter table public.native_push_subscriptions enable row level security;
revoke all on public.native_push_subscriptions from anon, authenticated;
create index if not exists native_push_subscriptions_profile_idx on public.native_push_subscriptions(profile_id);
