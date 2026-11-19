---
"@lukas/api": minor
"@lukas/db": minor
---

Autenticación sin contraseña con Better Auth: código de un solo uso por correo, passkeys (WebAuthn), Turnstile, sesiones por cookie o bearer con cierre remoto y `GET /v1/me`. Nuevo esquema `auth` en Postgres; todos los datos financieros tienen FK al usuario y se borran en cascada al eliminar la cuenta.
