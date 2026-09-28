-- Registra las condiciones de uso y versiona los documentos legales vigentes.
alter table public.consents drop constraint if exists consents_consent_type_check;
alter table public.consents add constraint consents_consent_type_check
  check (consent_type in ('privacy','health_data','image_use','fam_data','club_rules','recurring_payment','app_terms'));

create or replace function public.stamp_current_consent_document_version()
returns trigger language plpgsql as $$
begin
  new.document_version := '2026-09-28';
  return new;
end $$;

drop trigger if exists stamp_current_consent_document_version on public.consents;
create trigger stamp_current_consent_document_version
before insert on public.consents
for each row execute function public.stamp_current_consent_document_version();
