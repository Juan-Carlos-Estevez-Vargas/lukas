---
"@lukas/api": minor
---

Rate limiting con el binding de Workers (120 solicitudes por minuto en `/v1` y 5 en `/v1/auth`), respuesta 429 con `Retry-After`, CORS cerrado por lista de orígenes y cabeceras de seguridad (CSP, HSTS, `no-store`).
