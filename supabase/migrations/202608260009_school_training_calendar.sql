create table if not exists public.school_calendar_days (
  calendar_date date primary key,
  is_lective boolean not null,
  reason text,
  source_url text,
  updated_at timestamptz not null default now()
);

alter table public.school_calendar_days enable row level security;
drop policy if exists "school calendar visible to club" on public.school_calendar_days;
create policy "school calendar visible to club" on public.school_calendar_days for select using (auth.uid() is not null);
drop policy if exists "school calendar admins manage" on public.school_calendar_days;
create policy "school calendar admins manage" on public.school_calendar_days for all using (public.is_admin()) with check (public.is_admin());

alter table public.attendance_sessions add column if not exists calendar_generated boolean not null default false;
alter table public.attendance_sessions add column if not exists calendar_note text;
create unique index if not exists attendance_sessions_group_start_unique on public.attendance_sessions(training_group_id,starts_at);

insert into public.school_calendar_days(calendar_date,is_lective,reason,source_url)
select day::date,extract(isodow from day)<6,null,'https://www.bocm.es/boletin/CM_Orden_BOCM/2026/06/04/BOCM-20260604-13.PDF'
from generate_series('2026-09-07'::date,'2027-06-18'::date,'1 day') day
on conflict(calendar_date) do update set is_lective=excluded.is_lective,reason=excluded.reason,source_url=excluded.source_url,updated_at=now();

update public.school_calendar_days set is_lective=false,reason='Fiesta local de Fuenlabrada'
where calendar_date='2026-09-14';
update public.school_calendar_days set is_lective=false,reason='Festividad oficial'
where calendar_date in ('2026-10-12','2026-11-02','2026-12-07','2026-12-08');
update public.school_calendar_days set is_lective=false,reason='Vacaciones de Navidad'
where calendar_date between '2026-12-23' and '2027-01-06';
update public.school_calendar_days set is_lective=false,reason='Día no lectivo'
where calendar_date in ('2027-01-07','2027-01-08','2027-02-12','2027-02-15','2027-03-19','2027-03-29');
update public.school_calendar_days set is_lective=false,reason='Vacaciones de Semana Santa'
where calendar_date between '2027-03-20' and '2027-03-28';

create or replace function public.regenerate_training_calendar(target_from date default current_date,target_to date default '2027-06-18')
returns integer language plpgsql security definer set search_path=public as $$
declare creator uuid; inserted_count integer;
begin
  if not public.is_admin() and coalesce(auth.role(),'')<>'service_role' and current_user not in ('postgres','supabase_admin') then raise exception 'Solo administración puede regenerar el calendario.'; end if;
  select id into creator from public.profiles where role in ('owner','admin') order by case when id=auth.uid() then 0 when role='owner' then 1 else 2 end limit 1;
  -- A fresh review database intentionally starts without real club accounts.
  -- Leave the calendar empty until the dedicated reviewer account exists.
  if creator is null then return 0; end if;
  delete from public.attendance_sessions where calendar_generated and starts_at::date between target_from and target_to;
  insert into public.attendance_sessions(training_group_id,starts_at,ends_at,created_by,calendar_generated,calendar_note)
  select g.id,
    ((c.calendar_date+g.starts_at) at time zone 'Europe/Madrid'),
    case when g.ends_at is null then null else ((c.calendar_date+g.ends_at) at time zone 'Europe/Madrid') end,
    creator,true,'Calendario lectivo Fuenlabrada 2026/27'
  from public.training_groups g cross join public.school_calendar_days c
  where g.active and g.starts_at is not null and c.is_lective and c.calendar_date between target_from and target_to
    and case
      when lower(coalesce(g.schedule_days,'')) like '%lunes a jueves%' then extract(isodow from c.calendar_date) between 1 and 4
      when lower(coalesce(g.schedule_days,'')) like '%lunes a viernes%' then extract(isodow from c.calendar_date) between 1 and 5
      else (extract(isodow from c.calendar_date)=1 and lower(coalesce(g.schedule_days,'')) like '%lunes%')
        or (extract(isodow from c.calendar_date)=2 and lower(coalesce(g.schedule_days,'')) like '%martes%')
        or (extract(isodow from c.calendar_date)=3 and lower(coalesce(g.schedule_days,'')) like '%mi_rcoles%')
        or (extract(isodow from c.calendar_date)=4 and lower(coalesce(g.schedule_days,'')) like '%jueves%')
        or (extract(isodow from c.calendar_date)=5 and lower(coalesce(g.schedule_days,'')) like '%viernes%')
    end
  on conflict(training_group_id,starts_at) do update set ends_at=excluded.ends_at,calendar_generated=true,calendar_note=excluded.calendar_note;
  get diagnostics inserted_count=row_count;
  return inserted_count;
end $$;

grant execute on function public.regenerate_training_calendar(date,date) to authenticated;

select public.regenerate_training_calendar('2026-09-07','2027-06-18');
