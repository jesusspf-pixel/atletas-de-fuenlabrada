# Preparación definitiva — App Store y Google Play

## Ya preparado en el proyecto

- Proyecto iOS y Android nativos con Capacitor 8.
- Identificador estable `com.sportmed.atletasdefuenlabrada`.
- Versión inicial 1.0, compilación 1.
- Android dirigido a API 36 e iOS con versión mínima 15.
- Iconos y pantallas de inicio oficiales generados para todos los tamaños.
- Configuración de firma Android separada del código y protegida por `.gitignore`.
- Plugins nativos para estado de la app, navegador, notificaciones, splash y barra de estado.
- Dependencias de producción sin vulnerabilidades conocidas en `npm audit --omit=dev`.
- Ninguna modificación en Stripe, webhooks, cuotas o automatismos de cobro.

## Imprescindible antes del envío

1. Matricular Sportmed Integral Solutions S.L. en Apple Developer Program como organización.
2. Crear la cuenta de organización en Google Play Console y completar su verificación.
3. Confirmar que Sportmed puede figurar públicamente como vendedor/desarrollador de la aplicación licenciada al club.
4. Publicar la política de privacidad definitiva en la web.
5. Añadir dentro de la app un flujo real para solicitar la eliminación de la cuenta y publicar su página web equivalente.
6. Crear una cuenta de demostración aislada para los revisores, sin datos personales reales ni cobros activos.
7. Preparar capturas reales: iPhone 6,9 pulgadas, iPad si se mantiene compatible, teléfono Android y tableta Android si se publica para tabletas.
8. Configurar notificaciones nativas: APNs en Apple y `google-services.json`/Firebase en Android. Los archivos privados no se subirán al repositorio.
9. Crear y custodiar la clave de subida Android y los certificados/perfiles Apple.
10. Completar las declaraciones de privacidad, menores, contenido, acceso y seguridad de datos usando `PRIVACY_DATA_MATRIX.md`.

## Pruebas de aceptación

- Registro y confirmación de correo.
- Inicio y cierre de sesión en todos los roles.
- Recuperación de contraseña.
- Atleta/familia: navegación, plan, cuotas, Strava, avisos y tienda.
- Entrenador: grupos, planificación, asistencia, avisos y rendimiento.
- Administrador: altas, atletas, cuotas y rendimiento.
- Enlaces externos, archivos PDF, cámara/selector de imágenes y retorno desde Stripe.
- Notificaciones con la aplicación abierta, en segundo plano y cerrada.
- Pérdida de conexión y recuperación sin pantalla en blanco.
- Tamaños de texto grandes, modo oscuro del dispositivo y orientación permitida.
- Confirmación expresa de que una compilación móvil no altera ni duplica ningún cobro.

## Entregables finales

- Google Play: archivo `.aab` firmado para producción.
- Apple: archivo de Xcode enviado a App Store Connect/TestFlight.
- Copia cifrada de la clave Android y credenciales de recuperación guardada fuera del repositorio.
- Etiqueta Git de la versión publicada y copia del código fuente.
