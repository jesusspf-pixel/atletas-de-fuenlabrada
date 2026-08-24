-- Enlaces personales para familias renovadas: matrícula ya abonada/exenta.
create table if not exists public.family_renewal_invitations (
  id uuid primary key default gen_random_uuid(),
  email text not null,
  token uuid not null default gen_random_uuid() unique,
  expires_at timestamptz not null default now() + interval '30 days',
  used_at timestamptz,
  created_by uuid not null references public.profiles(id),
  created_at timestamptz not null default now()
);

alter table public.family_renewal_invitations enable row level security;

drop policy if exists "renewal invitations admins manage" on public.family_renewal_invitations;
create policy "renewal invitations admins manage"
on public.family_renewal_invitations for all
using (public.is_admin())
with check (public.is_admin());

create or replace function public.create_family_renewal_invitation(target_email text)
returns table(invitation_id uuid, invitation_token uuid, expires_at timestamptz)
language plpgsql security definer set search_path=public as $$
begin
  if not public.is_admin() then
    raise exception 'Solo administración puede crear invitaciones familiares.';
  end if;
  if lower(trim(coalesce(target_email,''))) !~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$' then
    raise exception 'Indica un correo válido.';
  end if;

  return query
  insert into public.family_renewal_invitations(email,created_by)
  values(lower(trim(target_email)),auth.uid())
  returning id,token,expires_at;
end $$;

create or replace function public.submit_family_registration(payload jsonb)
returns uuid language plpgsql security definer set search_path=public as $$
declare
  v_profile_id uuid := auth.uid();
  v_family_id uuid;
  v_athlete jsonb;
  v_athlete_id uuid;
  v_consent text;
  v_email text := coalesce(auth.jwt() ->> 'email', '');
  v_group_id uuid;
  v_group_category text;
  v_training_category text;
  v_competition_category text;
  v_training_year integer := extract(year from current_date)::integer + case when extract(month from current_date) >= 7 then 1 else 0 end;
  v_renewal_token uuid := nullif(payload->>'renewal_invitation','')::uuid;
  v_renewal_exempt boolean := false;
begin
  if v_profile_id is null then raise exception 'Debes iniciar sesión para enviar una inscripción.'; end if;
  if v_email = '' then raise exception 'No se ha encontrado el correo de la cuenta.'; end if;
  if jsonb_array_length(coalesce(payload -> 'athletes', '[]'::jsonb)) = 0 then raise exception 'Añade al menos un atleta.'; end if;

  if v_renewal_token is not null then
    select true into v_renewal_exempt
    from public.family_renewal_invitations
    where token=v_renewal_token
      and lower(email)=lower(v_email)
      and used_at is null
      and expires_at > now();

    if not coalesce(v_renewal_exempt,false) then
      raise exception 'El enlace de renovación no es válido para este correo o ha caducado.';
    end if;

    update public.family_renewal_invitations
    set used_at=now()
    where token=v_renewal_token;
  end if;

  insert into public.profiles(id,email,full_name,phone,role)
  values(v_profile_id,v_email,trim(coalesce(payload->>'first_name','') || ' ' || coalesce(payload->>'last_name','')),payload->>'phone','parent')
  on conflict(id) do update set full_name=excluded.full_name,phone=excluded.phone,updated_at=now();

  insert into public.families(primary_profile_id,relationship_to_athlete,dni_nie,address_line,postal_code,locality,province,emergency_phone)
  values(v_profile_id,payload->>'relationship',payload->>'dni_nie',payload->>'address_line',payload->>'postal_code',payload->>'locality',payload->>'province',nullif(payload->>'emergency_phone',''))
  returning id into v_family_id;

  for v_athlete in select value from jsonb_array_elements(payload->'athletes') loop
    v_group_id := nullif(v_athlete->>'training_group_id','')::uuid;
    select category_label into v_group_category from public.training_groups where id=v_group_id and active=true;
    if v_group_category is null then raise exception 'Selecciona un grupo de entrenamiento disponible para cada atleta.'; end if;

    v_training_category := public.category_for_year((v_athlete->>'birth_date')::date,v_training_year);
    v_competition_category := public.category_for_year((v_athlete->>'birth_date')::date,extract(year from current_date)::integer);

    insert into public.athletes(family_id,first_name,last_name,birth_date,federative_sex,dni_nie,club_status,license_status,medical_notes,training_group_id,training_category,official_competition_category)
    values(v_family_id,v_athlete->>'first_name',v_athlete->>'last_name',(v_athlete->>'birth_date')::date,v_athlete->>'federative_sex',nullif(v_athlete->>'dni_nie',''),'pending_review','pending',nullif(v_athlete->>'health_notes',''),v_group_id,v_training_category,v_competition_category)
    returning id into v_athlete_id;

    insert into public.health_declarations(athlete_id,relevant_condition,relevant_condition_detail,asthma_allergy_medication,injury_limitation,support_needs,additional_notes,declared_by)
    values(v_athlete_id,coalesce((v_athlete->>'relevant_condition')::boolean,false),nullif(v_athlete->>'relevant_condition_detail',''),nullif(v_athlete->>'asthma_allergy_medication',''),nullif(v_athlete->>'injury_limitation',''),nullif(v_athlete->>'support_needs',''),nullif(v_athlete->>'health_notes',''),v_profile_id);

    if v_training_category <> 'Sub 6' then
      insert into public.federation_license_applications(athlete_id,training_category,competition_category,form_data)
      values(v_athlete_id,v_training_category,v_competition_category,jsonb_build_object('nationality',v_athlete->>'nationality','birthplace',v_athlete->>'birthplace','previous_license',nullif(v_athlete->>'previous_license',''),'previous_club',nullif(v_athlete->>'previous_club',''),'guardian_name',trim(coalesce(payload->>'first_name','') || ' ' || coalesce(payload->>'last_name','')),'guardian_dni_nie',payload->>'dni_nie','guardian_phone',payload->>'phone','guardian_email',v_email,'address_line',payload->>'address_line','postal_code',payload->>'postal_code','locality',payload->>'locality','province',payload->>'province'));
    end if;

    for v_consent in select jsonb_array_elements_text(payload->'consents') loop
      insert into public.consents(athlete_id,consent_type,document_version,accepted_by)
      values(v_athlete_id,v_consent,'2026-08-draft',v_profile_id);
    end loop;

    insert into public.memberships(athlete_id,season,plan,enrolment_fee_cents,enrolment_fee_status,fee_provider,starts_on)
    values(v_athlete_id,'2026/27',payload->>'plan',case when v_renewal_exempt then 0 else null end,case when v_renewal_exempt then 'paid' else 'awaiting_admin' end,'paused',current_date);
  end loop;

  insert into public.audit_log(actor_id,entity_type,entity_id,action,metadata)
  values(v_profile_id,'family',v_family_id,'registration_submitted',jsonb_build_object('athletes',jsonb_array_length(payload->'athletes'),'renewal_invitation',v_renewal_exempt));

  return v_family_id;
end $$;

revoke all on function public.create_family_renewal_invitation(text) from public;
grant execute on function public.create_family_renewal_invitation(text) to authenticated;
revoke all on function public.submit_family_registration(jsonb) from public;
grant execute on function public.submit_family_registration(jsonb) to authenticated;
