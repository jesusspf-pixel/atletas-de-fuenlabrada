-- Gestión profesional de tienda y bandeja personal de notificaciones.

alter table public.club_products
  add column if not exists image_url text,
  add column if not exists updated_at timestamptz not null default now();

create table if not exists public.announcement_sender_archives (
  announcement_id uuid not null references public.announcements(id) on delete cascade,
  profile_id uuid not null references public.profiles(id) on delete cascade,
  archived_at timestamptz not null default now(),
  primary key (announcement_id, profile_id)
);

alter table public.announcement_sender_archives enable row level security;
drop policy if exists "sender archives own read" on public.announcement_sender_archives;
drop policy if exists "sender archives own write" on public.announcement_sender_archives;
create policy "sender archives own read" on public.announcement_sender_archives
  for select using (profile_id = auth.uid());
create policy "sender archives own write" on public.announcement_sender_archives
  for insert with check (profile_id = auth.uid());

-- Imágenes de productos: públicas para que las familias puedan ver el catálogo.
insert into storage.buckets (id, name, public)
values ('club-store-images', 'club-store-images', true)
on conflict (id) do update set public = true;

drop policy if exists "club store images public read" on storage.objects;
drop policy if exists "club store images admins upload" on storage.objects;
drop policy if exists "club store images admins update" on storage.objects;
drop policy if exists "club store images admins delete" on storage.objects;
create policy "club store images public read" on storage.objects
  for select using (bucket_id = 'club-store-images');
create policy "club store images admins upload" on storage.objects
  for insert with check (bucket_id = 'club-store-images' and public.is_admin());
create policy "club store images admins update" on storage.objects
  for update using (bucket_id = 'club-store-images' and public.is_admin());
create policy "club store images admins delete" on storage.objects
  for delete using (bucket_id = 'club-store-images' and public.is_admin());

-- El alta de un atleta genera una notificación real a propietario y administradores.
create or replace function public.notify_admins_new_athlete()
returns trigger language plpgsql security definer set search_path = public as $$
declare notice_id uuid;
declare recipient_id uuid;
declare source_profile_id uuid;
begin
  select coalesce(new.user_profile_id, f.primary_profile_id)
    into source_profile_id
  from public.families f
  where f.id = new.family_id;

  -- Una inscripción de menor puede no tener un perfil de atleta. En ese caso
  -- usamos el perfil familiar que la presentó; si tampoco existe, no bloqueamos
  -- el alta únicamente por no poder crear el aviso interno.
  if source_profile_id is null then
    select id into source_profile_id
    from public.profiles
    where role in ('owner', 'admin')
    order by created_at
    limit 1;
  end if;
  if source_profile_id is null then return new; end if;

  insert into public.announcements(title, body, audience, delivery_channels, published_at, created_by)
  values (
    'Nueva inscripción',
    new.first_name || ' ' || new.last_name || ' se ha registrado y requiere revisión.',
    'individual', array['app']::text[], now(), source_profile_id
  ) returning id into notice_id;
  for recipient_id in select id from public.profiles where role in ('owner','admin') loop
    insert into public.announcement_deliveries(announcement_id, recipient_profile_id, channel, delivery_status)
    values (notice_id, recipient_id, 'app', 'sent') on conflict do nothing;
  end loop;
  return new;
end;
$$;
drop trigger if exists athletes_notify_admins_after_insert on public.athletes;
create trigger athletes_notify_admins_after_insert
after insert on public.athletes for each row execute function public.notify_admins_new_athlete();

-- Un entrenador o administrador invitado puede entrar desde la pantalla principal
-- aunque ya no tenga a mano el enlace original de invitación.
create or replace function public.activate_pending_staff_access()
returns public.user_role language plpgsql security definer set search_path = public as $$
declare invite public.invitation_links;
declare user_email text;
begin
  if auth.uid() is null then raise exception 'Inicia sesión primero.'; end if;
  user_email := lower(coalesce(auth.jwt() ->> 'email', ''));
  select * into invite from public.invitation_links
  where lower(email) = user_email and accepted_at is null and expires_at > now()
  order by created_at desc limit 1 for update;
  if not found then raise exception 'No hay una invitación activa para este correo. Pide al club que cree una nueva.'; end if;
  insert into public.profiles(id, email, role)
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
revoke all on function public.activate_pending_staff_access() from public;
grant execute on function public.activate_pending_staff_access() to authenticated;
