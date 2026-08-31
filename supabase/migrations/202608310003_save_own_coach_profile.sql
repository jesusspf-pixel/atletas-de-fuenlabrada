-- Guarda el perfil público del entrenador en una sola operación.
-- La función nunca acepta un id externo: solo modifica al usuario autenticado.
create or replace function public.save_own_coach_profile(
  new_full_name text,
  new_phone text,
  new_bio text,
  new_public_phone text,
  new_avatar_url text
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  current_profile public.profiles%rowtype;
begin
  if auth.uid() is null then
    raise exception 'Debes iniciar sesión para guardar el perfil.';
  end if;

  select * into current_profile
  from public.profiles
  where id = auth.uid();

  if current_profile.id is null or current_profile.role <> 'coach' then
    raise exception 'Esta cuenta no tiene un perfil de entrenador activo.';
  end if;

  if nullif(trim(coalesce(new_full_name, '')), '') is null then
    raise exception 'El nombre público es obligatorio.';
  end if;

  update public.profiles
  set full_name = trim(new_full_name),
      phone = nullif(trim(coalesce(new_phone, '')), ''),
      updated_at = now()
  where id = auth.uid();

  insert into public.coach_profile_settings(
    profile_id, bio, public_phone, avatar_url, cover_url, updated_at
  ) values (
    auth.uid(),
    nullif(trim(coalesce(new_bio, '')), ''),
    nullif(trim(coalesce(new_public_phone, '')), ''),
    nullif(trim(coalesce(new_avatar_url, '')), ''),
    null,
    now()
  )
  on conflict(profile_id) do update set
    bio = excluded.bio,
    public_phone = excluded.public_phone,
    avatar_url = excluded.avatar_url,
    cover_url = null,
    updated_at = now();
end;
$$;

revoke all on function public.save_own_coach_profile(text,text,text,text,text) from public;
grant execute on function public.save_own_coach_profile(text,text,text,text,text) to authenticated;
