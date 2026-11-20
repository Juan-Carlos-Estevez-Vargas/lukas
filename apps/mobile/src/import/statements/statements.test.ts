import { readFileSync } from "node:fs";
import { type CivilDate, Money } from "@lukas/domain";
import { describe, expect, it } from "vitest";
import { createFromTemplate } from "../../accounts/accounts";
import { cardFixture, cop, local } from "../../accounts/card.test-helper";
import { templateByKey } from "../../accounts/templates";
import { recordMovement } from "../../movements/movements";
import { applyImport, defaultSelection, planImport } from "../import";
import type { PdfLine } from "../pdf/text";
import { leadingDate, maskNumbers, parseStatement } from "./parse";
import { looksLikePdf, readRate, readStatement } from "./statement";

const TODAY: CivilDate = { year: 2026, month: 11, day: 20 };
const PASSWORD = "1020304050";
const fixture = (name: string) =>
  new Uint8Array(readFileSync(`src/import/statements/fixtures/${name}.pdf`));

function read(name: string, password = "") {
  const res = readStatement(fixture(name), password, "COP", TODAY);
  if (!res.ok) throw new Error(res.reason);
  return res.statement;
}

const pesos = (m: Money) => Number(m.amountMinor) / 100;
const day = (d: CivilDate) =>
  `${d.year}-${String(d.month).padStart(2, "0")}-${String(d.day).padStart(2, "0")}`;

describe("extractos de los 5 bancos", () => {
  it("Bancolombia: dos páginas, montos con signo y saldo que cuadra", () => {
    const s = read("bancolombia");
    expect(s.bank).toBe("bancolombia");
    expect(s.card).toBe(false);
    expect(s.rows).toHaveLength(12);
    expect(s.skipped).toBe(0);
    expect(s.balanced).toBe(true);
    expect(pesos(s.opening ?? cop(0n))).toBe(1_250_000);
    const [first] = s.rows;
    expect(first && day(first.date)).toBe("2026-10-01");
    expect(first && pesos(first.amount)).toBe(-85_400);
    expect(s.rows.map((r) => r.description)).toContain("TRANSFERENCIA A CTA ••3456");
    expect(pesos(s.rows[10]?.amount ?? cop(0n))).toBe(1_234.56);
  });

  it("Nequi: cifrado, formato colombiano", () => {
    const s = read("nequi", PASSWORD);
    expect(s.bank).toBe("nequi");
    expect(s.rows.map((r) => pesos(r.amount))).toEqual([
      -12_000, 50_000, -23_450, 100_000, -26_900, -50_000, -43_800,
    ]);
    expect(s.balanced).toBe(true);
  });

  it("Davivienda: signo al final y fecha 'dd mm'", () => {
    const s = read("davivienda");
    expect(s.bank).toBe("davivienda");
    expect(s.rows.map((r) => pesos(r.amount))).toEqual([
      -98_000, 2_800_000, -45_000, -200_000, -67_200, -350_000,
    ]);
    expect(s.rows[5]?.description).toBe("Transferencia a ••5432");
    expect(s.balanced).toBe(true);
  });

  it("BBVA: AES-256, columnas de cargos y abonos", () => {
    const s = read("bbva", PASSWORD);
    expect(s.bank).toBe("bbva");
    expect(s.rows.map((r) => pesos(r.amount))).toEqual([
      -89_900, 450_000, -154_300, -12_500, -6_800,
    ]);
    expect(s.rows[3] && day(s.rows[3].date)).toBe("2026-10-16");
    expect(s.balanced).toBe(true);
  });

  it("Nu: tarjeta de crédito, compras como gastos y el pago como abono", () => {
    const s = read("nu");
    expect(s.bank).toBe("nu");
    expect(s.card).toBe(true);
    expect(s.balanced).toBeNull();
    expect(s.rows.map((r) => pesos(r.amount))).toEqual([
      -62_500, -16_900, -450_000, 600_000, -18_700, -234_150,
    ]);
    expect(s.rows.map((r) => day(r.date))[0]).toBe("2026-09-28");
    expect(s.rows[2]?.description).toBe("Falabella Andino");
  });

  it("lee al menos el 90 % de las líneas con fecha en cada extracto", () => {
    for (const [name, pw] of [
      ["bancolombia", ""],
      ["nequi", PASSWORD],
      ["davivienda", ""],
      ["bbva", PASSWORD],
      ["nu", ""],
    ] as const) {
      expect(readRate(read(name, pw))).toBeGreaterThanOrEqual(0.9);
    }
  });

  it("dice por qué no pudo leer", () => {
    expect(readStatement(fixture("nequi"), "", "COP", TODAY)).toEqual({
      ok: false,
      reason: "password",
    });
    expect(readStatement(new Uint8Array([1, 2, 3]), "", "COP", TODAY)).toEqual({
      ok: false,
      reason: "invalid",
    });
    expect(looksLikePdf(fixture("nu"))).toBe(true);
    expect(looksLikePdf(new Uint8Array([0x50, 0x4b]))).toBe(false);
  });
});

const line = (y: number, ...cells: [number, string][]): PdfLine => ({
  page: 1,
  y,
  cells: cells.map(([x, text]) => ({ x, end: x + text.length * 5, text })),
});

describe("reglas del lector", () => {
  it("reconoce fechas de extracto", () => {
    expect(leadingDate("5/10")).toEqual({ day: 5, month: 10, year: null });
    expect(leadingDate("05-10-26 algo")).toEqual({ day: 5, month: 10, year: 2026 });
    expect(leadingDate("2026/10/05")).toEqual({ day: 5, month: 10, year: 2026 });
    expect(leadingDate("3 de octubre de 2026")).toEqual({ day: 3, month: 10, year: 2026 });
    expect(leadingDate("28 SEPT.")).toEqual({ day: 28, month: 9, year: null });
    expect(leadingDate("03 10")).toEqual({ day: 3, month: 10, year: null });
    expect(leadingDate("1/3 cuotas")).toEqual({ day: 1, month: 3, year: null });
    expect(leadingDate("40/10")).toBeNull();
    expect(leadingDate("Compra")).toBeNull();
  });

  it("oculta números de cuenta y tarjeta", () => {
    expect(maskNumbers("PAGO A 4058 1234 5678 9012")).toBe("PAGO A ••9012");
    expect(maskNumbers("CTA 12345")).toBe("CTA 12345");
    expect(maskNumbers("REF 0570123498765432 OK")).toBe("REF ••5432 OK");
  });

  it("sin cabecera: fecha al inicio, monto y saldo al final; el año sale del periodo", () => {
    const s = parseStatement(
      [
        line(800, [10, "Banco Raro"], [300, "Corte 15/01/2027"]),
        line(
          780,
          [10, "28/12"],
          [60, "SUPERMERCADO"],
          [200, "1234"],
          [300, "45.000,00"],
          [400, "955.000,00"],
        ),
        line(770, [10, "02/01"], [60, "NOMINA"], [300, "2.000.000,00"], [400, "2.955.000,00"]),
        line(760, [10, "03/01"], [60, "SIN MONTO"]),
      ],
      "COP",
      TODAY,
    );
    expect(s.bank).toBeNull();
    expect(s.skipped).toBe(1);
    expect(s.rows.map((r) => day(r.date))).toEqual(["2026-12-28", "2027-01-02"]);
    expect(s.rows[0]?.description).toBe("SUPERMERCADO");
    // Sin signos ni saldo inicial: el primero se decide por palabras y el resto por el saldo.
    expect(s.rows.map((r) => pesos(r.amount))).toEqual([-45_000, 2_000_000]);
    expect(s.balanced).toBeNull();
  });

  it("con cabecera sin signos usa la diferencia de saldos", () => {
    const s = parseStatement(
      [
        line(800, [10, "Saldo anterior"], [400, "$ 100.000"]),
        line(790, [10, "Fecha"], [60, "Detalle"], [300, "Valor"], [400, "Saldo"]),
        line(780, [10, "01/11/2026"], [60, "Abono raro"], [300, "$ 10.000"], [400, "$ 90.000"]),
        line(770, [10, "02/11/2026"], [60, "Compra"], [300, "$ 5.000"], [400, "$ 95.000"]),
        line(760, [10, "03/11/2026"], [60, "Ilegible"], [300, "—"], [400, ""]),
        line(750, [10, "Saldo final"], [400, "$ 95.000"]),
      ],
      "COP",
      TODAY,
    );
    expect(s.rows.map((r) => pesos(r.amount))).toEqual([-10_000, 5_000]);
    expect(s.skipped).toBe(1);
    expect(s.balanced).toBe(true);
  });
});

describe("conciliación con lo registrado", () => {
  it("lo ya registrado a mano queda como posible y no se importa dos veces", async () => {
    const fx = await cardFixture({ closingDay: 15, dueDay: 2 });
    const tpl = templateByKey("bancolombia") ?? templateByKey("nequi");
    if (!tpl) throw new Error("falta la plantilla");
    const acc = await createFromTemplate(fx.db, tpl, {}, fx.clock);
    if (!acc.ok) throw acc.error;
    const manual = await recordMovement(
      fx.db,
      {
        kind: "expense",
        accountId: acc.value.id,
        categoryId: "default.mercado",
        amount: cop(85_400n),
        occurredAt: local(2026, 10, 1, 18),
        merchant: "Éxito",
      },
      fx.clock,
    );
    expect(manual.ok).toBe(true);
    const { rows } = read("bancolombia");
    const plan = await planImport(fx.db, acc.value.id, rows);
    expect(plan.rows[0]?.status).toBe("possible");
    expect(plan.rows.filter((r) => r.status === "new")).toHaveLength(11);
    expect(await applyImport(fx.db, plan, defaultSelection(plan), fx.clock)).toBe(11);
    const again = await planImport(fx.db, acc.value.id, rows);
    expect(again.rows.filter((r) => r.status === "new")).toHaveLength(0);
    void Money;
  });
});
