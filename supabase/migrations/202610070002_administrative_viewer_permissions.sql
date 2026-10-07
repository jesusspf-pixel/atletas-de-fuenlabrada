-- Acceso limitado para personal administrativo: atletas y cobros, solo lectura.

alter table public.invitation_links
  drop constraint if exists invitation_links_role_check;
alter table public.invitation_links
  add constraint invitation_links_role_check
  check (role in ('admin','coach','adult_athlete','administrative_viewer'));

create or replace function public.is_administrative_viewer()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.profiles
    where id = auth.uid()
      and role = 'administrative_viewer'
  )
$$;

revoke all on function public.is_administrative_viewer() from public;
grant execute on function public.is_administrative_viewer() to authenticated;

drop policy if exists "administrative viewer reads profiles" on public.profiles;
create policy "administrative viewer reads profiles"
  on public.profiles for select
  using (public.is_administrative_viewer());

drop policy if exists "administrative viewer reads athletes" on public.athletes;
create policy "administrative viewer reads athletes"
  on public.athletes for select
  using (public.is_administrative_viewer());

drop policy if exists "administrative viewer reads families" on public.families;
create policy "administrative viewer reads families"
  on public.families for select
  using (public.is_administrative_viewer());

drop policy if exists "administrative viewer reads memberships" on public.memberships;
create policy "administrative viewer reads memberships"
  on public.memberships for select
  using (public.is_administrative_viewer());

drop policy if exists "administrative viewer reads billing drafts" on public.billing_charge_drafts;
create policy "administrative viewer reads billing drafts"
  on public.billing_charge_drafts for select
  using (public.is_administrative_viewer());

create or replace function public.create_staff_invitation_multi(
  target_email text,
  target_role public.user_role,
  target_group_ids uuid[] default '{}'
)
returns public.invitation_links
language plpgsql
security definer
set search_path = public
as $$
declare
  created public.invitation_links;
  clean_groups uuid[];
begin
  if not public.is_admin() then
    raise exception 'Solo un administrador puede invitar al equipo.';
  end if;
  if target_role not in ('admin','coach','administrative_viewer') then
    raise exception 'El permiso solicitado no es válido para el equipo.';
  end if;
  select coalesce(array_agg(id),'{}'::uuid[])
    into clean_groups
    from public.training_groups
   where id = any(coalesce(target_group_ids,'{}'::uuid[]))
     and active = true;
  insert into public.invitation_links(
    email, role, training_group_id, training_group_ids, created_by
  ) values (
    nullif(lower(trim(target_email)),''),
    target_role,
    null,
    case when target_role = 'coach' then clean_groups else '{}'::uuid[] end,
    auth.uid()
  )
  returning * into created;
  return created;
end;
$$;

revoke all on function public.create_staff_invitation_multi(text,public.user_role,uuid[]) from public;
grant execute on function public.create_staff_invitation_multi(text,public.user_role,uuid[]) to authenticated;
