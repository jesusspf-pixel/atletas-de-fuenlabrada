-- Logros automáticos basados en actividad deportiva importada.

create or replace function public.refresh_club_challenge_achievements(target_athlete_id uuid)
returns void language plpgsql security definer set search_path = public as $$
declare
  total_km numeric;
  active_weeks integer;
  opted boolean;
begin
  select coalesce(challenge_opt_in,false) into opted from public.athlete_profile_settings where athlete_id=target_athlete_id;
  if not opted then return; end if;

  select coalesce(sum(distance_m),0)/1000.0 into total_km from public.external_sport_activities where athlete_id=target_athlete_id;
  select count(distinct date_trunc('week', started_at)) into active_weeks from public.external_sport_activities where athlete_id=target_athlete_id and started_at >= now() - interval '28 days';

  if total_km >= 100 then insert into public.athlete_achievements(athlete_id,achievement_key,title,description) values(target_athlete_id,'distance_100','100 km del club','Has acumulado 100 km de actividad conectada.') on conflict do nothing; end if;
  if total_km >= 250 then insert into public.athlete_achievements(athlete_id,achievement_key,title,description) values(target_athlete_id,'distance_250','250 km del club','Has acumulado 250 km de actividad conectada.') on conflict do nothing; end if;
  if total_km >= 500 then insert into public.athlete_achievements(athlete_id,achievement_key,title,description) values(target_athlete_id,'distance_500','500 km del club','Has acumulado 500 km de actividad conectada.') on conflict do nothing; end if;
  if total_km >= 1000 then insert into public.athlete_achievements(athlete_id,achievement_key,title,description) values(target_athlete_id,'distance_1000','1.000 km del club','Has alcanzado 1.000 km de actividad conectada.') on conflict do nothing; end if;
  if active_weeks >= 4 then insert into public.athlete_achievements(athlete_id,achievement_key,title,description) values(target_athlete_id,'four_week_streak','4 semanas en marcha','Has registrado actividad en cuatro semanas consecutivas del último mes.') on conflict do nothing; end if;
end;
$$;

create or replace function public.external_activity_refresh_achievements()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  perform public.refresh_club_challenge_achievements(new.athlete_id);
  return new;
end;
$$;
drop trigger if exists external_activity_achievements_after_write on public.external_sport_activities;
create trigger external_activity_achievements_after_write
after insert or update of distance_m, started_at on public.external_sport_activities
for each row execute function public.external_activity_refresh_achievements();
