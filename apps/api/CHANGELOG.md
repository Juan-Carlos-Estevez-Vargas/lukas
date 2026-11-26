# @lukas/api

## 0.3.0

### Minor Changes

- 6c7c10c: Ajustes → Borrar mi cuenta: borra la cuenta y todos los datos del servidor y del teléfono. Pide una sesión de menos de un día.
- b8f1f05: Suscripción a premium en Android con Google Play a través de RevenueCat: compra, restaurar compras y webhook que activa, renueva, cancela o vence premium. Queda apagado hasta configurar la llave de RevenueCat.
- ebc7fb7: El código de acceso se envía por correo con Resend en staging y producción. Queda apagado hasta subir `RESEND_API_KEY`.
- 1f3f409: Pago de premium con Wompi desde la web: checkout firmado, webhook con checksum verificado e idempotente, y el periodo pagado se suma al vigente. Queda apagado hasta configurar las llaves de Wompi.
- 2ca3719: Reporte de errores a Sentry y estadísticas de uso anónimas en PostHog, con limpieza de datos personales y un interruptor en Ajustes para apagarlo. Se enciende al configurar las llaves.

### Patch Changes

- Updated dependencies [64a77b7]
- Updated dependencies [6020caa]
- Updated dependencies [c4c4514]
- Updated dependencies [1f3f409]
- Updated dependencies [2ca3719]
  - @lukas/domain@0.4.0
  - @lukas/db@0.4.0
  - @lukas/ai-tools@0.2.1

## 0.2.0

### Minor Changes

- d0bece1: Asistente de IA en `POST /v1/agent/chat`: Workers AI (o cualquier API compatible con OpenAI) con las herramientas de `@lukas/ai-tools`, respuesta en streaming, cuota diaria por persona y sin datos personales hacia el modelo.
- aac5ebf: Planes y entitlements: plan gratis y premium, una saga de suscripción que aplica cada evento de pago una sola vez y `GET /v1/billing/entitlements`. Leer recibos y buscar por significado pasan a ser premium, y premium tiene más cuota diaria del asistente. Activar premium en la base lo habilita en la API, el teléfono y la web.
- 869d772: Búsqueda por significado: los movimientos se indexan con embeddings (pgvector) y "salidas a comer" encuentra restaurantes y domicilios. Solo busca en los movimientos de la persona y la consulta nunca da órdenes.
- a24c811: Comentarios de la beta: en Ajustes → Enviar comentarios se puede reportar una falla, proponer una idea o escribir otra cosa. Los números de tarjeta se tapan antes de enviar y antes de guardar.
- 03d2585: Política de tratamiento de datos y términos y condiciones dentro de la app. Al registrarse se pide la autorización (Ley 1581) y queda registrada con la versión aceptada; si un documento cambia, se pide de nuevo.
- bfe0b49: Lectura de recibos: la foto se comprime en el teléfono, un modelo de visión lee comercio, total y fecha en `POST /v1/agent/receipt` (sin guardar la imagen) y el formulario se llena para revisarlo antes de guardar.
- 4510aa5: Multimoneda con TRM: cron diario desde datos abiertos, endpoint público y cuentas en USD que suman al patrimonio en pesos.
- 38d7976: Pantalla de planes con precios en pesos, prueba gratis de premium por 14 días (vence sola, una vez por persona) y cupones de días de premium que se suman a lo vigente.
- e1e9776: Resumen semanal: los domingos a las 8 a. m. llega un aviso push con lo gastado en los últimos 7 días, la comparación con los 7 anteriores y la categoría principal. Se activa por teléfono en Ajustes y se borra al cerrar sesión.
- e855f4d: Sincronización push / pull: el teléfono sube sus cambios (cuentas, categorías y movimientos) y baja los de otros dispositivos al abrir la app o desde Ajustes.

### Patch Changes

- Updated dependencies [d0bece1]
- Updated dependencies [aac5ebf]
- Updated dependencies [869d772]
- Updated dependencies [3706acb]
- Updated dependencies [a24c811]
- Updated dependencies [03d2585]
- Updated dependencies [1848575]
- Updated dependencies [416fae6]
- Updated dependencies [4510aa5]
- Updated dependencies [38d7976]
- Updated dependencies [3ba18b3]
- Updated dependencies [dc44ef2]
- Updated dependencies [e1e9776]
- Updated dependencies [097de9b]
- Updated dependencies [844705a]
- Updated dependencies [e855f4d]
  - @lukas/db@0.3.0
  - @lukas/domain@0.3.0
  - @lukas/ai-tools@0.2.0
  - @lukas/sync@0.2.0

## 0.1.2

### Patch Changes

- Updated dependencies [3013fa8]
- Updated dependencies [c87ab7b]
- Updated dependencies [c18e598]
- Updated dependencies [0c79be7]
- Updated dependencies [95d93d7]
- Updated dependencies [78a41a0]
- Updated dependencies [b5c8779]
  - @lukas/domain@0.2.0

## 0.1.1

### Patch Changes

- 7d9ab62: Publica `/.well-known/security.txt` (RFC 9116) con el canal privado para reportar vulnerabilidades.

## 0.1.0

### Minor Changes

- 188583b: Rate limiting con el binding de Workers (120 solicitudes por minuto en `/v1` y 5 en `/v1/auth`), respuesta 429 con `Retry-After`, CORS cerrado por lista de orígenes y cabeceras de seguridad (CSP, HSTS, `no-store`).
- ddb4fd6: API inicial en Cloudflare Workers con Hono: `/health`, prefijo `/v1`, errores RFC 9457, `X-Request-Id`, logs JSON, validación con Zod, documento OpenAPI en `/v1/openapi.json` y entornos dev, staging y producción en `wrangler.jsonc`.
- e018276: Autenticación sin contraseña con Better Auth: código de un solo uso por correo, passkeys (WebAuthn), Turnstile, sesiones por cookie o bearer con cierre remoto y `GET /v1/me`. Nuevo esquema `auth` en Postgres; todos los datos financieros tienen FK al usuario y se borran en cascada al eliminar la cuenta.

### Patch Changes

- Updated dependencies [e018276]
  - @lukas/db@0.2.0
