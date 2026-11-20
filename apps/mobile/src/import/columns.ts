/**
 * De la tabla a movimientos: qué columna es qué (adivinado por el encabezado y corregible por la
 * persona) y cómo leer fechas y montos como los escriben los bancos colombianos.
 */
import { type CivilDate, type CurrencyCode, isValidCivil, Money } from "@lukas/domain";
import type { Table } from "./table";

export interface ColumnMap {
  /** Fila del encabezado (las de arriba se saltan: los bancos ponen títulos y datos de la cuenta). */
  readonly headerRow: number;
  readonly date: number | null;
  readonly description: number | null;
  /** Un solo monto con signo… */
  readonly amount: number | null;
  /** …o débito y crédito en columnas separadas (positivos los dos). */
  readonly debit: number | null;
  readonly credit: number | null;
  readonly category: number | null;
}

export type DateOrder = "dmy" | "mdy" | "ymd";

const norm = (s: string) => s.toLocaleLowerCase("es").normalize("NFD").replace(/[̀-ͯ]/g, "").trim();

const HINTS: Record<Exclude<keyof ColumnMap, "headerRow">, readonly RegExp[]> = {
  date: [/^fecha/, /^date/, /^dia$/, /fecha de (la )?transaccion/, /fecha movimiento/],
  description: [
    /descrip/,
    /concepto/,
    /detalle/,
    /referencia/,
    /comercio/,
    /^description/,
    /^memo/,
    /^nombre/,
  ],
  amount: [
    /^valor$/,
    /^monto$/,
    /^importe$/,
    /^amount$/,
    /^valor (de la )?transaccion/,
    /^valor total/,
  ],
  debit: [/debito/, /^cargo/, /^retiro/, /^salida/, /^debit/, /^egreso/],
  credit: [/credito/, /^abono/, /^deposito/, /^entrada/, /^credit/, /^ingreso/],
  category: [/categor/, /^category/, /^tipo de gasto/],
};

const find = (header: readonly string[], patterns: readonly RegExp[], taken: Set<number>) => {
  for (const p of patterns) {
    const i = header.findIndex((h, idx) => !taken.has(idx) && p.test(norm(h)));
    if (i >= 0) {
      taken.add(i);
      return i;
    }
  }
  return null;
};

/** La primera fila (de las 15 primeras) que tenga una columna de fecha y una de monto. */
export function guessColumns(table: Table): ColumnMap {
  for (let row = 0; row < Math.min(15, table.length); row++) {
    const header = table[row] ?? [];
    const taken = new Set<number>();
    const date = find(header, HINTS.date, taken);
    const debit = find(header, HINTS.debit, taken);
    const credit = find(header, HINTS.credit, taken);
    const amount = find(header, HINTS.amount, taken);
    const description = find(header, HINTS.description, taken);
    const category = find(header, HINTS.category, taken);
    if (date !== null && (amount !== null || debit !== null || credit !== null)) {
      return { headerRow: row, date, description, amount, debit, credit, category };
    }
  }
  return {
    headerRow: 0,
    date: 0,
    description: 1,
    amount: 2,
    debit: null,
    credit: null,
    category: null,
  };
}

/** Días entre el 30/12/1899 (día 0 de Excel) y el 1/1/1970. */
const EXCEL_EPOCH = 25_569;

/**
 * Fecha como la ponen los bancos: 15/11/2026, 15-11-26, 2026-11-15, 20261115, un número de Excel
 * o "15 nov 2026". `order` desempata 03/04 (por defecto día/mes, como en Colombia).
 */
export function parseDate(text: string, order: DateOrder = "dmy"): CivilDate | null {
  const s = norm(text).replace(/\s+\d{1,2}:\d{2}(:\d{2})?.*$/, "");
  const d = ymd(s) ?? numeric(s, order) ?? named(s) ?? excelSerial(s);
  return d && isValidCivil(d) ? d : null;
}

function ymd(s: string): CivilDate | null {
  const m = /^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})$/.exec(s) ?? /^(\d{4})(\d{2})(\d{2})$/.exec(s);
  return m ? { year: Number(m[1]), month: Number(m[2]), day: Number(m[3]) } : null;
}

function numeric(s: string, order: DateOrder): CivilDate | null {
  const m = /^(\d{1,2})[-/.](\d{1,2})[-/.](\d{2}|\d{4})$/.exec(s);
  if (!m) return null;
  const a = Number(m[1]);
  const b = Number(m[2]);
  const y = Number(m[3]);
  const year = y < 100 ? 2000 + y : y;
  return order === "mdy" ? { year, month: a, day: b } : { year, month: b, day: a };
}

function named(s: string): CivilDate | null {
  const m = /^(\d{1,2})[\s-]+(?:de\s+)?([a-z]{3,})\.?[\s-]+(?:de\s+)?(\d{4})$/.exec(s);
  const month = m ? monthFromName(m[2] ?? "") : null;
  return m && month ? { year: Number(m[3]), month, day: Number(m[1]) } : null;
}

function excelSerial(s: string): CivilDate | null {
  if (!/^\d{5}(\.\d+)?$/.test(s)) return null;
  const date = new Date((Math.floor(Number(s)) - EXCEL_EPOCH) * 86_400_000);
  return { year: date.getUTCFullYear(), month: date.getUTCMonth() + 1, day: date.getUTCDate() };
}

const MONTHS = ["ene", "feb", "mar", "abr", "may", "jun", "jul", "ago", "sep", "oct", "nov", "dic"];
const MONTHS_EN = [
  "jan",
  "feb",
  "mar",
  "apr",
  "may",
  "jun",
  "jul",
  "aug",
  "sep",
  "oct",
  "nov",
  "dec",
];

function monthFromName(name: string): number | null {
  const key = name.slice(0, 3);
  const i = MONTHS.indexOf(key);
  if (i >= 0) return i + 1;
  const j = MONTHS_EN.indexOf(key);
  return j >= 0 ? j + 1 : null;
}

/**
 * Monto con signo en unidades menores, sin pasar por punto flotante. Acepta "$ 1.234.567,89",
 * "-45.900", "1,234.56", "(12.000)" y "12.000-". El separador decimal es el último `.` o `,` si
 * le siguen 1 o 2 dígitos; si no, todo son separadores de miles.
 */
export function parseAmount(text: string, currency: CurrencyCode): Money | null {
  let s = text
    .replace(/\s| /g, "")
    .replace(/^(cop|usd|\$|us\$)+/i, "")
    .replace(/(cop|usd)$/i, "");
  let negative = false;
  if (/^\(.*\)$/.test(s)) {
    negative = true;
    s = s.slice(1, -1);
  }
  if (s.endsWith("-")) {
    negative = !negative;
    s = s.slice(0, -1);
  }
  if (s.startsWith("-")) {
    negative = !negative;
    s = s.slice(1);
  } else if (s.startsWith("+")) s = s.slice(1);
  s = s.replace(/^\$/, "");
  if (!/^[\d.,]+$/.test(s) || !/\d/.test(s)) return null;
  const last = Math.max(s.lastIndexOf("."), s.lastIndexOf(","));
  const decimals = last >= 0 ? s.length - last - 1 : 0;
  const hasDecimal = last >= 0 && decimals >= 1 && decimals <= 2;
  const whole = (hasDecimal ? s.slice(0, last) : s).replace(/[.,]/g, "");
  const fraction = hasDecimal ? s.slice(last + 1) : "";
  if (whole === "" && fraction === "") return null;
  const parsed = Money.parse(
    `${negative ? "-" : ""}${whole || "0"}${fraction ? `.${fraction}` : ""}`,
    currency,
  );
  return parsed.ok ? parsed.value : null;
}

export interface ImportRow {
  /** Fila del archivo (desde 1, como la ve la persona en Excel). */
  readonly line: number;
  readonly date: CivilDate;
  readonly description: string;
  /** Con signo: negativo es gasto. */
  readonly amount: Money;
  readonly category: string | null;
}

export interface RowError {
  readonly line: number;
  readonly reason: "date" | "amount";
  readonly raw: string;
}

/** Aplica el mapeo: filas válidas y las que no se pudieron leer (para mostrarlas, no para callarlas). */
export function readRows(
  table: Table,
  map: ColumnMap,
  currency: CurrencyCode,
  order: DateOrder = "dmy",
): { rows: ImportRow[]; errors: RowError[] } {
  const rows: ImportRow[] = [];
  const errors: RowError[] = [];
  const cell = (r: readonly string[], i: number | null) => (i === null ? "" : (r[i] ?? "").trim());
  table.forEach((r, index) => {
    if (index <= map.headerRow) return;
    const line = index + 1;
    const rawDate = cell(r, map.date);
    const rawAmount = cell(r, map.amount);
    const rawDebit = cell(r, map.debit);
    const rawCredit = cell(r, map.credit);
    // Totales, saldos y líneas vacías al final del extracto: sin fecha ni monto no son movimientos.
    if (!rawDate && !rawAmount && !rawDebit && !rawCredit) return;
    const date = parseDate(rawDate, order);
    if (!date) {
      errors.push({ line, reason: "date", raw: rawDate });
      return;
    }
    let amount: Money | null = null;
    if (map.amount !== null && rawAmount) amount = parseAmount(rawAmount, currency);
    else {
      const debit = rawDebit ? parseAmount(rawDebit, currency) : null;
      const credit = rawCredit ? parseAmount(rawCredit, currency) : null;
      if (debit && !debit.isZero()) amount = debit.isNegative() ? debit : debit.negate();
      else if (credit && !credit.isZero()) amount = credit.isNegative() ? credit.negate() : credit;
    }
    if (!amount || amount.isZero()) {
      errors.push({ line, reason: "amount", raw: rawAmount || rawDebit || rawCredit });
      return;
    }
    rows.push({
      line,
      date,
      description: cell(r, map.description).replace(/\s+/g, " "),
      amount,
      category: cell(r, map.category) || null,
    });
  });
  return { rows, errors };
}
