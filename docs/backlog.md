# Backlog de Lukas

Fase → épica → tarea (un PR) → subtareas (commits).
Tamaños: S < 1 día · M 1–3 días · L 3–5 días.

Cada PR se titula `<tipo>(<alcance>): <título> [FIN-xxx]` y cierra su issue.

## F0 · Cimientos (2 semanas)

Repo listo, CI con previews por PR y autenticación funcionando.

### Épica: Repositorio y convenciones

#### FIN-001 · Inicializar monorepo

- Tipo: `chore` · Tamaño: S
- [ ] pnpm workspace y estructura apps/ packages/
- [ ] turbo.json con pipelines build, lint, test, typecheck
- [ ] tsconfig base estricto y Biome
- [ ] README, .editorconfig, .nvmrc

**Hecho cuando:** pnpm turbo run lint typecheck pasa en limpio.

#### FIN-002 · Convenciones de commits, PRs y ADRs

- Tipo: `docs` · Tamaño: S
- [ ] commitlint + lefthook
- [ ] Changesets configurado
- [ ] Plantilla de PR y CODEOWNERS
- [ ] ADR-0001 arquitectura y ADR-0002 modo gratuito

**Hecho cuando:** Un commit fuera de la convención es rechazado.

#### FIN-003 · CI base en GitHub Actions

- Tipo: `ci` · Tamaño: S
- [ ] Workflow ci.yml con caché de pnpm y Turborepo
- [ ] Solo paquetes afectados
- [ ] Reporte de cobertura en el PR

**Hecho cuando:** El PR muestra checks verdes y cobertura.

#### FIN-004 · Seguridad de la cadena de suministro

- Tipo: `security` · Tamaño: S
- [ ] CodeQL y Semgrep CE
- [ ] gitleaks y OSV-Scanner
- [ ] Dependabot agrupado semanal
- [ ] Guía de protección de rama main

**Hecho cuando:** Un secreto de prueba en un commit hace fallar el CI.

### Épica: Núcleo de dominio y datos

#### FIN-005 · Paquete domain: dinero y utilidades

- Tipo: `feat` · Tamaño: M
- [ ] Value object Money con bigint y moneda
- [ ] Tipo Result y errores de dominio
- [ ] Generador UUIDv7
- [ ] Tests de propiedades con fast-check

**Hecho cuando:** Sumar, dividir y convertir Money nunca pierde centavos en 10 mil casos aleatorios.

#### FIN-006 · Esquema de base de datos inicial

- Tipo: `feat` · Tamaño: M · Requiere cuenta: Neon
- [ ] Drizzle con users, accounts, categories, transactions, entries
- [ ] Trigger diferido de doble partida
- [ ] Tablas changes, idempotency, outbox, audit_log
- [ ] Migración 0001 y semilla de categorías

**Hecho cuando:** Insertar asientos que no suman cero falla en el commit.

### Épica: Backend base

#### FIN-007 · API esqueleto en Workers

- Tipo: `feat` · Tamaño: M · Requiere cuenta: Cloudflare
- [ ] Hono con /health y /v1
- [ ] Errores RFC 9457 y logging estructurado
- [ ] Zod + OpenAPI generado
- [ ] wrangler.toml con entornos dev, staging, prod

**Hecho cuando:** /v1/health responde en workers.dev.

#### FIN-008 · Rate limiting y cabeceras de seguridad

- Tipo: `security` · Tamaño: S
- [ ] Binding de Rate Limiting por IP y por usuario
- [ ] CORS cerrado y secure headers
- [ ] Respuesta 429 con Retry-After
- [ ] Tests de abuso

**Hecho cuando:** El intento 6 de login en un minuto recibe 429.

#### FIN-009 · Autenticación con Better Auth

- Tipo: `feat` · Tamaño: L
- [ ] Registro y login con contraseña Argon2id
- [ ] Passkeys (WebAuthn)
- [ ] TOTP y códigos de recuperación
- [ ] Sesiones con refresh rotativo
- [ ] Turnstile en registro

**Hecho cuando:** Se puede crear cuenta, entrar con passkey y cerrar sesión remota.

### Épica: App y entrega

#### FIN-010 · App Expo esqueleto

- Tipo: `feat` · Tamaño: M · Requiere cuenta: Expo
- [ ] Expo Router con pestañas
- [ ] Paquete ui con tokens claro y oscuro
- [ ] i18n español / inglés
- [ ] Pantallas de login conectadas a FIN-009

**Hecho cuando:** La app abre en Android y en web y permite iniciar sesión.

#### FIN-011 · Previews por PR

- Tipo: `ci` · Tamaño: L · Requiere cuenta: Secretos en GitHub
- [ ] Rama Neon por PR con migraciones
- [ ] Worker api-pr-N
- [ ] Web preview en Pages
- [ ] EAS Update en canal pr-N con QR
- [ ] Comentario automático y limpieza al cerrar

**Hecho cuando:** Un PR de prueba comenta enlaces de API, web y QR de la app.

#### FIN-012 · Staging, producción gratuita y tablero de cuotas

- Tipo: `ci` · Tamaño: M
- [ ] main → staging automático
- [ ] Tag → producción con aprobación
- [ ] APK firmado en GitHub Release
- [ ] Documento de cuotas gratuitas y alertas de consumo

**Hecho cuando:** Un tag publica API, web y un APK descargable.

#### FIN-013 · Modelo de amenazas y política de seguridad

- Tipo: `docs` · Tamaño: S
- [ ] STRIDE por módulo en docs/security.md
- [ ] security.txt
- [ ] Checklist ASVS / MASVS en la plantilla de PR

**Hecho cuando:** Documento revisado y enlazado desde el README.

## F1 · MVP local-first (6–8 semanas)

La app sirve para llevar las finanzas del día a día, sin internet.

### Épica: Datos en el dispositivo

#### FIN-101 · SQLite cifrado en el dispositivo

- Tipo: `feat` · Tamaño: M
- [ ] op-sqlite con SQLCipher
- [ ] Clave en Keystore / Keychain
- [ ] Migraciones locales versionadas
- [ ] Build de desarrollo Android

**Hecho cuando:** El archivo de base local no se puede abrir sin la clave.

#### FIN-102 · Repositorios locales y Unit of Work

- Tipo: `feat` · Tamaño: M
- [ ] Puertos del dominio para cuentas y transacciones
- [ ] Adaptadores SQLite
- [ ] Unit of Work transaccional
- [ ] Tests de integración

**Hecho cuando:** Una transferencia fallida a mitad no deja saldos descuadrados.

#### FIN-103 · Onboarding y bloqueo de la app

- Tipo: `feat` · Tamaño: M
- [ ] Flujo de 3 pasos
- [ ] Bloqueo con biometría o PIN
- [ ] Datos de ejemplo opcionales
- [ ] Modo discreto que oculta montos

**Hecho cuando:** Una persona nueva registra su primer gasto en menos de 1 minuto.

### Épica: Cuentas y transacciones

#### FIN-104 · Cuentas con plantillas colombianas

- Tipo: `feat` · Tamaño: M
- [ ] CRUD de cuentas y grupos
- [ ] Plantillas Nequi, Daviplata, Bancolombia, Nu, Lulo
- [ ] Saldo inicial y archivado

**Hecho cuando:** Crear una cuenta Nequi toma un toque.

#### FIN-105 · Tarjetas de crédito

- Tipo: `feat` · Tamaño: M
- [ ] Cupo, día de corte y de pago
- [ ] Saldo del periodo y pago mínimo
- [ ] Recordatorio de pago

**Hecho cuando:** La tarjeta muestra cuánto pagar y cuándo.

#### FIN-106 · Registro rápido de gastos e ingresos

- Tipo: `feat` · Tamaño: L
- [ ] Botón flotante y teclado numérico propio
- [ ] Autocompletar por comercio
- [ ] Categoría sugerida
- [ ] Fecha, nota y cuenta

**Hecho cuando:** Registrar un gasto toma menos de 5 segundos.

#### FIN-107 · Transferencias entre cuentas

- Tipo: `feat` · Tamaño: S
- [ ] Caso de uso TransferFunds con doble partida
- [ ] Comisiones opcionales
- [ ] Multi-moneda en transferencias

**Hecho cuando:** El patrimonio total no cambia tras una transferencia.

#### FIN-108 · Split, etiquetas y adjuntos

- Tipo: `feat` · Tamaño: M
- [ ] Transacciones divididas en varias categorías
- [ ] Etiquetas
- [ ] Foto de recibo guardada localmente

**Hecho cuando:** Un mercado se divide entre comida y aseo.

#### FIN-109 · Lista, búsqueda y filtros

- Tipo: `feat` · Tamaño: M
- [ ] FlashList agrupada por día
- [ ] Búsqueda por texto y monto
- [ ] Filtros combinables (Specification)

**Hecho cuando:** Filtrar 10 mil transacciones responde en menos de 100 ms.

#### FIN-110 · Categorías y reglas

- Tipo: `feat` · Tamaño: M
- [ ] Jerarquía padre / hijo con íconos
- [ ] Reglas por comercio o palabra clave
- [ ] Aprender de correcciones

**Hecho cuando:** Al corregir una categoría, la siguiente del mismo comercio sale bien.

#### FIN-111 · Recurrentes y recordatorios

- Tipo: `feat` · Tamaño: M
- [ ] Reglas de repetición
- [ ] Notificaciones locales
- [ ] Generación automática al vencer

**Hecho cuando:** El arriendo aparece solo cada mes.

### Épica: Presupuestos y metas

#### FIN-112 · Presupuestos con alertas

- Tipo: `feat` · Tamaño: L
- [ ] Por categoría y periodo
- [ ] Sobres y 50/30/20
- [ ] Alertas al 80 % y 100 %

**Hecho cuando:** Pasar el 80 % del presupuesto genera un aviso.

#### FIN-113 · Metas de ahorro

- Tipo: `feat` · Tamaño: S
- [ ] Meta con monto y fecha
- [ ] Aporte sugerido
- [ ] Progreso visual

**Hecho cuando:** La meta muestra cuánto apartar por mes.

#### FIN-114 · Pantalla de inicio

- Tipo: `feat` · Tamaño: M
- [ ] Disponible del mes
- [ ] Top de categorías
- [ ] Próximos pagos

**Hecho cuando:** Las tres respuestas se ven sin desplazar.

#### FIN-115 · Multi-moneda con TRM

- Tipo: `feat` · Tamaño: S
- [ ] Cron diario de TRM (datos abiertos)
- [ ] Conversión en reportes
- [ ] Cuentas en USD

**Hecho cuando:** Una cuenta en USD suma al patrimonio en COP con la TRM del día.

#### FIN-116 · Respaldo y exportación local

- Tipo: `feat` · Tamaño: S
- [ ] Respaldo cifrado en archivo
- [ ] Exportar CSV
- [ ] Restaurar respaldo

**Hecho cuando:** Borrar y restaurar la app recupera todos los datos.

#### FIN-117 · Widgets Android

- Tipo: `feat` · Tamaño: M
- [ ] Widget de gasto rápido
- [ ] Widget de disponible del mes

**Hecho cuando:** Se registra un gasto desde la pantalla de inicio del teléfono.

#### FIN-118 · E2E y presupuesto de rendimiento

- Tipo: `test` · Tamaño: M
- [ ] Flujos Maestro críticos
- [ ] Medición de arranque y tamaño del APK en CI

**Hecho cuando:** El CI falla si el arranque pasa de 1,5 s.

## F2 · Sync, web y reportes (4–6 semanas)

Los datos viajan entre teléfono y web; reportes de verdad e importación de extractos.

### Épica: Sincronización

#### FIN-201 · Esquema servidor con RLS

- Tipo: `security` · Tamaño: M
- [ ] Políticas RLS por usuario y hogar
- [ ] Tests de aislamiento entre usuarios
- [ ] Auditoría de accesos

**Hecho cuando:** Ningún test logra leer datos de otro usuario.

#### FIN-202 · Protocolo de sync push / pull

- Tipo: `feat` · Tamaño: L
- [ ] packages/sync con tipos compartidos
- [ ] Endpoint /v1/sync con cursor
- [ ] Cola local de cambios pendientes
- [ ] Idempotencia por operación

**Hecho cuando:** Cambios offline en el teléfono aparecen en la web al reconectar.

#### FIN-203 · Conflictos y pruebas de sync

- Tipo: `test` · Tamaño: M
- [ ] Resolución por campo y versión
- [ ] Registro de conflictos
- [ ] Tests con dos dispositivos simulados

**Hecho cuando:** Editar lo mismo en dos dispositivos no pierde datos.

### Épica: Web y reportes

#### FIN-204 · App web y PWA

- Tipo: `feat` · Tamaño: M
- [ ] Expo Web con layout de escritorio
- [ ] PWA instalable en iPhone y Android
- [ ] CSP estricta

**Hecho cuando:** Se instala desde Safari en un iPhone.

#### FIN-205 · Reportes básicos

- Tipo: `feat` · Tamaño: L
- [ ] Paquete charts sobre Skia
- [ ] Flujo de caja, por categoría, patrimonio
- [ ] ECharts en web

**Hecho cuando:** Tocar una barra filtra las transacciones.

#### FIN-206 · Reportes avanzados

- Tipo: `feat` · Tamaño: L
- [ ] Sankey
- [ ] Mapa de calor por día
- [ ] Comparativos y vistas guardadas

**Hecho cuando:** Se compara octubre contra septiembre en un toque.

#### FIN-207 · Proyección de saldo a 90 días

- Tipo: `feat` · Tamaño: M
- [ ] Recurrentes y promedios
- [ ] Gráfico de proyección
- [ ] Aviso de saldo negativo futuro

**Hecho cuando:** Avisa si una cuenta quedará en rojo.

#### FIN-208 · Importación CSV y Excel

- Tipo: `feat` · Tamaño: M
- [ ] Mapeo de columnas
- [ ] Vista previa
- [ ] Deduplicación

**Hecho cuando:** Importar dos veces el mismo archivo no duplica.

#### FIN-209 · Extractos PDF de 5 bancos

- Tipo: `feat` · Tamaño: L
- [ ] Parsers Bancolombia, Davivienda, BBVA, Nu, Nequi
- [ ] Fixtures anonimizados
- [ ] Conciliación con lo registrado

**Hecho cuando:** Un extracto real se concilia sin edición manual en el 90 % de líneas.

#### FIN-210 · Exportación PDF y Excel

- Tipo: `feat` · Tamaño: S
- [ ] Reporte mensual en PDF
- [ ] Excel con hojas por cuenta

**Hecho cuando:** El PDF del mes se descarga desde la app.

## F3 · Captura automática e IA (6 semanas)

La mayoría de los gastos entran solos y el asistente responde preguntas reales.

### Épica: Captura

#### FIN-301 · Pipeline de ingestión

- Tipo: `feat` · Tamaño: M
- [ ] Normalización común
- [ ] Huella de deduplicación
- [ ] Asociación por últimos 4 dígitos
- [ ] Bandeja por revisar

**Hecho cuando:** La misma compra capturada por dos vías aparece una vez.

#### FIN-302 · Lector de notificaciones Android

- Tipo: `feat` · Tamaño: L
- [ ] Config plugin de Expo con NotificationListenerService
- [ ] Pantalla de consentimiento clara
- [ ] Filtro por apps permitidas
- [ ] Procesamiento solo en el dispositivo

**Hecho cuando:** Un pago con Nequi aparece en la app en segundos.

#### FIN-303 · Parsers de notificaciones

- Tipo: `feat` · Tamaño: M
- [ ] Nequi y Daviplata
- [ ] Bancolombia y Davivienda
- [ ] Nu y otros
- [ ] Fixtures por banco

**Hecho cuando:** Cada parser pasa sus fixtures en CI.

#### FIN-304 · Detector de suscripciones y duplicados

- Tipo: `feat` · Tamaño: M
- [ ] Patrones de periodicidad
- [ ] Propuesta de recurrente
- [ ] Alerta de cobro duplicado

**Hecho cuando:** Netflix se detecta como suscripción tras dos cobros.

### Épica: Agente de IA

#### FIN-305 · Herramientas del agente y servidor MCP

- Tipo: `feat` · Tamaño: L
- [ ] packages/ai-tools con esquemas Zod
- [ ] Herramientas de lectura
- [ ] Herramientas de propuesta
- [ ] Servidor MCP propio para pruebas

**Hecho cuando:** Cada herramienta tiene test y respeta el alcance del usuario.

#### FIN-306 · Agente en Workers AI

- Tipo: `feat` · Tamaño: L
- [ ] AI SDK con proveedor intercambiable
- [ ] Streaming
- [ ] Cuota diaria de tokens
- [ ] Limpieza de datos personales antes del modelo

**Hecho cuando:** Responde gasto por categoría con números correctos.

#### FIN-307 · Chat y aprobación de propuestas

- Tipo: `feat` · Tamaño: M
- [ ] UI de chat
- [ ] Tarjeta de propuesta con Aceptar / Editar
- [ ] Interruptor para apagar la IA

**Hecho cuando:** Nada se escribe sin aprobación.

#### FIN-308 · Lectura de recibos

- Tipo: `feat` · Tamaño: M
- [ ] Foto y compresión
- [ ] Extracción con modelo de visión
- [ ] Revisión antes de guardar

**Hecho cuando:** Una factura de supermercado se lee con monto y comercio.

#### FIN-309 · Resúmenes semanales

- Tipo: `feat` · Tamaño: S
- [ ] Cron semanal
- [ ] Push con Expo
- [ ] Preferencias de aviso

**Hecho cuando:** Llega el resumen del domingo.

#### FIN-310 · Búsqueda semántica

- Tipo: `feat` · Tamaño: M
- [ ] pgvector y embeddings
- [ ] Búsqueda por significado
- [ ] Pruebas de prompt injection

**Hecho cuando:** Buscar 'salidas a comer' encuentra restaurantes y domicilios.

## F4 · Premium en sandbox y beta cerrada (4 semanas)

Todo listo para cobrar, probado con pagos simulados y usuarios reales de prueba.

### Épica: Billing

#### FIN-401 · Módulo Billing y entitlements

- Tipo: `feat` · Tamaño: M
- [ ] Planes y entitlements
- [ ] Saga de suscripción
- [ ] Feature gates en app y API

**Hecho cuando:** Activar premium en la base habilita funciones en todas las plataformas.

#### FIN-402 · Wompi en sandbox (web)

- Tipo: `feat` · Tamaño: M · Requiere cuenta: Wompi sandbox
- [ ] Checkout de prueba
- [ ] Webhook con firma verificada
- [ ] Idempotencia

**Hecho cuando:** Un pago de prueba activa premium.

#### FIN-403 · RevenueCat en modo de prueba

- Tipo: `feat` · Tamaño: M · Requiere cuenta: RevenueCat
- [ ] SDK en la app
- [ ] Webhook a Billing
- [ ] Restaurar compras

**Hecho cuando:** Una compra de prueba activa premium en Android.

#### FIN-404 · Paywall y prueba de 14 días

- Tipo: `feat` · Tamaño: S
- [ ] Pantalla de planes
- [ ] Prueba gratuita
- [ ] Cupones

**Hecho cuando:** La prueba vence sola a los 14 días.

### Épica: Endurecimiento y beta

#### FIN-405 · Endurecimiento de seguridad

- Tipo: `security` · Tamaño: L
- [ ] FLAG_SECURE, root detection, pinning
- [ ] ZAP baseline en staging
- [ ] MobSF sobre el APK
- [ ] Pruebas IDOR

**Hecho cuando:** Sin hallazgos altos en ZAP y MobSF.

#### FIN-406 · Sentry y PostHog

- Tipo: `chore` · Tamaño: S · Requiere cuenta: Sentry, PostHog
- [ ] Errores con scrubbing de PII
- [ ] Feature flags
- [ ] Embudo de activación

**Hecho cuando:** Un error forzado aparece en Sentry sin datos personales.

#### FIN-407 · Documentos legales

- Tipo: `docs` · Tamaño: S
- [ ] Política de tratamiento de datos (Ley 1581)
- [ ] Términos y condiciones
- [ ] Autorización en el registro

**Hecho cuando:** Las políticas se aceptan al registrarse.

#### FIN-408 · Beta cerrada

- Tipo: `chore` · Tamaño: S
- [ ] APK firmado y PWA
- [ ] Formulario de feedback en la app
- [ ] Guía de instalación

**Hecho cuando:** 10 personas usan la beta una semana.

## F5 · Paso a servicios pagos (cuando haya presupuesto)

Cada tarea es independiente; se hacen en el orden que permita el presupuesto.

### Épica: Migración

#### FIN-501 · Dominio propio

- Tipo: `chore` · Tamaño: S · Pago: ~USD 10–40/año
- [ ] Comprar dominio y delegarlo a Cloudflare
- [ ] Custom domains para API y web
- [ ] Actualizar variables y redirecciones

**Hecho cuando:** La app usa el dominio sin publicar una versión nueva.

#### FIN-502 · Correo transaccional

- Tipo: `feat` · Tamaño: S · Pago: Gratis con dominio
- [ ] Resend con dominio verificado
- [ ] Verificación de correo
- [ ] Recuperación por correo

**Hecho cuando:** Llega el correo de verificación.

#### FIN-503 · Captura por correo reenviado

- Tipo: `feat` · Tamaño: M · Pago: Gratis con dominio
- [ ] Email Routing y Email Worker
- [ ] Verificación DKIM
- [ ] Parsers de correos bancarios
- [ ] Guía de filtro en Gmail

**Hecho cuando:** Una compra con tarjeta llega a la app por correo.

#### FIN-504 · Google Play

- Tipo: `chore` · Tamaño: M · Pago: USD 25 una vez
- [ ] Ficha de la tienda
- [ ] Play Integrity
- [ ] Rollout gradual

**Hecho cuando:** La app está publicada en Play.

#### FIN-505 · App Store e iOS nativo

- Tipo: `feat` · Tamaño: L · Pago: USD 99/año
- [ ] Build iOS
- [ ] App Attest
- [ ] Atajo de Apple Wallet
- [ ] Widgets iOS

**Hecho cuando:** La app está publicada en App Store.

#### FIN-506 · Cobros reales

- Tipo: `feat` · Tamaño: M · Pago: Comisiones
- [ ] Llaves de producción de Wompi
- [ ] Productos en tiendas
- [ ] Facturación electrónica

**Hecho cuando:** Primera suscripción real cobrada.

#### FIN-507 · Modelos de IA premium y planes pagos

- Tipo: `chore` · Tamaño: S · Pago: Por uso
- [ ] Adaptador de Claude para Premium
- [ ] Revisión de cuotas de Neon y Workers

**Hecho cuando:** Premium usa el modelo más capaz.

## F6 · Profundidad (continuo)

Funciones que diferencian la app.

### Épica: Producto

#### FIN-601 · Inversiones

- Tipo: `feat` · Tamaño: L
- [ ] Posiciones y precios
- [ ] Simulador de CDT
- [ ] Rentabilidad y asignación

**Hecho cuando:** El portafolio muestra rentabilidad anual.

#### FIN-602 · Deudas

- Tipo: `feat` · Tamaño: M
- [ ] Bola de nieve y avalancha
- [ ] Simulador de abonos a capital

**Hecho cuando:** Muestra la fecha de libertad de deudas.

#### FIN-603 · Hogar compartido

- Tipo: `feat` · Tamaño: L
- [ ] Invitaciones
- [ ] Permisos por cuenta
- [ ] Gastos divididos

**Hecho cuando:** Dos personas comparten presupuesto.

#### FIN-604 · Ayuda tributaria Colombia

- Tipo: `feat` · Tamaño: M
- [ ] 4×1000
- [ ] Topes de renta en UVT
- [ ] Resumen para la declaración

**Hecho cuando:** Indica si debes declarar renta.

#### FIN-605 · Evaluar open finance

- Tipo: `docs` · Tamaño: S
- [ ] Comparar Belvo y Prometeo
- [ ] Costos y requisitos legales
- [ ] ADR de decisión

**Hecho cuando:** Decisión documentada.
