# Modelo de amenazas (STRIDE)

Actualizado: noviembre de 2026, con la Fase 0 terminada (API, autenticación y app esqueleto).
Se revisa en cada épica que agregue un módulo, una integración externa o un dato sensible nuevo.

## Alcance y activos

| Activo | Dónde vive | Por qué importa |
| --- | --- | --- |
| Datos financieros (cuentas, movimientos, presupuestos) | Neon Postgres, esquema `app`; luego SQLite cifrado en el teléfono | Revelan hábitos, ingresos y deudas del usuario |
| Identidad y sesiones | Neon, esquema `auth`; token bearer en Keystore/Keychain | Quien tenga una sesión ve y cambia todo |
| Códigos de acceso por correo | Tabla `auth.verifications`, guardados con hash | Son la llave de entrada |
| Secretos de infraestructura | GitHub Actions y secretos de Cloudflare | Permiten desplegar o leer la base completa |
| Notificaciones bancarias (Fase 2) | Solo en el teléfono, se procesan localmente | Contienen montos y comercios; nunca números de tarjeta |

**Lo que Lukas nunca guarda:** números de tarjeta, CVV, claves de Nequi o de banca en línea.
La captura automática lee notificaciones y correos de comprobante, no credenciales.

## Límites de confianza

```
Teléfono (app Expo) ──HTTPS──▶ Cloudflare (WAF, rate limit) ──▶ Worker API ──TLS──▶ Neon
        │                                                          │
        └─ Keystore/Keychain                                       └─▶ Proveedor de correo
```

Todo lo que llega a la API es no confiable hasta pasar por Zod, la sesión y el rate limit.

## Análisis por módulo

Cada amenaza indica el control que ya existe (✓) o el que falta y en qué tarea se hace (○).

### API (Hono en Workers)

| STRIDE | Amenaza | Control |
| --- | --- | --- |
| S | Peticiones desde orígenes falsos usando la cookie del usuario | ✓ CORS cerrado por lista (`CORS_ORIGINS`) y cookies `SameSite` de Better Auth |
| T | Cuerpos manipulados o con campos extra | ✓ Validación Zod en cada ruta de `/v1` |
| R | Cambios sin rastro de quién los hizo | ✓ `X-Request-Id` y logs JSON · ○ escribir en `app.audit_log` desde cada caso de uso (F1) |
| I | Errores que filtran trazas, SQL o datos | ✓ Errores RFC 9457 sin detalles internos; `Cache-Control: no-store` |
| I | Logs con datos personales | ✓ Los logs solo llevan ids y nombres de error · ○ revisión con Semgrep de reglas propias (F1) |
| D | Abuso o fuerza bruta | ✓ 120 solicitudes/min en `/v1` y 5/min en `/v1/auth` · Plan gratis: 10 ms de CPU por solicitud |
| E | Leer o cambiar datos de otro usuario (IDOR) | ✓ `requireUser` en rutas privadas · ○ todo repositorio filtra por `user_id` y tiene prueba de aislamiento (F1, sincronización) |

### Autenticación (Better Auth)

| STRIDE | Amenaza | Control |
| --- | --- | --- |
| S | Adivinar el código de 6 dígitos | ✓ 3 intentos por código, vence en 5 min, 5 solicitudes/min por IP, Turnstile antes de enviar |
| S | Robo del token de sesión en el teléfono | ✓ Keystore/Keychain con `WHEN_UNLOCKED_THIS_DEVICE_ONLY`, `allowBackup: false` |
| S | Phishing del código | ✓ Passkeys con verificación de usuario como método preferido · ○ passkeys en el móvil (F1) |
| T | Reutilizar un código ya usado | ✓ Better Auth borra la verificación al usarla |
| R | El usuario no sabe dónde tiene sesión abierta | ✓ Listado y cierre remoto de sesiones · ○ pantalla de sesiones en la app (F1) |
| I | Enumerar correos registrados | ✓ El envío del código responde igual exista o no la cuenta |
| D | Bombardear el correo de un tercero | ✓ Turnstile + rate limit · ○ límite diario por destinatario (F1) |
| E | Escalar a otra cuenta cambiando el correo | ○ Cambio de correo con verificación en ambas direcciones (F1) |

### Base de datos (Neon + Drizzle)

| STRIDE | Amenaza | Control |
| --- | --- | --- |
| T | Inyección SQL | ✓ Solo consultas parametrizadas de Drizzle; Semgrep en CI |
| T | Movimientos desbalanceados o montos con decimales flotantes | ✓ Partida doble con `bigint` y moneda ISO 4217; transacciones ACID |
| R | Borrado sin registro | ✓ `audit_log` sin FK para sobrevivir al borrado de la cuenta |
| I | Fuga de la cadena de conexión | ✓ Solo como secreto de Cloudflare; gitleaks en CI · ○ rol de mínimo privilegio para la API (FIN-012) |
| D | Agotar la cuota gratuita | ○ Tablero de cuotas y alertas (FIN-012) |
| E | La API con permisos de dueño | ○ Rol `lukas_api` sin DDL; migraciones con otro rol (FIN-012) |

### App móvil (Expo)

| STRIDE | Amenaza | Control |
| --- | --- | --- |
| S | App modificada o falsa | ○ Firma del APK en CI y Play Integrity (FIN-012, F3) |
| T | Base local alterada | ○ SQLite con SQLCipher y clave en Keystore (FIN-101) |
| I | Datos visibles en capturas o en el selector de apps | ○ `FLAG_SECURE` opcional y bloqueo con biometría (FIN-103) |
| I | Copias de seguridad del teléfono con datos | ✓ `allowBackup: false` |
| D | Actualización OTA maliciosa | ○ Firma de código de EAS Update (FIN-011) |
| E | Permisos de notificaciones usados para leer más de lo necesario | ○ Filtro por paquete de banco/billetera y procesamiento solo local (F2) |

### CI/CD y cadena de suministro

| STRIDE | Amenaza | Control |
| --- | --- | --- |
| T | Dependencia comprometida | ✓ Versiones exactas, 14 días mínimos de publicación, `trustPolicy: no-downgrade`, OSV-Scanner y Dependabot |
| T | Acción de GitHub comprometida | ✓ Acciones fijadas por SHA, permisos `contents: read` por defecto |
| I | Secretos en el código | ✓ gitleaks en cada PR |
| E | Fusionar sin revisión | ○ Protección de `main` (requiere GitHub Pro o repo público; ver `proteccion-de-rama.md`) |
| E | Despliegue a producción no autorizado | ○ Entorno `production` con aprobación manual (FIN-012) |

## Riesgos aceptados

- **Sin protección de rama en `main`** mientras el repo sea privado en el plan gratuito. Mitigación: CI obligatorio antes de fusionar por convención del agente y del dueño.
- **Correo de códigos sin dominio propio** en pruebas: puede caer en spam. Se resuelve con la decisión 2.1 del archivo de tareas del dueño.

## Cómo reportar una vulnerabilidad

Ver [SECURITY.md](../../SECURITY.md).
