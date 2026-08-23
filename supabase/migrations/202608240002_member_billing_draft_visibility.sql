-- Permite que el deportista adulto y la familia vinculada vean las cuotas
-- creadas para ese atleta. No concede permisos de modificación ni duplica cargos.

drop policy if exists "billing charge drafts visible to payer or admin" on public.billing_charge_drafts;
drop policy if exists "billing charge drafts athlete family payer or admin" on public.billing_charge_drafts;

create policy "billing charge drafts athlete family payer or admin"
on public.billing_charge_drafts
for select
using (
  payer_profile_id = auth.uid()
  or exists (
    select 1
    from public.athletes athlete
    left join public.families family on family.id = athlete.family_id
    where athlete.id = billing_charge_drafts.athlete_id
      and (
        athlete.user_profile_id = auth.uid()
        or family.primary_profile_id = auth.uid()
      )
  )
  or exists (
    select 1
    from public.profiles profile
    where profile.id = auth.uid()
      and profile.role in ('owner', 'admin')
  )
);
