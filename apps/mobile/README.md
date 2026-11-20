# @lukas/mobile

App de Lukas para Android y web (luego iOS) con Expo SDK 58 y Expo Router.

## Desarrollo

```sh
pnpm --filter @lukas/api dev      # API local en http://localhost:8787
pnpm --filter @lukas/mobile dev   # Metro; abre la app con el build de desarrollo
```

La base cifrada usa código nativo (SQLCipher), así que la app ya no corre en Expo Go: hace falta el
build de desarrollo, un APK con `expo-dev-client`. Se compila una vez (y otra cada vez que cambie
una dependencia nativa) desde **Actions → EAS → Run workflow** con el perfil `development`, o con
`pnpm dlx eas-cli@27.4.1 build -p android --profile development`. Ese APK apunta a staging.

La app usa `EXPO_PUBLIC_API_URL` y, si no está definida, `http://10.0.2.2:8787` (el `localhost`
del equipo visto desde el emulador de Android). En desarrollo el código de acceso sale en la
consola de la API.

## Estructura

```
app/            rutas de Expo Router
  (auth)/       acceso con correo y código de 6 dígitos
  (tabs)/       Resumen, Movimientos, Presupuestos y Ajustes
src/api/        cliente HTTP de la API (lógica pura, con pruebas)
src/auth/       sesión y almacenamiento cifrado del token (expo-secure-store)
src/data/       base local cifrada: conexión, clave, migraciones y esquema
src/i18n/       textos en español (fuente de verdad) e inglés
src/theme/      tema claro u oscuro según el sistema, con tokens de @lukas/ui
```

## Web

`pnpm --filter @lukas/mobile web` abre la versión web. En la web el token vive en `sessionStorage`
(se borra al cerrar la pestaña), porque la API y la web están en dominios distintos y una cookie
sería de terceros. `public/_headers` aplica CSP estricta y demás cabeceras en Cloudflare Pages.

- Datos: SQLite solo en memoria, llenado por el sync al entrar; los cambios se suben en segundos y
  al cerrar con algo pendiente el navegador pregunta. Nada queda en el equipo
  ([ADR 0005](../../docs/adr/0005-web-sin-datos-en-reposo.md)).
- Escritorio: desde 900 px el menú pasa a la izquierda y el contenido se centra (máx. 760 px).
- PWA: `public/manifest.webmanifest`, íconos en `public/icons/` (fuente `icon.svg`) y
  `public/index.html` con lo que pide Safari. En el iPhone: Safari → Compartir → Agregar a inicio.
- `metro.config.js` empaqueta el `.wasm` de SQLite y aísla el origen (COOP/COEP) en desarrollo;
  en producción lo hace `_headers`. `pwa.test.ts` vigila esas cabeceras y el manifest.

## Seguridad

- El token de sesión se guarda en Keystore/Keychain (`WHEN_UNLOCKED_THIS_DEVICE_ONLY`), nunca en
  AsyncStorage, y `allowBackup` está desactivado en Android.
- Al abrir la app se valida el token con `GET /v1/me`; si la API lo rechaza, se borra.

## Base local

Los datos financieros viven en el dispositivo, en `lukas.db`, una base SQLite cifrada con
SQLCipher (AES-256) mediante `expo-sqlite` con `useSQLCipher`.

- La clave es aleatoria de 256 bits (`expo-crypto`), se crea en el primer arranque y se guarda en
  Keystore/Keychain (`WHEN_UNLOCKED_THIS_DEVICE_ONLY`). No se deriva del PIN ni de la sesión, así
  que el bloqueo de la app (FIN-103) puede cambiar sin recifrar nada.
- Si el binario no trae SQLCipher (`PRAGMA cipher_version` vacío), la app no abre la base: nunca
  guarda datos en claro.
- Si la clave no abre la base existente, la app falla sin borrar nada. Solo si la clave se acaba de
  crear (se perdió el Keystore) reemplaza el archivo, que de todas formas ya es ilegible.
- Migraciones en `src/data/schema.ts`, numeradas desde 1 y guardadas en `PRAGMA user_version`.
  Cada una corre en su transacción. Las publicadas no se editan: un cambio es una migración nueva.
- Montos en INTEGER (unidades menores); las tablas son STRICT y rechazan decimales.
- En la web no hay SQLCipher ni Keystore: la base es solo de memoria (ver Web).

## Cuentas

- Plantillas en `src/accounts/templates.ts`: Efectivo, Nequi, Daviplata, Bancolombia, Nu, Lulo Bank,
  tarjeta de crédito y ahorros. Un toque crea la cuenta; nombre y saldo inicial son opcionales.
- Los grupos (efectivo, billeteras, bancos, tarjetas, ahorros, deudas) salen del tipo de cuenta.
- El saldo inicial es una transacción contra la categoría de sistema "Saldo inicial".
- Archivar oculta la cuenta sin borrar su historia, y solo se permite con saldo en cero. Tipo y
  moneda no se editan porque los asientos ya registrados dependen de ellos.

## Tarjetas de crédito

- Solo se guardan cupo, día de corte y día de pago; nunca el número de la tarjeta.
- El resumen (`src/accounts/credit-card.ts` y `packages/domain/src/ledger/credit-card.ts`) usa el
  calendario del teléfono: deuda total, saldo por pagar del último extracto, compras del ciclo
  abierto y cupo disponible. Un corte "31" cae el último día de los meses más cortos.
- El pago mínimo es un estimado (2,78 % del saldo por pagar, redondeado a pesos); el exacto está en
  el extracto del banco.
- Recordatorio: notificación local 3 días antes y el día límite, a las 9 a. m., sin montos en el
  texto. Está apagado por defecto y se recalcula al abrir la app y al cambiar una tarjeta.

## Registro rápido

- Botón `+` en Resumen y Movimientos abre `app/movement/new.tsx`. Cuenta (la última usada) y fecha
  (hoy) ya vienen puestas: monto, categoría y Guardar.
- Teclado propio en pesos enteros (`src/movements/keypad.ts`); los centavos no se usan en COP.
- La migración 3 crea categorías por defecto con ids `default.*`.
- Categoría sugerida: la que más ha usado la persona con ese comercio; si es nuevo, reglas de
  comercios colombianos conocidos (`src/movements/merchant-rules.ts`).

## Dividir, etiquetas y recibos

- "Dividir en varias categorías" reparte el total; las partes deben sumar exacto
  (`newSplitMovement`).
- Etiquetas separadas por coma, sin distinguir mayúsculas; las recientes se tocan para agregarlas.
- Recibos con `expo-image-picker` (cámara o galería, calidad 0,6 y sin EXIF). La foto se copia a
  `documents/receipts/` de la app con un nombre propio y en la base solo queda ese nombre.

## Transferencias

- Desde el registro rápido, "Transferencia" abre `app/movement/transfer.tsx`: pagar la tarjeta,
  pasar de Nequi al banco o cambiar dólares.
- La comisión (o el 4x1000) sale de la cuenta de origen hacia "Comisiones e impuestos bancarios".
- Entre monedas se escribe lo que sale y lo que llega; la categoría de sistema "Cambio de moneda"
  hace que cada moneda cuadre por su lado. Las cuentas pueden crearse en COP, USD o EUR.
- Montos con coma decimal y punto de miles ("1.234,56"); en pesos, solo enteros.

## Lista y búsqueda

- La pestaña Movimientos usa FlashList con un encabezado fijo por día y el neto del día en pesos.
- Filtros combinables (`src/movements/filters.ts`): cada uno es una especificación que se
  traduce a SQL y también se evalúa en memoria; las pruebas comparan ambas.
- La búsqueda ignora tildes y mayúsculas gracias a `transactions.search_text` (migración 6) y
  entiende montos ("85.400", "12,50"), incluidas las comisiones.

## Categorías y reglas

- Categorías con un nivel de subcategorías e ícono; las de sistema no admiten hijas y archivar
  una categoría archiva también sus hijas (`src/movements/categories.ts`).
- Reglas por comercio o palabra clave (tabla `category_rules`, migración 7). Gana la regla del
  usuario sobre la aprendida, el comercio sobre la palabra clave y el patrón más largo.
- Al corregir la categoría sugerida, o al recategorizar desde el detalle de un movimiento, se
  aprende una regla para ese comercio y el siguiente sale bien.

## Recurrentes

- Reglas diarias, semanales, mensuales o anuales cada N periodos (`packages/domain`,
  `ledger/recurrence.ts`). El arriendo del 31 cae el 30 en abril y vuelve al 31 en mayo.
- Al abrir la app o volver a ella se registran solos los vencidos (`src/recurring`), cada uno en
  su transacción. `recurring_occurrences` (migración 8) impide registrar dos veces el mismo día.
- Los que solo avisan quedan pendientes hasta que la persona los registra u omite.
- Si empieza en el pasado no se rellena la historia. El aviso local sale a las 9 a. m. del día y
  no muestra montos.

## Presupuestos

- Por categoría (incluye sus subcategorías) o de todos los gastos, semanal, mensual o anual
  (`packages/domain`, `ledger/budget.ts`; `src/budgets`, migración 9). Los reembolsos restan.
- Sobres: lo que sobra o falta de periodos anteriores pasa al actual.
- Regla 50/30/20 del mes con las categorías clasificadas en necesidades, gustos o ahorro.
- Avisos al 80 % y al 100 %, una vez por periodo (`budget_alerts`): al registrar, al generar
  recurrentes y al abrir la app. Muestran el porcentaje, nunca montos.

## Metas de ahorro

- Meta con monto, fecha e ícono (`packages/domain`, `ledger/goal.ts`; `src/goals`, migración 10).
- Ligada a una cuenta, lo ahorrado es su saldo; sin cuenta, la persona anota abonos y retiros.
- Muestra cuánto apartar por mes: lo que falta entre los aportes mensuales que quedan (incluido
  el de hoy), redondeado hacia arriba a pesos enteros.

## Inicio

- Arriba, sin desplazar, tres respuestas (`src/home`): cuánto queda del mes (del presupuesto
  general si existe; si no, ingresos menos gastos) y cuánto se puede gastar por día; las tres
  categorías con más gasto (las subcategorías suman a su principal); y los próximos pagos de los
  siguientes 30 días (recurrentes, pendientes vencidos y tarjetas con saldo).
- Debajo, patrimonio y cuentas.

## Varias monedas y TRM

- Cuentas en USD o EUR. La API guarda la TRM del día con un cron diario desde datos abiertos
  (`apps/api/src/modules/rates`, tabla `app.exchange_rates`) y la expone en
  `GET /v1/rates/usd-cop?day=AAAA-MM-DD`.
- El teléfono la pide una vez al día solo si hay cuentas en dólares y la guarda (migración 11),
  así convierte sin conexión. Las cuentas en USD suman al patrimonio y los gastos en dólares
  cuentan en el inicio, convertidos a pesos. Lo que no tiene tasa se informa y no se suma.

## Respaldo y exportación

- Ajustes → Respaldo y exportación (`src/backup`). El respaldo lleva todas las tablas de datos en
  JSON, cifrado con una contraseña (scrypt + XChaCha20-Poly1305), y se comparte con el menú del
  sistema. Las fotos de recibos no viajan en el respaldo.
- Restaurar reemplaza todo en una transacción: valida tablas y columnas, revisa llaves foráneas y,
  si algo falla, deja la base como estaba. Acepta respaldos de versiones anteriores, no de más
  nuevas. Al terminar, la app se recarga.
- Exportar CSV: una fila por cuenta de cada movimiento, separado por `;`, con coma decimal y BOM
  para Excel. Las celdas que parecen fórmulas se neutralizan.

## Widgets de Android

- `react-native-android-widget` (plugin en `app.json`). El manejador se registra en `index.ts`,
  antes de expo-router, porque Android lo llama sin abrir la app.
- **Gasto rápido:** un botón grande y tres categorías frecuentes. Abren el registro rápido por
  enlace (`lukas://movement/new?kind=expense&category=…`), con el bloqueo de la app de por medio.
- **Disponible del mes:** lo calcula la app al abrir el inicio y lo guarda cifrado en SecureStore
  para pintarlo después. Si hay PIN o modo discreto muestra `••••`, y no se ofrece en la pantalla
  de bloqueo del teléfono.

## Primer uso y bloqueo

- Onboarding de 3 pasos (`app/(onboarding)`): bienvenida, primera cuenta con saldo inicial y
  protección. El saldo inicial se registra contra la categoría de sistema "Saldo inicial"
  (patrimonio), así que el libro siempre cuadra. Todo se guarda en una sola transacción.
- Datos de ejemplo opcionales en su propia cuenta; se borran desde Ajustes sin tocar lo demás.
- Bloqueo con PIN de 4 a 6 dígitos (sin repetidos ni seguidos) y, si el teléfono la tiene, huella
  o rostro. Se guarda solo el hash con sal (SHA-256 iterado) en Keystore/Keychain. Tras 5 fallos
  la espera crece de 30 s hasta 15 min. Se bloquea al abrir y tras un minuto en segundo plano, y la
  pantalla se tapa en el selector de apps.
- El PIN no cifra la base: la clave de SQLCipher es independiente, así que cambiar o quitar el PIN
  no recifra nada.
- Modo discreto: oculta todos los montos (`••••`), guardado en la tabla `preferences`.
- En la web el onboarding espera al primer sync: si ya hay cuentas en tu cuenta, no aparece.

Las pruebas corren la lógica sobre `node:sqlite`. Que el archivo no se abra sin la clave lo
garantiza SQLCipher y se comprueba en el dispositivo.

## Sincronización

- Local-first: todo se guarda en SQLite y la sincronización es un extra. Triggers (migración 12)
  anotan en `sync_outbox` cada cambio a cuentas, categorías y transacciones, venga de la pantalla
  que venga (también recurrentes, onboarding o restaurar una copia).
- `src/sync/sync.ts` sube la cola agrupada por registro (`POST /v1/sync/push`, protocolo en
  `@lukas/sync`) y baja lo nuevo desde un cursor (`GET /v1/sync/pull`). Corre al abrir la app, al
  volver a ella y con "Sincronizar ahora" en Ajustes. Sin red, la cola espera.
- El `opId` sale del registro y del último cambio anotado: un reintento tras un corte manda el
  mismo id y el servidor no duplica. Cada registro guarda la versión del servidor que conoce.
- Las categorías por defecto (`default.*`) viajan con un UUID derivado del usuario; al bajar
  vuelven a su id local. Presupuestos, metas, recurrentes, etiquetas y recibos aún no se suben.
- Conflictos: fusión de tres vías campo por campo contra la última versión conocida. Si ambos lados cambiaron el mismo campo, gana la edición más reciente y queda anotado en `sync_conflicts`. Un borrado contra una edición: gana la edición.

## Reportes

- Pestaña Reportes: flujo de caja de los últimos 6 meses (ingresos contra gastos), en qué se va
  el gasto de un mes por categoría y patrimonio al cierre de cada mes (`src/reports/reports.ts`).
  Todo en pesos, con la TRM del día para las cuentas en dólares.
- Tocar una barra abre Movimientos filtrado por ese mes y, si se tocó la barra, por ingresos o
  gastos; tocar una categoría filtra por mes y categoría. El filtro se quita con su ✕.
- Arriba se elige el mes; todo lo de abajo (comparación, Sankey, mapa de calor, categorías) es de
  ese mes. Elegir octubre ya lo compara contra septiembre, por categoría y del mayor cambio al
  menor (`src/reports/advanced.ts`); también se puede comparar contra el mismo mes del año pasado.
  Tocar una categoría deja solo esa.
- Comparaciones guardadas: base (mes anterior o año pasado) y categoría opcional, siempre relativas
  al mes elegido. Viven en las preferencias del teléfono, no se sincronizan
  (`src/reports/views.ts`). Se borran manteniéndolas presionadas.
- "A dónde se fue la plata": Sankey de ingresos por categoría → total → gastos por categoría, con
  "Ahorro" si sobró o "De más" si se gastó más de lo que entró.
- Gasto por día: calendario del mes (empieza el lunes) con la intensidad del gasto; tocar un día
  muestra cuánto fue.
- Gráficos: la geometría (escalas, barras, líneas, Sankey, calendario y qué se tocó) vive en
  `@lukas/charts`, sin dependencias. Barras y líneas se dibujan con `react-native-svg` en el
  teléfono (`src/charts/*.tsx`; Skia pesaba ~15 MB en el APK) y con ECharts en SVG en la web
  (`src/charts/*.web.tsx`), importado pieza por pieza. El Sankey y el mapa de calor usan
  `react-native-svg` en ambos.
- `metro.config.js` resuelve `tslib` a su versión ES: la que elige Metro por defecto deja a ECharts
  sin `__extends` en la web.

## Proyección de saldo

- Para cada cuenta de efectivo, banco o billetera proyecta el saldo de los próximos 90 días
  (`src/projection/projection.ts`): el saldo de hoy, los recurrentes de esa cuenta en su fecha (los
  que esperan confirmación cuentan hoy) y el promedio diario de los ingresos y gastos que no salieron
  de un recurrente, de los últimos 90 días o desde que existe la cuenta (mínimo 30, para que una
  cuenta nueva no se proyecte en picada). No adivina transferencias ni pagos de tarjeta.
- Si una cuenta quedaría en rojo, el Resumen lo avisa con la fecha y el monto; "Ver proyección"
  abre Reportes en el gráfico de esa cuenta, con lo programado y el punto más bajo.

## Importar CSV y Excel

- Ajustes → "Importar CSV o Excel" (`app/import/index.tsx`). Lee CSV (`;`, `,` o tabulador; UTF-8
  o Latin-1) y la primera hoja de un .xlsx con `fflate` y un lector propio del XML
  (`src/import/table.ts`), sin librerías de Excel. Hasta 5.000 filas.
- Columnas: busca el encabezado en las primeras 15 filas (los bancos ponen títulos arriba) y
  adivina fecha, descripción, valor con signo o débito/crédito y categoría; la persona puede
  cambiar cada una. Fechas día/mes (o mes/día), ISO, número de Excel y "15 nov 2026"; montos
  "$ 1.234.567,89", "1,234.56", "(12.000)" y "12.000-", sin punto flotante (`src/import/columns.ts`).
- Sin duplicados (`src/import/import.ts`): un movimiento ya está si en esa cuenta hay otro del mismo
  día, valor y descripción. Se cuentan repeticiones (dos tintos iguales son dos), así que importar
  dos veces el mismo archivo no agrega nada. Si coincide día y valor pero no la descripción
  (registrado a mano), queda como "¿Duplicado?" y no se importa salvo que la persona lo marque.
- La categoría sale de la columna del archivo si coincide con una existente; si no, de las reglas y
  el historial del comercio; si no, "Otros gastos" u "Otros ingresos". Todo entra en una sola
  transacción con `source = 'import'`.

## Pruebas de extremo a extremo y rendimiento

- Flujos de [Maestro](https://maestro.dev) en `.maestro/`: primer uso, registrar un gasto,
  transferencia entre cuentas y reportes (tocar la barra filtra). Cada uno arranca desde una
  instalación limpia.
- `.github/workflows/e2e.yml` compila el APK de release en el runner (sin EAS, solo x86_64) con
  `EXPO_PUBLIC_E2E=1`: la entrada por correo acepta el código fijo `123456` sin red. Ese modo no
  existe en los perfiles de `eas.json` (una prueba lo verifica).
- Después de los flujos, `e2e/measure.ts` mide 7 arranques en frío (`am start -W`, hasta el primer
  cuadro) y el tamaño del APK. El job falla si la mediana pasa de **1,5 s** o el APK de **45 MB**
  (`e2e/perf.ts`). El resultado queda en el resumen del job y los reportes como artefacto.
- En local: `maestro test .maestro` con un emulador en español y el APK de e2e instalado.

## Versiones

La versión visible sale de `package.json` (la sube Changesets); el número de build lo lleva EAS.
Ver [docs/releases.md](../../docs/releases.md).

## Pendiente

- Passkeys en el móvil (requiere módulo nativo) y Turnstile en la app.
