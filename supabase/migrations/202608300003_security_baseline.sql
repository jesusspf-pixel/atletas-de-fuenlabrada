-- Security baseline. This migration deliberately does not modify billing,
-- Stripe webhooks, charge scheduling or payment ledger behavior.

alter table public.audit_log enable row level security;
revoke all on table public.audit_log from anon, authenticated;

create table if not exists public.security_rate_limits (
  action text not null,
  key_hash text not null,
  window_started_at timestamptz not null default now(),
  request_count integer not null default 1 check (request_count > 0),
  primary key (action, key_hash)
);

alter table public.security_rate_limits enable row level security;
revoke all on table public.security_rate_limits from anon, authenticated;

create or replace function public.consume_public_rate_limit(
  target_action text,
  target_key_hash text,
  max_requests integer,
  window_seconds integer
) returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  current_count integer;
begin
  if length(target_action) not between 1 and 64
     or target_key_hash !~ '^[0-9a-f]{64}$'
     or max_requests not between 1 and 100
     or window_seconds not between 60 and 86400 then
    return false;
  end if;

  insert into public.security_rate_limits(action, key_hash, window_started_at, request_count)
  values(target_action, target_key_hash, now(), 1)
  on conflict(action, key_hash) do update
    set request_count = case
          when security_rate_limits.window_started_at <= now() - make_interval(secs => window_seconds)
            then 1
          else security_rate_limits.request_count + 1
        end,
        window_started_at = case
          when security_rate_limits.window_started_at <= now() - make_interval(secs => window_seconds)
            then now()
          else security_rate_limits.window_started_at
        end
  returning request_count into current_count;

  delete from public.security_rate_limits
  where window_started_at < now() - interval '2 days';

  return current_count <= max_requests;
end;
$$;

revoke all on function public.consume_public_rate_limit(text, text, integer, integer) from public, anon, authenticated;
grant execute on function public.consume_public_rate_limit(text, text, integer, integer) to service_role;

update storage.buckets
set file_size_limit = 5242880,
    allowed_mime_types = array['image/jpeg','image/png','image/webp','image/heic','image/heif']
where id = 'athlete-profiles';

update storage.buckets
set file_size_limit = 8388608,
    allowed_mime_types = array['image/jpeg','image/png','image/webp']
where id in ('club-store-images','club-assets');

update storage.buckets
set file_size_limit = 15728640,
    allowed_mime_types = array['application/pdf']
where id = 'club-private-documents';

drop policy if exists "club document storage upload" on storage.objects;
create policy "club private documents staff upload"
  on storage.objects for insert
  with check (bucket_id = 'club-private-documents' and public.is_staff());
