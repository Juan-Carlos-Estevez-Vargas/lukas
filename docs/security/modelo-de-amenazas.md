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
| E | Leer o cambiar datos de otro usuario (IDOR) | ✓ `requireUser` en rutas privadas · ✓ RLS en Postgres: la API consulta con `withUser` (rol `lukas_app` + `app.user_id` locales a la transacción) y solo ve lo propio y lo compartido con sus hogares; pruebas de aislamiento en `packages/db/src/rls.test.ts` · ✓ escrituras y accesos sensibles quedan en `audit_log` por trigger (la app no puede escribirla ni leer la de otros) |
| T | Sync: lotes manipulados, reenviados o con datos de otro usuario | ✓ `@lukas/sync` valida cada operación (tipos, UUID, montos enteros, asientos que cuadran, máximo 100 por lote) · ✓ el usuario sale de la sesión, nunca del cuerpo, y todo corre en `withUser` con RLS · ✓ `opId` idempotente y versión por registro: un reenvío no duplica y una versión vieja responde `conflict` |
| T | Una TRM falsa o corrupta desde datos abiertos | ✓ Solo se acepta un decimal positivo de `datos.gov.co` por HTTPS; se guarda por día y la app valida el formato antes de usarla |
| D | Datos abiertos caídos | ✓ Cron diario y respaldo en la última TRM guardada; `GET /v1/rates/usd-cop` es público, sin datos personales y con caché de 1 hora |

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
| S | App modificada o falsa | ✓ APK firmado por EAS en cada release (FIN-012) · ○ Play Integrity (F3) |
| T, I | Base local leída o alterada | ✓ SQLCipher (AES-256) con clave aleatoria en Keystore/Keychain; sin SQLCipher la app no abre la base (FIN-101) |
| I | Finanzas guardadas en claro en el navegador | ✓ La web usa SQLite solo en memoria, llenado por el sync; nada queda en disco (ADR 0005) |
| I | Alguien con el teléfono desbloqueado abre la app | ✓ Bloqueo con PIN (hash con sal en Keystore) o biometría; espera progresiva tras 5 fallos (FIN-103) |
| I | Datos visibles en el selector de apps o mirando la pantalla | ✓ Pantalla tapada en segundo plano y modo discreto (FIN-103) · ○ `FLAG_SECURE` contra capturas |
| I | Montos visibles en notificaciones con el teléfono bloqueado | ✓ Los avisos de pago de tarjetas, recurrentes y presupuestos no incluyen montos y son locales, sin push ni servidor (FIN-105, FIN-111, FIN-112) |
| I | Fotos de recibos expuestas | ✓ Carpeta privada de la app, sin respaldo (`allowBackup` apagado), sin EXIF ni ubicación; nunca salen del teléfono (FIN-108) · ○ cifrarlas como la base |
| I | Copias de seguridad del teléfono con datos | ✓ `allowBackup: false` |
| I | Archivo de respaldo filtrado (Drive, correo) | ✓ Cifrado con contraseña: scrypt (N=2^15, r=8) y XChaCha20-Poly1305 de `@noble`; sin la contraseña no se abre ni se puede alterar sin que se note (FIN-116) |
| T | Respaldo manipulado para inyectar SQL o datos inválidos | ✓ Solo tablas conocidas y columnas que existen (`PRAGMA table_info`); valores escalares; restauración en una transacción con revisión de llaves foráneas; si algo falla no cambia nada (FIN-116) |
| I | CSV exportado abierto en Excel ejecuta fórmulas | ✓ Celdas que empiezan con `=`, `+`, `-`, `@` se anteponen con `'`; el CSV no va cifrado y la pantalla lo advierte (FIN-116) |
| I | Copias del respaldo o CSV quedan en el teléfono | ✓ Se escriben en la caché privada solo para compartirlos y se borran al terminar (FIN-116) |
| I | Widget con el disponible a la vista sin desbloquear | ✓ Con PIN o modo discreto muestra `••••`; no se ofrece en la pantalla de bloqueo; el resumen se guarda en SecureStore (FIN-117) |
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
