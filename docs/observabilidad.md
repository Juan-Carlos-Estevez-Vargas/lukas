# Observabilidad

Errores a **Sentry** y uso a **PostHog** (FIN-406), los dos en su plan gratuito. No se usan sus
SDKs: la API y la app les hablan por HTTP detrás de un puerto. Así la app pesa menos, el Worker
no crece y todo pasa por una sola limpieza de datos personales (`packages/domain/src/telemetry.ts`).

## Qué se envía y qué no

| Se envía                             | Nunca se envía                                 |
| ------------------------------------ | ---------------------------------------------- |
| Tipo y mensaje del error, ya limpios | Correos, celulares, cédulas, números de cuenta |
| Pila de llamadas, limpia y recortada | Números de tarjeta (se tapan con Luhn)         |
| Ruta o pantalla sin query string     | Tokens de sesión, JWT, encabezados, cookies    |
| Versión, ambiente y plataforma       | Montos, comercios, notas, nombres de cuentas   |
| Eventos fijos del embudo (abajo)     | Id de la cuenta o correo de la persona         |

- **App:** se identifica con un id aleatorio de la instalación. La persona apaga todo en
  **Ajustes → Enviar errores y estadísticas anónimas**. Los eventos van con
  `$process_person_profile: false`: PostHog no arma perfiles.
- **API:** solo reporta errores 5xx, con la ruta (`POST /v1/billing/wompi/events`) y el
  `requestId`.
- La política de datos ya menciona a Sentry y PostHog como encargados fuera de Colombia.

### Embudo de activación

`app_opened` → `signed_in` → `onboarding_completed` → `first_movement` → `movement_created` →
`premium_viewed` → `premium_started`. Además está `feedback_sent`. En PostHog se arma un
_Funnel_ con esos pasos.

### Feature flags

`useTelemetry().flag("nombre", porDefecto)` lee las flags de PostHog al abrir la app. Sin PostHog
o con la telemetría apagada, devuelve el valor por defecto. Las flags sirven para encender
funciones de a pocos, no para seguridad: el servidor siempre valida.

## Encenderlo

1. **Sentry** ([sentry.io](https://sentry.io), plan Developer):
   - crear dos proyectos, `lukas-api` (plataforma _Cloudflare Workers_ o _Node_) y `lukas-app`
     (_React Native_); copiar el DSN de cada uno. No son secretos;
   - en **Settings → Security & Privacy**, activar _Prevent Storing of IP Addresses_ y
     _Data Scrubber_.
2. **PostHog** ([us.posthog.com](https://us.posthog.com), plan gratis, región **US**; la app
   envía a `us.i.posthog.com`, o a lo que diga `EXPO_PUBLIC_POSTHOG_HOST`):
   - crear el proyecto "Lukas" y copiar la _Project API key_ (`phc_…`). No es secreta;
   - en **Settings → Project → IP data capture**, activar _Discard client IP data_.
3. En GitHub, **Settings → Environments**, en `staging` y en `production`, crear las variables:
   - `SENTRY_DSN_API`: el DSN de `lukas-api`;
   - `SENTRY_DSN_APP`: el DSN de `lukas-app`;
   - `POSTHOG_KEY`: la llave `phc_…`.

   El próximo despliegue las pasa a la API y a la web.

4. En [expo.dev](https://expo.dev) → proyecto lukas → **Environment variables**, crear
   `EXPO_PUBLIC_SENTRY_DSN` (DSN de `lukas-app`) y `EXPO_PUBLIC_POSTHOG_KEY`, con visibilidad
   _Plain text_, para los ambientes `preview` y `production`. El próximo APK las incluye.
5. **Verificar** ("Hecho cuando"): con sesión en staging, llamar
   `POST /v1/debug/error`. La API responde 500 y en Sentry aparece "Error de prueba de Lukas para
   [correo]", sin el correo real. Esa ruta no existe en producción.

   ```sh
   curl -X POST -H "Authorization: Bearer <tu sesión>" https://<api-de-staging>/v1/debug/error
   ```

## Cuotas gratuitas

- Sentry Developer: 5 000 errores al mes; un solo usuario.
- PostHog: 1 millón de eventos al mes y 1 millón de consultas de flags.

Con la beta (10 personas) se está muy lejos de los dos límites. Ver
[cuotas-gratuitas.md](cuotas-gratuitas.md).
