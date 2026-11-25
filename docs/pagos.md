# Pagos

Lukas cobra premium de dos formas. Las dos llegan a la misma saga de suscripción (ver
[ADR 0006](adr/0006-billing-y-entitlements.md)), así que la app solo ve "premium hasta tal fecha".

| Dónde     | Proveedor                  | Por qué                                                                  |
| --------- | -------------------------- | ------------------------------------------------------------------------ |
| Web (PWA) | Wompi                      | Tarjeta, PSE, Nequi y Bancolombia en pesos; sin cuota mensual.           |
| Android   | Google Play vía RevenueCat | Google exige su sistema de pagos para lo digital dentro de apps de Play. |

## Wompi (FIN-402)

### Cómo funciona

1. En la web, **Planes → Pagar con Wompi** llama a `POST /v1/billing/wompi/checkout` con el
   precio (`premium-month` o `premium-year`).
2. La API crea una referencia aleatoria (`lk…`) y la guarda en `app.payment_checkouts` con la
   persona, el precio y el monto. Devuelve la URL del checkout web de Wompi, firmada con el
   secreto de integridad.
3. La persona paga en la página de Wompi y vuelve a `/premium`.
4. Wompi manda `transaction.updated` a `POST /v1/billing/wompi/events`. La API:
   - verifica el checksum con el secreto de eventos y que el ambiente sea el correcto (`test`
     con llaves `pub_test_`, `prod` con `pub_prod_`);
   - busca la referencia y exige que el monto y la moneda sean los del checkout;
   - si el estado es `APPROVED`, aplica `payment_succeeded` por un mes o un año, sumado al
     periodo vigente;
   - registra el evento por `id:estado`; un webhook repetido no cambia nada.

Lukas nunca ve ni guarda datos de la tarjeta: el pago ocurre en la página de Wompi. Del webhook
solo se usan id, referencia, estado, monto y moneda.

### Encenderlo

Sin las tres llaves, el checkout y el webhook responden 503 y la web no ofrece pagar.

1. Crear la cuenta en [comercios.wompi.co](https://comercios.wompi.co). El sandbox es gratis.
2. En **Desarrolladores → Llaves**, copiar:
   - la llave pública (`pub_test_…`), que no es secreta;
   - el secreto de **integridad** y el de **eventos**, que sí son secretos.
3. En GitHub, **Settings → Environments → staging → Variables**, crear `WOMPI_PUBLIC_KEY` con
   la llave pública. El próximo despliegue la pasa a la API.
4. Subir los secretos al Worker de staging. Se piden por consola y no quedan en el historial:

   ```sh
   cd apps/api
   npx wrangler secret put WOMPI_INTEGRITY_SECRET --env staging
   npx wrangler secret put WOMPI_EVENTS_SECRET --env staging
   ```

5. En Wompi, **Desarrolladores → URL de eventos**, poner
   `https://<api-de-staging>/v1/billing/wompi/events`.
6. Probar: en la web de staging, Planes → Pagar con Wompi. Pagar con una de las
   [tarjetas o métodos de prueba de Wompi](https://docs.wompi.co/docs/colombia/datos-de-prueba-en-sandbox/)
   que aprueban. Al volver, Ajustes debe decir "Tu plan: Premium".

Para producción se repite con las llaves `pub_prod_` en el environment `production`. Wompi pide
validar el comercio (RUT o cédula y cuenta bancaria) antes de dar las llaves de producción.

### Costos

Wompi no cobra mensualidad; cobra una comisión por transacción aprobada (revisar la tarifa
vigente en su página). Pasar a producción es decisión del dueño.

## RevenueCat y Google Play (FIN-403)

### Cómo funciona

1. En Android, al abrir **Planes**, la app consulta `/v1/me` y llama a
   `Purchases.configure({ appUserID })` con el id de la persona en Lukas. Luego muestra los
   paquetes mensual y anual de la oferta actual de RevenueCat, con el precio que da Google Play.
2. La compra y la renovación las maneja Google Play. **Restaurar compras** recupera una
   suscripción hecha en otro teléfono con la misma cuenta de Google.
3. RevenueCat manda cada evento a `POST /v1/billing/revenuecat/events` con el encabezado
   `Authorization` configurado. La API lo traduce a la saga:

   | RevenueCat                                                        | Saga                                               |
   | ----------------------------------------------------------------- | -------------------------------------------------- |
   | `INITIAL_PURCHASE`, `RENEWAL`, `UNCANCELLATION`, `PRODUCT_CHANGE` | `payment_succeeded` hasta `expiration_at_ms`       |
   | `CANCELLATION` (reembolso de soporte)                             | `refunded`                                         |
   | `CANCELLATION` (otro motivo)                                      | `renewal_canceled`: sigue hasta el fin del periodo |
   | `BILLING_ISSUE`                                                   | `payment_failed`: 3 días de gracia                 |
   | `EXPIRATION`                                                      | `expired`                                          |

   El evento se registra por su `id`; uno repetido no cambia nada. En producción solo se aceptan
   compras reales (`PRODUCTION`); en staging también las de prueba (`SANDBOX`).

4. Después de comprar, la app pregunta varias veces por el plan hasta que llega el webhook.

### Encenderlo

Sin la llave en la app, la pantalla muestra "pronto". Sin el secreto en la API, el webhook
responde 503.

1. **Google Play Console** (cuenta de desarrollador; Google cobra un pago único de registro):
   crear la app `co.lukas.app` y subir un primer APK/AAB a la pista de prueba interna. Luego
   crear dos suscripciones, por ejemplo `premium_mensual` y `premium_anual`, con los precios en
   COP.
2. **RevenueCat** ([app.revenuecat.com](https://app.revenuecat.com), gratis hasta cierto nivel de
   ingresos):
   - crear el proyecto "Lukas" y la app Android `co.lukas.app`, conectada a Play con una cuenta
     de servicio de Google Cloud (RevenueCat explica los pasos);
   - crear el entitlement **`premium`** y una oferta _current_ con los paquetes **Monthly** y
     **Annual** apuntando a las dos suscripciones;
   - copiar la API key pública de Android (`goog_…`).
3. En `apps/mobile/eas.json`, agregar `"EXPO_PUBLIC_REVENUECAT_ANDROID_KEY": "goog_…"` al `env`
   de los perfiles `preview` y `production`. No es secreta: va dentro del APK.
4. En RevenueCat, **Integrations → Webhooks**:
   - URL: `https://<api>/v1/billing/revenuecat/events`;
   - Authorization header: un valor largo y aleatorio, por ejemplo `openssl rand -hex 32`.
5. Subir ese mismo valor a la API, sin pegarlo en ningún chat ni archivo:

   ```sh
   cd apps/api
   npx wrangler secret put REVENUECAT_WEBHOOK_SECRET --env staging
   ```

6. Probar: agregar tu correo de Google como tester de licencias en Play Console. Instalar el APK
   desde la pista interna y suscribirte: las compras de testers no se cobran. En unos segundos,
   Ajustes debe decir "Tu plan: Premium". RevenueCat también tiene un botón **Send test event**
   para revisar el webhook: la API lo recibe y lo ignora.
