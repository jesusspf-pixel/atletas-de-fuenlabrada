# Club Atletas de Fuenlabrada

Aplicación web instalable para familias, atletas, entrenadores y administración del Club Atletas de Fuenlabrada.

## Arquitectura

- **Frontend/PWA:** React + Vite, desplegable en Cloudflare Pages.
- **Datos, usuarios y permisos:** Supabase (PostgreSQL + Auth + RLS), región europea.
- **Pagos:** diseño preparado para Stripe y TPV Santander. Las tarjetas se capturan únicamente en el formulario tokenizado del proveedor; nunca en esta web ni en Supabase.

## Puesta en marcha

1. En Supabase, abre **SQL Editor** y ejecuta `supabase/migrations/202608200001_club_core.sql`.
2. En **Project settings → API**, copia la URL y la clave pública/publishable.
3. Crea `.env.local` a partir de `.env.example` y rellena esos dos valores públicos.
4. Ejecuta `npm install` y `npm run build`.
5. En Cloudflare Pages importa este repositorio, usa `npm run build` y publica la carpeta `dist`.

## Seguridad operativa

- No subir `.env.local`, credenciales de Stripe, claves `service_role`, contraseñas ni exportaciones de familias.
- Antes de abrir inscripciones: cargar versiones definitivas de privacidad, salud, imágenes, normativa/FAM y someterlas a revisión legal.
- Los cargos se crean como borrador y requieren aprobación de administrador antes de enviarlos al proveedor.
