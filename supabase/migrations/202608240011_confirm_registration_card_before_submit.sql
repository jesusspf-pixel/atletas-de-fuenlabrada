-- Guarda la tarjeta verificada antes de que exista el perfil definitivo de una inscripción nueva.
-- El número de tarjeta y el CVV siguen exclusivamente en Stripe.

create table if not exists public.registration_payment_methods (
  profile_id uuid primary key,
  stripe_customer_id text not null unique,
  payment_method_added_at timestamptz not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.registration_payment_methods enable row level security;

create or replace function public.record_saved_payment_method(
  target_profile_id uuid,
  target_customer_id text
)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if exists (select 1 from public.profiles where id = target_profile_id) then
    insert into public.stripe_customers (
      profile_id, stripe_customer_id, payment_method_added_at, updated_at
    )
    values (
      target_profile_id, target_customer_id, now(), now()
    )
    on conflict (profile_id) do update
      set stripe_customer_id = excluded.stripe_customer_id,
          payment_method_added_at = excluded.payment_method_added_at,
          updated_at = now();

    delete from public.registration_payment_methods
    where profile_id = target_profile_id;
  else
    insert into public.registration_payment_methods (
      profile_id, stripe_customer_id, payment_method_added_at, updated_at
    )
    values (
      target_profile_id, target_customer_id, now(), now()
    )
    on conflict (profile_id) do update
      set stripe_customer_id = excluded.stripe_customer_id,
          payment_method_added_at = excluded.payment_method_added_at,
          updated_at = now();
  end if;
end;
$$;

grant execute on function public.record_saved_payment_method(uuid, text) to service_role;

create or replace function public.require_saved_payment_method(target_profile_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  pending_customer_id text;
begin
  if exists (
    select 1
    from public.stripe_customers
    where profile_id = target_profile_id
      and payment_method_added_at is not null
  ) then
    return;
  end if;

  select stripe_customer_id
  into pending_customer_id
  from public.registration_payment_methods
  where profile_id = target_profile_id
    and payment_method_added_at is not null;

  if pending_customer_id is not null then
    perform public.record_saved_payment_method(target_profile_id, pending_customer_id);
  end if;

  if not exists (
    select 1
    from public.stripe_customers
    where profile_id = target_profile_id
      and payment_method_added_at is not null
  ) then
    raise exception 'Añade y confirma una tarjeta en Stripe antes de enviar la solicitud.';
  end if;
end;
$$;
