create or replace function public.notify_group_training_plan()
returns trigger language plpgsql security definer set search_path=public as $$
declare notice_id uuid; recipient_id uuid; group_name text;
begin
  if new.published_at is null or (tg_op='UPDATE' and old.published_at is not distinct from new.published_at) then return new; end if;
  select name into group_name from public.training_groups where id=new.training_group_id;
  insert into public.announcements(title,body,audience,training_group_id,delivery_channels,published_at,created_by)
  values('Nuevo plan de entrenamiento',concat('Se ha publicado «',new.title,'» para ',coalesce(group_name,'tu grupo'),'.'), 'group',new.training_group_id,array['app']::text[],now(),new.created_by)
  returning id into notice_id;
  for recipient_id in
    select distinct coalesce(a.user_profile_id,f.primary_profile_id)
    from public.athletes a left join public.families f on f.id=a.family_id
    where a.training_group_id=new.training_group_id and coalesce(a.user_profile_id,f.primary_profile_id) is not null
  loop
    insert into public.announcement_deliveries(announcement_id,recipient_profile_id,channel,delivery_status)
    values(notice_id,recipient_id,'app','sent') on conflict do nothing;
  end loop;
  return new;
end; $$;
drop trigger if exists training_plan_published_notification on public.training_plans;
create trigger training_plan_published_notification after insert or update of published_at on public.training_plans
for each row execute function public.notify_group_training_plan();
