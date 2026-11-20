import type { accounts, categories, entries, transactions } from "@lukas/db/schema";
import type { AccountRecord, CategoryRecord, EntryRecord, TransactionRecord } from "@lukas/sync";

type AccountRow = typeof accounts.$inferSelect;
type CategoryRow = typeof categories.$inferSelect;
type TransactionRow = typeof transactions.$inferSelect;
type EntryRow = typeof entries.$inferSelect;

const iso = (d: Date | null): string | null => (d ? d.toISOString() : null);
const date = (s: string | null): Date | null => (s ? new Date(s) : null);

/** Filas de Postgres ↔ registros del protocolo (fechas ISO y montos en texto). */
export const accountRecord = (r: AccountRow): AccountRecord => ({
  id: r.id,
  name: r.name,
  type: r.type,
  currency: r.currency,
  institution: r.institution,
  last4: r.last4,
  closingDay: r.closingDay,
  dueDay: r.dueDay,
  creditLimitMinor: r.creditLimitMinor === null ? null : r.creditLimitMinor.toString(),
  archivedAt: iso(r.archivedAt),
  createdAt: r.createdAt.toISOString(),
  updatedAt: r.updatedAt.toISOString(),
});

export const accountRow = (r: AccountRecord, userId: string) => ({
  id: r.id,
  userId,
  name: r.name,
  type: r.type,
  currency: r.currency,
  institution: r.institution,
  last4: r.last4,
  closingDay: r.closingDay,
  dueDay: r.dueDay,
  creditLimitMinor: r.creditLimitMinor === null ? null : BigInt(r.creditLimitMinor),
  archivedAt: date(r.archivedAt),
  createdAt: new Date(r.createdAt),
  updatedAt: new Date(r.updatedAt),
});

export const categoryRecord = (r: CategoryRow): CategoryRecord => ({
  id: r.id,
  parentId: r.parentId,
  name: r.name,
  kind: r.kind,
  icon: r.icon,
  color: r.color,
  isSystem: r.isSystem,
  archivedAt: iso(r.archivedAt),
  createdAt: r.createdAt.toISOString(),
  updatedAt: r.updatedAt.toISOString(),
});

export const categoryRow = (r: CategoryRecord, userId: string) => ({
  id: r.id,
  userId,
  parentId: r.parentId,
  name: r.name,
  kind: r.kind,
  icon: r.icon,
  color: r.color,
  isSystem: r.isSystem,
  archivedAt: date(r.archivedAt),
  createdAt: new Date(r.createdAt),
  updatedAt: new Date(r.updatedAt),
});

export const entryRecord = (r: EntryRow): EntryRecord => ({
  id: r.id,
  accountId: r.accountId,
  categoryId: r.categoryId,
  amountMinor: r.amountMinor.toString(),
  currency: r.currency,
});

export const transactionRecord = (
  r: TransactionRow,
  lines: readonly EntryRow[],
): TransactionRecord => ({
  id: r.id,
  occurredAt: r.occurredAt.toISOString(),
  description: r.description,
  merchant: r.merchant,
  notes: r.notes,
  status: r.status,
  source: r.source,
  deletedAt: iso(r.deletedAt),
  createdAt: r.createdAt.toISOString(),
  updatedAt: r.updatedAt.toISOString(),
  entries: lines.map(entryRecord),
});

export const transactionRow = (r: TransactionRecord, userId: string) => ({
  id: r.id,
  userId,
  occurredAt: new Date(r.occurredAt),
  description: r.description,
  merchant: r.merchant,
  notes: r.notes,
  status: r.status,
  source: r.source,
  deletedAt: date(r.deletedAt),
  createdAt: new Date(r.createdAt),
  updatedAt: new Date(r.updatedAt),
});

export const entryRows = (r: TransactionRecord, userId: string) =>
  r.entries.map((e) => ({
    id: e.id,
    transactionId: r.id,
    userId,
    accountId: e.accountId,
    categoryId: e.categoryId,
    amountMinor: BigInt(e.amountMinor),
    currency: e.currency,
  }));
