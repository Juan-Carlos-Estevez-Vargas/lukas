import type { CurrencyCode } from "../currency";
import { DomainError } from "../errors";
import type { Money } from "../money";
import { err, ok, type Result } from "../result";

export const ACCOUNT_TYPES = [
  "cash",
  "bank",
  "digital_wallet",
  "credit_card",
  "loan",
  "investment",
  "other_asset",
  "other_liability",
] as const;

export type AccountType = (typeof ACCOUNT_TYPES)[number];

/** Dónde vive el dinero: efectivo, banco, Nequi, tarjeta, préstamo… */
export interface Account {
  readonly id: string;
  readonly name: string;
  readonly type: AccountType;
  readonly currency: CurrencyCode;
  readonly institution: string | null;
  /** Solo los últimos 4 dígitos, para asociar alertas. Nunca el número completo. */
  readonly last4: string | null;
  readonly closingDay: number | null;
  readonly dueDay: number | null;
  readonly creditLimit: Money | null;
  readonly archivedAt: Date | null;
  readonly createdAt: Date;
  readonly updatedAt: Date;
  /** Control de concurrencia optimista para el sync. */
  readonly version: number;
}

export interface NewAccount {
  readonly name: string;
  readonly type: AccountType;
  readonly currency: CurrencyCode;
  readonly institution?: string | null;
  readonly last4?: string | null;
  readonly closingDay?: number | null;
  readonly dueDay?: number | null;
  readonly creditLimit?: Money | null;
}

const isDay = (d: number | null | undefined) =>
  d == null || (Number.isInteger(d) && d >= 1 && d <= 31);

/** Valida y crea una cuenta nueva. `id` y `now` vienen de afuera para que sea determinista. */
export function createAccount(
  input: NewAccount,
  id: string,
  now: Date,
): Result<Account, DomainError> {
  const name = input.name.trim();
  if (name.length === 0)
    return err(new DomainError("account_name_required", "La cuenta necesita un nombre"));
  const last4 = input.last4 ?? null;
  if (last4 !== null && !/^[0-9]{4}$/.test(last4)) {
    return err(new DomainError("invalid_last4", "Solo se guardan los últimos 4 dígitos"));
  }
  if (!isDay(input.closingDay) || !isDay(input.dueDay)) {
    return err(new DomainError("invalid_day", "El día de corte y de pago van de 1 a 31"));
  }
  const creditLimit = input.creditLimit ?? null;
  if (creditLimit && creditLimit.currencyCode !== input.currency) {
    return err(
      new DomainError("currency_mismatch", "El cupo debe estar en la moneda de la cuenta"),
    );
  }
  return ok({
    id,
    name,
    type: input.type,
    currency: input.currency,
    institution: input.institution?.trim() || null,
    last4,
    closingDay: input.closingDay ?? null,
    dueDay: input.dueDay ?? null,
    creditLimit,
    archivedAt: null,
    createdAt: now,
    updatedAt: now,
    version: 1,
  });
}

export type AccountChanges = Partial<
  Pick<NewAccount, "name" | "institution" | "last4" | "closingDay" | "dueDay" | "creditLimit">
>;

/**
 * Edita una cuenta. El tipo y la moneda no cambian: los asientos ya registrados dependen de
 * ellos. Sube `version` para el control de concurrencia del sync.
 */
export function updateAccount(
  account: Account,
  changes: AccountChanges,
  now: Date,
): Result<Account, DomainError> {
  const merged = createAccount(
    {
      name: changes.name ?? account.name,
      type: account.type,
      currency: account.currency,
      institution: "institution" in changes ? changes.institution : account.institution,
      last4: "last4" in changes ? changes.last4 : account.last4,
      closingDay: "closingDay" in changes ? changes.closingDay : account.closingDay,
      dueDay: "dueDay" in changes ? changes.dueDay : account.dueDay,
      creditLimit: "creditLimit" in changes ? changes.creditLimit : account.creditLimit,
    },
    account.id,
    now,
  );
  if (!merged.ok) return merged;
  return ok({
    ...merged.value,
    archivedAt: account.archivedAt,
    createdAt: account.createdAt,
    version: account.version + 1,
  });
}

/** Archivar oculta la cuenta sin borrar su historia. Solo se puede con saldo en cero. */
export function archiveAccount(
  account: Account,
  balance: Money,
  now: Date,
): Result<Account, DomainError> {
  if (account.archivedAt) return ok(account);
  if (!balance.isZero()) {
    return err(
      new DomainError("balance_not_zero", "Lleva el saldo a cero antes de archivar la cuenta"),
    );
  }
  return ok({ ...account, archivedAt: now, updatedAt: now, version: account.version + 1 });
}

export function unarchiveAccount(account: Account, now: Date): Account {
  if (!account.archivedAt) return account;
  return { ...account, archivedAt: null, updatedAt: now, version: account.version + 1 };
}
