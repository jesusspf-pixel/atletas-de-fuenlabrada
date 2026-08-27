-- A consumed family renewal invitation always means that the enrolment fee was
-- already paid. Enforce this at membership level so later registration changes
-- cannot accidentally turn the fee back into a pending charge.
create or replace function public.apply_family_renewal_enrolment_exemption()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if exists (
    select 1
    from public.athletes a
    join public.families f on f.id = a.family_id
    join public.profiles p on p.id = f.primary_profile_id
    join public.family_renewal_invitations i on lower(i.email) = lower(p.email)
    where a.id = new.athlete_id
      and (
        i.used_at is not null
        or (i.delivery_status = 'sent' and i.expires_at > now())
      )
  ) then
    update public.memberships
    set enrolment_fee_cents = 0,
        enrolment_fee_status = 'paid'::public.payment_status
    where id = new.id;

    update public.family_renewal_invitations i
    set used_at = coalesce(i.used_at, now())
    from public.athletes a
    join public.families f on f.id = a.family_id
    join public.profiles p on p.id = f.primary_profile_id
    where a.id = new.athlete_id
      and lower(i.email) = lower(p.email)
      and i.used_at is null
      and i.delivery_status = 'sent'
      and i.expires_at > now();
  end if;

  return new;
end;
$$;

drop trigger if exists apply_family_renewal_enrolment_exemption_after_insert
on public.memberships;

create trigger apply_family_renewal_enrolment_exemption_after_insert
after insert on public.memberships
for each row execute function public.apply_family_renewal_enrolment_exemption();

-- Repair registrations already completed from renewal links. This only changes
-- enrolment-fee fields; recurring plans and charges remain untouched.
update public.memberships m
set enrolment_fee_cents = 0,
    enrolment_fee_status = 'paid'::public.payment_status
from public.athletes a
join public.families f on f.id = a.family_id
join public.profiles p on p.id = f.primary_profile_id
where m.athlete_id = a.id
  and exists (
    select 1
    from public.family_renewal_invitations i
    where lower(i.email) = lower(p.email)
      and (
        i.used_at is not null
        or (i.delivery_status = 'sent' and i.expires_at > now())
      )
  );

update public.family_renewal_invitations i
set used_at = coalesce(i.used_at, now())
where i.used_at is null
  and i.delivery_status = 'sent'
  and i.expires_at > now()
  and exists (
    select 1
    from public.profiles p
    join public.families f on f.primary_profile_id = p.id
    join public.athletes a on a.family_id = f.id
    join public.memberships m on m.athlete_id = a.id
    where lower(p.email) = lower(i.email)
  );
