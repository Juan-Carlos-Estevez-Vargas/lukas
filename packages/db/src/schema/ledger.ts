import { sql } from "drizzle-orm";
import {
  type AnyPgColumn,
  bigint,
  boolean,
  char,
  check,
  index,
  smallint,
  text,
  timestamp,
  uuid,
} from "drizzle-orm/pg-core";
import { app, currency, id, timestamps, userId } from "./common";

export const accountType = app.enum("account_type", [
  "cash",
  "bank",
  "digital_wallet",
  "credit_card",
  "loan",
  "investment",
  "other_asset",
  "other_liability",
]);

/** Cuentas donde vive el dinero del usuario: efectivo, bancos, Nequi, tarjetas, préstamos. */
export const accounts = app.table(
  "accounts",
  {
    id: id(),
    userId: userId(),
    name: text("name").notNull(),
    type: accountType("type").notNull(),
    currency: currency(),
    institution: text("institution"),
    /** Solo los últimos 4 dígitos, para asociar alertas. Nunca el número completo. */
    last4: char("last4", { length: 4 }),
    closingDay: smallint("closing_day"),
    dueDay: smallint("due_day"),
    creditLimitMinor: bigint("credit_limit_minor", { mode: "bigint" }),
    archivedAt: timestamp("archived_at", { withTimezone: true }),
    ...timestamps,
  },
  (t) => [
    index("accounts_user_idx").on(t.userId),
    check("accounts_last4_digits", sql`${t.last4} IS NULL OR ${t.last4} ~ '^[0-9]{4}$'`),
    check("accounts_closing_day", sql`${t.closingDay} IS NULL OR ${t.closingDay} BETWEEN 1 AND 31`),
    check("accounts_due_day", sql`${t.dueDay} IS NULL OR ${t.dueDay} BETWEEN 1 AND 31`),
  ],
);

export const categoryKind = app.enum("category_kind", ["income", "expense", "equity", "trading"]);

/**
 * Categorías de ingreso y gasto. En la doble partida son la contrapartida de las cuentas.
 * `equity` se usa para saldos iniciales y `trading` para equilibrar cambios de moneda.
 */
export const categories = app.table(
  "categories",
  {
    id: id(),
    userId: userId(),
    parentId: uuid("parent_id").references((): AnyPgColumn => categories.id, {
      onDelete: "restrict",
    }),
    name: text("name").notNull(),
    kind: categoryKind("kind").notNull(),
    icon: text("icon"),
    color: text("color"),
    isSystem: boolean("is_system").notNull().default(false),
    archivedAt: timestamp("archived_at", { withTimezone: true }),
    ...timestamps,
  },
  (t) => [index("categories_user_idx").on(t.userId)],
);

export const transactionStatus = app.enum("transaction_status", [
  "pending",
  "cleared",
  "reconciled",
]);

export const transactionSource = app.enum("transaction_source", [
  "manual",
  "notification",
  "statement",
  "receipt",
  "email",
  "import",
  "recurring",
]);

export const transactions = app.table(
  "transactions",
  {
    id: id(),
    userId: userId(),
    occurredAt: timestamp("occurred_at", { withTimezone: true }).notNull(),
    description: text("description").notNull().default(""),
    merchant: text("merchant"),
    notes: text("notes"),
    status: transactionStatus("status").notNull().default("cleared"),
    source: transactionSource("source").notNull().default("manual"),
    deletedAt: timestamp("deleted_at", { withTimezone: true }),
    ...timestamps,
  },
  (t) => [index("transactions_user_occurred_idx").on(t.userId, t.occurredAt.desc())],
);

/**
 * Asientos de doble partida. Cada asiento afecta una cuenta o una categoría (nunca ambas).
 * Por cada transacción y moneda, la suma de `amount_minor` debe ser cero (trigger diferido).
 */
export const entries = app.table(
  "entries",
  {
    id: id(),
    transactionId: uuid("transaction_id")
      .notNull()
      .references(() => transactions.id, { onDelete: "cascade" }),
    userId: userId(),
    accountId: uuid("account_id").references(() => accounts.id, { onDelete: "restrict" }),
    categoryId: uuid("category_id").references(() => categories.id, { onDelete: "restrict" }),
    amountMinor: bigint("amount_minor", { mode: "bigint" }).notNull(),
    currency: currency(),
  },
  (t) => [
    index("entries_transaction_idx").on(t.transactionId),
    index("entries_account_idx").on(t.accountId),
    index("entries_category_idx").on(t.categoryId),
    check(
      "entries_account_xor_category",
      sql`(${t.accountId} IS NULL) <> (${t.categoryId} IS NULL)`,
    ),
    check("entries_amount_not_zero", sql`${t.amountMinor} <> 0`),
  ],
);
