-- Los atletas adultos pueden escoger Running o entrenar con el grupo superior
-- de pista (Sub 23) según su especialidad. La categoría federativa continúa
-- siendo Absoluto / Máster; solo se amplían los grupos de entrenamiento válidos.
create or replace function public.enforce_registration_training_group()
returns trigger
language plpgsql
set search_path = public
as $$
declare
  training_year integer := extract(year from current_date)::integer
    + case when extract(month from current_date) >= 7 then 1 else 0 end;
  expected_category text;
  group_description text;
  normalized_expected text;
  normalized_group text;
begin
  expected_category := public.category_for_year(new.birth_date, training_year);
  new.training_category := expected_category;
  new.official_competition_category := public.category_for_year(
    new.birth_date,
    extract(year from current_date)::integer
  );

  if new.training_group_id is null then
    raise exception 'Selecciona el grupo de entrenamiento correspondiente a %.', expected_category;
  end if;

  select concat_ws(' ', name, category_label)
  into group_description
  from public.training_groups
  where id = new.training_group_id and active = true;

  if group_description is null then
    raise exception 'El grupo de entrenamiento seleccionado no está disponible.';
  end if;

  normalized_expected := regexp_replace(lower(expected_category), '[^a-z0-9]+', '', 'g');
  normalized_group := regexp_replace(lower(group_description), '[^a-z0-9]+', '', 'g');

  if expected_category = 'Absoluto / Máster' then
    if lower(group_description) !~ '(running|master|máster|absoluto)'
      and not (
        lower(group_description) ~ 'sub[[:space:]]*23'
        and lower(group_description) ~ '(velocidad|concurso|medio[[:space:]]*fondo|fondo)'
      ) then
      raise exception 'Selecciona un grupo adulto de Running, velocidad/concursos o medio fondo/fondo.';
    end if;
  elsif normalized_group not like normalized_expected || '%' then
    raise exception 'Por edad corresponde %, no el grupo seleccionado.', expected_category;
  end if;

  return new;
end;
$$;
