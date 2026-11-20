import type { MovementKind } from "@lukas/domain";
import type { RawCapture } from "../normalize";
import type { PostedNotification } from "../notification";

/**
 * Una forma de aviso de un banco. La expresión usa grupos con nombre: `amount` (obligatorio),
 * `merchant`, `last4`, `date` (dd/mm/aaaa) y `time` (hh:mm). `kind: null` marca avisos que no son
 * un gasto ni un ingreso (pagos de tarjeta, movimientos entre bolsillos) y se descartan.
 */
export interface NotificationRule {
  readonly pattern: RegExp;
  readonly kind: MovementKind | null;
}

export interface BankParser {
  readonly bank: string;
  /** Paquetes de Android de la app del banco. */
  readonly apps: readonly string[];
  readonly rules: readonly NotificationRule[];
}

/** "05/11/2026" y "13:01" del aviso, en hora local; `null` si no están o no tienen sentido. */
export function occurredAt(date?: string, time?: string, posted?: Date): Date | null {
  if (!date && !time) return null;
  const base = posted ?? new Date();
  let year = base.getFullYear();
  let month = base.getMonth();
  let day = base.getDate();
  if (date) {
    const d = /^(\d{1,2})[/-](\d{1,2})[/-](\d{2}|\d{4})$/.exec(date);
    if (!d) return null;
    day = Number(d[1]);
    month = Number(d[2]) - 1;
    year = d[3]?.length === 2 ? 2000 + Number(d[3]) : Number(d[3]);
  }
  let hours = 12;
  let minutes = 0;
  if (time) {
    const t = /^(\d{1,2}):(\d{2})$/.exec(time);
    if (!t) return null;
    hours = Number(t[1]);
    minutes = Number(t[2]);
  } else if (!date) return null;
  const at = new Date(year, month, day, hours, minutes);
  // Fechas imposibles (31/02) o del futuro lejano: mejor la hora del aviso.
  if (at.getDate() !== day || at.getMonth() !== month || hours > 23 || minutes > 59) return null;
  if (posted && at.getTime() - posted.getTime() > 3_600_000) return null;
  return at;
}

const MAX_TEXT = 500;

export type BankResult = RawCapture | "ignore" | null;

/** Aplica las reglas del banco: la captura, `"ignore"` si es un aviso conocido que no cuenta. */
export function applyRules(parser: BankParser, n: PostedNotification): BankResult {
  // Un aviso real tiene pocas líneas; cortar el texto acota el trabajo de las expresiones.
  const text = `${n.title}. ${n.text}`.replace(/\s+/g, " ").trim().slice(0, MAX_TEXT);
  for (const rule of parser.rules) {
    const m = rule.pattern.exec(text);
    if (!m) continue;
    if (rule.kind === null) return "ignore";
    const g = m.groups ?? {};
    if (!g.amount) continue;
    const posted = new Date(n.postedAt);
    return {
      source: "notification",
      app: n.app,
      receivedAt: posted,
      occurredAt: occurredAt(g.date, g.time, posted),
      amount: g.amount,
      kind: rule.kind,
      merchant: g.merchant?.trim() || null,
      last4: g.last4 ?? null,
      text,
    };
  }
  return null;
}
