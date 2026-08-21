-- Mejoras operativas: grupos por especialidad, borrado personal de avisos y borrado administrativo.

create table if not exists public.announcement_dismissals (
  announcement_id uuid not null references public.announcements(id) on delete cascade,
  profile_id uuid not null references public.profiles(id) on delete cascade,
  dismissed_at timestamptz not null default now(),
  primary key (announcement_id, profile_id)
);

alter table public.announcement_dismissals enable row level security;

drop policy if exists "announcement dismissals own read" on public.announcement_dismissals;
drop policy if exists "announcement dismissals own write" on public.announcement_dismissals;
drop policy if exists "announcement dismissals own delete" on public.announcement_dismissals;
create policy "announcement dismissals own read" on public.announcement_dismissals
  for select using (profile_id = auth.uid());
create policy "announcement dismissals own write" on public.announcement_dismissals
  for insert with check (profile_id = auth.uid());
create policy "announcement dismissals own delete" on public.announcement_dismissals
  for delete using (profile_id = auth.uid());

drop policy if exists "announcements admins delete" on public.announcements;
create policy "announcements admins delete" on public.announcements
  for delete using (public.is_admin());

-- Conserva las asignaciones existentes y renombra los grupos de mayores por especialidad.
update public.training_groups
set name = 'Sub 14 · Iniciación', category_label = 'Sub 14', schedule_days = 'Lunes a jueves', starts_at = '19:00', ends_at = '20:00', season = '2026'
where name = 'Sub 14';

update public.training_groups
set name = 'Sub 16 · Velocidad y concursos', category_label = 'Sub 16 · Velocidad y concursos', schedule_days = 'Lunes a jueves', starts_at = '19:30', ends_at = '20:30', season = '2026'
where name = 'Sub 16';
update public.training_groups
set name = 'Sub 18 · Velocidad y concursos', category_label = 'Sub 18 · Velocidad y concursos', schedule_days = 'Lunes a jueves', starts_at = '19:30', ends_at = '20:30', season = '2026'
where name = 'Sub 18';
update public.training_groups
set name = 'Sub 20 · Velocidad y concursos', category_label = 'Sub 20 · Velocidad y concursos', schedule_days = 'Lunes a jueves', starts_at = '19:30', ends_at = '20:30', season = '2026'
where name = 'Sub 20';
update public.training_groups
set name = 'Sub 23 · Velocidad y concursos', category_label = 'Sub 23 · Velocidad y concursos', schedule_days = 'Lunes a jueves', starts_at = '19:30', ends_at = '20:30', season = '2026'
where name = 'Sub 23';

insert into public.training_groups (name, category_label, colour, active, schedule_days, starts_at, ends_at, season)
values
  ('Sub 14 · Velocidad y concursos', 'Sub 14 · Velocidad y concursos', '#078a88', true, 'Lunes a jueves', '19:30', '20:30', '2026'),
  ('Sub 14 · Medio fondo y fondo', 'Sub 14 · Medio fondo y fondo', '#0f766e', true, 'Lunes a jueves', '19:30', '20:30', '2026'),
  ('Sub 16 · Medio fondo y fondo', 'Sub 16 · Medio fondo y fondo', '#2563eb', true, 'Lunes a jueves', '19:30', '20:30', '2026'),
  ('Sub 18 · Medio fondo y fondo', 'Sub 18 · Medio fondo y fondo', '#7c3aed', true, 'Lunes a jueves', '19:30', '20:30', '2026'),
  ('Sub 20 · Medio fondo y fondo', 'Sub 20 · Medio fondo y fondo', '#14966a', true, 'Lunes a jueves', '19:30', '20:30', '2026'),
  ('Sub 23 · Medio fondo y fondo', 'Sub 23 · Medio fondo y fondo', '#e27a23', true, 'Lunes a jueves', '19:30', '20:30', '2026')
on conflict (name) do update set
  category_label = excluded.category_label,
  schedule_days = excluded.schedule_days,
  starts_at = excluded.starts_at,
  ends_at = excluded.ends_at,
  season = excluded.season,
  active = true;
