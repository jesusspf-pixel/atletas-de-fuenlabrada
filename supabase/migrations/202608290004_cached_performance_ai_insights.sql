create table if not exists public.performance_ai_insights (
  id uuid primary key default gen_random_uuid(),
  athlete_id uuid not null references public.athletes(id) on delete cascade,
  analysis_date date not null default current_date,
  input_signature text not null,
  insight jsonb not null,
  model text not null default 'claude-sonnet-5',
  input_tokens integer,
  output_tokens integer,
  created_at timestamptz not null default now(),
  unique (athlete_id, analysis_date)
);

create index if not exists performance_ai_insights_athlete_created_idx
  on public.performance_ai_insights(athlete_id, created_at desc);

alter table public.performance_ai_insights enable row level security;

comment on table public.performance_ai_insights is
  'Análisis diarios agregados. Solo se accede mediante la Function autenticada; no contiene datos identificativos.';
