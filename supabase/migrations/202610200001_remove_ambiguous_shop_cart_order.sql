-- Elimina la firma antigua de dos parámetros que hace ambiguo el RPC de compra.
-- La firma vigente de tres parámetros acepta target_athlete_id y conserva un
-- valor por defecto para que clientes antiguos de dos parámetros sigan
-- funcionando a través de una única función.

begin;

drop function if exists public.create_shop_cart_order(jsonb, text);

revoke all on function public.create_shop_cart_order(jsonb, text, uuid) from public;
grant execute on function public.create_shop_cart_order(jsonb, text, uuid) to authenticated;

-- PostgREST debe refrescar inmediatamente su caché de firmas RPC.
notify pgrst, 'reload schema';

commit;
