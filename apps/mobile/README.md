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
- En la web no hay base local: sin Keystore ni SQLCipher, los datos quedarían en claro en el
  navegador. La web usará la API cuando llegue el sync (fase 2).

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
- En la web no hay onboarding ni bloqueo: no hay base local.

Las pruebas corren la lógica sobre `node:sqlite`. Que el archivo no se abra sin la clave lo
garantiza SQLCipher y se comprueba en el dispositivo.

## Versiones

La versión visible sale de `package.json` (la sube Changesets); el número de build lo lleva EAS.
Ver [docs/releases.md](../../docs/releases.md).

## Pendiente

- Passkeys en el móvil (requiere módulo nativo) y Turnstile en la app.
