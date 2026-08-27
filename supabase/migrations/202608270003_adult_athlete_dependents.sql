-- Una misma cuenta puede ser atleta adulto y responsable de menores.
-- El rol principal no se sustituye: se añade el permiso familiar complementario.

create or replace function public.sync_family_profile_role()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profile_roles(profile_id, role)
  values (new.primary_profile_id, 'parent')
  on conflict do nothing;
  return new;
end;
$$;

drop trigger if exists sync_family_profile_role_after_insert on public.families;
create trigger sync_family_profile_role_after_insert
after insert on public.families
for each row execute function public.sync_family_profile_role();

insert into public.profile_roles(profile_id, role)
select distinct primary_profile_id, 'parent'::public.user_role
from public.families
on conflict do nothing;
