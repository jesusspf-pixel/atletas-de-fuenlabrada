-- Rol de administración operativa estrictamente de solo lectura.
-- Se mantiene separado de admin para que nunca herede permisos de escritura.
alter type public.user_role add value if not exists 'administrative_viewer';
