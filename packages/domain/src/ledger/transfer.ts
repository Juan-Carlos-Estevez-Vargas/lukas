import { DomainError } from "../errors";
import type { Money } from "../money";
import { err, ok, type Result } from "../result";
import type { UnitOfWork } from "./ports";
import { checkBalanced, type Transaction } from "./transaction";

export interface TransferInput {
  readonly fromAccountId: string;
  readonly toAccountId: string;
  readonly amount: Money;
  readonly occurredAt: Date;
  readonly description?: string;
}

export interface TransferDeps {
  readonly uow: UnitOfWork;
  readonly newId: () => string;
  readonly now: () => Date;
}

/**
 * Mueve dinero entre dos cuentas propias con doble partida: sale de una y entra a la otra por el
 * mismo monto, así que el patrimonio no cambia. Por ahora ambas cuentas usan la misma moneda; las
 * transferencias con cambio de moneda llegan en FIN-107.
 */
export async function transferFunds(
  deps: TransferDeps,
  input: TransferInput,
): Promise<Result<Transaction, DomainError>> {
  if (input.fromAccountId === input.toAccountId) {
    return err(new DomainError("same_account", "La cuenta de origen y destino son la misma"));
  }
  if (input.amount.isZero() || input.amount.isNegative()) {
    return err(new DomainError("invalid_amount", "El monto a transferir debe ser mayor que cero"));
  }

  return deps.uow.run(async ({ accounts, transactions }) => {
    const [from, to] = await Promise.all([
      accounts.get(input.fromAccountId),
      accounts.get(input.toAccountId),
    ]);
    if (!from || !to) return err(new DomainError("account_not_found", "No existe la cuenta"));
    if (from.archivedAt || to.archivedAt) {
      return err(
        new DomainError("account_archived", "No se puede mover dinero de una cuenta archivada"),
      );
    }
    if (from.currency !== input.amount.currencyCode || to.currency !== input.amount.currencyCode) {
      return err(
        new DomainError(
          "currency_mismatch",
          "Las cuentas y el monto deben estar en la misma moneda",
        ),
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
      entries: [
        { id: deps.newId(), target: { accountId: from.id }, amount: input.amount.negate() },
        { id: deps.newId(), target: { accountId: to.id }, amount: input.amount },
      ],
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
