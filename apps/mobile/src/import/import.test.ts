import { Money } from "@lukas/domain";
import { strToU8, zipSync } from "fflate";
import { describe, expect, it } from "vitest";
import { createFromTemplate } from "../accounts/accounts";
import { cardFixture, cop, local } from "../accounts/card.test-helper";
import { templateByKey } from "../accounts/templates";
import { recordMovement } from "../movements/movements";
import { guessColumns, parseAmount, parseDate, readRows } from "./columns";
import { applyImport, defaultSelection, planImport } from "./import";
import { columnIndex, decodeText, detectDelimiter, parseCsv, parseXlsx, readTable } from "./table";

const BANCO = `Banco Ejemplo S.A.
Cuenta de ahorros;****1234
Fecha;Descripción;Débito;Crédito;Saldo
02/11/2026;COMPRA EXITO CALLE 80;"85.400,00";;1.000.000
03/11/2026;"TRANSFERENCIA ""NOMINA""";;"3.000.000,00";4.000.000
03/11/2026;TINTO JUAN VALDEZ;6.500;;
03/11/2026;TINTO JUAN VALDEZ;6.500;;
;;;;Saldo final 3.902.600
fecha mala;algo;1.000;;
04/11/2026;sin monto;;;
`;

describe("tablas", () => {
  it("detecta el separador y respeta comillas, comillas dobles y saltos de línea", () => {
    expect(detectDelimiter("a;b;c\n1;2;3")).toBe(";");
    expect(detectDelimiter("a,b\n1,2")).toBe(",");
    expect(detectDelimiter("a\tb\n1\t2")).toBe("\t");
    expect(parseCsv('﻿a,"b, c","d ""e"""\r\n1,"dos\nlíneas",3\n\n')).toEqual([
      ["a", "b, c", 'd "e"'],
      ["1", "dos\nlíneas", "3"],
    ]);
    expect(parseCsv("x;y")).toEqual([["x", "y"]]);
  });

  it("lee UTF-8 y, si no lo es, Latin-1", () => {
    expect(decodeText(strToU8("Descripción"))).toBe("Descripción");
    expect(decodeText(new Uint8Array([0x43, 0xe9, 0x64]))).toBe("Céd");
  });

  it("lee la primera hoja de un .xlsx con textos compartidos, en línea y números", () => {
    const xlsx = zipSync({
      "xl/workbook.xml": strToU8(
        '<workbook><sheets><sheet name="Movs" sheetId="1" r:id="rId7"/></sheets></workbook>',
      ),
      "xl/_rels/workbook.xml.rels": strToU8(
        '<Relationships><Relationship Id="rId7" Type="ws" Target="worksheets/sheet2.xml"/></Relationships>',
      ),
      "xl/sharedStrings.xml": strToU8(
        "<sst><si><t>Fecha</t></si><si><r><t>Va</t></r><r><t>lor</t></r></si><si><t>Pan &amp; café</t></si></sst>",
      ),
      "xl/worksheets/sheet2.xml": strToU8(
        `<worksheet><sheetData>
          <row r="1"><c r="A1" t="s"><v>0</v></c><c r="C1" t="s"><v>1</v></c></row>
          <row r="2"><c r="A2"><v>46336</v></c><c r="B2" t="s"><v>2</v></c><c r="C2"><v>-12500</v></c></row>
          <row r="3"><c r="B3" t="inlineStr"><is><t>Bus</t></is></c><c r="C3"/></row>
          <row r="4"></row>
        </sheetData></worksheet>`,
      ),
    });
    expect(parseXlsx(xlsx)).toEqual([
      ["Fecha", "", "Valor"],
      ["46336", "Pan & café", "-12500"],
      ["", "Bus", ""],
    ]);
    expect(readTable(xlsx)).toHaveLength(3);
    expect(readTable(strToU8("a;b\n1;2"))).toEqual([
      ["a", "b"],
      ["1", "2"],
    ]);
    expect(() => parseXlsx(zipSync({ "otro.txt": strToU8("x") }))).toThrow();
    expect(columnIndex("AB12")).toBe(27);
  });
});

describe("columnas, fechas y montos", () => {
  it("encuentra el encabezado debajo de los títulos del banco", () => {
    const map = guessColumns(parseCsv(BANCO));
    expect(map).toEqual({
      headerRow: 2,
      date: 0,
      description: 1,
      amount: null,
      debit: 2,
      credit: 3,
      category: null,
    });
    expect(guessColumns([["Date", "Memo", "Amount", "Category"]])).toMatchObject({
      date: 0,
      description: 1,
      amount: 2,
      category: 3,
    });
    expect(guessColumns([["x", "y"]])).toMatchObject({ headerRow: 0, date: 0, amount: 2 });
  });

  it("lee fechas como las escriben los bancos", () => {
    const k = (s: string, o?: "dmy" | "mdy") => {
      const d = parseDate(s, o);
      return d ? `${d.year}-${d.month}-${d.day}` : null;
    };
    expect(k("15/11/2026")).toBe("2026-11-15");
    expect(k("03/04/26")).toBe("2026-4-3");
    expect(k("03/04/26", "mdy")).toBe("2026-3-4");
    expect(k("2026-11-15")).toBe("2026-11-15");
    expect(k("20261115")).toBe("2026-11-15");
    expect(k("15 nov 2026")).toBe("2026-11-15");
    expect(k("15 de noviembre de 2026")).toBe("2026-11-15");
    expect(k("2 Dec 2026")).toBe("2026-12-2");
    expect(k("46336")).toBe("2026-11-10");
    expect(k("15/11/2026 14:30")).toBe("2026-11-15");
    expect(k("31/02/2026")).toBeNull();
    expect(k("15 xyz 2026")).toBeNull();
    expect(k("ayer")).toBeNull();
  });

  it("lee montos sin punto flotante", () => {
    const v = (s: string) => parseAmount(s, "COP")?.amountMinor ?? null;
    expect(v("$ 1.234.567,89")).toBe(123_456_789n);
    expect(v("-45.900")).toBe(-4_590_000n);
    expect(v("1,234.56")).toBe(123_456n);
    expect(v("(12.000)")).toBe(-1_200_000n);
    expect(v("12.000-")).toBe(-1_200_000n);
    expect(v("+3.000.000,00")).toBe(300_000_000n);
    expect(v("COP 5.000")).toBe(500_000n);
    expect(v("0,5")).toBe(50n);
    expect(v("abc")).toBeNull();
    expect(v("")).toBeNull();
    expect(v("$")).toBeNull();
  });

  it("convierte filas y separa las que no se pueden leer", () => {
    const table = parseCsv(BANCO);
    const { rows, errors } = readRows(table, guessColumns(table), "COP");
    expect(rows.map((r) => [r.line, r.description, r.amount.amountMinor])).toEqual([
      [4, "COMPRA EXITO CALLE 80", -8_540_000n],
      [5, 'TRANSFERENCIA "NOMINA"', 300_000_000n],
      [6, "TINTO JUAN VALDEZ", -650_000n],
      [7, "TINTO JUAN VALDEZ", -650_000n],
    ]);
    expect(errors).toEqual([
      { line: 9, reason: "date", raw: "fecha mala" },
      { line: 10, reason: "amount", raw: "" },
    ]);
    const signed = readRows(
      [
        ["Fecha", "Valor", "Categoría"],
        ["1/11/2026", "-1.000", "Mercado"],
        ["2/11/2026", "500", ""],
      ],
      {
        headerRow: 0,
        date: 0,
        description: null,
        amount: 1,
        debit: null,
        credit: null,
        category: 2,
      },
      "COP",
    );
    expect(signed.rows.map((r) => [r.amount.amountMinor, r.category, r.description])).toEqual([
      [-100_000n, "Mercado", ""],
      [50_000n, null, ""],
    ]);
    const negativeDebit = readRows(
      [
        ["f", "d", "c"],
        ["1/11/2026", "-2.000", ""],
        ["1/11/2026", "", "-3.000"],
      ],
      {
        headerRow: 0,
        date: 0,
        description: null,
        amount: null,
        debit: 1,
        credit: 2,
        category: null,
      },
      "COP",
    );
    expect(negativeDebit.rows.map((r) => r.amount.amountMinor)).toEqual([-200_000n, 300_000n]);
  });
});

async function setup() {
  const fx = await cardFixture({ closingDay: 15, dueDay: 2 });
  const tpl = templateByKey("bancolombia") ?? templateByKey("nequi");
  if (!tpl) throw new Error("falta la plantilla");
  const acc = await createFromTemplate(fx.db, tpl, {}, fx.clock);
  if (!acc.ok) throw acc.error;
  const table = parseCsv(BANCO);
  const { rows } = readRows(table, guessColumns(table), "COP");
  return { ...fx, accountId: acc.value.id, rows };
}

describe("importar", () => {
  it("importar dos veces el mismo archivo no duplica", async () => {
    const fx = await setup();
    const plan = await planImport(fx.db, fx.accountId, fx.rows);
    expect(plan.rows.map((r) => r.status)).toEqual(["new", "new", "new", "new"]);
    expect(plan.rows.map((r) => r.kind)).toEqual(["expense", "income", "expense", "expense"]);
    expect(await applyImport(fx.db, plan, defaultSelection(plan), fx.clock)).toBe(4);

    const again = await planImport(fx.db, fx.accountId, fx.rows);
    expect(again.rows.map((r) => r.status)).toEqual([
      "duplicate",
      "duplicate",
      "duplicate",
      "duplicate",
    ]);
    expect(defaultSelection(again).size).toBe(0);
    // Ni marcándolas a mano entran las repetidas.
    expect(await applyImport(fx.db, again, new Set([4, 5, 6, 7]), fx.clock)).toBe(0);
    const count = await fx.db.get<{ n: number }>(
      "SELECT count(*) AS n FROM transactions WHERE source = 'import'",
    );
    expect(count?.n).toBe(4);
  });

  it("cuenta repeticiones: si ya hay un tinto, entra solo el otro", async () => {
    const fx = await setup();
    const tintos = fx.rows.filter((r) => r.description.startsWith("TINTO"));
    const first = await planImport(fx.db, fx.accountId, tintos.slice(0, 1));
    await applyImport(fx.db, first, defaultSelection(first), fx.clock);
    const plan = await planImport(fx.db, fx.accountId, tintos);
    expect(plan.rows.map((r) => r.status)).toEqual(["duplicate", "new"]);
  });

  it("marca como posible duplicado lo registrado a mano el mismo día por el mismo monto", async () => {
    const fx = await setup();
    const manual = await recordMovement(
      fx.db,
      {
        kind: "expense",
        accountId: fx.accountId,
        categoryId: "default.mercado",
        amount: cop(85_400n),
        occurredAt: local(2026, 11, 2, 19),
        merchant: "Éxito",
      },
      fx.clock,
    );
    expect(manual.ok).toBe(true);
    const plan = await planImport(fx.db, fx.accountId, fx.rows);
    expect(plan.rows.map((r) => r.status)).toEqual(["possible", "new", "new", "new"]);
    expect(defaultSelection(plan).has(4)).toBe(false);
    // Si la persona dice que no es el mismo, se importa.
    expect(await applyImport(fx.db, plan, new Set([4]), fx.clock)).toBe(1);
  });

  it("usa la categoría del archivo si existe y si no la sugerida o 'Otros'", async () => {
    const fx = await setup();
    const rows = [
      {
        line: 2,
        date: { year: 2026, month: 11, day: 1 },
        description: "X",
        amount: cop(-1_000n),
        category: "mercado",
      },
      {
        line: 3,
        date: { year: 2026, month: 11, day: 1 },
        description: "",
        amount: cop(2_000n),
        category: "No existe",
      },
      {
        line: 4,
        date: { year: 2026, month: 11, day: 1 },
        description: "Y",
        amount: Money.ofMinor(-100n, "USD"),
        category: null,
      },
    ];
    const plan = await planImport(fx.db, fx.accountId, rows);
    expect(plan.rows.map((r) => r.categoryId)).toEqual([
      "default.mercado",
      "default.otros_ingresos",
    ]);
    await expect(planImport(fx.db, "no-existe", rows)).rejects.toThrow();
    expect((await planImport(fx.db, fx.accountId, [])).rows).toEqual([]);
  });

  it("si una fila falla no entra ninguna", async () => {
    const fx = await setup();
    const plan = await planImport(fx.db, fx.accountId, fx.rows);
    const broken = {
      ...plan,
      rows: plan.rows.map((r, i) => (i === 1 ? { ...r, categoryId: "no-existe" } : r)),
    };
    await expect(applyImport(fx.db, broken, defaultSelection(plan), fx.clock)).rejects.toThrow(
      /Fila 5/,
    );
    const count = await fx.db.get<{ n: number }>(
      "SELECT count(*) AS n FROM transactions WHERE source = 'import'",
    );
    expect(count?.n).toBe(0);
  });
});
