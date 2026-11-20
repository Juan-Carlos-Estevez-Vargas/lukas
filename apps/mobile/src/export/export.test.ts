import { strFromU8, unzipSync } from "fflate";
import { describe, expect, it } from "vitest";
import { createFromTemplate } from "../accounts/accounts";
import { cardFixture, cop, local } from "../accounts/card.test-helper";
import { templateByKey } from "../accounts/templates";
import { formatMoney } from "../format/money";
import { lineText, readPdfLines } from "../import/pdf/text";
import { parseXlsx } from "../import/table";
import { recordMovement } from "../movements/movements";
import { monthlyReport } from "./monthly";
import { clip, textWidth, winAnsi } from "./pdf-writer";
import { type ReportLabels, reportFileName, reportPdf, reportXlsx } from "./report";
import { buildXlsx, sheetNames, text } from "./xlsx";

const LABELS: ReportLabels = {
  title: "Reporte de octubre de 2026",
  generated: "Generado el 20 de noviembre de 2026",
  income: "Ingresos",
  expenses: "Gastos",
  net: "Neto",
  expensesByCategory: "Gastos por categoría",
  incomeByCategory: "Ingresos por categoría",
  accounts: "Cuentas",
  account: "Cuenta",
  currency: "Moneda",
  opening: "Saldo inicial",
  closing: "Saldo final",
  summary: "Resumen",
  empty: "Sin movimientos este mes.",
  headers: {
    date: "Fecha",
    kind: "Tipo",
    category: "Categoría",
    description: "Descripción",
    notes: "Notas",
    amount: "Valor",
  },
  kinds: { expense: "Gasto", income: "Ingreso", transfer: "Transferencia", adjustment: "Ajuste" },
  page: (n, total) => `Página ${n} de ${total}`,
  money: (m) => formatMoney(m, { locale: "es", discreet: false }),
  date: (d) => `${d.getDate()}/${d.getMonth() + 1}`,
};

async function setup(extra = 0) {
  const fx = await cardFixture({ closingDay: 15, dueDay: 2 });
  const tpl = templateByKey("bancolombia") ?? templateByKey("nequi");
  if (!tpl) throw new Error("falta la plantilla");
  const acc = await createFromTemplate(fx.db, tpl, { openingBalance: cop(1_000_000n) }, fx.clock);
  if (!acc.ok) throw acc.error;
  const record = async (
    kind: "expense" | "income",
    pesos: bigint,
    day: number,
    merchant: string,
  ) => {
    const res = await recordMovement(
      fx.db,
      {
        kind,
        accountId: acc.value.id,
        categoryId: kind === "expense" ? "default.mercado" : "default.salario",
        amount: cop(pesos),
        occurredAt: local(2026, 10, day),
        merchant,
      },
      fx.clock,
    );
    if (!res.ok) throw res.error;
  };
  await record("expense", 85_400n, 2, "Éxito (Calle 80)");
  await record("income", 3_000_000n, 5, "Nómina");
  await record("expense", 20_000n, 3, "Café");
  for (let i = 0; i < extra; i++) await record("expense", 1_000n, 10 + (i % 15), `Tinto ${i}`);
  await record("expense", 50_000n, 31, "Último día");
  return { ...fx, accountId: acc.value.id };
}

describe("reporte mensual", () => {
  it("reúne totales, categorías y movimientos por cuenta", async () => {
    const fx = await setup();
    const r = await monthlyReport(fx.db, { year: 2026, month: 10 }, "COP");
    expect(r.income.toDecimalString()).toBe("3000000.00");
    expect(r.expenses.toDecimalString()).toBe("155400.00");
    expect(r.expenseCategories[0]?.amount.toDecimalString()).toBe("155400.00");
    const account = r.accounts.find((a) => a.id === fx.accountId);
    // El saldo inicial de la cuenta se registró en octubre: sale como ajuste, sin comercio.
    expect(account?.movements.filter((m) => m.kind === "adjustment")).toHaveLength(1);
    expect(account?.movements.filter((m) => m.merchant).map((m) => m.merchant)).toEqual([
      "Éxito (Calle 80)",
      "Café",
      "Nómina",
      "Último día",
    ]);
    expect(account?.opening.toDecimalString()).toBe("0.00");
    expect(account?.closing.toDecimalString()).toBe("3844600.00");
    expect(reportFileName(r, "pdf")).toBe("lukas-2026-10.pdf");
  });

  it("el PDF se lee de vuelta con los montos y numera las páginas", async () => {
    const fx = await setup(60);
    const r = await monthlyReport(fx.db, { year: 2026, month: 10 }, "COP");
    const lines = readPdfLines(reportPdf(r, LABELS)).map(lineText);
    expect(lines[0]).toBe("Reporte de octubre de 2026");
    expect(lines).toContain("Ingresos $ 3.000.000");
    expect(lines.some((l) => l.includes("Éxito (Calle 80)") && l.endsWith("-$ 85.400"))).toBe(true);
    expect(lines.filter((l) => /^Fecha Tipo/.test(l)).length).toBeGreaterThan(1);
    expect(lines.some((l) => l.includes("Página 2 de 2"))).toBe(true);
    expect(lines).toContain("Sin movimientos este mes.");
  });

  it("el Excel trae un resumen y una hoja por cuenta", async () => {
    const fx = await setup();
    const r = await monthlyReport(fx.db, { year: 2026, month: 10 }, "COP");
    const file = reportXlsx(r, LABELS);
    const zip = unzipSync(file);
    const workbook = strFromU8(zip["xl/workbook.xml"] ?? new Uint8Array());
    expect(workbook).toContain('name="Resumen"');
    expect(workbook.match(/<sheet /g)?.length).toBe(r.accounts.length + 1);
    const summary = parseXlsx(file);
    expect(summary.find((r) => r[0] === "Ingresos")).toEqual(["Ingresos", "3000000.00", "COP"]);
    expect(strFromU8(zip["xl/worksheets/sheet2.xml"] ?? new Uint8Array())).toContain("Saldo final");
  });
});

describe("piezas", () => {
  it("nombres de hoja válidos y sin repetir", () => {
    expect(sheetNames(["Ahorros: [Nequi]", "ahorros: [nequi]", "", "x".repeat(40)])).toEqual([
      "Ahorros   Nequi",
      "ahorros   nequi (2)",
      "Hoja",
      "x".repeat(31),
    ]);
  });

  it("escapa XML y omite celdas vacías", () => {
    const zip = unzipSync(buildXlsx([{ name: "A", rows: [[text('<a & "b">\u0001'), null]] }]));
    expect(strFromU8(zip["xl/worksheets/sheet1.xml"] ?? new Uint8Array())).toContain(
      "&lt;a &amp; &quot;b&quot;&gt;",
    );
  });

  it("codifica WinAnsi, mide y recorta texto", () => {
    expect(winAnsi("añ€✓ ")).toEqual([97, 241, 128, 63, 32]);
    expect(textWidth("ii", 10)).toBeCloseTo(4.44);
    const cut = clip("Una descripción muy larga para la columna", 9, 60);
    expect(cut.endsWith("…")).toBe(true);
    expect(textWidth(cut, 9)).toBeLessThanOrEqual(60);
    expect(clip("corto", 9, 60)).toBe("corto");
  });
});
