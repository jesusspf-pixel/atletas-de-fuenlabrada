-- Galería de imágenes para los productos de la tienda.

create table if not exists public.club_product_images (
  id uuid primary key default gen_random_uuid(),
  product_id uuid not null references public.club_products(id) on delete cascade,
  image_url text not null,
  storage_path text,
  alt_text text,
  sort_order integer not null default 0 check (sort_order >= 0),
  is_primary boolean not null default false,
  created_by uuid references public.profiles(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (product_id, image_url)
);

create index if not exists club_product_images_product_order_idx
  on public.club_product_images(product_id, sort_order, created_at);

create unique index if not exists club_product_images_one_primary_idx
  on public.club_product_images(product_id)
  where is_primary;

alter table public.club_product_images enable row level security;

drop policy if exists "product images authenticated read" on public.club_product_images;
drop policy if exists "product images admins insert" on public.club_product_images;
drop policy if exists "product images admins update" on public.club_product_images;
drop policy if exists "product images admins delete" on public.club_product_images;

create policy "product images authenticated read" on public.club_product_images
  for select to authenticated using (true);
create policy "product images admins insert" on public.club_product_images
  for insert to authenticated with check (public.is_admin());
create policy "product images admins update" on public.club_product_images
  for update to authenticated using (public.is_admin()) with check (public.is_admin());
create policy "product images admins delete" on public.club_product_images
  for delete to authenticated using (public.is_admin());

grant select, insert, update, delete on public.club_product_images to authenticated;

-- Conserva como principal cualquier foto que ya tuvieran los productos.
insert into public.club_product_images(product_id, image_url, alt_text, sort_order, is_primary, created_by)
select id, image_url, name, 0, true, created_by
from public.club_products
where image_url is not null and btrim(image_url) <> ''
on conflict (product_id, image_url) do nothing;

create or replace function public.set_club_product_primary_image(
  target_product_id uuid,
  target_image_id uuid
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  selected_url text;
begin
  if not public.is_admin() then
    raise exception 'No tienes permisos para gestionar la tienda.';
  end if;

  select image_url into selected_url
  from public.club_product_images
  where id = target_image_id and product_id = target_product_id;

  if selected_url is null then
    raise exception 'La imagen no pertenece a este producto.';
  end if;

  update public.club_product_images
  set is_primary = false, updated_at = now()
  where product_id = target_product_id and is_primary;

  update public.club_product_images
  set is_primary = true, updated_at = now()
  where id = target_image_id;

  update public.club_products
  set image_url = selected_url, updated_at = now()
  where id = target_product_id;
end;
$$;

revoke all on function public.set_club_product_primary_image(uuid, uuid) from public;
grant execute on function public.set_club_product_primary_image(uuid, uuid) to authenticated;

create or replace function public.delete_club_product_image(target_image_id uuid)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  deleted_product_id uuid;
  deleted_storage_path text;
  deleted_was_primary boolean;
  next_image_id uuid;
  next_image_url text;
begin
  if not public.is_admin() then
    raise exception 'No tienes permisos para gestionar la tienda.';
  end if;

  delete from public.club_product_images
  where id = target_image_id
  returning product_id, storage_path, is_primary
  into deleted_product_id, deleted_storage_path, deleted_was_primary;

  if deleted_product_id is null then
    raise exception 'No se ha encontrado la imagen.';
  end if;

  if deleted_was_primary then
    select id, image_url into next_image_id, next_image_url
    from public.club_product_images
    where product_id = deleted_product_id
    order by sort_order, created_at, id
    limit 1;

    if next_image_id is not null then
      update public.club_product_images
      set is_primary = true, updated_at = now()
      where id = next_image_id;
    end if;

    update public.club_products
    set image_url = next_image_url, updated_at = now()
    where id = deleted_product_id;
  end if;

  return deleted_storage_path;
end;
$$;

revoke all on function public.delete_club_product_image(uuid) from public;
grant execute on function public.delete_club_product_image(uuid) to authenticated;
