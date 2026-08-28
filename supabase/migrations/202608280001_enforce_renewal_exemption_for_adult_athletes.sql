-- A renewal invitation can be completed as a family or as an adult athlete.
-- Both routes represent an enrolment fee that was already paid.
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
  left join public.profiles family_profile
    on family_profile.id = f.primary_profile_id
  left join public.profiles adult_profile
    on adult_profile.id = a.user_profile_id
  where a.id = new.athlete_id;

  if account_email is not null and exists (
    select 1
    from public.family_renewal_invitations i
    where lower(i.email) = account_email
      and (
        i.used_at is not null
        or (i.delivery_status = 'sent' and i.expires_at > now())
      )
  ) then
    update public.memberships
    set enrolment_fee_cents = 0,
        enrolment_fee_status = 'paid'::public.payment_status
    where id = new.id;

    update public.family_renewal_invitations
    set used_at = coalesce(used_at, now())
    where lower(email) = account_email
      and used_at is null
      and delivery_status = 'sent'
      and expires_at > now();
  end if;

  return new;
end;
$$;
