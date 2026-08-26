# Publicación móvil — Club Atletas de Fuenlabrada

Esta rama contiene los proyectos nativos sin modificar la versión web en producción.

## Identidad aprobada

- Nombre: Atletas de Fuenlabrada
- Propietario, desarrollador y editor: Sportmed Integral Solutions, S.L.
- Club licenciatario: Club Atletas de Fuenlabrada
- Identificador Android/iOS: `com.sportmed.atletasdefuenlabrada`
- Versión inicial: `1.0.0` (`versionCode` / build `1`)
- Web y soporte: `https://www.atletasdefuenlabrada.com`
- Correo de soporte: `info@atletasdefuenlabrada.com`

El mismo modelo se reutilizará con un identificador distinto para cada futuro club licenciatario.

## Ya preparado

- Proyecto Android generado con Capacitor.
- Proyecto iOS generado con Capacitor.
- Contenido web empaquetado localmente; producción permanece independiente.
- API móvil dirigida al servidor HTTPS oficial.
- Apertura de enlaces de retorno del dominio oficial dentro de la aplicación.
- Android App Links declarados para ambos dominios.
- Botones exclusivos de instalación PWA ocultos dentro de las apps nativas.
- Splash, barra de estado y colores base configurados.
- Solicitud autenticada de eliminación de cuenta en `/eliminar-cuenta`.
- Permiso y registro del dispositivo para avisos nativos en Android e iOS.
- Tokens nativos separados de las suscripciones de avisos del navegador.
- Universal Links declarados en iOS para ambos dominios oficiales.

## Necesario antes de firmar

1. Cuenta Google Play Console de organización verificada.
2. Cuenta Apple Developer de organización verificada.
3. Número D-U-N-S de Sportmed Integral Solutions, S.L.
4. Apple Team ID, certificado y perfil de distribución.
5. Clave de firma de Android y huella SHA-256.
6. Ficheros de asociación del dominio para Universal Links / App Links.
7. Firebase para notificaciones Android y APNs para iOS.
8. Política de privacidad definitiva publicada en una URL pública.
9. Solicitud de eliminación de cuenta accesible dentro y fuera de la app.
10. Usuario de demostración estable para los equipos de revisión.

Los avisos nativos no se enviarán todavía: primero deben conectarse las credenciales de Firebase (Android) y APNs (iOS). Los avisos web actuales continúan siendo independientes.

## Pruebas obligatorias antes de enviar

- Inicio, cierre y recuperación de sesión.
- Registro de adulto y familia.
- Alta de tarjeta, retorno de Stripe y confirmación del registro.
- Conexión, retorno y sincronización de Strava.
- Notificaciones con la app abierta, en segundo plano y cerrada.
- Planes de entrenamiento y archivos PDF.
- Tienda y cuotas sin duplicar cobros.
- Roles atleta, familia, entrenador y administrador.
- Eliminación/suspensión de cuenta e información legal.
- Diseño en teléfonos pequeños, tablet Android, iPhone e iPad.

## Flujo de publicación seguro

1. Compilar y probar localmente.
2. Android: prueba interna de Play Console.
3. iOS: TestFlight interno.
4. Corregir únicamente en esta rama.
5. Congelar la versión candidata y guardar los paquetes firmados.
6. Enviar a revisión; la web pública continúa funcionando sin cambios.
