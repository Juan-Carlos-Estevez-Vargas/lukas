# @lukas/sync

## 0.2.0

### Minor Changes

- 844705a: Conflictos de sincronización sin perder datos: si dos dispositivos editan el mismo registro se fusiona campo por campo, gana la edición más reciente en lo que choca y queda registro del conflicto.
- e855f4d: Sincronización push / pull: el teléfono sube sus cambios (cuentas, categorías y movimientos) y baja los de otros dispositivos al abrir la app o desde Ajustes.
