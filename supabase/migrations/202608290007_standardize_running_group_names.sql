-- Nombre único y coherente para los dos grupos de adultos en toda la plataforma.
update public.training_groups
set name = 'Running A', category_label = 'Absoluto / Máster'
where active = true
  and lower(regexp_replace(trim(name), '\\s+', ' ', 'g')) in (
    'máster a', 'master a', 'máster running a', 'master running a', 'máster running', 'master running'
  );

update public.training_groups
set name = 'Running B', category_label = 'Absoluto / Máster'
where active = true
  and lower(regexp_replace(trim(name), '\\s+', ' ', 'g')) in (
    'máster b', 'master b', 'máster running b', 'master running b'
  );

update public.training_groups
set name = 'Archivo Running A'
where active = false and lower(name) in ('archivo máster a','archivo master a','archivo máster running a','archivo master running a');

update public.training_groups
set name = 'Archivo Running B'
where active = false and lower(name) in ('archivo máster b','archivo master b','archivo máster running b','archivo master running b');
