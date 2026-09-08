-- El plan semanal es compartido por todo el equipo técnico asignado al grupo.
-- El copiloto de IA conserva sus permisos propios y no depende de esta política.
drop policy if exists "plans managed by planning owner" on public.training_plans;
drop policy if exists "plans managed by group coach" on public.training_plans;
create policy "plans managed by group coach" on public.training_plans for all
using (public.can_manage_group(training_group_id))
with check (public.can_manage_group(training_group_id));

drop policy if exists "plans visible to group" on public.training_plans;
create policy "plans visible to group" on public.training_plans for select using (
  public.is_admin()
  or public.coaches_group(training_group_id)
  or exists (
    select 1
    from public.athletes a
    join public.families f on f.id = a.family_id
    where a.training_group_id = training_plans.training_group_id
      and f.primary_profile_id = auth.uid()
  )
  or exists (
    select 1
    from public.athletes a
    where a.training_group_id = training_plans.training_group_id
      and a.user_profile_id = auth.uid()
  )
);
