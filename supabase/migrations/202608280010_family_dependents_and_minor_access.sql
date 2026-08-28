-- Añade menores a una familia existente y permite enlazar un acceso personal
-- de solo lectura para atletas Sub 14 o mayores.

create or replace function public.submit_dependent_registration(payload jsonb)
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
  v_group_id uuid;
  v_group_category text;
  v_training_category text;
  v_competition_category text;
  v_training_year integer := extract(year from current_date)::integer + case when extract(month from current_date) >= 7 then 1 else 0 end;
  v_license_requested boolean;
begin
  if v_profile_id is null then raise exception 'Debes iniciar sesión.'; end if;
  select id into v_family_id from public.families where primary_profile_id = v_profile_id order by created_at limit 1;
  if v_family_id is null then raise exception 'Primero debe existir la ficha familiar.'; end if;
  if jsonb_array_length(coalesce(payload->'athletes','[]'::jsonb)) = 0 then raise exception 'Añade al menos un menor.'; end if;

  for v_athlete in select value from jsonb_array_elements(payload->'athletes') loop
    if (v_athlete->>'birth_date')::date > current_date - interval '18 years' is false then
      raise exception 'Este acceso sirve únicamente para añadir menores de edad.';
    end if;
    v_group_id := nullif(v_athlete->>'training_group_id','')::uuid;
    select category_label into v_group_category from public.training_groups where id=v_group_id and active=true;
    if v_group_category is null then raise exception 'Selecciona un grupo disponible.'; end if;
    v_training_category := public.category_for_year((v_athlete->>'birth_date')::date,v_training_year);
    v_competition_category := public.category_for_year((v_athlete->>'birth_date')::date,extract(year from current_date)::integer);
    v_license_requested := v_training_category <> 'Sub 6';

    insert into public.athletes(family_id,first_name,last_name,birth_date,federative_sex,dni_nie,club_status,license_status,medical_notes,training_group_id,training_category,official_competition_category,federation_license_requested)
    values(v_family_id,v_athlete->>'first_name',v_athlete->>'last_name',(v_athlete->>'birth_date')::date,v_athlete->>'federative_sex',nullif(v_athlete->>'dni_nie',''),'pending_review','pending',nullif(v_athlete->>'health_notes',''),v_group_id,v_training_category,v_competition_category,v_license_requested)
    returning id into v_athlete_id;

    insert into public.health_declarations(athlete_id,relevant_condition,relevant_condition_detail,asthma_allergy_medication,injury_limitation,support_needs,additional_notes,declared_by)
    values(v_athlete_id,coalesce((v_athlete->>'relevant_condition')::boolean,false),nullif(v_athlete->>'relevant_condition_detail',''),nullif(v_athlete->>'asthma_allergy_medication',''),nullif(v_athlete->>'injury_limitation',''),nullif(v_athlete->>'support_needs',''),nullif(v_athlete->>'health_notes',''),v_profile_id);
    for v_consent in select jsonb_array_elements_text(payload->'consents') loop
      insert into public.consents(athlete_id,consent_type,document_version,accepted_by) values(v_athlete_id,v_consent,'2026-08-draft',v_profile_id);
    end loop;
    insert into public.memberships(athlete_id,season,plan,enrolment_fee_status,fee_provider,starts_on)
    values(v_athlete_id,'2026/27',payload->>'plan','awaiting_admin','paused',current_date);
  end loop;
  insert into public.audit_log(actor_id,entity_type,entity_id,action,metadata)
  values(v_profile_id,'family',v_family_id,'dependents_added',jsonb_build_object('athletes',jsonb_array_length(payload->'athletes')));
  return v_family_id;
end;
$$;

revoke all on function public.submit_dependent_registration(jsonb) from public;
grant execute on function public.submit_dependent_registration(jsonb) to authenticated;

create or replace function public.link_minor_athlete_access(target_athlete_id uuid, target_profile_id uuid, target_email text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare v_category text;
begin
  if not exists (
    select 1 from public.athletes a join public.families f on f.id=a.family_id
    where a.id=target_athlete_id and f.primary_profile_id=auth.uid()
  ) then raise exception 'No puedes gestionar el acceso de este atleta.'; end if;
  select training_category into v_category from public.athletes where id=target_athlete_id;
  if coalesce(v_category,'') in ('Sub 6','Sub 8','Sub 10','Sub 12') then
    raise exception 'El acceso individual está disponible desde Sub 14.';
  end if;
  if exists(select 1 from public.athletes where user_profile_id=target_profile_id and id<>target_athlete_id) then
    raise exception 'Este usuario ya está vinculado a otro atleta.';
  end if;
  insert into public.profiles(id,email,full_name,role)
  select target_profile_id,lower(trim(target_email)),trim(first_name||' '||last_name),'minor_athlete'
  from public.athletes where id=target_athlete_id
  on conflict(id) do update set email=excluded.email,full_name=excluded.full_name,role='minor_athlete',updated_at=now();
  insert into public.profile_roles(profile_id,role) values(target_profile_id,'minor_athlete') on conflict do nothing;
  update public.athletes set user_profile_id=target_profile_id,updated_at=now() where id=target_athlete_id;
  insert into public.audit_log(actor_id,entity_type,entity_id,action,metadata)
  values(auth.uid(),'athlete',target_athlete_id,'minor_access_invited',jsonb_build_object('email',lower(trim(target_email))));
end;
$$;

revoke all on function public.link_minor_athlete_access(uuid,uuid,text) from public;
grant execute on function public.link_minor_athlete_access(uuid,uuid,text) to authenticated;

-- Un menor solo ve su propia información económica accidentalmente solicitada
-- por componentes compartidos; no puede modificarla ni acceder a la de la familia.
drop policy if exists "ledger family or admin" on public.payment_ledger;
create policy "ledger family or admin" on public.payment_ledger for select using (
  public.is_admin() or exists (
    select 1 from public.athletes a join public.families f on f.id=a.family_id
    where a.id=athlete_id and f.primary_profile_id=auth.uid()
  )
);
