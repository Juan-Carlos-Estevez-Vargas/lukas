# @lukas/api

## 0.1.0

### Minor Changes

- 188583b: Rate limiting con el binding de Workers (120 solicitudes por minuto en `/v1` y 5 en `/v1/auth`), respuesta 429 con `Retry-After`, CORS cerrado por lista de orígenes y cabeceras de seguridad (CSP, HSTS, `no-store`).
- ddb4fd6: API inicial en Cloudflare Workers con Hono: `/health`, prefijo `/v1`, errores RFC 9457, `X-Request-Id`, logs JSON, validación con Zod, documento OpenAPI en `/v1/openapi.json` y entornos dev, staging y producción en `wrangler.jsonc`.
- e018276: Autenticación sin contraseña con Better Auth: código de un solo uso por correo, passkeys (WebAuthn), Turnstile, sesiones por cookie o bearer con cierre remoto y `GET /v1/me`. Nuevo esquema `auth` en Postgres; todos los datos financieros tienen FK al usuario y se borran en cascada al eliminar la cuenta.

### Patch Changes

- Updated dependencies [e018276]
  - @lukas/db@0.2.0
