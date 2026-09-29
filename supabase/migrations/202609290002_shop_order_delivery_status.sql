begin;

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
  if target_status not in ('requested','reviewing','ready','delivered','paid','cancelled') then raise exception 'Estado de pedido no válido.'; end if;

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
  elsif target_status='delivered' then
    notice_title := 'Pedido entregado';
    notice_body := 'Tu pedido figura como entregado. Gracias por confiar en la tienda del club.';
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
