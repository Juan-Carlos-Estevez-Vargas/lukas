# @lukas/mobile

## 0.5.1

### Patch Changes

- 4c009a3: La app Android incluye la configuración de Firebase para recibir avisos push.
- dd6c11e: La telemetría de uso se envía a PostHog en la región US (`us.i.posthog.com`) por defecto.

## 0.5.0

### Minor Changes

- 6c7c10c: Ajustes → Borrar mi cuenta: borra la cuenta y todos los datos del servidor y del teléfono. Pide una sesión de menos de un día.
- c219de2: Captcha de Turnstile antes de pedir el código de acceso: en Android dentro de la app y en la web en una ventana emergente. Solo aparece cuando hay llave configurada.
- b8f1f05: Suscripción a premium en Android con Google Play a través de RevenueCat: compra, restaurar compras y webhook que activa, renueva, cancela o vence premium. Queda apagado hasta configurar la llave de RevenueCat.
- 64a77b7: Deudas: con la tasa E.A. y el pago mínimo de cada tarjeta o préstamo, Lukas muestra la fecha de libertad con avalancha o bola de nieve y cuánto se ahorra abonando a capital.
- 6020caa: Ayuda tributaria: con los movimientos del año, Lukas compara patrimonio, ingresos, compras, consumos con tarjeta y consignaciones contra los topes en UVT y dice si probablemente debes declarar renta. También estima el 4×1000 del mes y deja marcar la cuenta exenta.
- c4c4514: Inversiones: registra CDT, fondos, acciones, ETF o cripto con su precio, mira la rentabilidad anual y la asignación del portafolio, y simula un CDT con la retención en la fuente.
- 1f3f409: Pago de premium con Wompi desde la web: checkout firmado, webhook con checksum verificado e idempotente, y el periodo pagado se suma al vigente. Queda apagado hasta configurar las llaves de Wompi.
- 2ca3719: Reporte de errores a Sentry y estadísticas de uso anónimas en PostHog, con limpieza de datos personales y un interruptor en Ajustes para apagarlo. Se enciende al configurar las llaves.
- d364dd8: Tutorial guiado: "Primeros pasos" en el Resumen con seis tareas que se marcan solas al hacerlas, un consejo la primera vez que se abre cada pantalla y la opción de verlo otra vez desde Ajustes.

### Patch Changes

- Updated dependencies [64a77b7]
- Updated dependencies [6020caa]
- Updated dependencies [c4c4514]
- Updated dependencies [1f3f409]
- Updated dependencies [2ca3719]
  - @lukas/domain@0.4.0

## 0.4.0

### Minor Changes

- f6ae881: Chat con el asistente: arranca apagado, explica qué datos usa y lo que propone (movimientos, categorías, presupuestos) solo se guarda al aceptarlo o editarlo.
- a838421: Bandeja "Por revisar" para los movimientos que llegan solos: sin duplicados entre vías, con la cuenta adivinada por los últimos 4 dígitos o el banco.
- aac5ebf: Planes y entitlements: plan gratis y premium, una saga de suscripción que aplica cada evento de pago una sola vez y `GET /v1/billing/entitlements`. Leer recibos y buscar por significado pasan a ser premium, y premium tiene más cuota diaria del asistente. Activar premium en la base lo habilita en la API, el teléfono y la web.
- 869d772: Búsqueda por significado: los movimientos se indexan con embeddings (pgvector) y "salidas a comer" encuentra restaurantes y domicilios. Solo busca en los movimientos de la persona y la consulta nunca da órdenes.
- 3706acb: Subcategorías con ícono, reglas por comercio o palabra clave y aprendizaje al corregir una categoría.
- a24c811: Comentarios de la beta: en Ajustes → Enviar comentarios se puede reportar una falla, proponer una idea o escribir otra cosa. Los números de tarjeta se tapan antes de enviar y antes de guardar.
- 03d2585: Política de tratamiento de datos y términos y condiciones dentro de la app. Al registrarse se pide la autorización (Ley 1581) y queda registrada con la versión aceptada; si un documento cambia, se pide de nuevo.
- e47162c: Seguridad del teléfono: Lukas bloquea las capturas de pantalla (se pueden permitir en Ajustes), avisa si el teléfono tiene root y solo habla con la API por HTTPS con pinning de certificados.
- dff0d18: Importar extractos en PDF de Bancolombia, Davivienda, BBVA, Nu y Nequi (también con clave), con verificación de saldos y conciliación con lo ya registrado.
- 0cc8cfa: Importar movimientos desde CSV o Excel del banco: columnas adivinadas y editables, vista previa y sin duplicados al importar dos veces el mismo archivo.
- 571b37d: Lector de notificaciones en Android: con tu permiso, los avisos de las apps de banco que elijas llegan solos a "Por revisar", leídos solo en el teléfono.
- 7b040e1: Lectores por banco para los avisos de Nequi, Daviplata, Bancolombia, Davivienda, BBVA y Nu: monto, comercio, tarjeta y hora; los pagos de tarjeta y los movimientos entre bolsillos no llegan a la bandeja.
- bfe0b49: Lectura de recibos: la foto se comprime en el teléfono, un modelo de visión lee comercio, total y fecha en `POST /v1/agent/receipt` (sin guardar la imagen) y el formulario se llena para revisarlo antes de guardar.
- 416fae6: Metas de ahorro con fecha, progreso y cuánto apartar por mes.
- 4510aa5: Multimoneda con TRM: cron diario desde datos abiertos, endpoint público y cuentas en USD que suman al patrimonio en pesos.
- 1fc6660: Inicio con el disponible del mes, el top de categorías y los próximos pagos.
- 38d7976: Pantalla de planes con precios en pesos, prueba gratis de premium por 14 días (vence sola, una vez por persona) y cupones de días de premium que se suman a lo vigente.
- 3ba18b3: Presupuestos por categoría y periodo, sobres, regla 50/30/20 y avisos al 80 % y 100 %.
- af24e7a: Proyección de saldo a 90 días por cuenta, con recurrentes y el promedio de lo variable. El Resumen avisa si una cuenta quedaría en rojo y Reportes muestra el gráfico.
- dc44ef2: Movimientos recurrentes que se registran solos al vencer o avisan para confirmarlos.
- 57c0457: Descargar el reporte del mes en PDF y en Excel (una hoja de resumen y una por cuenta) desde Reportes.
- 3028154: Reportes avanzados: comparar un mes contra el anterior o el del año pasado por categoría, comparaciones guardadas, Sankey de a dónde se fue la plata y mapa de calor del gasto por día.
- 623cdad: Reportes: flujo de caja, gasto por categoría y patrimonio mes a mes. Tocar una barra o una categoría abre los movimientos filtrados.
- d13654f: Respaldo cifrado con contraseña, restauración completa y exportación de movimientos a CSV.
- e1e9776: Resumen semanal: los domingos a las 8 a. m. llega un aviso push con lo gastado en los últimos 7 días, la comparación con los 7 anteriores y la categoría principal. Se activa por teléfono en Ajustes y se borra al cerrar sesión.
- 8befa50: El Resumen detecta suscripciones (dos cobros iguales con periodo semanal, mensual o anual) y propone crear el recurrente, y avisa cuando un comercio te cobra dos veces lo mismo.
- 844705a: Conflictos de sincronización sin perder datos: si dos dispositivos editan el mismo registro se fusiona campo por campo, gana la edición más reciente en lo que choca y queda registro del conflicto.
- e855f4d: Sincronización push / pull: el teléfono sube sus cambios (cuentas, categorías y movimientos) y baja los de otros dispositivos al abrir la app o desde Ajustes.
- 2a098aa: App web instalable (PWA): menú lateral en escritorio, datos traídos con el sync y guardados solo en memoria, e instalación desde Safari en el iPhone.
- 256413f: Widgets de Android: gasto rápido con categorías frecuentes y disponible del mes que se oculta con PIN o modo discreto.

### Patch Changes

- Updated dependencies [aac5ebf]
- Updated dependencies [3706acb]
- Updated dependencies [a24c811]
- Updated dependencies [03d2585]
- Updated dependencies [416fae6]
- Updated dependencies [4510aa5]
- Updated dependencies [38d7976]
- Updated dependencies [3ba18b3]
- Updated dependencies [dc44ef2]
- Updated dependencies [3028154]
- Updated dependencies [623cdad]
- Updated dependencies [844705a]
- Updated dependencies [e855f4d]
  - @lukas/domain@0.3.0
  - @lukas/charts@0.2.0
  - @lukas/sync@0.2.0

## 0.3.0

### Minor Changes

- c8e23f5: Base local cifrada con SQLCipher: la clave se guarda en Keystore/Keychain y el esquema contable se
  crea con migraciones versionadas. Desde esta versión la app necesita el build de desarrollo
  (ya no corre en Expo Go).
- 3013fa8: Cuentas con plantillas colombianas (Nequi, Daviplata, Bancolombia, Nu, Lulo): se crean en un toque,
  se editan, se archivan con saldo en cero y se agrupan por tipo en el resumen.
- c18e598: Lista de movimientos agrupada por día, búsqueda sin tildes y por monto, y filtros combinables.
- 64cf044: Primer uso en 3 pasos con la primera cuenta y su saldo inicial, bloqueo con PIN o huella, datos de
  ejemplo opcionales y modo discreto que oculta los montos.
- 0c79be7: Registro rápido de gastos e ingresos: botón +, teclado propio en pesos, autocompletar de comercios,
  categoría sugerida y categorías por defecto.
- 95d93d7: Movimientos divididos en varias categorías, etiquetas y foto del recibo guardada en el teléfono.
- 78a41a0: Tarjetas de crédito: cupo, día de corte y de pago, deuda, saldo por pagar del extracto, cupo
  disponible, pago mínimo estimado y recordatorio local del pago.
- b5c8779: Transferencias entre cuentas con comisión opcional y cambio de moneda; cuentas en USD y EUR.

### Patch Changes

- e9ef0c6: Cada release de la app adjunta su APK firmado de Android, compilado en EAS Build.
- Updated dependencies [3013fa8]
- Updated dependencies [c87ab7b]
- Updated dependencies [c18e598]
- Updated dependencies [0c79be7]
- Updated dependencies [95d93d7]
- Updated dependencies [78a41a0]
- Updated dependencies [b5c8779]
  - @lukas/domain@0.2.0

## 0.2.0

### Minor Changes

- 8fc7899: Versión web de la app (Expo para web) con la misma pantalla de acceso y pestañas, sesión guardada solo durante la pestaña y cabeceras de seguridad estrictas en Cloudflare Pages.

## 0.1.0

### Minor Changes

- 137e1d3: Primera versión de la app móvil con Expo: acceso sin contraseña con código por correo, sesión guardada cifrada en el dispositivo, pestañas de Resumen, Movimientos, Presupuestos y Ajustes, tema claro y oscuro con contraste AA, y textos en español e inglés según el idioma del teléfono.

### Patch Changes

- Updated dependencies [137e1d3]
  - @lukas/ui@0.1.0
