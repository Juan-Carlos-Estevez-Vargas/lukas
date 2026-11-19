import {
  type Account,
  type AccountChanges,
  archiveAccount,
  type CurrencyCode,
  createAccount,
  type DomainError,
  type Entry,
  type Money,
  type Result,
  unarchiveAccount,
  updateAccount,
} from "@lukas/domain";
import { sqliteAccounts, sqliteRepositories } from "../data/ledger-sqlite";
import type { SqlConnection } from "../data/sql";
import type { AccountTemplate } from "./templates";

export interface Clock {
  readonly newId: () => string;
  readonly now: () => Date;
}

const OPENING_BALANCE = "Saldo inicial";

/** Categoría de sistema (patrimonio) contra la que se registran los saldos iniciales. */
async function openingBalanceCategory(db: SqlConnection, clock: Clock): Promise<string> {
  const row = await db.get<{ id: string }>(
    "SELECT id FROM categories WHERE kind = 'equity' AND is_system = 1 AND name = ?",
    OPENING_BALANCE,
  );
  if (row) return row.id;
  const id = clock.newId();
  const now = clock.now().toISOString();
  await db.run(
    `INSERT INTO categories (id, name, kind, is_system, created_at, updated_at)
     VALUES (?, ?, 'equity', 1, ?, ?)`,
    id,
    OPENING_BALANCE,
    now,
    now,
  );
  return id;
}

/**
 * Registra el saldo inicial como una transacción contra "Saldo inicial", así el libro cuadra
 * y el saldo de la cuenta sale de los asientos como cualquier otro. Debe correr dentro de una
 * transacción de la base.
 */
export async function recordOpeningBalance(
  tx: SqlConnection,
  account: Account,
  amount: Money,
  clock: Clock,
): Promise<void> {
  if (amount.isZero()) return;
  const equity = await openingBalanceCategory(tx, clock);
  const now = clock.now();
  const entries: Entry[] = [
    { id: clock.newId(), target: { accountId: account.id }, amount },
    { id: clock.newId(), target: { categoryId: equity }, amount: amount.negate() },
  ];
  await sqliteRepositories(tx).transactions.save({
    id: clock.newId(),
    occurredAt: now,
    description: OPENING_BALANCE,
    merchant: null,
    notes: null,
    status: "cleared",
    source: "manual",
    entries,
    createdAt: now,
    updatedAt: now,
    version: 1,
  });
}

/** Datos propios de una tarjeta de crédito. Nunca el número: solo cupo y días. */
export interface CardSettings {
  readonly creditLimit: Money | null;
  readonly closingDay: number | null;
  readonly dueDay: number | null;
}

/** Crea una cuenta desde una plantilla, con saldo inicial opcional, en una sola transacción. */
export async function createFromTemplate(
  db: SqlConnection,
  template: AccountTemplate,
  options: {
    name?: string;
    openingBalance?: Money | null;
    card?: CardSettings;
    currency?: CurrencyCode;
  },
  clock: Clock,
): Promise<Result<Account, DomainError>> {
  const res = createAccount(
    {
      name: options.name?.trim() || template.name,
      type: template.type,
      currency: options.currency ?? "COP",
      institution: template.institution,
      ...(template.type === "credit_card" && options.card ? options.card : {}),
    },
    clock.newId(),
    clock.now(),
  );
  if (!res.ok) return res;
  await db.transaction(async (tx) => {
    await sqliteAccounts(tx).save(res.value);
    if (options.openingBalance)
      await recordOpeningBalance(tx, res.value, options.openingBalance, clock);
  });
  return res;
}

export async function editAccount(
  db: SqlConnection,
  id: string,
  changes: AccountChanges,
  now: Date,
): Promise<Result<Account, DomainError> | null> {
  const repo = sqliteAccounts(db);
  const account = await repo.get(id);
  if (!account) return null;
  const res = updateAccount(account, changes, now);
  if (res.ok) await repo.save(res.value);
  return res;
}

/** Archiva (con saldo en cero) o restaura una cuenta. */
export async function setArchived(
  db: SqlConnection,
  id: string,
  archived: boolean,
  now: Date,
): Promise<Result<Account, DomainError> | null> {
  let result: Result<Account, DomainError> | null = null;
  await db.transaction(async (tx) => {
    const repo = sqliteAccounts(tx);
    const account = await repo.get(id);
    if (!account) return;
    result = archived
      ? archiveAccount(account, await repo.balance(account), now)
      : { ok: true, value: unarchiveAccount(account, now) };
    if (result.ok) await repo.save(result.value);
  });
  return result;
}
