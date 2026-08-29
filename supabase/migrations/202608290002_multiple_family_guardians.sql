alter table public.families add column if not exists billing_profile_id uuid references public.profiles(id) on delete restrict;
update public.families set billing_profile_id=primary_profile_id where billing_profile_id is null;

create table if not exists public.family_guardians (
  id uuid primary key default gen_random_uuid(),
  family_id uuid not null references public.families(id) on delete cascade,
  profile_id uuid not null references public.profiles(id) on delete cascade,
  relationship text not null check (relationship in ('padre','madre','tutor_legal')),
  access_status text not null default 'active' check (access_status in ('active','revoked')),
  added_by uuid references public.profiles(id),
  created_at timestamptz not null default now(),
  unique(family_id,profile_id)
);
alter table public.family_guardians enable row level security;

insert into public.family_guardians(family_id,profile_id,relationship,added_by)
select id,primary_profile_id,relationship_to_athlete,primary_profile_id from public.families
on conflict(family_id,profile_id) do nothing;

create or replace function public.can_access_family(target_family_id uuid)
returns boolean language sql stable security definer set search_path=public as $$
  select public.is_admin() or exists(
    select 1 from public.family_guardians g
    where g.family_id=target_family_id and g.profile_id=auth.uid() and g.access_status='active'
  )
$$;

create policy "guardians see their family links" on public.family_guardians for select using (public.can_access_family(family_id));
create policy "admins manage family links" on public.family_guardians for all using (public.is_admin()) with check (public.is_admin());
create policy "additional guardians see family" on public.families for select using (public.can_access_family(id));
create policy "additional guardians see athletes" on public.athletes for select using (family_id is not null and public.can_access_family(family_id));
create policy "additional guardians see memberships" on public.memberships for select using (exists(select 1 from public.athletes a where a.id=athlete_id and public.can_access_family(a.family_id)));
create policy "additional guardians see attendance" on public.attendance_records for select using (exists(select 1 from public.athletes a where a.id=athlete_id and public.can_access_family(a.family_id)));
create policy "additional guardians see health" on public.health_declarations for select using (exists(select 1 from public.athletes a where a.id=athlete_id and public.can_access_family(a.family_id)));
create policy "additional guardians see external activities" on public.external_sport_activities for select using (exists(select 1 from public.athletes a where a.id=athlete_id and public.can_access_family(a.family_id)));

create or replace function public.set_family_billing_guardian(target_family_id uuid,target_profile_id uuid)
returns void language plpgsql security definer set search_path=public as $$
begin
  if not public.is_admin() then raise exception 'Solo administración puede cambiar el responsable de pago.'; end if;
  if not exists(select 1 from public.family_guardians where family_id=target_family_id and profile_id=target_profile_id and access_status='active') then raise exception 'El perfil no es tutor activo de esta familia.'; end if;
  if not exists(select 1 from public.stripe_customers where profile_id=target_profile_id and payment_method_added_at is not null) then raise exception 'El nuevo responsable debe añadir antes una tarjeta.'; end if;
  update public.families set billing_profile_id=target_profile_id where id=target_family_id;
  update public.billing_charge_drafts d set payer_profile_id=target_profile_id,updated_at=now()
  where d.athlete_id in (select id from public.athletes where family_id=target_family_id)
    and d.status in ('awaiting_admin','approved','failed','cancelled') and d.charge_kind='recurring';
  insert into public.audit_log(actor_id,entity_type,entity_id,action,metadata) values(auth.uid(),'family',target_family_id,'billing_guardian_changed',jsonb_build_object('profile_id',target_profile_id));
end $$;
grant execute on function public.set_family_billing_guardian(uuid,uuid) to authenticated;

create or replace function public.family_billing_profile(target_family_id uuid)
returns uuid language sql stable security definer set search_path=public as $$
  select coalesce(billing_profile_id,primary_profile_id) from public.families where id=target_family_id
$$;

-- Blindaje central: cualquier matrícula o cuota familiar se asigna siempre al
-- responsable de pago, nunca al tutor adicional ni al acceso del menor.
create or replace function public.assign_family_charge_payer()
returns trigger language plpgsql security definer set search_path=public as $$
declare selected_payer uuid;
begin
  select case when a.family_id is not null then coalesce(f.billing_profile_id,f.primary_profile_id) else a.user_profile_id end
  into selected_payer from public.athletes a left join public.families f on f.id=a.family_id where a.id=new.athlete_id;
  if selected_payer is not null then new.payer_profile_id:=selected_payer; end if;
  return new;
end $$;
drop trigger if exists billing_charge_assign_family_payer on public.billing_charge_drafts;
create trigger billing_charge_assign_family_payer before insert or update of athlete_id,payer_profile_id
on public.billing_charge_drafts for each row execute function public.assign_family_charge_payer();
