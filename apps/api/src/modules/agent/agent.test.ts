import { sampleData } from "@lukas/ai-tools";
import { describe, expect, it } from "vitest";
import { agentTools, runAgent } from "./agent";
import { scriptedModel } from "./mock-model";
import { redact, redactDeep } from "./redact";

type Spending = { total: { amount: string }; categories: { name: string; amount: string }[] };

const pesos = (amount: string) =>
  `$${(amount.split(".")[0] ?? "0").replace(/\B(?=(\d{3})+(?!\d))/g, ".")}`;

const NOW = new Date("2026-11-05T15:00:00Z");

describe("agente", () => {
  it("responde gasto por categoría con los números de la herramienta", async () => {
    const usage: number[] = [];
    let ended = 0;
    const model = scriptedModel(
      "spending_by_category",
      { from: "2026-10-01", to: "2026-10-31" },
      (r) => {
        const s = r as Spending;
        const top = s.categories[0];
        return `En octubre gastaste ${pesos(s.total.amount)}; lo que más pesó fue ${top?.name} con ${pesos(top?.amount ?? "0")}.`;
      },
    );
    const result = runAgent({
      model,
      data: sampleData(),
      messages: [{ role: "user", content: "¿Cuánto gasté en octubre por categoría?" }],
      now: NOW,
      onUsage: async (t) => {
        usage.push(t);
      },
      onEnd: () => {
        ended++;
      },
    });
    expect(await result.text).toBe(
      "En octubre gastaste $550.800; lo que más pesó fue Mercado con $410.000.",
    );
    await result.consumeStream();
    expect(usage).toEqual([860]);
    expect(ended).toBeGreaterThanOrEqual(1);
    // El modelo recibió las instrucciones con la fecha de Colombia.
    expect(JSON.stringify(model.doStreamCalls[0]?.prompt)).toContain("Hoy es 2026-11-05");
  });

  it("le quita datos personales al mensaje antes de mandarlo al modelo", async () => {
    const model = scriptedModel("list_accounts", {}, () => "Listo.");
    const result = runAgent({
      model,
      data: sampleData(),
      messages: [
        { role: "assistant", content: "Hola, ¿en qué te ayudo?" },
        { role: "user", content: "Mi tarjeta es 4111 1111 1111 1111 y mi correo ana@correo.com" },
      ],
      now: NOW,
      onUsage: async () => undefined,
    });
    await result.consumeStream();
    const sent = JSON.stringify(model.doStreamCalls[0]?.prompt);
    expect(sent).not.toContain("4111");
    expect(sent).not.toContain("ana@correo.com");
    expect(sent).toContain("[tarjeta]");
  });

  it("las herramientas devuelven errores legibles y sin datos personales", async () => {
    const tools = agentTools(sampleData(), NOW, () => "p-1");
    const run = (name: string, input: unknown) =>
      (tools[name] as { execute: (i: unknown, o: unknown) => Promise<unknown> }).execute(input, {
        toolCallId: "x",
        messages: [],
      });
    expect(
      await run("propose_recategorize", { movementId: "nada", categoryId: "cat-mercado" }),
    ).toEqual({ error: "not_found", message: "No existe el movimiento nada" });
    expect(await run("month_summary", { month: "octubre" })).toMatchObject({ error: "invalid" });
    const p = (await run("propose_movement", {
      kind: "expense",
      accountId: "acc-nequi",
      categoryId: "cat-mercado",
      amount: "1000",
      date: "2026-11-04",
      note: "llamar al 3001234567",
    })) as { payload: { note: string } };
    expect(p.payload.note).toBe("llamar al [celular]");
  });
});

describe("datos personales", () => {
  it("tapa tarjetas, correos, celulares y documentos pero no montos ni ids", () => {
    expect(redact("4111-1111-1111-1111")).toBe("[tarjeta]");
    expect(redact("escríbeme a juan.perez+lukas@gmail.com")).toBe("escríbeme a [correo]");
    expect(redact("+57 300 123 4567")).toBe("[celular]");
    expect(redact("mi cédula 1020304050")).toBe("mi cédula [número]");
    expect(redact("gasté $1.200.000 y 45900 en mercado, 12000000.00 en total")).toBe(
      "gasté $1.200.000 y 45900 en mercado, 12000000.00 en total",
    );
    expect(
      redactDeep({ id: "12345678", movementId: "87654321", note: "cc 12345678", n: 3 }),
    ).toEqual({ id: "12345678", movementId: "87654321", note: "cc [número]", n: 3 });
    expect(redactDeep(["3001234567", null])).toEqual(["[celular]", null]);
  });
});
