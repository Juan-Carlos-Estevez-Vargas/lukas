# @lukas/domain

## 0.2.0

### Minor Changes

- 3013fa8: Cuentas con plantillas colombianas (Nequi, Daviplata, Bancolombia, Nu, Lulo): se crean en un toque,
  se editan, se archivan con saldo en cero y se agrupan por tipo en el resumen.
- c87ab7b: Libro contable en el dominio: cuentas, transacciones de doble partida, regla de cuadre, puertos de
  repositorios, unidad de trabajo y el caso de uso de transferencia entre cuentas.
- c18e598: Lista de movimientos agrupada por día, búsqueda sin tildes y por monto, y filtros combinables.
- 0c79be7: Registro rápido de gastos e ingresos: botón +, teclado propio en pesos, autocompletar de comercios,
  categoría sugerida y categorías por defecto.
- 95d93d7: Movimientos divididos en varias categorías, etiquetas y foto del recibo guardada en el teléfono.
- 78a41a0: Tarjetas de crédito: cupo, día de corte y de pago, deuda, saldo por pagar del extracto, cupo
  disponible, pago mínimo estimado y recordatorio local del pago.
- b5c8779: Transferencias entre cuentas con comisión opcional y cambio de moneda; cuentas en USD y EUR.

## 0.1.0

### Minor Changes

- b7f4740: Primer núcleo de dominio: `Money` con montos en `bigint` y monedas ISO 4217, redondeo exacto, reparto sin pérdida de centavos, conversión con tasas decimales, tipo `Result` y generador UUIDv7.
