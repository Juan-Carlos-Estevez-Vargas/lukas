import type { AssistantClient } from "./client";

/**
 * Asistente de las pruebas de extremo a extremo: sin red ni modelo, responde siempre lo mismo
 * con una propuesta de presupuesto para revisar la tarjeta y su aprobación.
 */
export function e2eAssistantClient(): AssistantClient {
  return {
    async chat() {
      return {
        ok: true,
        value: {
          text: "Este mes vas bien. Te propongo un tope mensual para todos tus gastos.",
          failed: false,
          proposals: [
            {
              id: "e2e-budget",
              type: "budget",
              summary: "Presupuesto mensual de 1500000.00 COP para todos los gastos",
              payload: { categoryId: null, amount: { amount: "1500000.00", currency: "COP" } },
            },
          ],
        },
      };
    },
  };
}
