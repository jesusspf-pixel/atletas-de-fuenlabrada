-- Administración de resultados oficiales importados
-- Permite corregir u ocultar una marca errónea y eliminarla cuando proceda.

drop policy if exists "results admins delete" on public.athlete_results;
create policy "results admins delete"
on public.athlete_results
for delete
to authenticated
using (public.is_admin());

comment on policy "results admins delete" on public.athlete_results is
  'Solo administración puede eliminar resultados oficiales importados o corregidos.';