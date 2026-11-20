# @lukas/domain

## 0.3.0

### Minor Changes

- aac5ebf: Planes y entitlements: plan gratis y premium, una saga de suscripción que aplica cada evento de pago una sola vez y `GET /v1/billing/entitlements`. Leer recibos y buscar por significado pasan a ser premium, y premium tiene más cuota diaria del asistente. Activar premium en la base lo habilita en la API, el teléfono y la web.
- 3706acb: Subcategorías con ícono, reglas por comercio o palabra clave y aprendizaje al corregir una categoría.
- a24c811: Comentarios de la beta: en Ajustes → Enviar comentarios se puede reportar una falla, proponer una idea o escribir otra cosa. Los números de tarjeta se tapan antes de enviar y antes de guardar.
- 03d2585: Política de tratamiento de datos y términos y condiciones dentro de la app. Al registrarse se pide la autorización (Ley 1581) y queda registrada con la versión aceptada; si un documento cambia, se pide de nuevo.
- 416fae6: Metas de ahorro con fecha, progreso y cuánto apartar por mes.
- 4510aa5: Multimoneda con TRM: cron diario desde datos abiertos, endpoint público y cuentas en USD que suman al patrimonio en pesos.
- 38d7976: Pantalla de planes con precios en pesos, prueba gratis de premium por 14 días (vence sola, una vez por persona) y cupones de días de premium que se suman a lo vigente.
- 3ba18b3: Presupuestos por categoría y periodo, sobres, regla 50/30/20 y avisos al 80 % y 100 %.
- dc44ef2: Movimientos recurrentes que se registran solos al vencer o avisan para confirmarlos.

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
