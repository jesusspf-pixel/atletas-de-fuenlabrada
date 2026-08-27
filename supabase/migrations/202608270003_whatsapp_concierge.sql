-- Conversaciones del asistente de WhatsApp. Solo se accede desde las Functions
-- con la service role; no se exponen datos de conversaciones a usuarios públicos.
create table if not exists public.whatsapp_conversations (
  id uuid primary key default gen_random_uuid(),
  whatsapp_id text not null unique,
  contact_name text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.whatsapp_messages (
  id uuid primary key default gen_random_uuid(),
  conversation_id uuid not null references public.whatsapp_conversations(id) on delete cascade,
  direction text not null check (direction in ('inbound','outbound')),
  provider_message_id text unique,
  body text not null,
  raw jsonb,
  created_at timestamptz not null default now()
);

create index if not exists whatsapp_messages_conversation_created_idx
  on public.whatsapp_messages(conversation_id, created_at desc);

create table if not exists public.whatsapp_board_requests (
  id uuid primary key default gen_random_uuid(),
  conversation_id uuid not null references public.whatsapp_conversations(id) on delete cascade,
  category text not null default 'consulta',
  summary text not null,
  status text not null default 'pending' check (status in ('pending','reviewing','answered','closed')),
  created_at timestamptz not null default now(),
  resolved_at timestamptz
);

alter table public.whatsapp_conversations enable row level security;
alter table public.whatsapp_messages enable row level security;
alter table public.whatsapp_board_requests enable row level security;
