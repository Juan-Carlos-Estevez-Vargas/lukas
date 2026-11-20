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

## El agente en la API

`apps/api/src/modules/agent` usa estas herramientas en `POST /v1/agent/chat`:

- **Modelo intercambiable:** AI SDK con un proveedor compatible con OpenAI (`model.ts`). Por
  defecto es Workers AI de la cuenta (`CLOUDFLARE_ACCOUNT_ID` + secreto `AI_API_KEY`, modelo
  `@cf/meta/llama-3.3-70b-instruct-fp8-fast`). Con `AI_BASE_URL` y `AI_MODEL` se cambia de
  proveedor sin tocar el código. Sin `AI_API_KEY` el endpoint responde 503.
- **Streaming:** la respuesta es un *UI message stream* del AI SDK. Las propuestas llegan como
  resultados de herramientas para que la app pinte la tarjeta de aprobación.
- **Cuota diaria:** 20 000 tokens y 40 mensajes por persona y día de Colombia, en `app.ai_usage`
  (con RLS). Al pasarse, 429 `agent_quota`.
- **Datos personales:** antes de llegar al modelo se tapan tarjetas, correos, celulares y números
  de 8 o más dígitos, tanto en los mensajes como en los resultados de las herramientas (`redact.ts`).
  Los ids se dejan porque el modelo los necesita para proponer cambios.
- **Alcance:** los datos salen de `postgresAgentData`, que corre cada consulta con `withUser`, así
  que RLS limita todo a la persona de la sesión.
