-- Garantiza que el propietario vea las altas incluso si su perfil tardó en crearse.
-- Ejecutar después de las migraciones 202608210001 y 202608210002.

create or replace function public.is_staff()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select lower(coalesce(auth.jwt() ->> 'email', '')) = 'jesusspf@gmail.com'
    or exists (
      select 1 from public.profiles
      where id = auth.uid() and role in ('owner','admin','coach')
    )
$$;

create or replace function public.is_admin()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select lower(coalesce(auth.jwt() ->> 'email', '')) = 'jesusspf@gmail.com'
    or exists (
      select 1 from public.profiles
      where id = auth.uid() and role in ('owner','admin')
    )
$$;

create or replace function public.bootstrap_owner()
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.uid() is null or lower(coalesce(auth.jwt() ->> 'email','')) <> 'jesusspf@gmail.com' then
    raise exception 'Solo el propietario inicial puede usar esta activación.';
  end if;

  insert into public.profiles (id, email, full_name, role)
  values (auth.uid(), 'jesusspf@gmail.com', 'Jesús Pérez', 'owner')
  on conflict (id) do update
  set email = excluded.email,
      full_name = excluded.full_name,
      role = 'owner',
      updated_at = now();
end;
$$;

revoke all on function public.bootstrap_owner() from public;
grant execute on function public.bootstrap_owner() to authenticated;
