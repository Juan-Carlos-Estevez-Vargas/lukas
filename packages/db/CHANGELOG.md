# @lukas/db

## 0.3.0

### Minor Changes

- d0bece1: Asistente de IA en `POST /v1/agent/chat`: Workers AI (o cualquier API compatible con OpenAI) con las herramientas de `@lukas/ai-tools`, respuesta en streaming, cuota diaria por persona y sin datos personales hacia el modelo.
- aac5ebf: Planes y entitlements: plan gratis y premium, una saga de suscripción que aplica cada evento de pago una sola vez y `GET /v1/billing/entitlements`. Leer recibos y buscar por significado pasan a ser premium, y premium tiene más cuota diaria del asistente. Activar premium en la base lo habilita en la API, el teléfono y la web.
- 869d772: Búsqueda por significado: los movimientos se indexan con embeddings (pgvector) y "salidas a comer" encuentra restaurantes y domicilios. Solo busca en los movimientos de la persona y la consulta nunca da órdenes.
- a24c811: Comentarios de la beta: en Ajustes → Enviar comentarios se puede reportar una falla, proponer una idea o escribir otra cosa. Los números de tarjeta se tapan antes de enviar y antes de guardar.
- 03d2585: Política de tratamiento de datos y términos y condiciones dentro de la app. Al registrarse se pide la autorización (Ley 1581) y queda registrada con la versión aceptada; si un documento cambia, se pide de nuevo.
- 4510aa5: Multimoneda con TRM: cron diario desde datos abiertos, endpoint público y cuentas en USD que suman al patrimonio en pesos.
- 38d7976: Pantalla de planes con precios en pesos, prueba gratis de premium por 14 días (vence sola, una vez por persona) y cupones de días de premium que se suman a lo vigente.
- e1e9776: Resumen semanal: los domingos a las 8 a. m. llega un aviso push con lo gastado en los últimos 7 días, la comparación con los 7 anteriores y la categoría principal. Se activa por teléfono en Ajustes y se borra al cerrar sesión.
- 097de9b: Row Level Security por usuario y hogar (rol `lukas_app` y `withUser`), tablas de hogares y auditoría automática de escrituras en `audit_log`.

## 0.2.0

### Minor Changes

- e018276: Autenticación sin contraseña con Better Auth: código de un solo uso por correo, passkeys (WebAuthn), Turnstile, sesiones por cookie o bearer con cierre remoto y `GET /v1/me`. Nuevo esquema `auth` en Postgres; todos los datos financieros tienen FK al usuario y se borran en cascada al eliminar la cuenta.

## 0.1.0

### Minor Changes

- 30789ab: Esquema inicial de Postgres: libro mayor de doble partida (cuentas, categorías, transacciones y asientos) con triggers de integridad, tablas de sync, idempotencia, outbox y auditoría, más la semilla de categorías para Colombia.
