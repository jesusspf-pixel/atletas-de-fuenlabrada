-- Piloto cerrado: Running A puede tener varios entrenadores, pero un único responsable de planificación.
create table if not exists public.training_group_planning_owners (
  training_group_id uuid primary key references public.training_groups(id) on delete cascade,
  planner_profile_id uuid not null references public.profiles(id) on delete cascade,
  created_at timestamptz not null default now()
);

alter table public.training_group_planning_owners enable row level security;
drop policy if exists "planning owners visible to assigned coaches" on public.training_group_planning_owners;
create policy "planning owners visible to assigned coaches" on public.training_group_planning_owners for select using (
  public.is_admin() or public.coaches_group(training_group_id)
);
drop policy if exists "planning owners admins manage" on public.training_group_planning_owners;
create policy "planning owners admins manage" on public.training_group_planning_owners for all using (public.is_admin()) with check (public.is_admin());

insert into public.training_group_planning_owners(training_group_id, planner_profile_id)
select g.id, p.id
from public.training_groups g
cross join public.profiles p
where lower(regexp_replace(g.name, '\\s+', ' ', 'g')) in ('running a','máster running a','master running a','máster running','master running')
  and lower(regexp_replace(p.email, '\\s+', '', 'g')) = 'atletismourjc@gmail.com'
on conflict (training_group_id) do update set planner_profile_id = excluded.planner_profile_id;

create or replace function public.can_plan_group(group_id uuid)
returns boolean language sql stable security definer set search_path = public
as $$
  select public.is_admin() or case
    when exists (select 1 from public.training_group_planning_owners where training_group_id = group_id)
    then exists (select 1 from public.training_group_planning_owners where training_group_id = group_id and planner_profile_id = auth.uid())
    else public.coaches_group(group_id)
  end
$$;

drop policy if exists "plans managed by group coach" on public.training_plans;
drop policy if exists "plans managed by planning owner" on public.training_plans;
create policy "plans managed by planning owner" on public.training_plans for all
using (public.can_plan_group(training_group_id))
with check (public.can_plan_group(training_group_id));
