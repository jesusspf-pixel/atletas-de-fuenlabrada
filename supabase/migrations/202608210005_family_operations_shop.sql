-- Fichas operativas de grupos, avisos de asistencia, solicitudes de carrera y tienda.
-- Ejecutar después de 202608210004_club_operations.sql.

create table if not exists public.family_notification_preferences (
  family_id uuid primary key references public.families(id) on delete cascade,
  enabled boolean not null default false,
  channels text[] not null default array['app']::text[] check (channels <@ array['app','email']::text[]),
  updated_at timestamptz not null default now()
);

create table if not exists public.club_products (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  description text,
  price_cents integer not null check (price_cents >= 0),
  sizes text[] not null default array[]::text[],
  active boolean not null default true,
  created_by uuid not null references public.profiles(id),
  created_at timestamptz not null default now()
);

create table if not exists public.club_orders (
  id uuid primary key default gen_random_uuid(),
  status text not null default 'requested' check (status in ('requested','reviewing','ready','paid','cancelled')),
  total_cents integer not null default 0 check (total_cents >= 0),
  created_by uuid not null references public.profiles(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.club_order_items (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references public.club_orders(id) on delete cascade,
  product_id uuid references public.club_products(id) on delete set null,
  product_name text not null,
  size text,
  quantity integer not null default 1 check (quantity > 0),
  unit_price_cents integer not null check (unit_price_cents >= 0)
);

alter table public.family_notification_preferences enable row level security;
alter table public.club_products enable row level security;
alter table public.club_orders enable row level security;
alter table public.club_order_items enable row level security;

create policy "family notification preferences own or admin" on public.family_notification_preferences for select using (
  public.is_admin() or exists (select 1 from public.families f where f.id = family_id and f.primary_profile_id = auth.uid())
);
create policy "family notification preferences family write" on public.family_notification_preferences for insert with check (
  exists (select 1 from public.families f where f.id = family_id and f.primary_profile_id = auth.uid())
);
create policy "family notification preferences family update" on public.family_notification_preferences for update using (
  exists (select 1 from public.families f where f.id = family_id and f.primary_profile_id = auth.uid())
) with check (exists (select 1 from public.families f where f.id = family_id and f.primary_profile_id = auth.uid()));

create policy "club products readable authenticated" on public.club_products for select using (auth.uid() is not null and (active or public.is_admin()));
create policy "club products admins manage" on public.club_products for all using (public.is_admin()) with check (public.is_admin());
create policy "club orders owner or admin read" on public.club_orders for select using (created_by = auth.uid() or public.is_admin());
create policy "club orders authenticated create own" on public.club_orders for insert with check (created_by = auth.uid());
create policy "club orders admins update" on public.club_orders for update using (public.is_admin()) with check (public.is_admin());
create policy "club order items owner or admin read" on public.club_order_items for select using (public.is_admin() or exists (select 1 from public.club_orders o where o.id = order_id and o.created_by = auth.uid()));
create policy "club order items own order create" on public.club_order_items for insert with check (exists (select 1 from public.club_orders o where o.id = order_id and o.created_by = auth.uid()));

-- Cuando el entrenador pasa lista, se avisa solo a las familias que lo han elegido.
create or replace function public.queue_attendance_notification(target_session_id uuid, target_athlete_id uuid, did_attend boolean)
returns void language plpgsql security definer set search_path = public as $$
declare target_group_id uuid;
declare target_family_id uuid;
declare target_profile_id uuid;
declare target_name text;
declare group_name text;
declare selected_channels text[];
declare created_announcement uuid;
declare channel_name text;
begin
  select s.training_group_id into target_group_id from public.attendance_sessions s where s.id = target_session_id;
  if target_group_id is null or not public.can_manage_group(target_group_id) then raise exception 'No tienes permiso para avisar de esta asistencia.'; end if;
  select a.family_id, a.first_name || ' ' || a.last_name into target_family_id, target_name from public.athletes a where a.id = target_athlete_id;
  if target_family_id is null then return; end if;
  select f.primary_profile_id into target_profile_id from public.families f where f.id = target_family_id;
  select channels into selected_channels from public.family_notification_preferences where family_id = target_family_id and enabled;
  if target_profile_id is null or selected_channels is null or cardinality(selected_channels) = 0 then return; end if;
  select name into group_name from public.training_groups where id = target_group_id;
  insert into public.announcements(title, body, audience, delivery_channels, published_at, created_by)
  values ('Asistencia: ' || target_name, target_name || case when did_attend then ' ha asistido al entrenamiento de ' else ' no ha asistido al entrenamiento de ' end || coalesce(group_name, 'su grupo') || '.', 'individual', selected_channels, now(), auth.uid())
  returning id into created_announcement;
  foreach channel_name in array selected_channels loop
    insert into public.announcement_deliveries(announcement_id, recipient_profile_id, channel, delivery_status)
    values (created_announcement, target_profile_id, channel_name, case when channel_name = 'email' then 'pending' else 'sent' end)
    on conflict do nothing;
  end loop;
end;
$$;
revoke all on function public.queue_attendance_notification(uuid, uuid, boolean) from public;
grant execute on function public.queue_attendance_notification(uuid, uuid, boolean) to authenticated;

-- La familia solicita una carrera y el aviso llega al entrenador de su grupo y al equipo del club.
create or replace function public.request_competition_entry(target_event_id uuid, target_athlete_id uuid)
returns void language plpgsql security definer set search_path = public as $$
declare target_group_id uuid;
declare target_family_id uuid;
declare target_owner_id uuid;
declare target_name text;
declare event_name text;
declare announcement_id uuid;
declare recipient_id uuid;
begin
  if not exists (select 1 from public.competition_events where id = target_event_id and published) then raise exception 'La prueba no está disponible.'; end if;
  select training_group_id, family_id, first_name || ' ' || last_name into target_group_id, target_family_id, target_name from public.athletes where id = target_athlete_id;
  if not found then raise exception 'No se ha encontrado el atleta.'; end if;
  if not exists (select 1 from public.families f where f.id = target_family_id and f.primary_profile_id = auth.uid()) and not exists (select 1 from public.athletes a where a.id = target_athlete_id and a.user_profile_id = auth.uid()) then raise exception 'Solo puede solicitar pruebas para sus propios atletas.'; end if;
  insert into public.competition_entries(competition_event_id, athlete_id, requested_by, status)
  values (target_event_id, target_athlete_id, auth.uid(), 'requested')
  on conflict (competition_event_id, athlete_id) do update set requested_by = excluded.requested_by, status = 'requested';
  select title into event_name from public.competition_events where id = target_event_id;
  insert into public.announcements(title, body, audience, delivery_channels, published_at, created_by)
  values ('Solicitud de competición', target_name || ' solicita participar en «' || event_name || '».', 'individual', array['app']::text[], now(), auth.uid()) returning id into announcement_id;
  for recipient_id in select distinct id from public.profiles where role in ('owner','admin') union select coach_profile_id from public.training_group_coaches where training_group_id = target_group_id loop
    insert into public.announcement_deliveries(announcement_id, recipient_profile_id, channel, delivery_status) values (announcement_id, recipient_id, 'app', 'sent') on conflict do nothing;
  end loop;
end;
$$;
revoke all on function public.request_competition_entry(uuid, uuid) from public;
grant execute on function public.request_competition_entry(uuid, uuid) to authenticated;

insert into public.club_products(name, description, price_cents, sizes, active, created_by)
select 'Camiseta técnica del club', 'Camiseta oficial de entrenamiento.', 1800, array['XS','S','M','L','XL'], true, id
from public.profiles where role in ('owner','admin') order by created_at limit 1
on conflict do nothing;
