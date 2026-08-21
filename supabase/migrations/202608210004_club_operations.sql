-- Operativa completa del club: horarios, avisos, calendario, disponibilidad y PDFs.
-- Ejecutar después de las migraciones anteriores.

alter table public.training_groups
  add column if not exists schedule_days text,
  add column if not exists starts_at time,
  add column if not exists ends_at time,
  add column if not exists season text not null default '2026';

insert into public.training_groups (name, category_label, colour, active, schedule_days, starts_at, ends_at, season)
values
  ('Sub 6 · L-X', 'Sub 6', '#2563eb', true, 'Lunes y miércoles', '17:00', '18:00', '2026'),
  ('Sub 6 · M-J', 'Sub 6', '#2563eb', true, 'Martes y jueves', '17:00', '18:00', '2026'),
  ('Sub 8 · L-X', 'Sub 8', '#7c3aed', true, 'Lunes y miércoles', '17:00', '18:00', '2026'),
  ('Sub 8 · M-J', 'Sub 8', '#7c3aed', true, 'Martes y jueves', '17:00', '18:00', '2026'),
  ('Sub 10 · L-X', 'Sub 10', '#14966a', true, 'Lunes y miércoles', '17:00', '18:00', '2026'),
  ('Sub 10 · M-J', 'Sub 10', '#14966a', true, 'Martes y jueves', '17:00', '18:00', '2026'),
  ('Sub 12 · L-X', 'Sub 12', '#e27a23', true, 'Lunes y miércoles', '18:00', '19:00', '2026'),
  ('Sub 12 · M-J', 'Sub 12', '#e27a23', true, 'Martes y jueves', '18:00', '19:00', '2026'),
  ('Sub 14', 'Sub 14', '#078a88', true, 'Lunes a jueves', '18:00', '19:00', '2026'),
  ('Sub 16', 'Sub 16', '#2563eb', true, 'Lunes a jueves', '19:30', '20:30', '2026'),
  ('Sub 18', 'Sub 18', '#7c3aed', true, 'Lunes a jueves', '19:30', '20:30', '2026'),
  ('Sub 20', 'Sub 20', '#14966a', true, 'Lunes a jueves', '19:30', '20:30', '2026'),
  ('Sub 23', 'Sub 23', '#e27a23', true, 'Lunes a jueves', '19:30', '20:30', '2026'),
  ('Máster A', 'Máster A', '#078a88', true, 'Lunes a jueves', '19:30', '20:30', '2026'),
  ('Máster B', 'Máster B', '#385898', true, 'Lunes a jueves', '19:30', '20:30', '2026')
on conflict (name) do update set
  category_label = excluded.category_label,
  schedule_days = excluded.schedule_days,
  starts_at = excluded.starts_at,
  ends_at = excluded.ends_at,
  season = excluded.season,
  active = true;

alter table public.competition_coach_attendance
  add column if not exists available boolean not null default true,
  add column if not exists responded_at timestamptz not null default now();

alter table public.announcements drop constraint if exists announcements_audience_check;
alter table public.announcements
  add constraint announcements_audience_check check (audience in ('club','group','staff','individual'));
alter table public.announcements
  add column if not exists delivery_channels text[] not null default array['app']::text[];

create table if not exists public.announcement_deliveries (
  announcement_id uuid not null references public.announcements(id) on delete cascade,
  recipient_profile_id uuid not null references public.profiles(id) on delete cascade,
  channel text not null check (channel in ('app','email')),
  delivery_status text not null default 'pending' check (delivery_status in ('pending','sent','failed')),
  created_at timestamptz not null default now(),
  primary key (announcement_id, recipient_profile_id, channel)
);

create table if not exists public.club_documents (
  id uuid primary key default gen_random_uuid(),
  document_type text not null check (document_type in ('competition_circular','training_plan','license_form')),
  title text not null,
  storage_path text not null unique,
  competition_event_id uuid references public.competition_events(id) on delete cascade,
  training_group_id uuid references public.training_groups(id) on delete cascade,
  uploaded_by uuid not null references public.profiles(id),
  created_at timestamptz not null default now()
);

insert into storage.buckets (id, name, public)
values ('club-private-documents', 'club-private-documents', false)
on conflict (id) do nothing;

alter table public.announcement_deliveries enable row level security;
alter table public.club_documents enable row level security;

drop policy if exists "announcements visible by audience" on public.announcements;
create policy "announcements visible by audience" on public.announcements for select using (
  public.is_admin()
  or audience = 'club'
  or (audience = 'staff' and exists (select 1 from public.profiles p where p.id = auth.uid() and p.role in ('owner','admin','coach')))
  or (audience = 'group' and public.coaches_group(training_group_id))
  or (audience = 'group' and exists (select 1 from public.athletes a join public.families f on f.id = a.family_id where a.training_group_id = announcements.training_group_id and f.primary_profile_id = auth.uid()))
  or (audience = 'group' and exists (select 1 from public.athletes a where a.training_group_id = announcements.training_group_id and a.user_profile_id = auth.uid()))
  or (audience = 'individual' and exists (select 1 from public.announcement_deliveries d where d.announcement_id = announcements.id and d.recipient_profile_id = auth.uid()))
);

create policy "announcement deliveries visible to recipient or admin" on public.announcement_deliveries for select using (
  recipient_profile_id = auth.uid() or public.is_admin()
);
create policy "announcement deliveries created by club staff" on public.announcement_deliveries for insert with check (
  public.is_admin() or exists (select 1 from public.announcements a where a.id = announcement_id and a.created_by = auth.uid())
);

drop policy if exists "competition coach attendance admin manage" on public.competition_coach_attendance;
create policy "competition coach availability manage" on public.competition_coach_attendance for all using (
  public.is_admin() or coach_profile_id = auth.uid()
) with check (
  public.is_admin() or coach_profile_id = auth.uid()
);

create policy "club documents visible authenticated" on public.club_documents for select using (auth.uid() is not null);
create policy "club documents uploaded by admin or group coach" on public.club_documents for insert with check (
  public.is_admin() or (training_group_id is not null and public.coaches_group(training_group_id))
);
create policy "club documents admin delete" on public.club_documents for delete using (public.is_admin());

create policy "club document storage read" on storage.objects for select using (
  bucket_id = 'club-private-documents' and auth.uid() is not null
);
create policy "club document storage upload" on storage.objects for insert with check (
  bucket_id = 'club-private-documents' and auth.uid() is not null
);
create policy "club document storage admin delete" on storage.objects for delete using (
  bucket_id = 'club-private-documents' and public.is_admin()
);
