import { describe, expect, it } from "vitest";
import { parseAssistantStream, toProposal } from "./stream";

const sse = (...events: unknown[]) =>
  `${events.map((e) => `data: ${typeof e === "string" ? e : JSON.stringify(e)}`).join("\n\n")}\n\ndata: [DONE]\n\n`;

const movement = {
  id: "p1",
  type: "movement",
  summary: "Gasto de 12000.00 COP en Mercado desde Nequi el 2026-11-19 (Exito)",
  payload: {
    kind: "expense",
    accountId: "acc",
    categoryId: "cat",
    amount: { amount: "12000.00", currency: "COP" },
    date: "2026-11-19",
    merchant: "Exito",
  },
};

describe("flujo del asistente", () => {
  it("junta el texto y las propuestas e ignora lo demás", () => {
    const body = sse(
      { type: "start" },
      { type: "tool-input-available", toolCallId: "c1", toolName: "propose_movement", input: {} },
      { type: "tool-output-available", toolCallId: "c1", output: movement },
      { type: "tool-output-available", toolCallId: "c2", output: movement },
      { type: "tool-output-available", toolCallId: "c3", output: { total: "1" } },
      "no es json",
      { type: "text-delta", id: "t1", delta: "Listo, " },
      { type: "text-delta", id: "t1", delta: "revisa la tarjeta. " },
      { type: "finish" },
    );
    const reply = parseAssistantStream(
      `: comentario\n${body}data: {"type":"text-delta","delta":"x"}`,
    );
    expect(reply.text).toBe("Listo, revisa la tarjeta.");
    expect(reply.failed).toBe(false);
    expect(reply.proposals).toEqual([
      {
        id: "p1",
        type: "movement",
        summary: movement.summary,
        payload: { ...movement.payload, merchant: "Exito", note: null },
      },
    ]);
  });

  it("marca los errores del modelo o de las herramientas", () => {
    expect(parseAssistantStream(sse({ type: "error", errorText: "x" })).failed).toBe(true);
    expect(parseAssistantStream(sse({ type: "tool-output-error" })).failed).toBe(true);
    expect(parseAssistantStream(sse([1, 2])).failed).toBe(false);
  });
});

describe("propuestas recibidas", () => {
  it("acepta recategorizar y presupuestos con o sin categoría", () => {
    expect(
      toProposal({
        id: "p2",
        type: "recategorize",
        summary: "Mover",
        payload: { movementId: "m1", from: "a", to: "b" },
      }),
    ).toEqual({
      id: "p2",
      type: "recategorize",
      summary: "Mover",
      payload: { movementId: "m1", to: "b" },
    });
    const budget = {
      id: "p3",
      type: "budget",
      summary: "Presupuesto",
      payload: {
        categoryId: null,
        period: "monthly",
        amount: { amount: "800000.00", currency: "COP" },
      },
    };
    expect(toProposal(budget)).toMatchObject({ payload: { categoryId: null } });
    expect(
      toProposal({ ...budget, payload: { ...budget.payload, categoryId: "c" } }),
    ).toMatchObject({
      payload: { categoryId: "c" },
    });
  });

  it.each([
    ["sin payload", { id: "x", type: "budget", summary: "s" }],
    ["sin id", { ...movement, id: "" }],
    ["tipo desconocido", { ...movement, type: "delete_all" }],
    ["clase inválida", { ...movement, payload: { ...movement.payload, kind: "transfer" } }],
    ["fecha rara", { ...movement, payload: { ...movement.payload, date: "ayer" } }],
    [
      "monto en número",
      { ...movement, payload: { ...movement.payload, amount: { amount: 12000, currency: "COP" } } },
    ],
    [
      "monto raro",
      { ...movement, payload: { ...movement.payload, amount: { amount: "1e9", currency: "COP" } } },
    ],
    [
      "moneda inválida",
      { ...movement, payload: { ...movement.payload, amount: { amount: "1", currency: "XXX" } } },
    ],
    ["monto sin objeto", { ...movement, payload: { ...movement.payload, amount: "1" } }],
    [
      "comercio enorme",
      { ...movement, payload: { ...movement.payload, merchant: "x".repeat(81) } },
    ],
    ["nota no texto", { ...movement, payload: { ...movement.payload, note: 3 } }],
    [
      "recategorizar incompleto",
      { id: "x", type: "recategorize", summary: "s", payload: { movementId: "m" } },
    ],
    [
      "presupuesto sin monto",
      { id: "x", type: "budget", summary: "s", payload: { categoryId: null } },
    ],
    [
      "categoría no texto",
      {
        id: "x",
        type: "budget",
        summary: "s",
        payload: { categoryId: 4, amount: { amount: "1", currency: "COP" } },
      },
    ],
  ])("descarta: %s", (_, output) => {
    expect(toProposal(output)).toBeNull();
  });
});
