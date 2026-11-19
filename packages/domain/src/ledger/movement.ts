import { DomainError } from "../errors";
import type { Money } from "../money";
import { err, ok, type Result } from "../result";
import type { Account } from "./account";
import { checkBalanced, type Transaction } from "./transaction";

export type MovementKind = "expense" | "income";

/** Categoría de ingresos o gastos, lo mínimo que el registro necesita saber de ella. */
export interface MovementCategory {
  readonly id: string;
  readonly kind: "income" | "expense" | "equity" | "trading";
  readonly archivedAt: Date | null;
}

export interface MovementInput {
  readonly kind: MovementKind;
  /** Siempre positivo: el signo sale de `kind`. */
  readonly amount: Money;
  readonly occurredAt: Date;
  readonly merchant?: string | null;
  readonly note?: string | null;
}

export interface MovementDeps {
  readonly newId: () => string;
  readonly now: () => Date;
}

const clean = (s: string | null | undefined): string | null => {
  const v = s?.trim().replace(/\s+/g, " ");
  return v ? v : null;
};

/**
 * Un gasto o ingreso es una transacción de doble partida entre una cuenta y una categoría: el
 * gasto sale de la cuenta y entra a la categoría; el ingreso al revés.
 */
export function newMovement(
  account: Account,
  category: MovementCategory,
  input: MovementInput,
  deps: MovementDeps,
): Result<Transaction, DomainError> {
  if (input.amount.isZero() || input.amount.isNegative()) {
    return err(new DomainError("invalid_amount", "El monto debe ser mayor que cero"));
  }
  if (account.archivedAt) {
    return err(new DomainError("account_archived", "La cuenta está archivada"));
  }
  if (account.currency !== input.amount.currencyCode) {
    return err(
      new DomainError("currency_mismatch", "El monto debe estar en la moneda de la cuenta"),
    );
  }
  if (category.kind !== input.kind || category.archivedAt) {
    return err(new DomainError("invalid_category", "La categoría no corresponde al movimiento"));
  }
  const toAccount = input.kind === "income" ? input.amount : input.amount.negate();
  const merchant = clean(input.merchant);
  const now = deps.now();
  const transaction: Transaction = {
    id: deps.newId(),
    occurredAt: input.occurredAt,
    description: merchant ?? "",
    merchant,
    notes: clean(input.note),
    status: "cleared",
    source: "manual",
    entries: [
      { id: deps.newId(), target: { accountId: account.id }, amount: toAccount },
      { id: deps.newId(), target: { categoryId: category.id }, amount: toAccount.negate() },
    ],
    createdAt: now,
    updatedAt: now,
    version: 1,
  };
  const balanced = checkBalanced(transaction.entries);
  return balanced.ok ? ok(transaction) : balanced;
}

/** Clave para comparar comercios: sin tildes, mayúsculas ni espacios de más. */
export function merchantKey(name: string): string {
  return name
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim();
}

export interface CategoryUse {
  readonly categoryId: string;
  readonly occurredAt: Date;
}

/**
 * Sugiere la categoría que más se ha usado con ese comercio; a igual uso, la más reciente.
 * `null` si no hay historial.
 */
export function suggestFromHistory(history: readonly CategoryUse[]): string | null {
  const stats = new Map<string, { count: number; last: number }>();
  for (const h of history) {
    const s = stats.get(h.categoryId) ?? { count: 0, last: 0 };
    stats.set(h.categoryId, {
      count: s.count + 1,
      last: Math.max(s.last, h.occurredAt.getTime()),
    });
  }
  let best: [string, { count: number; last: number }] | null = null;
  for (const entry of stats) {
    if (
      !best ||
      entry[1].count > best[1].count ||
      (entry[1].count === best[1].count && entry[1].last > best[1].last)
    ) {
      best = entry;
    }
  }
  return best ? best[0] : null;
}
