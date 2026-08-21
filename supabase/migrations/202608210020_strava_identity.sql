alter table public.athlete_external_integrations
  add column if not exists provider_display_name text,
  add column if not exists provider_avatar_url text;
