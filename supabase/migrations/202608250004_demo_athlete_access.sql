-- Accesos de demostración: panel de atleta completo sin cobros reales.
alter table public.profiles add column if not exists is_demo boolean not null default false;

alter table public.invitation_links drop constraint if exists invitation_links_role_check;
alter table public.invitation_links add constraint invitation_links_role_check
  check (role in ('admin','coach','adult_athlete'));

create or replace function public.create_demo_athlete_invitation(target_email text)
returns public.invitation_links language plpgsql security definer set search_path = public as $$
declare created public.invitation_links;
begin
  if not public.is_admin() then raise exception 'Solo un administrador puede crear accesos de demostración.'; end if;
  insert into public.invitation_links(email, role, created_by)
  values (nullif(lower(trim(target_email)), ''), 'adult_athlete', auth.uid())
  returning * into created;
  return created;
end;
$$;
revoke all on function public.create_demo_athlete_invitation(text) from public;
grant execute on function public.create_demo_athlete_invitation(text) to authenticated;

create or replace function public.accept_staff_invitation(invitation_token uuid)
returns public.user_role language plpgsql security definer set search_path = public as $$
declare invite public.invitation_links;
declare user_email text;
declare demo_athlete_id uuid;
begin
  if auth.uid() is null then raise exception 'Inicia sesión antes de aceptar la invitación.'; end if;
  user_email := lower(coalesce(auth.jwt() ->> 'email', ''));
  select * into invite from public.invitation_links
  where token = invitation_token and accepted_at is null and expires_at > now()
  for update;
  if not found then raise exception 'La invitación no existe, ha caducado o ya se utilizó.'; end if;
  if invite.email is not null and lower(invite.email) <> user_email then
    raise exception 'Esta invitación corresponde a otro correo electrónico.';
  end if;

  insert into public.profiles (id, email, full_name, phone, role, is_demo)
  values (auth.uid(), user_email, case when invite.role = 'adult_athlete' then 'Atleta de demostración' else null end,
          case when invite.role = 'adult_athlete' then '600000000' else null end,
          invite.role, invite.role = 'adult_athlete')
  on conflict (id) do update set email = excluded.email, role = excluded.role,
    is_demo = excluded.is_demo, updated_at = now();

  if invite.role = 'coach' and invite.training_group_id is not null then
    insert into public.training_group_coaches(training_group_id, coach_profile_id)
    values (invite.training_group_id, auth.uid()) on conflict do nothing;
  elsif invite.role = 'adult_athlete' then
    select id into demo_athlete_id from public.athletes where user_profile_id = auth.uid();
    if demo_athlete_id is null then
      insert into public.athletes(user_profile_id, first_name, last_name, birth_date, federative_sex,
        club_status, license_status, training_group_id)
      values(auth.uid(), 'Atleta', 'Demo', date '2000-01-01', 'M', 'active', 'active',
        (select id from public.training_groups where active order by name limit 1))
      returning id into demo_athlete_id;
      insert into public.memberships(athlete_id, season, plan, enrolment_fee_status, fee_provider, starts_on)
      values(demo_athlete_id, '2026/27', 'monthly', 'paid', 'paused', current_date)
      on conflict (athlete_id, season) do nothing;
    end if;
  end if;

  update public.invitation_links set accepted_at = now() where id = invite.id;
  return invite.role;
end;
$$;
revoke all on function public.accept_staff_invitation(uuid) from public;
grant execute on function public.accept_staff_invitation(uuid) to authenticated;

