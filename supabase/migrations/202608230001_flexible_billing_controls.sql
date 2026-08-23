-- Centro de control de cuotas: cálculo trazable, revisión y autorización previa.
-- No contiene datos de tarjeta; Stripe solo podrá ver importes aprobados por administración.

alter table public.memberships
  add column if not exists billing_started_on date,
  add column if not exists billing_authorized boolean not null default false,
  add column if not exists billing_authorized_at timestamptz,
  add column if not exists billing_authorized_by uuid references public.profiles(id);

create table if not exists public.club_billing_rules (
  id boolean primary key default true check (id),
  monthly_cents integer not null default 3500 check (monthly_cents >= 0),
  term_autumn_cents integer not null default 7000 check (term_autumn_cents >= 0),
  term_winter_cents integer not null default 7000 check (term_winter_cents >= 0),
  term_spring_cents integer not null default 7000 check (term_spring_cents >= 0),
  full_rate_through_day integer not null default 14 check (full_rate_through_day between 1 and 28),
  half_rate_through_day integer not null default 19 check (half_rate_through_day between 1 and 28),
  family_discount_members integer not null default 3 check (family_discount_members >= 1),
  monthly_family_discount_percent numeric(5,2) not null default 10 check (monthly_family_discount_percent between 0 and 100),
  enrolment_family_discount_percent numeric(5,2) not null default 30 check (enrolment_family_discount_percent between 0 and 100),
  currency text not null default 'eur',
  updated_at timestamptz not null default now(),
  updated_by uuid references public.profiles(id)
);

insert into public.club_billing_rules(id) values (true) on conflict (id) do nothing;

create table if not exists public.billing_charge_drafts (
  id uuid primary key default gen_random_uuid(),
  membership_id uuid not null references public.memberships(id) on delete cascade,
  athlete_id uuid not null references public.athletes(id) on delete cascade,
  payer_profile_id uuid references public.profiles(id) on delete set null,
  charge_kind text not null check (charge_kind in ('enrolment','recurring','manual')),
  period_starts_on date,
  period_ends_on date,
  scheduled_for date not null,
  calculated_amount_cents integer not null check (calculated_amount_cents >= 0),
  approved_amount_cents integer check (approved_amount_cents is null or approved_amount_cents >= 0),
  discount_cents integer not null default 0 check (discount_cents >= 0),
  status text not null default 'awaiting_admin' check (status in ('awaiting_admin','approved','checkout_pending','paid','failed','waived','cancelled')),
  calculation_snapshot jsonb not null default '{}'::jsonb,
  admin_note text,
  override_reason text,
  approved_by uuid references public.profiles(id),
  approved_at timestamptz,
  provider_reference text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists billing_charge_drafts_schedule_idx on public.billing_charge_drafts(status, scheduled_for);
create index if not exists billing_charge_drafts_membership_idx on public.billing_charge_drafts(membership_id);

alter table public.club_billing_rules enable row level security;
alter table public.billing_charge_drafts enable row level security;

drop policy if exists "billing rules readable" on public.club_billing_rules;
create policy "billing rules readable" on public.club_billing_rules for select using (auth.uid() is not null);
drop policy if exists "billing rules admins manage" on public.club_billing_rules;
create policy "billing rules admins manage" on public.club_billing_rules for all using (
  exists (select 1 from public.profiles p where p.id = auth.uid() and p.role in ('owner','admin'))
) with check (
  exists (select 1 from public.profiles p where p.id = auth.uid() and p.role in ('owner','admin'))
);

drop policy if exists "billing charge drafts visible to payer or admin" on public.billing_charge_drafts;
create policy "billing charge drafts visible to payer or admin" on public.billing_charge_drafts for select using (
  payer_profile_id = auth.uid()
  or exists (select 1 from public.profiles p where p.id = auth.uid() and p.role in ('owner','admin'))
);
drop policy if exists "billing charge drafts admins manage" on public.billing_charge_drafts;
create policy "billing charge drafts admins manage" on public.billing_charge_drafts for all using (
  exists (select 1 from public.profiles p where p.id = auth.uid() and p.role in ('owner','admin'))
) with check (
  exists (select 1 from public.profiles p where p.id = auth.uid() and p.role in ('owner','admin'))
);

create or replace function public.create_billing_charge_draft(
  target_membership_id uuid,
  target_kind text default 'recurring',
  target_scheduled_for date default current_date
) returns uuid
language plpgsql security definer set search_path = public as $$
declare
  membership_row record;
  rules public.club_billing_rules%rowtype;
  payer_id uuid;
  active_members integer := 0;
  started_on date;
  basis_on date;
  month_no integer;
  period_start date;
  period_end date;
  period_months integer;
  months_remaining numeric;
  base_cents integer := 0;
  discount integer := 0;
  amount integer := 0;
  first_charge boolean;
  draft_id uuid;
begin
  if not exists (select 1 from public.profiles p where p.id = auth.uid() and p.role in ('owner','admin')) then
    raise exception 'Solo administración puede preparar cobros';
  end if;

  select ms.id, ms.athlete_id, ms.plan, ms.enrolment_fee_cents, ms.enrolment_fee_status,
         coalesce(ms.billing_started_on, ms.created_at::date) as started_on,
         a.user_profile_id, f.primary_profile_id
    into membership_row
    from public.memberships ms
    join public.athletes a on a.id = ms.athlete_id
    left join public.families f on f.id = a.family_id
   where ms.id = target_membership_id;
  if not found then raise exception 'No existe la cuota seleccionada'; end if;

  select * into rules from public.club_billing_rules where id = true;
  payer_id := coalesce(membership_row.user_profile_id, membership_row.primary_profile_id);
  started_on := membership_row.started_on;
  first_charge := not exists (
    select 1 from public.billing_charge_drafts d
     where d.membership_id = target_membership_id
       and d.charge_kind in ('enrolment','recurring')
       and d.status not in ('cancelled','waived')
  );

  if payer_id is not null then
    select count(*) into active_members
    from public.athletes a
    left join public.families f on f.id = a.family_id
    where a.club_status = 'active'
      and (a.user_profile_id = payer_id or f.primary_profile_id = payer_id);
  end if;

  if target_kind = 'enrolment' then
    base_cents := case when membership_row.enrolment_fee_status = 'paid' then 0 else coalesce(membership_row.enrolment_fee_cents, 0) end;
    if active_members >= rules.family_discount_members then
      discount := round(base_cents * rules.enrolment_family_discount_percent / 100.0);
    end if;
  elsif target_kind = 'recurring' then
    basis_on := case when first_charge then started_on else target_scheduled_for end;
    if membership_row.plan = 'monthly' then
      base_cents := rules.monthly_cents;
      period_start := date_trunc('month', basis_on)::date;
      period_end := (period_start + interval '1 month - 1 day')::date;
      if first_charge then
        if extract(day from basis_on) <= rules.full_rate_through_day then
          null;
        elsif extract(day from basis_on) <= rules.half_rate_through_day then
          base_cents := round(base_cents / 2.0);
        else
          base_cents := 0;
          period_start := (period_start + interval '1 month')::date;
          period_end := (period_start + interval '1 month - 1 day')::date;
        end if;
      end if;
      if active_members >= rules.family_discount_members then
        discount := round(base_cents * rules.monthly_family_discount_percent / 100.0);
      end if;
    else
      month_no := extract(month from basis_on);
      if month_no between 9 and 11 then
        period_start := make_date(extract(year from basis_on)::int, 9, 1);
        period_end := make_date(extract(year from basis_on)::int, 11, 30);
        base_cents := rules.term_autumn_cents;
      elsif month_no = 12 then
        period_start := make_date(extract(year from basis_on)::int, 12, 1);
        period_end := make_date(extract(year from basis_on)::int + 1, 2, 28);
        base_cents := rules.term_winter_cents;
      elsif month_no in (1,2) then
        period_start := make_date(extract(year from basis_on)::int - 1, 12, 1);
        period_end := make_date(extract(year from basis_on)::int, 2, 28);
        base_cents := rules.term_winter_cents;
      else
        period_start := make_date(extract(year from basis_on)::int, 3, 1);
        period_end := make_date(extract(year from basis_on)::int, 6, 30);
        base_cents := rules.term_spring_cents;
      end if;
      period_months := (extract(year from age(period_end, period_start))::int * 12) + extract(month from age(period_end, period_start))::int + 1;
      months_remaining := (extract(year from age(period_end, date_trunc('month', basis_on)::date))::int * 12) + extract(month from age(period_end, date_trunc('month', basis_on)::date))::int + 1;
      if first_charge then
        if extract(day from basis_on) > rules.half_rate_through_day then months_remaining := months_remaining - 1;
        elsif extract(day from basis_on) > rules.full_rate_through_day then months_remaining := months_remaining - 0.5;
        end if;
        base_cents := greatest(0, round(base_cents * months_remaining / period_months));
      end if;
    end if;
  else
    raise exception 'Tipo de cobro no válido';
  end if;

  amount := greatest(0, base_cents - discount);
  insert into public.billing_charge_drafts (
    membership_id, athlete_id, payer_profile_id, charge_kind, period_starts_on, period_ends_on,
    scheduled_for, calculated_amount_cents, approved_amount_cents, discount_cents, calculation_snapshot
  ) values (
    target_membership_id, membership_row.athlete_id, payer_id, target_kind, period_start, period_end,
    target_scheduled_for, amount, amount, discount,
    jsonb_build_object('plan', membership_row.plan, 'started_on', started_on, 'active_family_members', active_members, 'rules', to_jsonb(rules))
  ) returning id into draft_id;
  return draft_id;
end $$;

grant execute on function public.create_billing_charge_draft(uuid,text,date) to authenticated;

create or replace function public.sync_billing_authorization()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.status = 'approved' and old.status is distinct from 'approved' and new.charge_kind = 'recurring' then
    update public.memberships set billing_authorized = true, billing_authorized_at = now(), billing_authorized_by = auth.uid()
      where id = new.membership_id;
    new.approved_by := coalesce(new.approved_by, auth.uid());
    new.approved_at := coalesce(new.approved_at, now());
  end if;
  new.updated_at := now();
  return new;
end $$;

drop trigger if exists billing_charge_drafts_authorize on public.billing_charge_drafts;
create trigger billing_charge_drafts_authorize before update on public.billing_charge_drafts
for each row execute function public.sync_billing_authorization();
