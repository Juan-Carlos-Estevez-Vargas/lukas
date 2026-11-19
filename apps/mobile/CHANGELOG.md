# @lukas/mobile

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
