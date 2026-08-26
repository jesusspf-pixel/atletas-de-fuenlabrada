create or replace function public.create_shop_cart_order(target_items jsonb, target_payment_method text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  target_order_id uuid;
  item jsonb;
  target_product public.club_products%rowtype;
  target_variant public.club_product_variants%rowtype;
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
  insert into public.club_orders(status,payment_method,payment_status,total_cents,created_by)
  values ('requested',target_payment_method,'pending',0,auth.uid()) returning id into target_order_id;
  for item in select value from jsonb_array_elements(target_items) loop
    item_quantity := greatest(1,least(20,coalesce((item->>'quantity')::integer,1)));
    select * into target_product from public.club_products where id=(item->>'product_id')::uuid and active;
    if not found then raise exception 'Uno de los productos ya no está disponible.'; end if;
    select * into target_variant from public.club_product_variants where product_id=target_product.id and size=item->>'size' for update;
    if not found then raise exception 'Una de las tallas ya no está disponible.'; end if;
    if target_variant.stock_on_hand >= item_quantity then
      update public.club_product_variants set stock_on_hand=stock_on_hand-item_quantity,updated_at=now() where id=target_variant.id;
    elsif target_variant.allow_backorder then has_backorder := true;
    else raise exception 'No hay suficiente stock de % talla %.',target_product.name,target_variant.size;
    end if;
    insert into public.club_order_items(order_id,product_id,product_name,size,quantity,unit_price_cents)
    values(target_order_id,target_product.id,target_product.name,target_variant.size,item_quantity,target_product.price_cents);
    total := total + target_product.price_cents * item_quantity;
  end loop;
  update public.club_orders set total_cents=total,status=case when has_backorder then 'reviewing' else 'requested' end,updated_at=now() where id=target_order_id;
  insert into public.announcements(title,body,audience,delivery_channels,published_at,created_by)
  values('Nuevo pedido de tienda','Nuevo pedido con '||jsonb_array_length(target_items)||' artículo(s) y un total de '||to_char(total/100.0,'FM999999990.00')||' €.', 'individual',array['app']::text[],now(),auth.uid()) returning id into target_notice;
  for target_admin in select id from public.profiles where role in ('owner','admin') loop
    insert into public.announcement_deliveries(announcement_id,recipient_profile_id,channel,delivery_status) values(target_notice,target_admin,'app','sent') on conflict do nothing;
  end loop;
  return jsonb_build_object('id',target_order_id,'backorder',has_backorder,'amount_cents',total);
end;
$$;
revoke all on function public.create_shop_cart_order(jsonb,text) from public;
grant execute on function public.create_shop_cart_order(jsonb,text) to authenticated;
