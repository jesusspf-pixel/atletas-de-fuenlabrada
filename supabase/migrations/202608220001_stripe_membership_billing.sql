-- Facturación recurrente de cuotas del club con Stripe.
-- Las tarjetas permanecen exclusivamente en Stripe.

create table if not exists public.stripe_customers (
  profile_id uuid primary key references public.profiles(id) on delete cascade,
  stripe_customer_id text not null unique,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.memberships add column if not exists stripe_subscription_id text;
alter table public.memberships add column if not exists stripe_checkout_session_id text;
alter table public.memberships add column if not exists enrolment_fee_cents integer check (enrolment_fee_cents is null or enrolment_fee_cents >= 0);
alter table public.memberships add column if not exists billing_status text not null default 'not_configured' check (billing_status in ('not_configured','checkout_pending','active','past_due','cancelled','paused'));
alter table public.memberships add column if not exists next_billing_on date;
alter table public.memberships add column if not exists stripe_price_amount_cents integer;
alter table public.memberships add column if not exists billing_updated_at timestamptz;

create unique index if not exists memberships_stripe_subscription_unique
  on public.memberships(stripe_subscription_id)
  where stripe_subscription_id is not null;

create unique index if not exists payment_ledger_provider_reference_unique
  on public.payment_ledger(provider_reference)
  where provider_reference is not null;

alter table public.stripe_customers enable row level security;

drop policy if exists "stripe customer own or admin" on public.stripe_customers;
create policy "stripe customer own or admin" on public.stripe_customers for select using (
  profile_id = auth.uid() or exists (
    select 1 from public.profiles p where p.id = auth.uid() and p.role in ('owner','admin')
  )
);

create or replace function public.can_pay_membership(target_membership_id uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1
    from public.memberships m
    join public.athletes a on a.id = m.athlete_id
    left join public.families f on f.id = a.family_id
    where m.id = target_membership_id
      and (a.user_profile_id = auth.uid() or f.primary_profile_id = auth.uid())
  )
$$;

grant execute on function public.can_pay_membership(uuid) to authenticated;

create table if not exists public.club_billing_prices (
  id boolean primary key default true check (id),
  monthly_cents integer not null default 3500 check (monthly_cents > 0),
  term_cents integer not null default 7000 check (term_cents > 0),
  currency text not null default 'eur',
  updated_at timestamptz not null default now(),
  updated_by uuid references public.profiles(id)
);

insert into public.club_billing_prices(id, monthly_cents, term_cents, currency)
values (true, 3500, 7000, 'eur')
on conflict (id) do nothing;

alter table public.club_billing_prices enable row level security;
drop policy if exists "billing prices readable" on public.club_billing_prices;
drop policy if exists "billing prices admins manage" on public.club_billing_prices;
create policy "billing prices readable" on public.club_billing_prices for select using (auth.uid() is not null);
create policy "billing prices admins manage" on public.club_billing_prices for all using (
  exists (select 1 from public.profiles p where p.id = auth.uid() and p.role in ('owner','admin'))
) with check (
  exists (select 1 from public.profiles p where p.id = auth.uid() and p.role in ('owner','admin'))
);
