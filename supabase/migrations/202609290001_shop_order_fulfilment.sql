-- Pedidos de tienda: atleta destinatario, grupo y flujo de preparación/entrega.
-- Todo el cambio es atómico: si una instrucción falla, no se conserva ninguna
-- modificación parcial ni se altera el flujo que ya está en producción.

begin;

alter table public.club_orders
  add column if not exists athlete_id uuid references public.athletes(id) on delete set null,
  add column if not exists athlete_name_snapshot text,
  add column if not exists training_group_id uuid references public.training_groups(id) on delete set null,
  add column if not exists training_group_name_snapshot text;

create index if not exists club_orders_athlete_created_idx
  on public.club_orders(athlete_id, created_at desc);

-- Completa pedidos anteriores únicamente cuando el comprador se corresponde
-- de forma inequívoca con un solo atleta.
with unique_athlete as (
  select payer_id, min(athlete_id::text)::uuid as athlete_id
  from (
    select coalesce(a.user_profile_id, f.primary_profile_id) as payer_id, a.id as athlete_id
    from public.athletes a
    left join public.families f on f.id = a.family_id
  ) owned
  where payer_id is not null
  group by payer_id
  having count(*) = 1
)
update public.club_orders o
set athlete_id = a.id,
    athlete_name_snapshot = concat_ws(' ', a.first_name, a.last_name),
    training_group_id = a.training_group_id,
    training_group_name_snapshot = g.name
from unique_athlete u
join public.athletes a on a.id = u.athlete_id
left join public.training_groups g on g.id = a.training_group_id
where o.created_by = u.payer_id
  and o.athlete_id is null;

drop function if exists public.create_shop_cart_order(jsonb,text);

create or replace function public.create_shop_cart_order(
  target_items jsonb,
  target_payment_method text,
  target_athlete_id uuid default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  target_order_id uuid;
  item jsonb;
  target_product public.club_products%rowtype;
  target_variant public.club_product_variants%rowtype;
  selected_athlete public.athletes%rowtype;
  selected_group_name text;
  item_quantity integer;
  total integer := 0;
  has_backorder boolean := false;
  target_admin uuid;
  target_notice uuid;
begin
  if auth.uid() is null then raise exception 'Debes iniciar sesión.'; end if;
  if target_payment_method not in ('pickup','card') then raise exception 'Método de pago no válido.'; end if;
  if jsonb_typeof(target_items) <> 'array' or jsonb_array_length(target_items) = 0 then raise exception 'El carrito está vacío.'; end if;
  if jsonb_array_length(target_items) > 30 then raise exception 'El carrito contiene demasiados artículos.'; end if;

  if target_athlete_id is not null then
    select a.* into selected_athlete
    from public.athletes a
    left join public.families f on f.id = a.family_id
    where a.id = target_athlete_id
      and (a.user_profile_id = auth.uid() or f.primary_profile_id = auth.uid());
    if not found then raise exception 'El atleta elegido no pertenece a tu cuenta.'; end if;
    select name into selected_group_name from public.training_groups where id = selected_athlete.training_group_id;
  end if;

  insert into public.club_orders(
    status, payment_method, payment_status, total_cents, created_by,
    athlete_id, athlete_name_snapshot, training_group_id, training_group_name_snapshot
  ) values (
    'requested', target_payment_method, 'pending', 0, auth.uid(),
    selected_athlete.id,
    case when selected_athlete.id is null then null else concat_ws(' ', selected_athlete.first_name, selected_athlete.last_name) end,
    selected_athlete.training_group_id,
    selected_group_name
  ) returning id into target_order_id;

  for item in select value from jsonb_array_elements(target_items) loop
    item_quantity := greatest(1,least(20,coalesce((item->>'quantity')::integer,1)));
    select * into target_product from public.club_products where id=(item->>'product_id')::uuid and active;
    if not found then raise exception 'Uno de los productos ya no está disponible.'; end if;
    select * into target_variant from public.club_product_variants where product_id=target_product.id and size=item->>'size' for update;
    if not found then raise exception 'Una de las tallas ya no está disponible.'; end if;
    if target_variant.stock_on_hand >= item_quantity then
      update public.club_product_variants set stock_on_hand=stock_on_hand-item_quantity,updated_at=now() where id=target_variant.id;
    elsif target_variant.allow_backorder then
      has_backorder := true;
    else
      raise exception 'No hay suficiente stock de % talla %.',target_product.name,target_variant.size;
    end if;
    insert into public.club_order_items(order_id,product_id,product_name,size,quantity,unit_price_cents)
    values(target_order_id,target_product.id,target_product.name,target_variant.size,item_quantity,target_product.price_cents);
    total := total + target_product.price_cents * item_quantity;
  end loop;

  update public.club_orders
  set total_cents=total,status=case when has_backorder then 'reviewing' else 'requested' end,updated_at=now()
  where id=target_order_id;

  insert into public.announcements(title,body,audience,delivery_channels,published_at,created_by,action_type,action_id)
  values(
    'Nuevo pedido de tienda',
    coalesce(nullif(concat_ws(' · ', selected_athlete.first_name || ' ' || selected_athlete.last_name, selected_group_name), ''), 'Nuevo pedido') ||
      ' · ' || jsonb_array_length(target_items) || ' artículo(s) · ' || to_char(total/100.0,'FM999999990.00') || ' €.',
    'individual',array['app']::text[],now(),auth.uid(),'shop_order',target_order_id
  ) returning id into target_notice;
  for target_admin in select id from public.profiles where role in ('owner','admin') loop
    insert into public.announcement_deliveries(announcement_id,recipient_profile_id,channel,delivery_status)
    values(target_notice,target_admin,'app','sent') on conflict do nothing;
  end loop;
  return jsonb_build_object('id',target_order_id,'backorder',has_backorder,'amount_cents',total);
end;
$$;

revoke all on function public.create_shop_cart_order(jsonb,text,uuid) from public;
grant execute on function public.create_shop_cart_order(jsonb,text,uuid) to authenticated;

create or replace function public.manage_shop_order(
  target_order_id uuid,
  target_status text,
  mark_paid boolean default false
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  target_order public.club_orders%rowtype;
  notice_id uuid;
  notice_title text;
  notice_body text;
  resulting_payment_status text;
begin
  if not public.is_admin() then raise exception 'No tienes permisos para gestionar pedidos.'; end if;
  if target_status not in ('requested','reviewing','ready','paid','cancelled') then raise exception 'Estado de pedido no válido.'; end if;

  select * into target_order from public.club_orders where id=target_order_id for update;
  if not found then raise exception 'No se ha encontrado el pedido.'; end if;

  resulting_payment_status := case when mark_paid or target_status='paid' then 'paid' else target_order.payment_status end;
  update public.club_orders
  set status=target_status,
      payment_status=resulting_payment_status,
      updated_at=now()
  where id=target_order_id;

  if target_status='reviewing' then
    notice_title := 'Estamos preparando tu pedido';
    notice_body := 'Ya estamos preparando tu pedido de la tienda del club. Te avisaremos cuando esté listo para entregarlo.';
  elsif target_status='ready' then
    notice_title := 'Tu pedido está preparado';
    notice_body := case when resulting_payment_status='paid'
      then 'Tu pedido está preparado. Dirígete a tu entrenador para que te lo entregue.'
      else 'Tu pedido está preparado. Dirígete a tu entrenador para abonar el pedido y que te lo entregue.' end;
  elsif target_status='paid' and target_order.payment_status <> 'paid' then
    notice_title := 'Pago del pedido registrado';
    notice_body := 'Hemos registrado el pago de tu pedido. Si ya está preparado, dirígete a tu entrenador para que te lo entregue.';
  end if;

  if notice_title is not null then
    insert into public.announcements(title,body,audience,delivery_channels,published_at,created_by,action_type,action_id)
    values(notice_title,notice_body,'individual',array['app']::text[],now(),auth.uid(),'shop_order',target_order_id)
    returning id into notice_id;
    insert into public.announcement_deliveries(announcement_id,recipient_profile_id,channel,delivery_status)
    values(notice_id,target_order.created_by,'app','sent') on conflict do nothing;
  end if;

  return jsonb_build_object(
    'id',target_order_id,
    'status',target_status,
    'payment_status',resulting_payment_status,
    'recipient_id',target_order.created_by,
    'notification_title',notice_title,
    'notification_body',notice_body
  );
end;
$$;

revoke all on function public.manage_shop_order(uuid,text,boolean) from public;
grant execute on function public.manage_shop_order(uuid,text,boolean) to authenticated;

commit;
