# @lukas/api

## 0.1.0

### Minor Changes

- 188583b: Rate limiting con el binding de Workers (120 solicitudes por minuto en `/v1` y 5 en `/v1/auth`), respuesta 429 con `Retry-After`, CORS cerrado por lista de orígenes y cabeceras de seguridad (CSP, HSTS, `no-store`).
- ddb4fd6: API inicial en Cloudflare Workers con Hono: `/health`, prefijo `/v1`, errores RFC 9457, `X-Request-Id`, logs JSON, validación con Zod, documento OpenAPI en `/v1/openapi.json` y entornos dev, staging y producción en `wrangler.jsonc`.
