# 0006. Billing con saga de suscripción y entitlements

- Estado: Aceptado
- Fecha: 2026-11-20

## Contexto

Lukas va a cobrar por la web con Wompi (FIN-402) y en Android con RevenueCat (FIN-403). Cada proveedor manda webhooks con su propio formato, a veces repetidos o desordenados. La app y la API necesitan saber qué puede usar cada persona sin conocer a ningún proveedor, y nadie debe poder regalarse premium desde su sesión.

## Decisión

- **Entitlements, no planes.** Las pantallas y las rutas preguntan por funciones (`receiptReading`, `semanticSearch`) y por la cuota del asistente, que salen de `entitlementsOf(plan)` en `@lukas/domain`. Un plan nuevo solo cambia el catálogo.
- **Saga pura.** `applyBillingEvent` mueve la suscripción entre `trialing`, `active`, `past_due` (con `GRACE_DAYS` de gracia), `canceled` (premium hasta el fin del periodo) y `expired`. Los eventos más viejos que el último aplicado se ignoran.
- **Una transacción por evento.** El adaptador de cada proveedor traduce el webhook a un `BillingEvent` y llama `BillingStore.process`, que registra el evento por (proveedor, id) en `billing_events`, aplica la saga, guarda la suscripción y deja `SubscriptionChanged` en la bandeja de salida. Un webhook repetido devuelve `duplicate` sin tocar nada.
- **Solo lectura para la app.** `lukas_app` solo puede leer su fila de `subscriptions` (RLS) y no ve `billing_events`. Escriben los webhooks y soporte, como dueño de las tablas. Cada cambio queda en `audit_log`.
- **La API decide y la app solo muestra.** Las rutas premium responden 402 `premium_required`. La app guarda la última respuesta de `/billing/entitlements` para ocultar lo que el plan no incluye cuando no hay red.

## Consecuencias

- Para activar premium a mano (soporte o pruebas) basta con una fila en `app.subscriptions` con `provider = 'manual'`.
- No se guarda el cuerpo de los webhooks ni datos de tarjeta, solo el tipo del evento y la referencia del proveedor.
- La app puede mostrar un plan desactualizado hasta que vuelva a abrirse con red. La API siempre usa el dato fresco.
