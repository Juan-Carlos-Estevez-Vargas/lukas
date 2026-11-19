import type { CurrencyCode } from "../currency";
import { DomainError } from "../errors";
import type { Money } from "../money";
import { err, ok, type Result } from "../result";

export type TransactionStatus = "pending" | "cleared" | "reconciled";
export type TransactionSource =
  | "manual"
  | "notification"
  | "statement"
  | "receipt"
  | "email"
  | "import"
  | "recurring";

/** A qué afecta un asiento: una cuenta o una categoría, nunca ambas. */
export type EntryTarget = { readonly accountId: string } | { readonly categoryId: string };

/** Asiento de doble partida: positivo entra a la cuenta/categoría, negativo sale. */
export interface Entry {
  readonly id: string;
  readonly target: EntryTarget;
  readonly amount: Money;
}

export interface Transaction {
  readonly id: string;
  readonly occurredAt: Date;
  readonly description: string;
  readonly merchant: string | null;
  readonly notes: string | null;
  readonly status: TransactionStatus;
  readonly source: TransactionSource;
  readonly entries: readonly Entry[];
  readonly createdAt: Date;
  readonly updatedAt: Date;
  readonly version: number;
}

export const accountIdOf = (entry: Entry): string | null =>
  "accountId" in entry.target ? entry.target.accountId : null;

/**
 * Regla central del libro: al menos dos asientos, ninguno en cero y, por cada moneda, la suma da
 * cero. Así el dinero no aparece ni desaparece: solo se mueve.
 */
export function checkBalanced(entries: readonly Entry[]): Result<true, DomainError> {
  if (entries.length < 2) {
    return err(
      new DomainError("too_few_entries", "Una transacción necesita al menos dos asientos"),
    );
  }
  const totals = new Map<CurrencyCode, bigint>();
  for (const e of entries) {
    if (e.amount.isZero())
      return err(new DomainError("zero_entry", "Un asiento no puede ser cero"));
    totals.set(
      e.amount.currencyCode,
      (totals.get(e.amount.currencyCode) ?? 0n) + e.amount.amountMinor,
    );
  }
  for (const [currency, total] of totals) {
    if (total !== 0n) {
      return err(new DomainError("unbalanced", `Los asientos en ${currency} no suman cero`));
    }
  }
  return ok(true);
}
