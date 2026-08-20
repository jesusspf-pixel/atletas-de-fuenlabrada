-- Operativa diaria: grupos, planificación, avisos, carreras y permisos por grupo.
-- Ejecutar después de 202608200001_club_core.sql y 202608210001_registration_workflow.sql.

create table if not exists public.training_group_coaches (
  training_group_id uuid not null references public.training_groups(id) on delete cascade,
  coach_profile_id uuid not null references public.profiles(id) on delete cascade,
  is_primary boolean not null default false,
  created_at timestamptz not null default now(),
  primary key (training_group_id, coach_profile_id)
);

create table if not exists public.training_plans (
  id uuid primary key default gen_random_uuid(),
  training_group_id uuid not null references public.training_groups(id) on delete cascade,
  title text not null,
  body text not null,
  week_starts_on date not null,
  published_at timestamptz,
  created_by uuid not null references public.profiles(id),
  created_at timestamptz not null default now(),
  unique (training_group_id, week_starts_on)
);

create table if not exists public.announcements (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  body text not null,
  audience text not null default 'club' check (audience in ('club','group','family')),
  training_group_id uuid references public.training_groups(id) on delete cascade,
  published_at timestamptz,
  created_by uuid not null references public.profiles(id),
  created_at timestamptz not null default now()
);

create table if not exists public.competition_events (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  venue text,
  starts_at timestamptz not null,
  federation_deadline timestamptz,
  internal_deadline timestamptz,
  source_pdf_path text,
  rules_summary text,
  published boolean not null default false,
  created_by uuid not null references public.profiles(id),
  created_at timestamptz not null default now()
);

create table if not exists public.competition_coach_attendance (
  competition_event_id uuid not null references public.competition_events(id) on delete cascade,
  coach_profile_id uuid not null references public.profiles(id) on delete cascade,
  colour text not null default '#2563eb',
  primary key (competition_event_id, coach_profile_id)
);

create table if not exists public.competition_entries (
  id uuid primary key default gen_random_uuid(),
  competition_event_id uuid not null references public.competition_events(id) on delete cascade,
  athlete_id uuid not null references public.athletes(id) on delete cascade,
  requested_events jsonb not null default '[]'::jsonb,
  status text not null default 'requested' check (status in ('requested','reviewing','approved','rejected','registered')),
  requested_by uuid not null references public.profiles(id),
  reviewed_by uuid references public.profiles(id),
  reviewed_at timestamptz,
  notes text,
  created_at timestamptz not null default now(),
  unique (competition_event_id, athlete_id)
);

create table if not exists public.invitation_links (
  id uuid primary key default gen_random_uuid(),
  email text,
  role public.user_role not null check (role in ('admin','coach')),
  training_group_id uuid references public.training_groups(id) on delete set null,
  token uuid not null unique default gen_random_uuid(),
  expires_at timestamptz not null default now() + interval '14 days',
  accepted_at timestamptz,
  created_by uuid not null references public.profiles(id),
  created_at timestamptz not null default now()
);

create or replace function public.is_admin()
returns boolean language sql stable security definer set search_path = public
as $$ select exists (select 1 from public.profiles where id = auth.uid() and role in ('owner','admin')) $$;

create or replace function public.coaches_group(group_id uuid)
returns boolean language sql stable security definer set search_path = public
as $$ select exists (
  select 1 from public.training_group_coaches
  where training_group_id = group_id and coach_profile_id = auth.uid()
) $$;

create or replace function public.can_manage_group(group_id uuid)
returns boolean language sql stable security definer set search_path = public
as $$ select public.is_admin() or public.coaches_group(group_id) $$;

-- Reemplaza el acceso global de entrenadores por acceso limitado a sus grupos.
drop policy if exists "athletes family or staff" on public.athletes;
create policy "athletes own family admin or assigned coach" on public.athletes for select using (
  public.is_admin()
  or user_profile_id = auth.uid()
  or exists (select 1 from public.families f where f.id = family_id and f.primary_profile_id = auth.uid())
  or public.coaches_group(training_group_id)
);
create policy "athletes admins update" on public.athletes for update using (public.is_admin()) with check (public.is_admin());

drop policy if exists "health restricted" on public.health_declarations;
create policy "health own family admin or assigned coach" on public.health_declarations for select using (
  public.is_admin()
  or exists (
    select 1 from public.athletes a join public.families f on f.id = a.family_id
    where a.id = athlete_id and f.primary_profile_id = auth.uid()
  )
  or exists (select 1 from public.athletes a where a.id = athlete_id and public.coaches_group(a.training_group_id))
);

drop policy if exists "consents own or staff" on public.consents;
create policy "consents own family admin or assigned coach" on public.consents for select using (
  public.is_admin() or accepted_by = auth.uid() or exists (
    select 1 from public.athletes a left join public.families f on f.id = a.family_id
    where a.id = athlete_id and (a.user_profile_id = auth.uid() or f.primary_profile_id = auth.uid() or public.coaches_group(a.training_group_id))
  )
);

drop policy if exists "groups visible to members" on public.training_groups;
create policy "groups authenticated read" on public.training_groups for select using (auth.uid() is not null);
create policy "groups admins manage" on public.training_groups for all using (public.is_admin()) with check (public.is_admin());

-- Las políticas originales usaban is_staff(), que incluía a todos los entrenadores.
-- Se sustituyen por reglas específicas de cada familia y grupo asignado.
drop policy if exists "profiles own or staff" on public.profiles;
create policy "profiles own admin or group coach" on public.profiles for select using (
  id = auth.uid() or public.is_admin() or exists (
    select 1 from public.training_group_coaches gc
    join public.athletes a on a.training_group_id = gc.training_group_id
    where gc.coach_profile_id = auth.uid() and a.user_profile_id = profiles.id
  )
);
create policy "profiles own update" on public.profiles for update using (id = auth.uid()) with check (id = auth.uid() and role = (select role from public.profiles where id = auth.uid()));

drop policy if exists "families own or staff" on public.families;
create policy "families own admin or assigned coach" on public.families for select using (
  primary_profile_id = auth.uid() or public.is_admin() or exists (
    select 1 from public.athletes a where a.family_id = families.id and public.coaches_group(a.training_group_id)
  )
);

drop policy if exists "memberships family or staff" on public.memberships;
create policy "memberships family admin or assigned coach" on public.memberships for select using (
  public.is_admin() or exists (
    select 1 from public.athletes a left join public.families f on f.id = a.family_id
    where a.id = athlete_id and (a.user_profile_id = auth.uid() or f.primary_profile_id = auth.uid() or public.coaches_group(a.training_group_id))
  )
);

drop policy if exists "ledger family or staff" on public.payment_ledger;
create policy "ledger family or admin" on public.payment_ledger for select using (
  public.is_admin() or exists (
    select 1 from public.athletes a join public.families f on f.id = a.family_id
    where a.id = athlete_id and f.primary_profile_id = auth.uid()
  )
);

alter table public.training_group_coaches enable row level security;
alter table public.training_plans enable row level security;
alter table public.announcements enable row level security;
alter table public.competition_events enable row level security;
alter table public.competition_coach_attendance enable row level security;
alter table public.competition_entries enable row level security;
alter table public.invitation_links enable row level security;

create policy "group coaches visible authenticated" on public.training_group_coaches for select using (auth.uid() is not null);
create policy "group coaches admins manage" on public.training_group_coaches for all using (public.is_admin()) with check (public.is_admin());

create policy "plans visible to group" on public.training_plans for select using (
  public.is_admin() or public.coaches_group(training_group_id)
  or exists (select 1 from public.athletes a join public.families f on f.id = a.family_id where a.training_group_id = training_plans.training_group_id and f.primary_profile_id = auth.uid())
  or exists (select 1 from public.athletes a where a.training_group_id = training_plans.training_group_id and a.user_profile_id = auth.uid())
);
create policy "plans managed by group coach" on public.training_plans for all using (public.can_manage_group(training_group_id)) with check (public.can_manage_group(training_group_id));

create policy "announcements visible by audience" on public.announcements for select using (
  audience = 'club' or public.is_admin() or (audience = 'group' and public.coaches_group(training_group_id))
  or (audience = 'group' and exists (select 1 from public.athletes a join public.families f on f.id = a.family_id where a.training_group_id = announcements.training_group_id and f.primary_profile_id = auth.uid()))
  or (audience = 'group' and exists (select 1 from public.athletes a where a.training_group_id = announcements.training_group_id and a.user_profile_id = auth.uid()))
);
create policy "announcements admins or coach group" on public.announcements for insert with check (
  public.is_admin() or (audience = 'group' and public.coaches_group(training_group_id) and created_by = auth.uid())
);

create policy "competitions authenticated read" on public.competition_events for select using (auth.uid() is not null and (published or public.is_admin()));
create policy "competitions admins manage" on public.competition_events for all using (public.is_admin()) with check (public.is_admin());
create policy "competition coach attendance read" on public.competition_coach_attendance for select using (auth.uid() is not null);
create policy "competition coach attendance admin manage" on public.competition_coach_attendance for all using (public.is_admin()) with check (public.is_admin());
create policy "competition entry own family or assigned coach" on public.competition_entries for select using (
  public.is_admin() or requested_by = auth.uid() or exists (
    select 1 from public.athletes a join public.families f on f.id = a.family_id
    where a.id = athlete_id and f.primary_profile_id = auth.uid()
  ) or exists (select 1 from public.athletes a where a.id = athlete_id and public.coaches_group(a.training_group_id))
);
create policy "competition entry family request" on public.competition_entries for insert with check (
  requested_by = auth.uid() and exists (
    select 1 from public.athletes a join public.families f on f.id = a.family_id
    where a.id = athlete_id and f.primary_profile_id = auth.uid()
  )
);
create policy "competition entry review admin or group coach" on public.competition_entries for update using (
  public.is_admin() or exists (select 1 from public.athletes a where a.id = athlete_id and public.coaches_group(a.training_group_id))
) with check (
  public.is_admin() or exists (select 1 from public.athletes a where a.id = athlete_id and public.coaches_group(a.training_group_id))
);

drop policy if exists "attendance family or staff" on public.attendance_records;
create policy "attendance sessions visible to members" on public.attendance_sessions for select using (
  public.is_admin() or public.coaches_group(training_group_id) or exists (
    select 1 from public.athletes a left join public.families f on f.id = a.family_id
    where a.training_group_id = attendance_sessions.training_group_id and (a.user_profile_id = auth.uid() or f.primary_profile_id = auth.uid())
  )
);
create policy "attendance sessions admins or group coach" on public.attendance_sessions for all using (public.can_manage_group(training_group_id)) with check (public.can_manage_group(training_group_id));
create policy "attendance records family admin or assigned coach" on public.attendance_records for select using (
  public.is_admin() or exists (
    select 1 from public.athletes a left join public.families f on f.id = a.family_id
    join public.attendance_sessions s on s.id = attendance_records.session_id
    where a.id = attendance_records.athlete_id and (a.user_profile_id = auth.uid() or f.primary_profile_id = auth.uid() or public.coaches_group(s.training_group_id))
  )
);
create policy "attendance records group coach insert" on public.attendance_records for insert with check (
  exists (select 1 from public.attendance_sessions s where s.id = session_id and public.can_manage_group(s.training_group_id))
);
create policy "attendance records admins or group coach update" on public.attendance_records for update using (
  public.is_admin() or exists (select 1 from public.attendance_sessions s where s.id = session_id and public.coaches_group(s.training_group_id))
);
create policy "attendance records masters can RSVP" on public.attendance_records for update using (
  exists (select 1 from public.athletes a where a.id = athlete_id and a.user_profile_id = auth.uid())
) with check (
  exists (select 1 from public.athletes a where a.id = athlete_id and a.user_profile_id = auth.uid())
);

create policy "invitation links admins manage" on public.invitation_links for all using (public.is_admin()) with check (public.is_admin());

create or replace function public.create_staff_invitation(target_email text, target_role public.user_role, target_group_id uuid default null)
returns public.invitation_links language plpgsql security definer set search_path = public as $$
declare created public.invitation_links;
begin
  if not public.is_admin() then raise exception 'Solo un administrador puede invitar al equipo.'; end if;
  if target_role not in ('admin','coach') then raise exception 'Solo se puede invitar a administradores o entrenadores.'; end if;
  insert into public.invitation_links(email, role, training_group_id, created_by)
  values (nullif(lower(trim(target_email)), ''), target_role, target_group_id, auth.uid())
  returning * into created;
  return created;
end;
$$;
revoke all on function public.create_staff_invitation(text, public.user_role, uuid) from public;
grant execute on function public.create_staff_invitation(text, public.user_role, uuid) to authenticated;

create or replace function public.accept_staff_invitation(invitation_token uuid)
returns public.user_role language plpgsql security definer set search_path = public as $$
declare invite public.invitation_links;
declare user_email text;
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
  insert into public.profiles (id, email, role)
  values (auth.uid(), user_email, invite.role)
  on conflict (id) do update set email = excluded.email, role = excluded.role, updated_at = now();
  if invite.role = 'coach' and invite.training_group_id is not null then
    insert into public.training_group_coaches(training_group_id, coach_profile_id)
    values (invite.training_group_id, auth.uid()) on conflict do nothing;
  end if;
  update public.invitation_links set accepted_at = now() where id = invite.id;
  return invite.role;
end;
$$;
revoke all on function public.accept_staff_invitation(uuid) from public;
grant execute on function public.accept_staff_invitation(uuid) to authenticated;

create or replace function public.bootstrap_owner()
returns void language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null or lower(coalesce(auth.jwt() ->> 'email','')) <> 'jesusspf@gmail.com' then
    raise exception 'Solo el propietario inicial puede usar esta activación.';
  end if;
  insert into public.profiles (id, email, full_name, role)
  values (auth.uid(), 'jesusspf@gmail.com', 'Jesús Pérez', 'owner')
  on conflict (id) do update set role = 'owner', full_name = 'Jesús Pérez', updated_at = now();
end;
$$;
revoke all on function public.bootstrap_owner() from public;
grant execute on function public.bootstrap_owner() to authenticated;
