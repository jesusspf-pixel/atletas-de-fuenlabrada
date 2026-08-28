-- An invitation is created only by an administrator and proves that the
-- enrolment fee was paid before migration. Applying the exemption must not
-- depend on whether the link was sent by the batch mailer or copied manually.
create or replace function public.apply_family_renewal_enrolment_exemption()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  account_email text;
begin
  select lower(coalesce(family_profile.email, adult_profile.email))
  into account_email
  from public.athletes a
  left join public.families f on f.id = a.family_id
  left join public.profiles family_profile on family_profile.id = f.primary_profile_id
  left join public.profiles adult_profile on adult_profile.id = a.user_profile_id
  where a.id = new.athlete_id;

  if account_email is not null and exists (
    select 1
    from public.family_renewal_invitations i
    where lower(i.email) = account_email
      and (i.used_at is not null or i.expires_at > now())
  ) then
    new.enrolment_fee_cents := 0;
    new.enrolment_fee_status := 'paid'::public.payment_status;

    update public.family_renewal_invitations
    set used_at = coalesce(used_at, now())
    where lower(email) = account_email
      and used_at is null
      and expires_at > now();
  end if;

  return new;
end;
$$;

-- Repair registrations already completed from a valid renewal invitation.
with invited_memberships as (
  select distinct m.id, lower(coalesce(family_profile.email, adult_profile.email)) as account_email
  from public.memberships m
  join public.athletes a on a.id = m.athlete_id
  left join public.families f on f.id = a.family_id
  left join public.profiles family_profile on family_profile.id = f.primary_profile_id
  left join public.profiles adult_profile on adult_profile.id = a.user_profile_id
  join public.family_renewal_invitations i
    on lower(i.email) = lower(coalesce(family_profile.email, adult_profile.email))
   and (i.used_at is not null or i.expires_at > now())
)
update public.memberships m
set enrolment_fee_cents = 0,
    enrolment_fee_status = 'paid'::public.payment_status
from invited_memberships invited
where m.id = invited.id
  and (m.enrolment_fee_cents <> 0 or m.enrolment_fee_status <> 'paid'::public.payment_status);

update public.family_renewal_invitations i
set used_at = coalesce(i.used_at, now())
where i.used_at is null
  and i.expires_at > now()
  and exists (
    select 1
    from public.memberships m
    join public.athletes a on a.id = m.athlete_id
    left join public.families f on f.id = a.family_id
    left join public.profiles family_profile on family_profile.id = f.primary_profile_id
    left join public.profiles adult_profile on adult_profile.id = a.user_profile_id
    where lower(coalesce(family_profile.email, adult_profile.email)) = lower(i.email)
  );
