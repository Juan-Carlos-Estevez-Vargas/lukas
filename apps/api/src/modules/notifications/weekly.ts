import { sql } from "drizzle-orm";
import type { PgDatabase, PgQueryResultHKT } from "drizzle-orm/pg-core";
import type { TablesRelationalConfig } from "drizzle-orm/relations";
import type { PushMessage, PushSender } from "./push";

const DAY = 86_400_000;

/** Los últimos 7 días hasta `now`, y los 7 anteriores para comparar. */
export function weekWindow(now: Date) {
  const start = new Date(now.getTime() - 7 * DAY);
  return { previous: new Date(start.getTime() - 7 * DAY), start, end: now };
}

/** Pesos con puntos de miles, sin centavos: "$ 1.234.567". */
export function pesos(minor: bigint): string {
  const negative = minor < 0n;
  const abs = negative ? -minor : minor;
  const whole = (abs + 50n) / 100n;
  const text = whole.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ".");
  return `${negative ? "-" : ""}$ ${text}`;
}

export interface WeekSpending {
  readonly thisWeek: bigint;
  readonly lastWeek: bigint;
  readonly top: { readonly name: string; readonly amount: bigint } | null;
}

/** Texto del resumen. Solo gastos en pesos; otras monedas se ven en la app. */
export function summaryText(s: WeekSpending): { title: string; body: string } {
  const title = "Tu semana en Lukas";
  if (s.thisWeek <= 0n) {
    return { title, body: "En los últimos 7 días no registraste gastos. ¿Se te pasó alguno?" };
  }
  let body = `En los últimos 7 días gastaste ${pesos(s.thisWeek)}`;
  if (s.lastWeek > 0n) {
    const change = Number(((s.thisWeek - s.lastWeek) * 100n) / s.lastWeek);
    if (change === 0) body += ", igual que los 7 días anteriores";
    else
      body += `, ${Math.abs(change)} % ${change > 0 ? "más" : "menos"} que los 7 días anteriores`;
  }
  body += ".";
  if (s.top) body += ` Lo que más: ${s.top.name} (${pesos(s.top.amount)}).`;
  return { title, body };
}

interface Row extends Record<string, unknown> {
  user_id: string;
  token: string;
  name: string | null;
  this_week: string | null;
  last_week: string | null;
}

/**
 * Arma el resumen de cada teléfono con el aviso activado. Corre como dueño de la base (cron),
 * así que filtra por persona explícitamente; cada token usa solo su registro más reciente.
 */
export async function weeklyMessages<
  Q extends PgQueryResultHKT,
  Full extends Record<string, unknown>,
  Schema extends TablesRelationalConfig,
>(db: PgDatabase<Q, Full, Schema>, now: Date): Promise<PushMessage[]> {
  const { previous, start, end } = weekWindow(now);
  const result = await db.execute<Row>(sql`
    WITH devices AS (
      SELECT DISTINCT ON (token) token, user_id, weekly_summary
      FROM app.push_devices
      ORDER BY token, updated_at DESC
    ),
    spend AS (
      SELECT e.user_id, c.name,
        sum(e.amount_minor) FILTER (WHERE t.occurred_at >= ${start.toISOString()}) AS this_week,
        sum(e.amount_minor) FILTER (WHERE t.occurred_at < ${start.toISOString()}) AS last_week
      FROM app.entries e
      JOIN app.transactions t ON t.id = e.transaction_id
      JOIN app.categories c ON c.id = e.category_id
      WHERE c.kind = 'expense' AND e.currency = 'COP' AND t.deleted_at IS NULL
        AND t.occurred_at >= ${previous.toISOString()} AND t.occurred_at < ${end.toISOString()}
        AND e.user_id IN (SELECT user_id FROM devices WHERE weekly_summary)
      GROUP BY e.user_id, c.name
    )
    SELECT d.user_id, d.token, s.name, s.this_week::text, s.last_week::text
    FROM devices d LEFT JOIN spend s ON s.user_id = d.user_id
    WHERE d.weekly_summary
    ORDER BY d.token, s.name
  `);
  const rows: Row[] = Array.isArray(result)
    ? (result as Row[])
    : ((result as { rows: Row[] }).rows ?? []);
  const byToken = new Map<string, WeekSpending>();
  for (const r of rows) {
    const prev = byToken.get(r.token) ?? { thisWeek: 0n, lastWeek: 0n, top: null };
    const thisWeek = BigInt(r.this_week ?? "0");
    const lastWeek = BigInt(r.last_week ?? "0");
    const top =
      r.name && thisWeek > 0n && (!prev.top || thisWeek > prev.top.amount)
        ? { name: r.name, amount: thisWeek }
        : prev.top;
    byToken.set(r.token, {
      thisWeek: prev.thisWeek + thisWeek,
      lastWeek: prev.lastWeek + lastWeek,
      top,
    });
  }
  return [...byToken].map(([to, spending]) => ({ to, ...summaryText(spending), url: "/reports" }));
}

/** Envía los resúmenes y borra los teléfonos que ya no existen. */
export async function sendWeeklySummaries<
  Q extends PgQueryResultHKT,
  Full extends Record<string, unknown>,
  Schema extends TablesRelationalConfig,
>(db: PgDatabase<Q, Full, Schema>, sender: PushSender, now: Date) {
  const messages = await weeklyMessages(db, now);
  if (messages.length === 0) return { sent: 0, removed: 0 };
  const { dead } = await sender.send(messages);
  for (const token of dead) {
    await db.execute(sql`DELETE FROM app.push_devices WHERE token = ${token}`);
  }
  return { sent: messages.length, removed: dead.length };
}
