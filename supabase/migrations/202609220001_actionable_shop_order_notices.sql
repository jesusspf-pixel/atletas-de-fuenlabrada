-- Los avisos operativos pueden abrir directamente la entidad que los originó.

alter table public.announcements
  add column if not exists action_type text,
  add column if not exists action_id uuid;

alter table public.announcements
  drop constraint if exists announcements_action_type_check;

alter table public.announcements
  add constraint announcements_action_type_check
  check (action_type is null or action_type in ('shop_order'));

create index if not exists announcements_action_idx
  on public.announcements(action_type, action_id)
  where action_type is not null and action_id is not null;

create or replace function public.attach_shop_order_to_announcement()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.title = 'Nuevo pedido de tienda' and new.action_id is null then
    select id into new.action_id
    from public.club_orders
    where created_by = new.created_by
    order by created_at desc
    limit 1;

    if new.action_id is not null then
      new.action_type := 'shop_order';
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists announcements_attach_shop_order_before_insert
  on public.announcements;
create trigger announcements_attach_shop_order_before_insert
before insert on public.announcements
for each row execute function public.attach_shop_order_to_announcement();

-- Recupera el vínculo de los avisos antiguos usando el pedido más cercano
-- del mismo comprador. Solo se aceptan coincidencias dentro de diez minutos.
update public.announcements a
set action_type = 'shop_order',
    action_id = (
      select o.id
      from public.club_orders o
      where o.created_by = a.created_by
        and abs(extract(epoch from (o.created_at - a.created_at))) <= 600
      order by abs(extract(epoch from (o.created_at - a.created_at)))
      limit 1
    )
where a.title = 'Nuevo pedido de tienda'
  and a.action_id is null
  and exists (
    select 1
    from public.club_orders o
    where o.created_by = a.created_by
      and abs(extract(epoch from (o.created_at - a.created_at))) <= 600
  );
