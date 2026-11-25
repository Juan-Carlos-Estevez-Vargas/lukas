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
