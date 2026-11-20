# @lukas/ai-tools

Herramientas que el agente de IA puede usar sobre los datos de una persona. Cada una tiene un
esquema Zod de entrada, una descripción para el modelo y pruebas.

## Alcance

Las herramientas reciben un `AgentData` (`src/data.ts`) que ya está limitado a una persona. En la
API se crea con la sesión y las políticas RLS de Postgres; en pruebas, con `memoryData`. Ninguna
herramienta acepta un id de usuario, así que el modelo no puede pedir datos de otra persona: un id
de cuenta o movimiento ajeno simplemente "no existe".

## Herramientas

| Nombre | Tipo | Qué hace |
| --- | --- | --- |
| `list_accounts` | lectura | Cuentas con saldo actual (las archivadas, si se piden) |
| `list_categories` | lectura | Categorías activas, por tipo |
| `spending_by_category` | lectura | Gasto o ingreso por categoría entre dos fechas, con porcentaje |
| `month_summary` | lectura | Ingresos, gastos y neto de un mes, sin transferencias |
| `list_movements` | lectura | Movimientos con filtros (tipo, cuenta, categoría, texto), máximo 50 |
| `propose_movement` | propuesta | Un gasto o ingreso para que la persona lo apruebe |
| `propose_recategorize` | propuesta | Cambiar la categoría de un movimiento |
| `propose_budget` | propuesta | Un presupuesto mensual |

- Las de propuesta validan contra los datos (cuenta activa, categoría del tipo correcto, monto
  positivo, fecha no futura) y devuelven `{ id, type, summary, payload }`. **No escriben nada**: la
  app muestra la tarjeta y la persona decide (FIN-307).
- Montos como texto decimal con su moneda (`{ amount: "45900.00", currency: "COP" }`), calculados con
  `Money` en enteros. Fechas como días de Colombia (`AAAA-MM-DD`, UTC−5).
- `callTool(ctx, nombre, entrada)` valida la entrada y lanza `ToolError` (`not_found` o `invalid`).

## Servidor MCP para pruebas

```sh
pnpm --filter @lukas/ai-tools mcp
```

Levanta un servidor MCP por stdio con datos inventados (`src/sample.ts`). Sirve para probar las
herramientas desde cualquier cliente MCP, por ejemplo el inspector
(`npx @modelcontextprotocol/inspector pnpm --filter @lukas/ai-tools mcp`). No toca datos reales.
