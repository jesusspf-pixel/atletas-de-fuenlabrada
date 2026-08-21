-- Centro de configuración persistente del club.

-- Esta parte se repite de forma segura para que la actualización funcione
-- aunque la entrega anterior solo se hubiera desplegado en Cloudflare y no
-- se hubiera ejecutado todavía en el SQL Editor.
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
create policy "sender archives own read" on public.announcement_sender_archives for select using (profile_id = auth.uid());
create policy "sender archives own write" on public.announcement_sender_archives for insert with check (profile_id = auth.uid());

insert into storage.buckets (id, name, public) values ('club-store-images', 'club-store-images', true) on conflict (id) do update set public = true;
drop policy if exists "club store images public read" on storage.objects;
drop policy if exists "club store images admins upload" on storage.objects;
drop policy if exists "club store images admins update" on storage.objects;
drop policy if exists "club store images admins delete" on storage.objects;
create policy "club store images public read" on storage.objects for select using (bucket_id = 'club-store-images');
create policy "club store images admins upload" on storage.objects for insert with check (bucket_id = 'club-store-images' and public.is_admin());
create policy "club store images admins update" on storage.objects for update using (bucket_id = 'club-store-images' and public.is_admin());
create policy "club store images admins delete" on storage.objects for delete using (bucket_id = 'club-store-images' and public.is_admin());

create or replace function public.activate_pending_staff_access()
returns public.user_role language plpgsql security definer set search_path = public as $$
declare invite public.invitation_links; user_email text;
begin
  if auth.uid() is null then raise exception 'Inicia sesión primero.'; end if;
  user_email := lower(coalesce(auth.jwt() ->> 'email', ''));
  select * into invite from public.invitation_links where lower(email) = user_email and accepted_at is null and expires_at > now() order by created_at desc limit 1 for update;
  if not found then raise exception 'No hay una invitación activa para este correo. Pide al club que cree una nueva.'; end if;
  insert into public.profiles(id, email, role) values (auth.uid(), user_email, invite.role)
    on conflict (id) do update set email = excluded.email, role = excluded.role, updated_at = now();
  if invite.role = 'coach' and invite.training_group_id is not null then
    insert into public.training_group_coaches(training_group_id, coach_profile_id) values (invite.training_group_id, auth.uid()) on conflict do nothing;
  end if;
  update public.invitation_links set accepted_at = now() where id = invite.id;
  return invite.role;
end;
$$;
revoke all on function public.activate_pending_staff_access() from public;
grant execute on function public.activate_pending_staff_access() to authenticated;

-- La inscripción no debe quedarse bloqueada si el perfil de la familia todavía
-- no se ha creado. El aviso al equipo se genera con un origen seguro.
create or replace function public.notify_admins_new_athlete()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  notice_id uuid;
  recipient_id uuid;
  source_profile_id uuid;
begin
  select coalesce(new.user_profile_id, f.primary_profile_id)
    into source_profile_id
  from public.families f
  where f.id = new.family_id;

  if source_profile_id is null then
    select id into source_profile_id
    from public.profiles
    where role in ('owner', 'admin')
    order by created_at
    limit 1;
  end if;

  if source_profile_id is null then
    return new;
  end if;

  insert into public.announcements (title, body, audience, channels, published_at, created_by)
  values (
    'Nueva inscripción',
    concat(new.first_name, ' ', new.last_name, ' ha enviado una inscripción para revisión.'),
    'individual',
    array['app']::text[],
    now(),
    source_profile_id
  ) returning id into notice_id;

  for recipient_id in
    select id from public.profiles where role in ('owner', 'admin')
  loop
    insert into public.announcement_deliveries (announcement_id, profile_id)
    values (notice_id, recipient_id)
    on conflict do nothing;
  end loop;

  return new;
end;
$$;

drop trigger if exists athletes_notify_admins_new_athlete on public.athletes;
create trigger athletes_notify_admins_new_athlete
after insert on public.athletes
for each row execute function public.notify_admins_new_athlete();

create table if not exists public.club_settings (
  id boolean primary key default true check (id),
  club_name text not null default 'Club Atletas de Fuenlabrada',
  contact_email text,
  contact_phone text,
  address_line text,
  season_label text not null default 'Temporada 2026/27',
  registration_open boolean not null default false,
  registration_message text,
  logo_url text,
  updated_by uuid references public.profiles(id),
  updated_at timestamptz not null default now()
);

insert into public.club_settings(id)
values (true)
on conflict (id) do nothing;

alter table public.club_settings enable row level security;
drop policy if exists "club settings authenticated read" on public.club_settings;
drop policy if exists "club settings admins write" on public.club_settings;
create policy "club settings authenticated read" on public.club_settings
  for select using (auth.uid() is not null);
create policy "club settings admins write" on public.club_settings
  for update using (public.is_admin()) with check (public.is_admin());

insert into storage.buckets (id, name, public)
values ('club-assets', 'club-assets', true)
on conflict (id) do update set public = true;

drop policy if exists "club assets public read" on storage.objects;
drop policy if exists "club assets admins upload" on storage.objects;
drop policy if exists "club assets admins update" on storage.objects;
drop policy if exists "club assets admins delete" on storage.objects;
create policy "club assets public read" on storage.objects
  for select using (bucket_id = 'club-assets');
create policy "club assets admins upload" on storage.objects
  for insert with check (bucket_id = 'club-assets' and public.is_admin());
create policy "club assets admins update" on storage.objects
  for update using (bucket_id = 'club-assets' and public.is_admin());
create policy "club assets admins delete" on storage.objects
  for delete using (bucket_id = 'club-assets' and public.is_admin());
