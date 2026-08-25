-- Las cuentas de demostración no representan a una persona real y no deben
-- necesitar DNI/NIE para crear su ficha de atleta.
create or replace function public.validate_registration_record()
returns trigger language plpgsql security definer set search_path=public as $$
declare payer uuid;
declare demo_profile boolean := false;
begin
  if TG_TABLE_NAME = 'families' then
    perform public.validate_registration_person(new.dni_nie, (select phone from public.profiles where id=new.primary_profile_id), new.postal_code, new.emergency_phone);
    return new;
  end if;
  if TG_TABLE_NAME = 'athletes' then
    if new.birth_date > current_date then raise exception 'La fecha de nacimiento no puede ser futura.'; end if;
    if new.user_profile_id is not null then
      select coalesce(is_demo, false) into demo_profile from public.profiles where id = new.user_profile_id;
    end if;
    if nullif(trim(coalesce(new.dni_nie,'')),'') is not null and not public.valid_spanish_identity(new.dni_nie) then raise exception 'El DNI/NIE del atleta no es válido.'; end if;
    if new.user_profile_id is not null and not demo_profile and not public.valid_spanish_identity(new.dni_nie) then raise exception 'El DNI/NIE es obligatorio para un atleta adulto.'; end if;
    return new;
  end if;
  if TG_TABLE_NAME = 'memberships' and new.fee_provider='paused' and new.enrolment_fee_status='awaiting_admin' then
    select coalesce(a.user_profile_id,f.primary_profile_id) into payer from public.athletes a left join public.families f on f.id=a.family_id where a.id=new.athlete_id;
    perform public.require_saved_payment_method(payer);
  end if;
  return new;
end $$;
