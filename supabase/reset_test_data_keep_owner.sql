-- REINICIO TOTAL DE PRUEBAS
-- Conserva ÚNICAMENTE la cuenta administradora jesusspf@gmail.com.
-- Elimina datos de pruebas: usuarios, familias, atletas, cuotas, cobros,
-- tarjetas referenciadas, pedidos, asistencia, mensajes, avisos y solicitudes.
-- NO borra la configuración del club: grupos, productos, reglas de cuotas,
-- documentos ni ajustes.
--
-- Ejecutar una sola vez en Supabase > SQL Editor.
-- Operación irreversible para los datos de prueba.

begin;

do $$
declare
  keep_owner uuid;
begin
  select id into keep_owner
  from auth.users
  where lower(email) = 'jesusspf@gmail.com'
  limit 1;

  if keep_owner is null then
    raise exception 'No se encontró jesusspf@gmail.com. No se ha borrado nada.';
  end if;

  -- Comunicaciones, tienda, mensajes y asistencia de pruebas
  delete from public.announcement_dismissals;
  delete from public.announcement_reads;
  delete from public.announcement_deliveries;
  delete from public.announcement_sender_archives;
  delete from public.announcements;
  delete from public.club_order_items;
  delete from public.club_orders;
  delete from public.coach_athlete_messages;
  delete from public.coach_messages;
  delete from public.coach_athlete_notes;
  delete from public.competition_coach_attendance;
  delete from public.competition_entries;
  delete from public.attendance_records;
  delete from public.attendance_sessions;

  -- Información deportiva y federativa de los atletas de prueba
  delete from public.federation_license_applications;
  delete from public.federation_result_rows;
  delete from public.athlete_achievements;
  delete from public.athlete_results;
  delete from public.external_sport_activities;
  delete from public.athlete_integration_tokens;
  delete from public.athlete_external_integrations;
  delete from public.athlete_profile_settings;
  delete from public.health_declarations;
  delete from public.consents;

  -- Cobros, matrículas, métodos de pago guardados y cuotas programadas
  delete from public.billing_charge_drafts;
  delete from public.payment_ledger;
  delete from public.registration_payment_methods;
  delete from public.stripe_customers;
  delete from public.memberships;

  -- Altas e identidades de prueba
  delete from public.invitation_links;
  delete from public.invitations;
  delete from public.external_oauth_states;
  delete from public.family_notification_preferences;
  delete from public.athletes;
  delete from public.families;
  delete from public.profile_roles where profile_id <> keep_owner;

  -- Conservamos la cuenta de administrador y su rol. Eliminamos el resto.
  update public.audit_log set actor_id = null where actor_id <> keep_owner;
  delete from public.profiles where id <> keep_owner;
  delete from auth.users where id <> keep_owner;
end $$;

commit;

-- Verificación esperada:
select
  (select count(*) from auth.users) as usuarios_restantes,
  (select count(*) from public.athletes) as atletas_restantes,
  (select count(*) from public.billing_charge_drafts) as cuotas_restantes;
