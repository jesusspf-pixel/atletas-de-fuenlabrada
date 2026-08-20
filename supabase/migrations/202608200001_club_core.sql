-- Club Atletas de Fuenlabrada: núcleo multirol y trazabilidad.
-- Ejecutar en Supabase SQL Editor antes de abrir inscripciones.
create extension if not exists pgcrypto;

create type public.user_role as enum ('owner','admin','coach','parent','adult_athlete','minor_athlete');
create type public.club_status as enum ('draft','pending_review','active','inactive','withdrawn');
create type public.license_status as enum ('pending','active','rejected','expired');
create type public.invitation_status as enum ('pending','accepted','expired','revoked');
create type public.payment_status as enum ('draft','awaiting_admin','approved','paid','failed','void');

create table public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  email text not null,
  full_name text,
  phone text,
  role public.user_role not null default 'parent',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.families (
  id uuid primary key default gen_random_uuid(),
  primary_profile_id uuid not null references public.profiles(id),
  relationship_to_athlete text not null check (relationship_to_athlete in ('padre','madre','tutor_legal')),
  dni_nie text not null,
  address_line text not null,
  postal_code text not null,
  locality text not null,
  province text not null,
  emergency_phone text,
  created_at timestamptz not null default now()
);

create table public.training_groups (
  id uuid primary key default gen_random_uuid(),
  name text not null unique,
  category_label text not null,
  coach_profile_id uuid references public.profiles(id),
  colour text not null default '#2563eb',
  active boolean not null default true,
  created_at timestamptz not null default now()
);

create table public.athletes (
  id uuid primary key default gen_random_uuid(),
  family_id uuid references public.families(id) on delete set null,
  user_profile_id uuid unique references public.profiles(id) on delete set null,
  first_name text not null,
  last_name text not null,
  birth_date date not null,
  federative_sex text not null check (federative_sex in ('M','F')),
  dni_nie text,
  club_status public.club_status not null default 'draft',
  license_status public.license_status not null default 'pending',
  license_number text,
  official_competition_category text,
  training_category text,
  training_group_id uuid references public.training_groups(id),
  medical_notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.health_declarations (
  id uuid primary key default gen_random_uuid(),
  athlete_id uuid not null references public.athletes(id) on delete cascade,
  relevant_condition boolean not null default false,
  relevant_condition_detail text,
  asthma_allergy_medication text,
  injury_limitation text,
  support_needs text,
  additional_notes text,
  declared_by uuid not null references public.profiles(id),
  created_at timestamptz not null default now()
);

create table public.consents (
  id uuid primary key default gen_random_uuid(),
  athlete_id uuid not null references public.athletes(id) on delete cascade,
  consent_type text not null check (consent_type in ('privacy','health_data','image_use','fam_data','club_rules','recurring_payment')),
  document_version text not null,
  accepted_by uuid not null references public.profiles(id),
  accepted_at timestamptz not null default now(),
  unique (athlete_id, consent_type, document_version)
);

create table public.invitations (
  id uuid primary key default gen_random_uuid(),
  email text,
  token uuid not null default gen_random_uuid() unique,
  created_by uuid not null references public.profiles(id),
  role public.user_role not null check (role in ('admin','coach','parent','adult_athlete')),
  enrolment_fee_state text check (enrolment_fee_state in ('paid','pending')),
  status public.invitation_status not null default 'pending',
  expires_at timestamptz not null default now() + interval '30 days',
  accepted_at timestamptz,
  created_at timestamptz not null default now()
);

create table public.memberships (
  id uuid primary key default gen_random_uuid(),
  athlete_id uuid not null references public.athletes(id) on delete cascade,
  season text not null,
  plan text not null check (plan in ('monthly','term')),
  enrolment_fee_status public.payment_status not null default 'awaiting_admin',
  fee_provider text not null default 'stripe' check (fee_provider in ('stripe','santander','paused')),
  starts_on date not null,
  ends_on date,
  created_at timestamptz not null default now(),
  unique (athlete_id, season)
);

create table public.payment_ledger (
  id uuid primary key default gen_random_uuid(),
  athlete_id uuid not null references public.athletes(id) on delete cascade,
  membership_id uuid references public.memberships(id) on delete set null,
  kind text not null check (kind in ('enrolment','monthly_fee','term_fee','shop','credit','adjustment')),
  description text not null,
  amount_cents integer not null,
  scheduled_for date,
  status public.payment_status not null default 'draft',
  provider text not null default 'stripe' check (provider in ('stripe','santander','manual')),
  provider_reference text,
  approved_by uuid references public.profiles(id),
  approved_at timestamptz,
  created_at timestamptz not null default now()
);

create table public.attendance_sessions (
  id uuid primary key default gen_random_uuid(),
  training_group_id uuid not null references public.training_groups(id),
  starts_at timestamptz not null,
  ends_at timestamptz,
  created_by uuid not null references public.profiles(id),
  created_at timestamptz not null default now()
);

create table public.attendance_records (
  id uuid primary key default gen_random_uuid(),
  session_id uuid not null references public.attendance_sessions(id) on delete cascade,
  athlete_id uuid not null references public.athletes(id) on delete cascade,
  intention_to_attend boolean,
  attended boolean,
  marked_by uuid references public.profiles(id),
  marked_at timestamptz,
  unique (session_id, athlete_id)
);

create table public.audit_log (
  id bigint generated always as identity primary key,
  actor_id uuid references public.profiles(id),
  entity_type text not null,
  entity_id uuid,
  action text not null,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

alter table public.profiles enable row level security;
alter table public.families enable row level security;
alter table public.athletes enable row level security;
alter table public.health_declarations enable row level security;
alter table public.consents enable row level security;
alter table public.training_groups enable row level security;
alter table public.invitations enable row level security;
alter table public.memberships enable row level security;
alter table public.payment_ledger enable row level security;
alter table public.attendance_sessions enable row level security;
alter table public.attendance_records enable row level security;

create or replace function public.is_staff()
returns boolean language sql stable security definer set search_path = public
as $$ select exists (select 1 from public.profiles where id = auth.uid() and role in ('owner','admin','coach')) $$;

create policy "profiles own or staff" on public.profiles for select using (id = auth.uid() or public.is_staff());
create policy "athletes family or staff" on public.athletes for select using (
  public.is_staff() or user_profile_id = auth.uid() or exists (
    select 1 from public.families f where f.id = family_id and f.primary_profile_id = auth.uid()
  )
);
create policy "families own or staff" on public.families for select using (primary_profile_id = auth.uid() or public.is_staff());
create policy "health restricted" on public.health_declarations for select using (public.is_staff() or exists (
  select 1 from public.athletes a join public.families f on f.id = a.family_id
  where a.id = athlete_id and f.primary_profile_id = auth.uid()
));
create policy "consents own or staff" on public.consents for select using (public.is_staff() or accepted_by = auth.uid());
create policy "groups visible to members" on public.training_groups for select using (auth.uid() is not null);
create policy "memberships family or staff" on public.memberships for select using (public.is_staff() or exists (
  select 1 from public.athletes a join public.families f on f.id = a.family_id
  where a.id = athlete_id and f.primary_profile_id = auth.uid()
));
create policy "ledger family or staff" on public.payment_ledger for select using (public.is_staff() or exists (
  select 1 from public.athletes a join public.families f on f.id = a.family_id
  where a.id = athlete_id and f.primary_profile_id = auth.uid()
));
create policy "attendance family or staff" on public.attendance_records for select using (public.is_staff() or exists (
  select 1 from public.athletes a join public.families f on f.id = a.family_id
  where a.id = athlete_id and f.primary_profile_id = auth.uid()
));
