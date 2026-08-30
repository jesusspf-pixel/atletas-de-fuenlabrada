# Declaración de datos para Apple y Google

Esta matriz sirve para completar App Privacy y Data Safety. Debe validarla el responsable legal antes del envío.

| Categoría | Uso previsto | Compartición / tratamiento |
| --- | --- | --- |
| Nombre, apellidos, correo y teléfono | Cuenta, identificación y comunicaciones del club | Supabase y proveedores necesarios para operar el servicio |
| Datos de menores y tutores | Gestión familiar y deportiva | Acceso restringido según rol |
| Datos deportivos, asistencia, marcas y planes | Prestación del servicio deportivo | Club, entrenadores autorizados y usuario correspondiente |
| Actividades de carrera y frecuencia cardiaca de Strava | Análisis deportivo voluntario | Strava, infraestructura de la aplicación y proveedor de análisis cuando se solicite |
| Fotos de perfil | Identificación dentro del club | Usuarios autorizados según la función |
| Información de cuotas y estado de pagos | Gestión económica del club | Stripe; la aplicación no debe almacenar números completos de tarjeta |
| Notificaciones | Avisos operativos y deportivos | Servicio de notificaciones de Apple/Google y backend del club |
| Registros técnicos y diagnóstico | Seguridad, prevención de fraude y resolución de errores | Proveedores de infraestructura y observabilidad |

Principios obligatorios:

- No usar datos deportivos o de menores con fines publicitarios.
- No vender datos personales.
- Pedir consentimiento separado para Strava, notificaciones e imágenes cuando corresponda.
- Mostrar solo los datos mínimos necesarios para cada rol.
- Mantener el historial económico que exija la ley aunque se cierre la cuenta; anonimizar o borrar el resto según proceda.
- No incluir secretos, claves de Stripe, Supabase, Claude ni certificados dentro de la aplicación móvil.
