import { addDays, type CivilDate, type CurrencyCode, compareCivil, Money } from "@lukas/domain";
import { type ImportRow, parseAmount } from "../columns";
import { lineText, type PdfCell, type PdfLine } from "../pdf/text";

export type BankId = "bancolombia" | "davivienda" | "bbva" | "nu" | "nequi";

/** Bancos conocidos; se reconocen por la cabecera, no por los movimientos (que nombran a otros). */
const BANKS: readonly { readonly id: BankId; readonly pattern: RegExp }[] = [
  { id: "nequi", pattern: /\bnequi\b/i },
  { id: "nu", pattern: /(^|\s)nu(\s|$)|nu financiera|nubank/i },
  { id: "davivienda", pattern: /davivienda|daviplata/i },
  { id: "bbva", pattern: /\bbbva\b/i },
  { id: "bancolombia", pattern: /bancolombia/i },
];

export const BANK_NAMES: Record<BankId, string> = {
  bancolombia: "Bancolombia",
  davivienda: "Davivienda",
  bbva: "BBVA",
  nu: "Nu",
  nequi: "Nequi",
};

export interface Statement {
  readonly bank: BankId | null;
  /** Extracto de tarjeta de crédito: las compras salen positivas y aquí se vuelven gastos. */
  readonly card: boolean;
  readonly rows: readonly ImportRow[];
  /** Líneas que parecían movimientos (empiezan con fecha) pero no se pudieron leer. */
  readonly skipped: number;
  readonly opening: Money | null;
  readonly closing: Money | null;
  /** Si el saldo inicial más los movimientos da el saldo final; `null` si no hay cómo saberlo. */
  readonly balanced: boolean | null;
}

type Role = "date" | "description" | "amount" | "debit" | "credit" | "balance" | "other";

interface Column {
  readonly role: Role;
  readonly x: number;
  readonly end: number;
}

const PLAIN: Record<string, string> = { á: "a", é: "e", í: "i", ó: "o", ú: "u", ü: "u", ñ: "n" };

/** Minúsculas y sin tildes (sin `normalize`, que no todos los motores de JS traen). */
const strip = (s: string) => s.toLowerCase().replace(/[áéíóúüñ]/g, (c) => PLAIN[c] ?? c);

function roleOf(header: string, taken: ReadonlySet<Role>): Role {
  const h = strip(header);
  if (/^(f\.|fecha)/.test(h)) return taken.has("date") ? "other" : "date";
  if (/saldo/.test(h)) return "balance";
  if (/cargo|debito|retiro|egreso|salida/.test(h)) return "debit";
  if (/abono|credito|deposito|ingreso|entrada/.test(h)) return "credit";
  if (/descrip|concepto|detalle|movimiento|transacci|establecimiento|comercio/.test(h)) {
    return "description";
  }
  if (/cuota|pendiente|diferir|tasa|interes/.test(h)) return "other";
  if (/valor|monto|importe/.test(h)) return taken.has("amount") ? "other" : "amount";
  return "other";
}

/** Una línea es cabecera de tabla si nombra una fecha y al menos un monto. */
function headerColumns(line: PdfLine): Column[] | null {
  if (line.cells.length < 3) return null;
  const taken = new Set<Role>();
  const columns = line.cells.map((c) => {
    const role = roleOf(c.text, taken);
    taken.add(role);
    return { role, x: c.x, end: c.end };
  });
  const money = columns.some((c) => ["amount", "debit", "credit"].includes(c.role));
  return taken.has("date") && money && !line.cells.some((c) => parseAmount(c.text, "COP"))
    ? columns
    : null;
}

/** Columna de la celda: la que más se solapa; si ninguna, la de centro más cercano. */
function columnOf(cell: PdfCell, columns: readonly Column[]): Column | undefined {
  let best: Column | undefined;
  let score = 0;
  for (const col of columns) {
    const overlap = Math.min(cell.end, col.end) - Math.max(cell.x, col.x);
    if (overlap > score) {
      score = overlap;
      best = col;
    }
  }
  if (best) return best;
  const mid = (cell.x + cell.end) / 2;
  return [...columns].sort(
    (a, b) => Math.abs((a.x + a.end) / 2 - mid) - Math.abs((b.x + b.end) / 2 - mid),
  )[0];
}

const MONTHS: Record<string, number> = {
  ene: 1,
  jan: 1,
  feb: 2,
  mar: 3,
  abr: 4,
  apr: 4,
  may: 5,
  jun: 6,
  jul: 7,
  ago: 8,
  aug: 8,
  sep: 9,
  set: 9,
  oct: 10,
  nov: 11,
  dic: 12,
  dec: 12,
};

interface PartialDate {
  readonly day: number;
  readonly month: number;
  readonly year: number | null;
}

const valid = (d: PartialDate): PartialDate | null =>
  d.month >= 1 && d.month <= 12 && d.day >= 1 && d.day <= 31 ? d : null;

const fullYear = (y: string | undefined): number | null => {
  if (!y) return null;
  const n = Number(y);
  return y.length === 2 ? 2000 + n : n;
};

/** Fecha al inicio del texto: "5/10", "05-10-2026", "2026/10/05", "03 10", "28 sep", "3 de oct. de 2026". */
export function leadingDate(text: string): PartialDate | null {
  const t = strip(text).trim();
  let m = /^(\d{4})[/.-](\d{1,2})[/.-](\d{1,2})\b/.exec(t);
  if (m) return valid({ year: Number(m[1]), month: Number(m[2]), day: Number(m[3]) });
  m = /^(\d{1,2})[/.-](\d{1,2})(?:[/.-](\d{4}|\d{2}))?(?![\d/])/.exec(t);
  if (m) return valid({ day: Number(m[1]), month: Number(m[2]), year: fullYear(m[3]) });
  m = /^(\d{1,2})(?: de)? ([a-z]{3})[a-z]*\.?(?:,? (?:de )?(\d{4}))?\b/.exec(t);
  const month = m ? MONTHS[m[2] ?? ""] : undefined;
  if (m && month) return valid({ day: Number(m[1]), month, year: fullYear(m[3]) });
  m = /^(\d{1,2}) (\d{1,2})$/.exec(t);
  if (m) return valid({ day: Number(m[1]), month: Number(m[2]), year: null });
  return null;
}

/** Fechas completas (con año) en un texto; sirven para saber el periodo del extracto. */
function fullDates(text: string): CivilDate[] {
  const out: CivilDate[] = [];
  const t = strip(text);
  const re =
    /(\d{4}[/.-]\d{1,2}[/.-]\d{1,2}|\d{1,2}[/.-]\d{1,2}[/.-]\d{4}|\d{1,2}(?: de)? [a-z]{3}[a-z]*\.?,? (?:de )?\d{4})/g;
  for (const m of t.matchAll(re)) {
    const d = leadingDate(m[0]);
    if (d?.year) out.push({ year: d.year, month: d.month, day: d.day });
  }
  return out;
}

/** El año que falta: el más reciente que no quede muy por después del fin del periodo. */
function withYear(d: PartialDate, end: CivilDate): CivilDate {
  if (d.year) return { year: d.year, month: d.month, day: d.day };
  const guess = { year: end.year, month: d.month, day: d.day };
  return compareCivil(guess, addDays(end, 45)) > 0 ? { ...guess, year: end.year - 1 } : guess;
}

const abs = (m: Money): Money => (m.isNegative() ? m.negate() : m);

const amountOf = (text: string, currency: CurrencyCode): Money | null =>
  parseAmount(text.replace(/\+$/, "").replace(/^\+/, ""), currency);

/** Nunca guardar números de cuenta o tarjeta completos: se dejan los últimos 4 dígitos. */
export const maskNumbers = (text: string): string =>
  text.replace(/\d[\d -]{4,}\d/g, (run) => {
    const digits = run.replace(/\D/g, "");
    return digits.length >= 6 ? `••${digits.slice(-4)}` : run;
  });

const OPENING = /saldo (anterior|inicial)/;
const CLOSING = /saldo (final|actual|nuevo)|nuevo saldo/;
const INCOME_WORDS =
  /abono|recib|consignaci|deposito|nomina|salario|devoluci|reintegro|intereses|recarga/;

interface RawRow {
  readonly date: PartialDate;
  readonly description: string;
  /** Signo dado por el extracto (columna débito/crédito o el signo del monto). */
  readonly amount: Money;
  readonly signed: boolean;
  readonly balance: Money | null;
}

/** Lee los movimientos de un extracto ya convertido en líneas. */
export function parseStatement(
  lines: readonly PdfLine[],
  currency: CurrencyCode,
  today: CivilDate,
): Statement {
  const firstHeader = lines.findIndex((l) => headerColumns(l) !== null);
  const intro = lines.slice(0, firstHeader < 0 ? 12 : Math.max(firstHeader, 1));
  const introText = intro.map(lineText).join("\n");
  const bank = BANKS.find((b) => b.pattern.test(introText))?.id ?? null;
  const card = /tarjeta de cr[eé]dito|pago m[ií]nimo|cupo total/i.test(introText);

  let columns: Column[] | null = null;
  let opening: Money | null = null;
  let closing: Money | null = null;
  let skipped = 0;
  const raw: RawRow[] = [];
  const context: CivilDate[] = [];

  for (const line of lines) {
    const header = headerColumns(line);
    if (header) {
      columns = header;
      continue;
    }
    const text = strip(lineText(line));
    const amounts = line.cells
      .map((c) => amountOf(c.text, currency))
      .filter((m): m is Money => m !== null);
    // "Saldo anterior  $ 1.250.000" en dos celdas o "Saldo Anterior: $ 900,000.00" en una.
    const labelled = amounts[amounts.length - 1] ?? amountOf(text.split(":").pop() ?? "", currency);
    if (OPENING.test(text) && !leadingDate(text)) {
      opening = labelled;
      continue;
    }
    if (CLOSING.test(text) && !leadingDate(text)) {
      closing = labelled;
      continue;
    }
    const row = columns ? byColumns(line, columns, currency) : byPosition(line, currency);
    if (row === "none") {
      context.push(...fullDates(lineText(line)));
      continue;
    }
    if (row === "unreadable") skipped++;
    else raw.push(row);
  }

  const end =
    context.reduce<CivilDate | null>((m, d) => (!m || compareCivil(d, m) > 0 ? d : m), null) ??
    today;
  const anySigned = raw.some((r) => r.signed);
  const rows: ImportRow[] = [];
  let previous = opening;
  raw.forEach((r, i) => {
    let amount = r.amount;
    if (card) amount = amount.negate();
    else if (!anySigned) {
      const delta = previous && r.balance ? r.balance.subtract(previous) : null;
      if (delta && abs(delta).equals(abs(amount))) amount = delta;
      else if (!INCOME_WORDS.test(strip(r.description))) amount = amount.negate();
    }
    previous = r.balance ?? (previous ? previous.add(amount) : null);
    rows.push({
      line: i + 1,
      date: withYear(r.date, end),
      description: maskNumbers(r.description),
      amount,
      category: null,
    });
  });

  const lastBalance = [...raw].reverse().find((r) => r.balance)?.balance ?? null;
  const finalBalance = closing ?? lastBalance;
  const total = rows.reduce((s, r) => s.add(r.amount), Money.zero(currency));
  const balanced =
    !card && opening && finalBalance ? opening.add(total).equals(finalBalance) : null;
  return { bank, card, rows, skipped, opening, closing: finalBalance, balanced };
}

type Parsed = RawRow | "none" | "unreadable";

function byColumns(line: PdfLine, columns: readonly Column[], currency: CurrencyCode): Parsed {
  const by = new Map<Role, string[]>();
  for (const cell of line.cells) {
    const role = columnOf(cell, columns)?.role ?? "other";
    by.set(role, [...(by.get(role) ?? []), cell.text]);
  }
  const get = (role: Role) => (by.get(role) ?? []).join(" ").trim();
  const date = leadingDate(get("date"));
  if (!date) return "none";
  const description = get("description") || get("other");
  const balance = get("balance") ? amountOf(get("balance"), currency) : null;
  const debit = get("debit") ? amountOf(get("debit"), currency) : null;
  const credit = get("credit") ? amountOf(get("credit"), currency) : null;
  if (debit && !debit.isZero()) {
    return { date, description, amount: abs(debit).negate(), signed: true, balance };
  }
  if (credit && !credit.isZero())
    return { date, description, amount: abs(credit), signed: true, balance };
  const text = get("amount");
  const amount = text ? amountOf(text, currency) : null;
  if (!amount) return "unreadable";
  return { date, description, amount, signed: /-|\(|\+$/.test(text), balance };
}

/** Sin cabecera reconocible: fecha en la primera celda, montos al final (el último, el saldo). */
function byPosition(line: PdfLine, currency: CurrencyCode): Parsed {
  const [first, ...rest] = line.cells;
  const date = first ? leadingDate(first.text) : null;
  if (!date) return "none";
  const trailing: { text: string; money: Money }[] = [];
  for (let i = rest.length - 1; i >= 0; i--) {
    const text = rest[i]?.text ?? "";
    const money = /[.,]\d{2}\b|\$/.test(text) ? amountOf(text, currency) : null;
    if (!money) break;
    trailing.unshift({ text, money });
  }
  const amount = trailing[0];
  if (!amount) return "unreadable";
  const description = rest
    .slice(0, rest.length - trailing.length)
    .map((c) => c.text)
    .filter((t) => !/^\d{1,6}$/.test(t))
    .join(" ");
  return {
    date,
    description,
    amount: amount.money,
    signed: /-|\(/.test(amount.text),
    balance: trailing.length > 1 ? (trailing[trailing.length - 1]?.money ?? null) : null,
  };
}
