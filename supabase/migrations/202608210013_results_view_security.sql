-- Las vistas deportivas deben respetar las políticas RLS de las tablas base.
-- PostgreSQL 15+ / Supabase: security_invoker ejecuta la vista con permisos del usuario.

alter view public.athlete_personal_bests set (security_invoker = true);
alter view public.club_event_rankings set (security_invoker = true);

-- Las familias necesitan sus propias mejores marcas; el ranking global queda reservado al equipo.
revoke all on public.club_event_rankings from authenticated;
grant select on public.club_event_rankings to authenticated;

-- La vista sigue filtrada por RLS de athlete_results/athletes; adicionalmente la UI solo la expone a staff.
