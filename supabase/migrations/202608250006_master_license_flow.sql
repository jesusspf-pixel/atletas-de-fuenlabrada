-- Flujo de alta para Máster con/sin licencia y limpieza de grupos duplicados.

alter table public.athletes
  add column if not exists federation_license_requested boolean not null default true;

create or replace function public.enrolment_fee_for_athlete(target_athlete_id uuid)
returns integer language plpgsql stable as $$
declare
  category text;
  license_requested boolean;
begin
  select coalesce(a.training_category,tg.category_label), a.federation_license_requested
  into category,license_requested
  from public.athletes a
  left join public.training_groups tg on tg.id=a.training_group_id
  where a.id=target_athlete_id;

  if category is null then
    raise exception 'No se ha podido calcular la matrícula del atleta.';
  end if;
  if lower(category) ~ 'master|máster|absoluto' and not coalesce(license_requested,true) then
    return 4500;
  end if;
  return public.enrolment_fee_for_category(category);
end $$;

create or replace function public.set_membership_enrolment_fee()
returns trigger language plpgsql security definer set search_path=public as $$
begin
  if new.enrolment_fee_cents is null then
    new.enrolment_fee_cents := public.enrolment_fee_for_athlete(new.athlete_id);
  end if;
  return new;
end $$;

create or replace function public.submit_adult_registration(payload jsonb)
returns uuid language plpgsql security definer set search_path=public as $$
declare
  v_profile_id uuid := auth.uid(); v_athlete_id uuid; v_consent text; v_email text := coalesce(auth.jwt()->>'email','');
  v_group_id uuid := nullif(payload->>'training_group_id','')::uuid; v_group_category text;
  v_training_year integer := extract(year from current_date)::integer + case when extract(month from current_date) >= 7 then 1 else 0 end;
  v_training_category text; v_competition_category text; v_license_requested boolean;
begin
  if v_profile_id is null or v_email='' then raise exception 'Debes iniciar sesión para enviar una inscripción.'; end if;
  if coalesce(payload->>'first_name','')='' or coalesce(payload->>'last_name','')='' or coalesce(payload->>'birth_date','')='' then raise exception 'Faltan datos obligatorios del atleta.'; end if;
  select category_label into v_group_category from public.training_groups where id=v_group_id and active=true;
  if v_group_category is null then raise exception 'Selecciona un grupo de entrenamiento disponible.'; end if;
  v_training_category := public.category_for_year((payload->>'birth_date')::date,v_training_year);
  v_competition_category := public.category_for_year((payload->>'birth_date')::date,extract(year from current_date)::integer);
  v_license_requested := case when v_training_category='Sub 6' then false when v_training_category='Absoluto / Máster' then coalesce(payload->>'license_option','without') <> 'without' else true end;
  insert into public.profiles(id,email,full_name,phone,role) values(v_profile_id,v_email,trim((payload->>'first_name') || ' ' || (payload->>'last_name')),payload->>'phone','adult_athlete')
  on conflict(id) do update set full_name=excluded.full_name,phone=excluded.phone,updated_at=now();
  insert into public.athletes(user_profile_id,first_name,last_name,birth_date,federative_sex,dni_nie,club_status,license_status,medical_notes,training_group_id,training_category,official_competition_category,federation_license_requested)
  values(v_profile_id,payload->>'first_name',payload->>'last_name',(payload->>'birth_date')::date,payload->>'federative_sex',nullif(payload->>'dni_nie',''),'pending_review','pending',nullif(payload->>'health_notes',''),v_group_id,v_training_category,v_competition_category,v_license_requested) returning id into v_athlete_id;
  insert into public.health_declarations(athlete_id,relevant_condition,relevant_condition_detail,asthma_allergy_medication,injury_limitation,support_needs,additional_notes,declared_by)
  values(v_athlete_id,coalesce((payload->>'relevant_condition')::boolean,false),nullif(payload->>'relevant_condition_detail',''),nullif(payload->>'asthma_allergy_medication',''),nullif(payload->>'injury_limitation',''),nullif(payload->>'support_needs',''),nullif(payload->>'health_notes',''),v_profile_id);
  if v_license_requested then insert into public.federation_license_applications(athlete_id,training_category,competition_category,form_data) values(v_athlete_id,v_training_category,v_competition_category,jsonb_build_object('nationality',payload->>'nationality','birthplace',payload->>'birthplace','previous_license',nullif(payload->>'previous_license',''),'previous_club',nullif(payload->>'previous_club',''),'athlete_email',v_email,'athlete_phone',payload->>'phone')); end if;
  for v_consent in select jsonb_array_elements_text(payload->'consents') loop insert into public.consents(athlete_id,consent_type,document_version,accepted_by) values(v_athlete_id,v_consent,'2026-08-draft',v_profile_id); end loop;
  insert into public.memberships(athlete_id,season,plan,enrolment_fee_status,fee_provider,starts_on) values(v_athlete_id,'2026/27',payload->>'plan','awaiting_admin','paused',current_date);
  insert into public.audit_log(actor_id,entity_type,entity_id,action,metadata) values(v_profile_id,'athlete',v_athlete_id,'adult_registration_submitted',jsonb_build_object('federation_license_requested',v_license_requested));
  return v_athlete_id;
end $$;

create or replace function public.submit_family_registration(payload jsonb)
returns uuid language plpgsql security definer set search_path=public as $$
declare
  v_profile_id uuid := auth.uid(); v_family_id uuid; v_athlete jsonb; v_athlete_id uuid; v_consent text;
  v_email text := coalesce(auth.jwt()->>'email',''); v_group_id uuid; v_group_category text;
  v_training_category text; v_competition_category text; v_training_year integer := extract(year from current_date)::integer + case when extract(month from current_date) >= 7 then 1 else 0 end;
  v_renewal_token uuid := nullif(payload->>'renewal_invitation','')::uuid; v_renewal_allowed boolean := false; v_license_requested boolean;
begin
  if v_profile_id is null then raise exception 'Debes iniciar sesión para enviar una inscripción.'; end if;
  if v_email='' then raise exception 'No se ha encontrado el correo de la cuenta.'; end if;
  if jsonb_array_length(coalesce(payload->'athletes','[]'::jsonb))=0 then raise exception 'Añade al menos un atleta.'; end if;
  if v_renewal_token is not null then
    select true into v_renewal_allowed from public.family_renewal_invitations where token=v_renewal_token and lower(email)=lower(v_email) and used_at is null and expires_at>now();
    if not coalesce(v_renewal_allowed,false) then raise exception 'El enlace de renovación no es válido para este correo o ha caducado.'; end if;
    update public.family_renewal_invitations set used_at=now() where token=v_renewal_token;
  end if;
  insert into public.profiles(id,email,full_name,phone,role) values(v_profile_id,v_email,trim(coalesce(payload->>'first_name','')||' '||coalesce(payload->>'last_name','')),payload->>'phone','parent')
  on conflict(id) do update set full_name=excluded.full_name,phone=excluded.phone,updated_at=now();
  insert into public.families(primary_profile_id,relationship_to_athlete,dni_nie,address_line,postal_code,locality,province,emergency_phone)
  values(v_profile_id,payload->>'relationship',payload->>'dni_nie',payload->>'address_line',payload->>'postal_code',payload->>'locality',payload->>'province',nullif(payload->>'emergency_phone','')) returning id into v_family_id;
  for v_athlete in select value from jsonb_array_elements(payload->'athletes') loop
    v_group_id := nullif(v_athlete->>'training_group_id','')::uuid;
    select category_label into v_group_category from public.training_groups where id=v_group_id and active=true;
    if v_group_category is null then raise exception 'Selecciona un grupo de entrenamiento disponible para cada atleta.'; end if;
    v_training_category := public.category_for_year((v_athlete->>'birth_date')::date,v_training_year);
    v_competition_category := public.category_for_year((v_athlete->>'birth_date')::date,extract(year from current_date)::integer);
    v_license_requested := case when v_training_category='Sub 6' then false when v_training_category='Absoluto / Máster' then coalesce(v_athlete->>'license_option','without') <> 'without' else true end;
    insert into public.athletes(family_id,first_name,last_name,birth_date,federative_sex,dni_nie,club_status,license_status,medical_notes,training_group_id,training_category,official_competition_category,federation_license_requested)
    values(v_family_id,v_athlete->>'first_name',v_athlete->>'last_name',(v_athlete->>'birth_date')::date,v_athlete->>'federative_sex',nullif(v_athlete->>'dni_nie',''),'pending_review','pending',nullif(v_athlete->>'health_notes',''),v_group_id,v_training_category,v_competition_category,v_license_requested) returning id into v_athlete_id;
    insert into public.health_declarations(athlete_id,relevant_condition,relevant_condition_detail,asthma_allergy_medication,injury_limitation,support_needs,additional_notes,declared_by)
    values(v_athlete_id,coalesce((v_athlete->>'relevant_condition')::boolean,false),nullif(v_athlete->>'relevant_condition_detail',''),nullif(v_athlete->>'asthma_allergy_medication',''),nullif(v_athlete->>'injury_limitation',''),nullif(v_athlete->>'support_needs',''),nullif(v_athlete->>'health_notes',''),v_profile_id);
    if v_license_requested then insert into public.federation_license_applications(athlete_id,training_category,competition_category,form_data) values(v_athlete_id,v_training_category,v_competition_category,jsonb_build_object('nationality',v_athlete->>'nationality','birthplace',v_athlete->>'birthplace','previous_license',nullif(v_athlete->>'previous_license',''),'previous_club',nullif(v_athlete->>'previous_club',''),'guardian_name',trim(coalesce(payload->>'first_name','')||' '||coalesce(payload->>'last_name','')),'guardian_dni_nie',payload->>'dni_nie','guardian_phone',payload->>'phone','guardian_email',v_email,'address_line',payload->>'address_line','postal_code',payload->>'postal_code','locality',payload->>'locality','province',payload->>'province')); end if;
    for v_consent in select jsonb_array_elements_text(payload->'consents') loop insert into public.consents(athlete_id,consent_type,document_version,accepted_by) values(v_athlete_id,v_consent,'2026-08-draft',v_profile_id); end loop;
    insert into public.memberships(athlete_id,season,plan,enrolment_fee_status,fee_provider,starts_on) values(v_athlete_id,'2026/27',payload->>'plan','awaiting_admin','paused',current_date);
  end loop;
  insert into public.audit_log(actor_id,entity_type,entity_id,action,metadata) values(v_profile_id,'family',v_family_id,'registration_submitted',jsonb_build_object('athletes',jsonb_array_length(payload->'athletes'),'renewal_invitation',v_renewal_allowed));
  return v_family_id;
end $$;

-- El grupo antiguo MASTER A solo contiene la ficha de demostración: se mueve al grupo vigente.
update public.athletes a
set training_group_id=(select id from public.training_groups where name='Máster A' and active=true order by created_at desc limit 1)
where a.training_group_id in (select id from public.training_groups where name='MASTER A' and coalesce(trim(schedule_days),'')='')
  and exists(select 1 from public.profiles p where p.id=a.user_profile_id and p.is_demo=true);

update public.training_groups
set active=false
where name in ('MASTER A','MASTER B') and coalesce(trim(schedule_days),'')='';

revoke all on function public.submit_adult_registration(jsonb) from public;
grant execute on function public.submit_adult_registration(jsonb) to authenticated;
revoke all on function public.submit_family_registration(jsonb) from public;
grant execute on function public.submit_family_registration(jsonb) to authenticated;
