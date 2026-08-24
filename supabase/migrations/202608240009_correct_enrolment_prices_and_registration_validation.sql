-- Precios de matrícula 2026/27 y validaciones obligatorias del alta.
-- Fuente: formulario de renovaciones del Club Atletas de Fuenlabrada.

alter table public.stripe_customers add column if not exists payment_method_added_at timestamptz;

create or replace function public.valid_spanish_identity(raw_value text)
returns boolean language plpgsql immutable as $$
declare value text := upper(regexp_replace(coalesce(raw_value,''), '[[:space:]-]', '', 'g'));
begin
  if value ~ '^[XYZ][0-9]{7}[A-Z]$' then
    value := case left(value,1) when 'X' then '0' when 'Y' then '1' else '2' end || substr(value,2);
  end if;
  return value ~ '^[0-9]{8}[A-Z]$'
    and substr('TRWAGMYFPDXBNJZSQVHLCKE', (substr(value,1,8)::integer % 23) + 1, 1) = right(value,1);
end $$;

create or replace function public.valid_spanish_phone(raw_value text)
returns boolean language sql immutable as $$
  select regexp_replace(coalesce(raw_value,''), '[^0-9+]', '', 'g') ~ '^(\\+34)?[6789][0-9]{8}$'
$$;

create or replace function public.enrolment_fee_for_category(raw_category text)
returns integer language plpgsql immutable as $$
declare category text := lower(replace(replace(coalesce(raw_category,''),'á','a'),'é','e'));
begin
  if category ~ 'sub[ -]?6' then return 4000; end if;
  if category ~ 'sub[ -]?(8|10|12|14|16)' then return 6000; end if;
  if category ~ 'sub[ -]?(18|20)' then return 7000; end if;
  if category ~ 'sub[ -]?23|absoluto' then return 9000; end if;
  if category ~ 'master|running' then
    if category ~ 'running|sin licencia' then return 4000; end if;
    return 9000;
  end if;
  raise exception 'No se ha podido calcular la matrícula: categoría sin tarifa (%).', raw_category;
end $$;

create or replace function public.require_saved_payment_method(target_profile_id uuid)
returns void language plpgsql security definer set search_path=public as $$
begin
  if not exists (select 1 from public.stripe_customers where profile_id=target_profile_id and payment_method_added_at is not null) then
    raise exception 'Añade y confirma una tarjeta en Stripe antes de enviar la solicitud.';
  end if;
end $$;

create or replace function public.validate_registration_person(raw_dni text, raw_phone text, raw_postal_code text default null, raw_emergency_phone text default null)
returns void language plpgsql immutable as $$
begin
  if not public.valid_spanish_identity(raw_dni) then raise exception 'El DNI/NIE no es válido.'; end if;
  if not public.valid_spanish_phone(raw_phone) then raise exception 'El teléfono debe ser un número español válido.'; end if;
  if raw_postal_code is not null and coalesce(raw_postal_code,'') !~ '^[0-9]{5}$' then raise exception 'El código postal debe tener 5 cifras.'; end if;
  if nullif(trim(coalesce(raw_emergency_phone,'')),'') is not null and not public.valid_spanish_phone(raw_emergency_phone) then raise exception 'El teléfono de emergencia no es válido.'; end if;
end $$;

create or replace function public.set_membership_enrolment_fee()
returns trigger language plpgsql security definer set search_path=public as $$
declare category text;
begin
  if new.enrolment_fee_cents is null then
    select coalesce(a.training_category, tg.category_label) into category
    from public.athletes a left join public.training_groups tg on tg.id=a.training_group_id
    where a.id=new.athlete_id;
    new.enrolment_fee_cents := public.enrolment_fee_for_category(category);
  end if;
  return new;
end $$;

create or replace function public.validate_registration_record()
returns trigger language plpgsql security definer set search_path=public as $$
declare payer uuid;
begin
  if TG_TABLE_NAME = 'families' then
    perform public.validate_registration_person(new.dni_nie, (select phone from public.profiles where id=new.primary_profile_id), new.postal_code, new.emergency_phone);
    return new;
  end if;
  if TG_TABLE_NAME = 'athletes' then
    if new.birth_date > current_date then raise exception 'La fecha de nacimiento no puede ser futura.'; end if;
    if nullif(trim(coalesce(new.dni_nie,'')),'') is not null and not public.valid_spanish_identity(new.dni_nie) then raise exception 'El DNI/NIE del atleta no es válido.'; end if;
    if new.user_profile_id is not null and not public.valid_spanish_identity(new.dni_nie) then raise exception 'El DNI/NIE es obligatorio para un atleta adulto.'; end if;
    return new;
  end if;
  if TG_TABLE_NAME = 'memberships' and new.fee_provider='paused' and new.enrolment_fee_status='awaiting_admin' then
    select coalesce(a.user_profile_id,f.primary_profile_id) into payer from public.athletes a left join public.families f on f.id=a.family_id where a.id=new.athlete_id;
    perform public.require_saved_payment_method(payer);
  end if;
  return new;
end $$;

create or replace function public.validate_registration_profile_phone()
returns trigger language plpgsql immutable as $$
begin
  if new.role in ('parent','adult_athlete') and not public.valid_spanish_phone(new.phone) then
    raise exception 'El teléfono debe ser un número español válido.';
  end if;
  return new;
end $$;

drop trigger if exists validate_registration_profile_phone_before_write on public.profiles;
create trigger validate_registration_profile_phone_before_write before insert or update of phone, role on public.profiles
for each row execute function public.validate_registration_profile_phone();

drop trigger if exists validate_family_registration_before_insert on public.families;
create trigger validate_family_registration_before_insert before insert on public.families for each row execute function public.validate_registration_record();
drop trigger if exists validate_athlete_registration_before_insert on public.athletes;
create trigger validate_athlete_registration_before_insert before insert on public.athletes for each row execute function public.validate_registration_record();
drop trigger if exists validate_membership_registration_before_insert on public.memberships;
create trigger validate_membership_registration_before_insert before insert on public.memberships for each row execute function public.validate_registration_record();

drop trigger if exists set_membership_enrolment_fee_before_insert on public.memberships;
create trigger set_membership_enrolment_fee_before_insert before insert on public.memberships
for each row execute function public.set_membership_enrolment_fee();

-- Corrige solicitudes de prueba aún no cobradas; los cargos ya pagados no se alteran.
update public.memberships m set enrolment_fee_cents=public.enrolment_fee_for_category(coalesce(a.training_category,tg.category_label))
from public.athletes a left join public.training_groups tg on tg.id=a.training_group_id
where a.id=m.athlete_id and coalesce(m.enrolment_fee_status,'') <> 'paid';

update public.billing_charge_drafts d set calculated_amount_cents=m.enrolment_fee_cents,approved_amount_cents=m.enrolment_fee_cents,
  calculation_snapshot=coalesce(d.calculation_snapshot,'{}'::jsonb)||jsonb_build_object('reason','Matrícula por categoría 2026/27')
from public.memberships m
where d.membership_id=m.id and d.charge_kind='enrolment' and d.status in ('awaiting_admin','approved');

create or replace function public.approve_registration_and_schedule(target_athlete_id uuid, waive_enrolment boolean default false)
returns table(enrolment_draft_id uuid, athlete_id uuid) language plpgsql security definer set search_path=public as $$
declare m public.memberships%rowtype; payer uuid; fee_cents integer; category text;
begin
 if not public.is_admin() then raise exception 'Solo administración puede validar una inscripción.'; end if;
 select ms.* into m from public.memberships ms where ms.athlete_id=target_athlete_id order by ms.created_at desc limit 1 for update;
 if not found then raise exception 'No se ha encontrado la cuota de este atleta.'; end if;
 select coalesce(a.user_profile_id,f.primary_profile_id),coalesce(a.training_category,tg.category_label)
 into payer,category from public.athletes a left join public.families f on f.id=a.family_id left join public.training_groups tg on tg.id=a.training_group_id where a.id=target_athlete_id;
 fee_cents := public.enrolment_fee_for_category(category);
 update public.athletes set club_status='active' where id=target_athlete_id;
 update public.memberships set billing_started_on=coalesce(billing_started_on,current_date),fee_provider='stripe',enrolment_fee_cents=case when waive_enrolment then 0 else fee_cents end,enrolment_fee_status=case when waive_enrolment then 'paid' else enrolment_fee_status end where id=m.id;
 if waive_enrolment then
  insert into public.billing_charge_drafts(membership_id,athlete_id,payer_profile_id,charge_kind,scheduled_for,calculated_amount_cents,approved_amount_cents,status,calculation_snapshot) values(m.id,target_athlete_id,payer,'enrolment',current_date,0,0,'waived',jsonb_build_object('reason','Matrícula exenta')) on conflict do nothing;
 else
  select d.id into enrolment_draft_id from public.billing_charge_drafts d where d.membership_id=m.id and d.charge_kind='enrolment' and d.status='approved' order by d.created_at desc limit 1;
  if enrolment_draft_id is null and not exists(select 1 from public.billing_charge_drafts d where d.membership_id=m.id and d.charge_kind='enrolment' and d.status='paid') then
   insert into public.billing_charge_drafts(membership_id,athlete_id,payer_profile_id,charge_kind,scheduled_for,calculated_amount_cents,approved_amount_cents,status,calculation_snapshot) values(m.id,target_athlete_id,payer,'enrolment',current_date,fee_cents,fee_cents,'approved',jsonb_build_object('reason','Alta nueva','category',category)) returning id into enrolment_draft_id;
  end if;
 end if;
 perform public.rebuild_membership_fee_schedule(m.id);
 athlete_id:=target_athlete_id; return next;
end $$;
