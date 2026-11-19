# @lukas/db

## 0.2.0

### Minor Changes

- e018276: Autenticación sin contraseña con Better Auth: código de un solo uso por correo, passkeys (WebAuthn), Turnstile, sesiones por cookie o bearer con cierre remoto y `GET /v1/me`. Nuevo esquema `auth` en Postgres; todos los datos financieros tienen FK al usuario y se borran en cascada al eliminar la cuenta.

## 0.1.0

### Minor Changes

- 30789ab: Esquema inicial de Postgres: libro mayor de doble partida (cuentas, categorías, transacciones y asientos) con triggers de integridad, tablas de sync, idempotencia, outbox y auditoría, más la semilla de categorías para Colombia.
