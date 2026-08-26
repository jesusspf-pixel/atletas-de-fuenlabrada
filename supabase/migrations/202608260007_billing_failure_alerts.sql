create table if not exists public.billing_failure_alerts(
  draft_id uuid primary key references public.billing_charge_drafts(id) on delete cascade,
  announcement_id uuid references public.announcements(id) on delete set null,
  created_at timestamptz not null default now()
);

alter table public.billing_failure_alerts enable row level security;
revoke all on public.billing_failure_alerts from anon,authenticated;

create or replace function public.notify_failed_billing_charge()
returns trigger language plpgsql security definer set search_path=public as $$
declare notice_id uuid; creator uuid; athlete_name text; amount_text text; recipient uuid;
begin
  if new.status <> 'failed' or old.status = 'failed' then return new; end if;
  if exists(select 1 from public.billing_failure_alerts where draft_id=new.id) then return new; end if;
  select id into creator from public.profiles where role in ('owner','admin') order by case when role='owner' then 0 else 1 end limit 1;
  if creator is null then return new; end if;
  select trim(first_name||' '||last_name) into athlete_name from public.athletes where id=new.athlete_id;
  amount_text := to_char(coalesce(new.approved_amount_cents,new.calculated_amount_cents)/100.0,'FM999990D00');
  insert into public.announcements(title,body,audience,delivery_channels,published_at,created_by)
  values('Cobro rechazado',concat('Ha fallado el cobro de ',amount_text,' € de ',coalesce(athlete_name,'un atleta'),'. ',coalesce(new.admin_note,'Revisar el pago en Cuotas.')),'individual',array['app','email']::text[],now(),creator)
  returning id into notice_id;
  for recipient in select id from public.profiles where role in ('owner','admin') union select new.payer_profile_id where new.payer_profile_id is not null loop
    insert into public.announcement_deliveries(announcement_id,recipient_profile_id,channel,delivery_status) values(notice_id,recipient,'app','sent') on conflict do nothing;
  end loop;
  insert into public.billing_failure_alerts(draft_id,announcement_id) values(new.id,notice_id);
  return new;
end $$;

drop trigger if exists billing_charge_failure_notification on public.billing_charge_drafts;
create trigger billing_charge_failure_notification after update of status on public.billing_charge_drafts
for each row execute function public.notify_failed_billing_charge();
