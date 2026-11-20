import type { AccountView, AgentData, CategoryView, MovementView } from "./data";

/** Datos en memoria: para pruebas y para el servidor MCP local. */
export function memoryData(data: {
  readonly accounts: readonly AccountView[];
  readonly categories: readonly CategoryView[];
  readonly movements: readonly MovementView[];
}): AgentData {
  return {
    accounts: async () => data.accounts,
    categories: async () => data.categories,
    movements: async ({ from, to }) =>
      data.movements
        .filter((m) => m.occurredAt >= from && m.occurredAt < to)
        .sort((a, b) => b.occurredAt.getTime() - a.occurredAt.getTime()),
    movement: async (id) => data.movements.find((m) => m.id === id) ?? null,
  };
}
