import { DomainError } from "../errors";
import type { Money } from "../money";
import { err, ok, type Result } from "../result";
import type { UnitOfWork } from "./ports";
import { checkBalanced, type Entry, type Transaction } from "./transaction";

export interface TransferInput {
  readonly fromAccountId: string;
  readonly toAccountId: string;
  /** Lo que sale de la cuenta de origen, en su moneda. */
  readonly amount: Money;
  readonly occurredAt: Date;
  readonly description?: string;
  /** Comisión o 4x1000 cobrado en la cuenta de origen, contra una categoría de gasto. */
  readonly fee?: { readonly amount: Money; readonly categoryId: string };
  /**
   * Entre monedas distintas: lo que llega a la cuenta de destino, en su moneda, y la categoría de
   * cambio que equilibra cada moneda por separado.
   */
  readonly exchange?: { readonly received: Money; readonly categoryId: string };
}

export interface TransferDeps {
  readonly uow: UnitOfWork;
  readonly newId: () => string;
  readonly now: () => Date;
}

const positive = (m: Money) => !m.isZero() && !m.isNegative();
const fail = (code: string, message: string) => err(new DomainError(code, message));

/**
 * Mueve dinero entre dos cuentas propias con doble partida: sale de una y entra a la otra, así que
 * el patrimonio no cambia salvo por la comisión. Entre monedas, cada moneda cuadra por su lado a
 * través de la categoría de cambio: sale X USD hacia el cambio y del cambio entran Y COP.
 */
export async function transferFunds(
  deps: TransferDeps,
  input: TransferInput,
): Promise<Result<Transaction, DomainError>> {
  if (input.fromAccountId === input.toAccountId) {
    return fail("same_account", "La cuenta de origen y destino son la misma");
  }
  if (!positive(input.amount)) {
    return fail("invalid_amount", "El monto a transferir debe ser mayor que cero");
  }
  if (input.fee && !positive(input.fee.amount)) {
    return fail("invalid_fee", "La comisión debe ser mayor que cero");
  }
  if (input.exchange && !positive(input.exchange.received)) {
    return fail("invalid_amount", "El monto recibido debe ser mayor que cero");
  }

  return deps.uow.run(async ({ accounts, transactions }) => {
    const [from, to] = await Promise.all([
      accounts.get(input.fromAccountId),
      accounts.get(input.toAccountId),
    ]);
    if (!from || !to) return fail("account_not_found", "No existe la cuenta");
    if (from.archivedAt || to.archivedAt) {
      return fail("account_archived", "No se puede mover dinero de una cuenta archivada");
    }
    const received = input.exchange?.received ?? input.amount;
    const crossCurrency = from.currency !== to.currency;
    if (
      from.currency !== input.amount.currencyCode ||
      to.currency !== received.currencyCode ||
      crossCurrency !== Boolean(input.exchange)
    ) {
      return fail("currency_mismatch", "Los montos deben estar en la moneda de cada cuenta");
    }
    if (input.fee && input.fee.amount.currencyCode !== from.currency) {
      return fail("currency_mismatch", "La comisión va en la moneda de la cuenta de origen");
    }

    const entry = (target: Entry["target"], amount: Money): Entry => ({
      id: deps.newId(),
      target,
      amount,
    });
    const entries: Entry[] = [entry({ accountId: from.id }, input.amount.negate())];
    if (input.exchange) {
      const fx = { categoryId: input.exchange.categoryId };
      entries.push(entry(fx, input.amount), entry(fx, received.negate()));
    }
    entries.push(entry({ accountId: to.id }, received));
    if (input.fee) {
      entries.push(
        entry({ accountId: from.id }, input.fee.amount.negate()),
        entry({ categoryId: input.fee.categoryId }, input.fee.amount),
      );
    }

    const now = deps.now();
    const transaction: Transaction = {
      id: deps.newId(),
      occurredAt: input.occurredAt,
      description: input.description?.trim() || `${from.name} → ${to.name}`,
      merchant: null,
      notes: null,
      status: "cleared",
      source: "manual",
      entries,
      createdAt: now,
      updatedAt: now,
      version: 1,
    };
    const balanced = checkBalanced(transaction.entries);
    if (!balanced.ok) return balanced;
    await transactions.save(transaction);
    return ok(transaction);
  });
}
