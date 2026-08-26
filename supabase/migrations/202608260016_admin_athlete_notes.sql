drop policy if exists "coach notes admins insert" on public.coach_athlete_notes;
create policy "coach notes admins insert"
on public.coach_athlete_notes
for insert
with check (public.is_admin());
