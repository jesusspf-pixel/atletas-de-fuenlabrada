-- Registro público: solo crea familias/atletas pendientes de revisión.
-- No concede roles de administrador o entrenador ni realiza cobros.

create or replace function public.submit_family_registration(payload jsonb)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_profile_id uuid := auth.uid();
  v_family_id uuid;
  v_athlete jsonb;
  v_athlete_id uuid;
  v_consent text;
  v_email text := coalesce(auth.jwt() ->> 'email', '');
begin
  if v_profile_id is null then
    raise exception 'Debes iniciar sesión para enviar una inscripción.';
  end if;

  if v_email = '' then
    raise exception 'No se ha encontrado el correo de la cuenta.';
  end if;

  if jsonb_array_length(coalesce(payload -> 'athletes', '[]'::jsonb)) = 0 then
    raise exception 'Añade al menos un atleta.';
  end if;

  insert into public.profiles (id, email, full_name, phone, role)
  values (
    v_profile_id,
    v_email,
    trim(coalesce(payload ->> 'first_name', '') || ' ' || coalesce(payload ->> 'last_name', '')),
    payload ->> 'phone',
    'parent'
  )
  on conflict (id) do update
  set full_name = excluded.full_name,
      phone = excluded.phone,
      updated_at = now();

  insert into public.families (
    primary_profile_id, relationship_to_athlete, dni_nie, address_line,
    postal_code, locality, province, emergency_phone
  ) values (
    v_profile_id,
    payload ->> 'relationship',
    payload ->> 'dni_nie',
    payload ->> 'address_line',
    payload ->> 'postal_code',
    payload ->> 'locality',
    payload ->> 'province',
    nullif(payload ->> 'emergency_phone', '')
  ) returning id into v_family_id;

  for v_athlete in select value from jsonb_array_elements(payload -> 'athletes') loop
    insert into public.athletes (
      family_id, first_name, last_name, birth_date, federative_sex, dni_nie,
      club_status, license_status, medical_notes
    ) values (
      v_family_id,
      v_athlete ->> 'first_name',
      v_athlete ->> 'last_name',
      (v_athlete ->> 'birth_date')::date,
      v_athlete ->> 'federative_sex',
      nullif(v_athlete ->> 'dni_nie', ''),
      'pending_review',
      'pending',
      nullif(v_athlete ->> 'health_notes', '')
    ) returning id into v_athlete_id;

    insert into public.health_declarations (
      athlete_id, relevant_condition, relevant_condition_detail,
      asthma_allergy_medication, injury_limitation, support_needs,
      additional_notes, declared_by
    ) values (
      v_athlete_id,
      coalesce((v_athlete ->> 'relevant_condition')::boolean, false),
      nullif(v_athlete ->> 'relevant_condition_detail', ''),
      nullif(v_athlete ->> 'asthma_allergy_medication', ''),
      nullif(v_athlete ->> 'injury_limitation', ''),
      nullif(v_athlete ->> 'support_needs', ''),
      nullif(v_athlete ->> 'health_notes', ''),
      v_profile_id
    );

    for v_consent in select jsonb_array_elements_text(payload -> 'consents') loop
      insert into public.consents (athlete_id, consent_type, document_version, accepted_by)
      values (v_athlete_id, v_consent, '2026-08-draft', v_profile_id);
    end loop;

    insert into public.memberships (
      athlete_id, season, plan, enrolment_fee_status, fee_provider, starts_on
    ) values (
      v_athlete_id,
      '2026/27',
      payload ->> 'plan',
      'awaiting_admin',
      'paused',
      current_date
    );
  end loop;

  insert into public.audit_log (actor_id, entity_type, entity_id, action, metadata)
  values (v_profile_id, 'family', v_family_id, 'registration_submitted', jsonb_build_object('athletes', jsonb_array_length(payload -> 'athletes')));

  return v_family_id;
end;
$$;

revoke all on function public.submit_family_registration(jsonb) from public;
grant execute on function public.submit_family_registration(jsonb) to authenticated;

create or replace function public.submit_adult_registration(payload jsonb)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_profile_id uuid := auth.uid();
  v_athlete_id uuid;
  v_consent text;
  v_email text := coalesce(auth.jwt() ->> 'email', '');
begin
  if v_profile_id is null or v_email = '' then
    raise exception 'Debes iniciar sesión para enviar una inscripción.';
  end if;
  if coalesce(payload ->> 'first_name','') = '' or coalesce(payload ->> 'last_name','') = '' or coalesce(payload ->> 'birth_date','') = '' then
    raise exception 'Faltan datos obligatorios del atleta.';
  end if;

  insert into public.profiles (id, email, full_name, phone, role)
  values (v_profile_id, v_email, trim((payload ->> 'first_name') || ' ' || (payload ->> 'last_name')), payload ->> 'phone', 'adult_athlete')
  on conflict (id) do update set full_name = excluded.full_name, phone = excluded.phone, updated_at = now();

  insert into public.athletes (
    user_profile_id, first_name, last_name, birth_date, federative_sex, dni_nie, club_status, license_status, medical_notes
  ) values (
    v_profile_id, payload ->> 'first_name', payload ->> 'last_name', (payload ->> 'birth_date')::date,
    payload ->> 'federative_sex', nullif(payload ->> 'dni_nie',''), 'pending_review', 'pending', nullif(payload ->> 'health_notes','')
  ) returning id into v_athlete_id;

  insert into public.health_declarations (
    athlete_id, relevant_condition, relevant_condition_detail, asthma_allergy_medication,
    injury_limitation, support_needs, additional_notes, declared_by
  ) values (
    v_athlete_id, coalesce((payload ->> 'relevant_condition')::boolean, false),
    nullif(payload ->> 'relevant_condition_detail',''), nullif(payload ->> 'asthma_allergy_medication',''),
    nullif(payload ->> 'injury_limitation',''), nullif(payload ->> 'support_needs',''), nullif(payload ->> 'health_notes',''), v_profile_id
  );

  for v_consent in select jsonb_array_elements_text(payload -> 'consents') loop
    insert into public.consents (athlete_id, consent_type, document_version, accepted_by)
    values (v_athlete_id, v_consent, '2026-08-draft', v_profile_id);
  end loop;

  insert into public.memberships (athlete_id, season, plan, enrolment_fee_status, fee_provider, starts_on)
  values (v_athlete_id, '2026/27', payload ->> 'plan', 'awaiting_admin', 'paused', current_date);

  insert into public.audit_log (actor_id, entity_type, entity_id, action)
  values (v_profile_id, 'athlete', v_athlete_id, 'adult_registration_submitted');
  return v_athlete_id;
end;
$$;

revoke all on function public.submit_adult_registration(jsonb) from public;
grant execute on function public.submit_adult_registration(jsonb) to authenticated;
