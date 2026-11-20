import { describe, expect, it } from "vitest";
import { visionModel } from "./mock-model";
import { normalizeDate, normalizeTotal, parseReceipt, readReceipt } from "./receipt";

const NOW = new Date("2026-11-20T15:00:00Z");

describe("lectura de recibos", () => {
  it.each([
    ["45900", "45900.00"],
    ["45.900", "45900.00"],
    ["45,900", "45900.00"],
    ["$ 1.234.567,50", "1234567.50"],
    ["1,234,567.50", "1234567.50"],
    ["12.5", "12.50"],
    [45900, "45900.00"],
  ])("total %j → %s", (raw, expected) => {
    expect(normalizeTotal(raw, "COP")).toBe(expected);
  });

  it.each([[0], [-5], [12.5], [Number.NaN], ["abc"], ["1.2.3,4,5"], [""], [null], ["0"]])(
    "descarta el total %j",
    (raw) => {
      expect(normalizeTotal(raw, "COP")).toBeNull();
    },
  );

  it("valida la fecha: real, no futura y de este último año", () => {
    expect(normalizeDate("2026-11-18", NOW)).toBe("2026-11-18");
    expect(normalizeDate("2026-11-21", NOW)).toBe("2026-11-21");
    expect(normalizeDate("2026-11-25", NOW)).toBeNull();
    expect(normalizeDate("2024-01-01", NOW)).toBeNull();
    expect(normalizeDate("2026-02-30", NOW)).toBeNull();
    expect(normalizeDate("18/11/2026", NOW)).toBeNull();
    expect(normalizeDate(20261118, NOW)).toBeNull();
  });

  it("saca el JSON aunque venga envuelto y limpia los campos", () => {
    const text =
      'Claro:\n```json\n{"merchant": "  ÉXITO   Unicentro ", "total": "187.450", "currency": "cop", "date": "2026-11-19"}\n```';
    expect(parseReceipt(text, NOW)).toEqual({
      merchant: "ÉXITO Unicentro",
      amount: { amount: "187450.00", currency: "COP" },
      date: "2026-11-19",
    });
    expect(parseReceipt("no pude leerlo", NOW)).toEqual({
      merchant: null,
      amount: null,
      date: null,
    });
    expect(parseReceipt("{roto", NOW).amount).toBeNull();
    expect(parseReceipt("[1]", NOW).amount).toBeNull();
    expect(parseReceipt('{"merchant":"null","total":"9.99","currency":"XYZ"}', NOW)).toEqual({
      merchant: null,
      amount: { amount: "9.99", currency: "COP" },
      date: null,
    });
    expect(parseReceipt('{"total":"20","currency":"USD"}', NOW).amount).toEqual({
      amount: "20.00",
      currency: "USD",
    });
  });

  it("manda la foto al modelo de visión con instrucciones y cuenta los tokens", async () => {
    const { model, calls } = visionModel(
      '{"merchant":"Carulla","total":"52300","currency":"COP","date":"2026-11-20"}',
    );
    const res = await readReceipt({ model, image: "aGVsbG8=", mediaType: "image/jpeg", now: NOW });
    expect(res).toEqual({
      reading: {
        merchant: "Carulla",
        amount: { amount: "52300.00", currency: "COP" },
        date: "2026-11-20",
      },
      tokens: 1240,
    });
    const [message] = calls[0]?.prompt ?? [];
    expect(message?.role).toBe("user");
    const parts = message?.role === "user" ? message.content : [];
    expect(parts.map((p) => p.type)).toEqual(["text", "file"]);
    expect(JSON.stringify(parts)).toContain("ignóralo");
  });
});
