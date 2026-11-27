# Paso a producción

Todo el código para lanzar Lukas ya está en `main` y se prende con llaves. Esta guía junta, en
orden, **solo lo que tiene que hacer el dueño**: crear cuentas, subir secretos, decidir lo que
cuesta y aprobar el despliegue. Cada paso enlaza la guía detallada.

Reglas que no cambian:

- Los secretos se suben con `npx wrangler secret put …` (o en el panel del servicio). Nunca se
  pegan en un chat, un issue ni un archivo del repo.
- Lo que no es secreto (llaves públicas, DSN, project keys) va en **GitHub → Settings →
  Environments → `staging` / `production` → Variables**.
- Todo lo que cuesta dinero está marcado con 💰 y requiere tu decisión.

## Resumen

| #   | Paso                                 | Costo                | Bloquea                              |
| --- | ------------------------------------ | -------------------- | ------------------------------------ |
| 1   | Correo del código (Resend)           | Gratis               | Que alguien pueda entrar             |
| 2   | Dominio propio                       | 💰 ~USD 10–40 al año | Correo a cualquier persona           |
| 3   | Datos legales y revisión del abogado | 💰 honorarios        | Abrir la beta                        |
| 4   | Sentry y PostHog                     | Gratis               | Ver errores y el embudo              |
| 5   | Asistente de IA (Workers AI)         | Gratis               | Asistente, recibos y búsqueda        |
| 6   | Avisos push (Firebase)               | Gratis               | Resumen de los domingos              |
| 7   | Captcha (Turnstile)                  | Gratis               | Frenar bots que piden códigos        |
| 8   | Pagos en la web (Wompi)              | 💰 comisión por pago | Cobrar premium en la web             |
| 9   | Google Play y RevenueCat             | 💰 USD 25 una vez    | Publicar en Play y cobrar en Android |
| 10  | Probar todo en staging               | Gratis               | Aprobar producción                   |
| 11  | Aprobar producción (API, web y app)  | Gratis               | —                                    |

Los pasos 1 y 4 a 7 se pueden hacer ya, en cualquier orden. Sin el paso 1 nadie puede entrar en
staging ni en producción.

## 1. Correo del código (Resend)

Guía: [correo.md](correo.md).

1. Crea la cuenta gratis en https://resend.com con tu correo.
2. **API Keys → Create API key** (_Sending access_).
3. Súbela a staging: `cd apps/api && npx wrangler secret put RESEND_API_KEY --env staging`.
4. Entra a la web de staging con **ese mismo correo**: debe llegarte el código.

## 2. 💰 Dominio propio

Sin dominio, Resend solo entrega al correo del dueño de la cuenta, así que nadie más puede entrar.
Con un dominio (por ejemplo `lukas.com.co` o `usalukas.co`):

1. Cómpralo en Cloudflare Registrar (precio de costo) o donde prefieras y delega el DNS a
   Cloudflare.
2. En Resend, **Domains → Add domain** y agrega en Cloudflare DNS los registros que pide.
3. Cuando quede verificado, crea en GitHub la variable `MAIL_FROM`, por ejemplo
   `Lukas <acceso@tudominio.co>`.
4. Avísame el dominio: conecto la API y la web a él (FIN-501) y actualizo las URLs.

## 3. Datos legales

La política de datos y los términos ya están en la app (`apps/mobile/src/legal/documents.ts`).
Faltan datos que solo tú decides:

1. Quién es el **Responsable del tratamiento**: tú como persona natural o una empresa. Nombre y
   cédula o NIT.
2. Un **correo de contacto** para consultas de datos. Puede ser uno nuevo solo para Lukas (con el
   dominio del paso 2 queda mejor).
3. 💰 Que un **abogado** revise los dos textos antes de abrir la beta.

Pásame 1 y 2 (no son secretos) y los pongo en los textos.

## 4. Sentry y PostHog

Guía: [observabilidad.md](observabilidad.md), sección "Encenderlo". En corto:

1. Sentry (plan Developer): proyectos `lukas-api` y `lukas-app`; copia los dos DSN.
2. PostHog (plan gratis, región **US**): proyecto "Lukas"; copia la _Project API key_ (`phc_…`).
3. En GitHub, environments `staging` y `production`, variables `SENTRY_DSN_API`,
   `SENTRY_DSN_APP` y `POSTHOG_KEY`.
4. En expo.dev → proyecto lukas → **Environment variables**: `EXPO_PUBLIC_SENTRY_DSN` y
   `EXPO_PUBLIC_POSTHOG_KEY`.

## 5. Asistente de IA (Workers AI)

1. Cloudflare → **My Profile → API Tokens → Create Token** con la plantilla _Workers AI_.
2. `npx wrangler secret put AI_API_KEY --env staging` (y luego `--env production`).

El plan gratis da 10 000 neuronas al día; la API además limita el uso por persona.

## 6. Avisos push (Firebase)

1. En https://console.firebase.google.com crea el proyecto "Lukas" y una app Android con el
   paquete `co.lukas.app`. Súbeme el `google-services.json` (no es secreto).
2. **Configuración del proyecto → Cuentas de servicio → Generar nueva clave privada.** Esa clave
   **sí es secreta**: súbela tú en expo.dev → proyecto lukas → **Credentials → Android → FCM V1
   service account key**.

## 7. Captcha (Turnstile)

Antes de pedir el código, la app muestra el captcha gratis de Cloudflare (en Android dentro de la
app; en la web, en una ventanita).

1. Cloudflare → **Turnstile → Add widget**, nombre "Lukas", modo _Managed_. En **Hostnames** agrega
   `lukas-web-e7j.pages.dev` y `staging.lukas-web-e7j.pages.dev` (y tu dominio cuando lo tengas).
2. Copia la **Site key** (pública) y créala como variable `TURNSTILE_SITE_KEY` en los environments
   `staging` y `production` de GitHub, y como `EXPO_PUBLIC_TURNSTILE_SITE_KEY` en expo.dev →
   proyecto lukas → **Environment variables**.
3. Despliega la web y compila un APK nuevo **antes** de subir el secreto: así la app ya envía el
   token cuando la API empiece a exigirlo.
4. Sube la **Secret key**: `npx wrangler secret put TURNSTILE_SECRET_KEY --env staging` (y luego
   `--env production`).

## 8. 💰 Pagos en la web (Wompi)

Guía: [pagos.md](pagos.md), sección Wompi.

1. Cuenta en https://comercios.wompi.co. Para probar, el sandbox es gratis.
2. Variable `WOMPI_PUBLIC_KEY` en el environment `staging` (`pub_test_…`).
3. Secretos: `WOMPI_INTEGRITY_SECRET` y `WOMPI_EVENTS_SECRET` con `--env staging`.
4. URL de eventos en Wompi: `https://<api-de-staging>/v1/billing/wompi/events`.
5. Para producción, Wompi pide validar el comercio (RUT o cédula y cuenta bancaria). Luego se
   repite con las llaves `pub_prod_` en el environment `production`. Wompi cobra una comisión por
   pago aprobado; no hay mensualidad.

## 9. 💰 Google Play y RevenueCat

Guía: [pagos.md](pagos.md), sección RevenueCat.

1. **Cuenta de desarrollador de Google Play** (pago único de USD 25). Las cuentas personales
   nuevas deben hacer una **prueba cerrada con al menos 12 personas durante 14 días** antes de
   poder publicar en producción; revisa la regla vigente en Play Console. La beta cerrada
   (FIN-408) sirve para eso.
2. Crea la app `co.lukas.app`. En **Actions → EAS → Run workflow** elige el perfil `play`: compila
   el AAB que pide Play. Súbelo a **Prueba interna** y luego a **Prueba cerrada**.
3. Llena en Play Console:
   - **Política de privacidad:** `https://<web>/legal/privacy`.
   - **Eliminación de cuenta:** la app lo permite en Ajustes → Borrar mi cuenta. Como enlace web
     usa la misma política (sección 5, explica cómo pedirlo por correo).
   - **Seguridad de los datos:** correo (para entrar), datos financieros que la persona escribe
     (cifrados en tránsito, se pueden borrar), diagnóstico anónimo (Sentry) y analítica anónima
     (PostHog). No se comparten con terceros para publicidad.
   - **Funciones financieras:** Lukas es una app de presupuesto y registro de gastos; no presta,
     no invierte ni mueve dinero.
   - Clasificación de contenido y público objetivo (mayores de 18).
4. Suscripciones `premium_mensual` y `premium_anual` en COP.
5. RevenueCat: proyecto, entitlement `premium`, oferta _current_ y la API key pública
   (`goog_…`). Pásamela y la pongo en `eas.json`.
6. Webhook de RevenueCat y el secreto `REVENUECAT_WEBHOOK_SECRET` con `--env staging` (y luego
   `--env production`).

## 10. Probar todo en staging

Con la web de staging y un APK del perfil `development` o de la prueba interna:

- [ ] Pasar el captcha, entrar con el código del correo y crear una passkey.
- [ ] Onboarding, crear cuentas, registrar gastos y una transferencia; sincronizar entre el
      teléfono y la web.
- [ ] Respaldo cifrado: exportar y restaurar.
- [ ] Asistente, lectura de un recibo y búsqueda por significado (con premium).
- [ ] Pagar premium con Wompi sandbox y ver "Tu plan: Premium".
- [ ] Suscribirte desde la prueba interna de Play (como tester no se cobra).
- [ ] `POST /v1/debug/error` y ver el error en Sentry sin el correo.
- [ ] Enviar un comentario y borrar una cuenta de prueba.

## 11. Aprobar producción

Cuando todo lo anterior esté bien, el paso a producción son tres acciones tuyas:

1. **Secretos de producción**: repite con `--env production` cada `wrangler secret put` de los
   pasos 1, 5, 7, 8 y 9, y crea las variables del environment `production` en GitHub.
2. **API, web y migraciones:** GitHub → **Actions → Deploy → Run workflow → `production`**. La
   prueba de humo final debe quedar en verde.
3. **App:** el PR de versiones se fusiona solo una vez al día y compila el APK firmado. Para Play,
   corre **Actions → EAS → `play`**, súbelo a la pista de producción en Play Console y envíalo a
   revisión.

Después del lanzamiento, revisa una vez por semana las cuotas gratuitas
([cuotas-gratuitas.md](cuotas-gratuitas.md)) y los comentarios de la beta ([beta.md](beta.md)).
