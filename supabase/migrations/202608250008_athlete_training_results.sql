-- Los atletas adultos pueden registrar sus propias marcas de entrenamiento.
drop policy if exists "athlete own training insert" on public.athlete_results;
create policy "athlete own training insert" on public.athlete_results
for insert to authenticated
with check (
  source = 'training'
  and official = false
  and created_by = auth.uid()
  and exists (
    select 1
    from public.athletes a
    where a.id = athlete_results.athlete_id
      and a.user_profile_id = auth.uid()
  )
);
