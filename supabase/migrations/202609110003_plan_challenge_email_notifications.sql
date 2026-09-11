-- Operational email alerts for weekly plans, challenges and duels.
-- Each source record reuses its UUID as the announcement UUID. This makes the
-- notification idempotent: editing or retrying the same item never creates a
-- second email delivery for the same recipient.

create or replace function public.notification_profile_for_athlete(target_athlete_id uuid)
returns uuid language sql stable security definer set search_path=public as $$
  select coalesce(a.user_profile_id, f.primary_profile_id)
  from public.athletes a
  left join public.families f on f.id=a.family_id
  where a.id=target_athlete_id
  limit 1
$$;

revoke all on function public.notification_profile_for_athlete(uuid) from public;
grant execute on function public.notification_profile_for_athlete(uuid) to service_role;

create or replace function public.notify_group_training_plan()
returns trigger language plpgsql security definer set search_path=public as $$
declare recipient_id uuid; group_name text;
begin
  if new.published_at is null then return new; end if;
  select name into group_name from public.training_groups where id=new.training_group_id;

  insert into public.announcements(
    id,title,body,audience,training_group_id,delivery_channels,published_at,created_by
  ) values (
    new.id,
    'Nuevo plan semanal · ' || coalesce(group_name,'Tu grupo'),
    'Ya está disponible «' || new.title || '», el plan de la semana de ' ||
      to_char(new.week_starts_on,'DD/MM/YYYY') || '.',
    'group',new.training_group_id,array['app','email']::text[],new.published_at,new.created_by
  ) on conflict(id) do update set
    title=excluded.title,
    body=excluded.body,
    training_group_id=excluded.training_group_id,
    delivery_channels=excluded.delivery_channels,
    published_at=excluded.published_at;

  for recipient_id in
    select distinct coalesce(a.user_profile_id,f.primary_profile_id)
    from public.athletes a
    left join public.families f on f.id=a.family_id
    where a.training_group_id=new.training_group_id
      and coalesce(a.user_profile_id,f.primary_profile_id) is not null
  loop
    insert into public.announcement_deliveries(
      announcement_id,recipient_profile_id,channel,delivery_status
    ) values
      (new.id,recipient_id,'app','sent'),
      (new.id,recipient_id,'email','pending')
    on conflict do nothing;
  end loop;
  return new;
end; $$;

drop trigger if exists training_plan_published_notification on public.training_plans;
create trigger training_plan_published_notification
after insert or update of published_at on public.training_plans
for each row execute function public.notify_group_training_plan();

create or replace function public.notify_challenge_participant()
returns trigger language plpgsql security definer set search_path=public as $$
declare
  challenge_row public.club_challenges;
  recipient_id uuid;
  notice_title text;
  notice_body text;
begin
  select * into challenge_row from public.club_challenges where id=new.challenge_id;
  if challenge_row.id is null then return new; end if;

  recipient_id:=public.notification_profile_for_athlete(new.athlete_id);
  if recipient_id is null or recipient_id=challenge_row.created_by then return new; end if;

  if challenge_row.scope='duel' then
    if new.status<>'pending' then return new; end if;
    notice_title:='Te han retado a un duelo';
    notice_body:='Tienes un nuevo duelo: «' || challenge_row.title || '». Entra para aceptarlo o rechazarlo.';
  else
    notice_title:=case when challenge_row.scope='group' then 'Nuevo reto para tu grupo' else 'Nuevo reto del club' end;
    notice_body:='Se ha creado «' || challenge_row.title || '». Entra para consultar el objetivo y seguir el progreso.';
  end if;

  insert into public.announcements(
    id,title,body,audience,training_group_id,delivery_channels,published_at,created_by
  ) values (
    challenge_row.id,notice_title,notice_body,
    case when challenge_row.scope='duel' then 'individual' else challenge_row.scope end,
    challenge_row.training_group_id,array['app','email']::text[],now(),challenge_row.created_by
  ) on conflict(id) do nothing;

  insert into public.announcement_deliveries(
    announcement_id,recipient_profile_id,channel,delivery_status
  ) values
    (challenge_row.id,recipient_id,'app','sent'),
    (challenge_row.id,recipient_id,'email','pending')
  on conflict do nothing;
  return new;
end; $$;

drop trigger if exists club_challenge_participant_notification on public.club_challenge_participants;
create trigger club_challenge_participant_notification
after insert on public.club_challenge_participants
for each row execute function public.notify_challenge_participant();

