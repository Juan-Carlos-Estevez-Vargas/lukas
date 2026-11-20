import type { AccountView, AgentData, CategoryView, MovementView } from "@lukas/ai-tools";
import { withUser } from "@lukas/db";
import { accounts, categories, entries, transactions } from "@lukas/db/schema";
import { type CurrencyCode, isCurrencyCode, Money } from "@lukas/domain";
import { and, desc, eq, gte, inArray, isNull, lt, sql } from "drizzle-orm";
import type { PgDatabase, PgQueryResultHKT } from "drizzle-orm/pg-core";
import type { TablesRelationalConfig } from "drizzle-orm/relations";

const currencyOf = (code: string): CurrencyCode => {
  if (!isCurrencyCode(code)) throw new Error(`Moneda desconocida: ${code}`);
  return code;
};

type Db = PgDatabase<PgQueryResultHKT, Record<string, unknown>, TablesRelationalConfig>;

interface EntryRow {
  transactionId: string;
  accountId: string | null;
  categoryId: string | null;
  amountMinor: bigint;
  currency: string;
}

/**
 * Datos del agente sobre Postgres. Cada consulta corre en su propia transacción `withUser`, así
 * que RLS limita todo a la persona de la sesión (y a sus hogares) aunque una consulta olvidara
 * filtrar.
 */
export function postgresAgentData<
  Q extends PgQueryResultHKT,
  Full extends Record<string, unknown>,
  Schema extends TablesRelationalConfig,
>(db: PgDatabase<Q, Full, Schema>, userId: string): AgentData {
  const as = <T>(fn: (tx: Db) => Promise<T>) =>
    withUser(db, userId, (tx) => fn(tx as unknown as Db));

  const categoryList = () =>
    as((tx) =>
      tx
        .select({
          id: categories.id,
          name: categories.name,
          kind: categories.kind,
          isSystem: categories.isSystem,
          archivedAt: categories.archivedAt,
        })
        .from(categories),
    );

  const toMovements = async (
    tx: Db,
    rows: {
      id: string;
      occurredAt: Date;
      merchant: string | null;
      description: string;
      notes: string | null;
    }[],
  ): Promise<MovementView[]> => {
    if (rows.length === 0) return [];
    const ids = rows.map((r) => r.id);
    const lines: EntryRow[] = await tx
      .select({
        transactionId: entries.transactionId,
        accountId: entries.accountId,
        categoryId: entries.categoryId,
        amountMinor: entries.amountMinor,
        currency: entries.currency,
      })
      .from(entries)
      .where(inArray(entries.transactionId, ids));
    const cats = new Map(
      (
        await tx
          .select({ id: categories.id, kind: categories.kind, isSystem: categories.isSystem })
          .from(categories)
      ).map((c) => [c.id, c]),
    );
    const out: MovementView[] = [];
    for (const r of rows) {
      const own = lines.filter((l) => l.transactionId === r.id);
      const accountLines = own.filter((l) => l.accountId);
      const categoryLines = own.filter((l) => l.categoryId);
      const base = {
        id: r.id,
        occurredAt: r.occurredAt,
        merchant: r.merchant ?? (r.description || null),
        note: r.notes,
      };
      if (categoryLines.length === 0) {
        const from = accountLines.find((l) => l.amountMinor < 0n);
        const to = accountLines.find((l) => l.amountMinor > 0n);
        if (!from?.accountId) continue;
        out.push({
          ...base,
          kind: "transfer",
          accountId: from.accountId,
          toAccountId: to?.accountId ?? null,
          categoryId: null,
          amount: Money.ofMinor(-from.amountMinor, currencyOf(from.currency)),
        });
        continue;
      }
      const account = accountLines[0];
      // La categoría principal es la de mayor monto (en un movimiento dividido).
      const main = [...categoryLines].sort((a, b) =>
        (b.amountMinor < 0n ? -b.amountMinor : b.amountMinor) >
        (a.amountMinor < 0n ? -a.amountMinor : a.amountMinor)
          ? 1
          : -1,
      )[0];
      const category = main?.categoryId ? cats.get(main.categoryId) : undefined;
      // Saldos iniciales y ajustes (categorías del sistema) no son gastos ni ingresos.
      if (!account?.accountId || !category || category.isSystem) continue;
      if (category.kind !== "expense" && category.kind !== "income") continue;
      const minor = account.amountMinor < 0n ? -account.amountMinor : account.amountMinor;
      out.push({
        ...base,
        kind: category.kind as "expense" | "income",
        accountId: account.accountId,
        toAccountId: null,
        categoryId: main?.categoryId ?? null,
        amount: Money.ofMinor(minor, currencyOf(account.currency)),
      });
    }
    return out;
  };

  const txColumns = {
    id: transactions.id,
    occurredAt: transactions.occurredAt,
    merchant: transactions.merchant,
    description: transactions.description,
    notes: transactions.notes,
  };

  return {
    accounts: () =>
      as(async (tx): Promise<AccountView[]> => {
        const rows = await tx
          .select({
            id: accounts.id,
            name: accounts.name,
            type: accounts.type,
            currency: accounts.currency,
            archivedAt: accounts.archivedAt,
            balance: sql<string>`coalesce((
              SELECT sum(e.amount_minor) FROM app.entries e
              JOIN app.transactions t ON t.id = e.transaction_id
              WHERE e.account_id = "accounts"."id" AND t.deleted_at IS NULL
            ), 0)::text`,
          })
          .from(accounts);
        return rows.map((a) => ({
          id: a.id,
          name: a.name,
          type: a.type,
          currency: currencyOf(a.currency),
          balance: Money.ofMinor(BigInt(a.balance), currencyOf(a.currency)),
          archived: a.archivedAt !== null,
        }));
      }),
    categories: async (): Promise<CategoryView[]> =>
      (await categoryList())
        .filter((c) => !c.isSystem && (c.kind === "expense" || c.kind === "income"))
        .map((c) => ({
          id: c.id,
          name: c.name,
          kind: c.kind as "expense" | "income",
          archived: c.archivedAt !== null,
        })),
    movements: ({ from, to }) =>
      as(async (tx) =>
        toMovements(
          tx,
          await tx
            .select(txColumns)
            .from(transactions)
            .where(
              and(
                isNull(transactions.deletedAt),
                gte(transactions.occurredAt, from),
                lt(transactions.occurredAt, to),
              ),
            )
            .orderBy(desc(transactions.occurredAt))
            .limit(2000),
        ),
      ),
    movement: (id) =>
      as(async (tx) => {
        // Un id que no es UUID no existe (y Postgres rechazaría la comparación).
        if (!/^[0-9a-f-]{36}$/i.test(id)) return null;
        const rows = await tx
          .select(txColumns)
          .from(transactions)
          .where(and(eq(transactions.id, id), isNull(transactions.deletedAt)));
        return (await toMovements(tx, rows))[0] ?? null;
      }),
  };
}
