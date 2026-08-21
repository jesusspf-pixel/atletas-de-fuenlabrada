-- Tienda operativa: stock por talla, pedidos y avisos visibles para familias.

create table if not exists public.club_product_variants (
  id uuid primary key default gen_random_uuid(),
  product_id uuid not null references public.club_products(id) on delete cascade,
  size text not null,
  stock_on_hand integer not null default 0 check (stock_on_hand >= 0),
  allow_backorder boolean not null default true,
  backorder_message text,
  updated_at timestamptz not null default now(),
  unique(product_id, size)
);

alter table public.club_orders add column if not exists payment_method text not null default 'pickup' check (payment_method in ('pickup','card'));
alter table public.club_orders add column if not exists payment_status text not null default 'pending' check (payment_status in ('pending','paid','failed','refunded'));
alter table public.club_orders add column if not exists stripe_checkout_session_id text unique;

alter table public.club_product_variants enable row level security;

drop policy if exists "club variants readable authenticated" on public.club_product_variants;
drop policy if exists "club variants admins manage" on public.club_product_variants;
create policy "club variants readable authenticated" on public.club_product_variants for select using (
  auth.uid() is not null and exists (select 1 from public.club_products p where p.id = product_id and (p.active or public.is_admin()))
);
create policy "club variants admins manage" on public.club_product_variants for all using (public.is_admin()) with check (public.is_admin());

-- Los productos existentes empiezan como encargo hasta que el administrador indique el stock real.
insert into public.club_product_variants(product_id, size, stock_on_hand, allow_backorder)
select p.id, s.size, 0, true
from public.club_products p
cross join lateral unnest(p.sizes) as s(size)
on conflict (product_id, size) do nothing;

create or replace function public.create_shop_order(target_product_id uuid, target_size text, target_payment_method text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  target_variant public.club_product_variants%rowtype;
  target_product public.club_products%rowtype;
  target_order_id uuid;
  is_backorder boolean := false;
  target_admin uuid;
  target_notice uuid;
begin
  if target_payment_method not in ('pickup', 'card') then raise exception 'Método de pago no válido.'; end if;
  select p.* into target_product from public.club_products p where p.id = target_product_id and p.active;
  if not found then raise exception 'Este producto ya no está disponible.'; end if;
  select * into target_variant from public.club_product_variants where product_id = target_product_id and size = target_size for update;
  if not found then raise exception 'La talla elegida no está disponible.'; end if;
  if target_variant.stock_on_hand > 0 then
    update public.club_product_variants set stock_on_hand = stock_on_hand - 1, updated_at = now() where id = target_variant.id;
  elsif target_variant.allow_backorder then
    is_backorder := true;
  else
    raise exception 'No hay stock de esta talla en este momento.';
  end if;
  insert into public.club_orders(status, payment_method, payment_status, total_cents, created_by)
  values (case when is_backorder then 'reviewing' else 'requested' end, target_payment_method, 'pending', target_product.price_cents, auth.uid())
  returning id into target_order_id;
  insert into public.club_order_items(order_id, product_id, product_name, size, quantity, unit_price_cents)
  values (target_order_id, target_product.id, target_product.name, target_variant.size, 1, target_product.price_cents);
  insert into public.announcements(title, body, audience, delivery_channels, published_at, created_by)
  values ('Nuevo pedido de tienda', target_product.name || ' · talla ' || target_variant.size || case when is_backorder then ' (encargo sin stock).' else '.' end, 'individual', array['app']::text[], now(), auth.uid())
  returning id into target_notice;
  for target_admin in select id from public.profiles where role in ('owner','admin') loop
    insert into public.announcement_deliveries(announcement_id, recipient_profile_id, channel, delivery_status)
    values (target_notice, target_admin, 'app', 'sent') on conflict do nothing;
  end loop;
  return jsonb_build_object('id', target_order_id, 'backorder', is_backorder, 'amount_cents', target_product.price_cents);
end;
$$;
revoke all on function public.create_shop_order(uuid, text, text) from public;
grant execute on function public.create_shop_order(uuid, text, text) to authenticated;

-- Por defecto, las familias reciben el aviso en la aplicación y pueden desactivarlo desde su perfil.
alter table public.family_notification_preferences alter column enabled set default true;
insert into public.family_notification_preferences(family_id, enabled, channels)
select id, true, array['app']::text[] from public.families
on conflict (family_id) do nothing;

create or replace function public.create_default_family_notification_preference()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into public.family_notification_preferences(family_id, enabled, channels)
  values (new.id, true, array['app']::text[])
  on conflict (family_id) do nothing;
  return new;
end;
$$;
drop trigger if exists family_notification_preference_after_insert on public.families;
create trigger family_notification_preference_after_insert
after insert on public.families for each row execute function public.create_default_family_notification_preference();

create or replace function public.queue_attendance_notification(target_session_id uuid, target_athlete_id uuid, did_attend boolean)
returns void language plpgsql security definer set search_path = public as $$
declare target_group_id uuid;
declare target_family_id uuid;
declare target_profile_id uuid;
declare target_name text;
declare group_name text;
declare selected_channels text[];
declare preference_enabled boolean;
declare created_announcement uuid;
declare channel_name text;
begin
  select s.training_group_id into target_group_id from public.attendance_sessions s where s.id = target_session_id;
  if target_group_id is null or not public.can_manage_group(target_group_id) then raise exception 'No tienes permiso para avisar de esta asistencia.'; end if;
  select a.family_id, a.first_name || ' ' || a.last_name into target_family_id, target_name from public.athletes a where a.id = target_athlete_id;
  if target_family_id is null then return; end if;
  select f.primary_profile_id into target_profile_id from public.families f where f.id = target_family_id;
  select enabled, channels into preference_enabled, selected_channels from public.family_notification_preferences where family_id = target_family_id;
  if preference_enabled = false then return; end if;
  if selected_channels is null or cardinality(selected_channels) = 0 then selected_channels := array['app']::text[]; end if;
  if target_profile_id is null then return; end if;
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
