import {
  type DomainError,
  type Money,
  type Result,
  type Transaction,
  transferFunds,
} from "@lukas/domain";
import type { Clock } from "../accounts/accounts";
import { sqliteUnitOfWork } from "../data/ledger-sqlite";
import type { SqlConnection } from "../data/sql";

export const FEE_CATEGORY = "default.comisiones";
export const EXCHANGE_CATEGORY = "system.cambio";

export interface NewTransfer {
  readonly fromAccountId: string;
  readonly toAccountId: string;
  readonly amount: Money;
  /** Solo entre monedas distintas: lo que llega a la cuenta de destino. */
  readonly received?: Money | null;
  readonly fee?: Money | null;
  readonly occurredAt: Date;
  readonly description?: string;
}

/** Transferencia entre cuentas propias, con comisión y cambio de moneda opcionales. */
export function recordTransfer(
  db: SqlConnection,
  input: NewTransfer,
  clock: Clock,
): Promise<Result<Transaction, DomainError>> {
  return transferFunds(
    { uow: sqliteUnitOfWork(db), ...clock },
    {
      fromAccountId: input.fromAccountId,
      toAccountId: input.toAccountId,
      amount: input.amount,
      occurredAt: input.occurredAt,
      ...(input.description ? { description: input.description } : {}),
      ...(input.fee ? { fee: { amount: input.fee, categoryId: FEE_CATEGORY } } : {}),
      ...(input.received
        ? { exchange: { received: input.received, categoryId: EXCHANGE_CATEGORY } }
        : {}),
    },
  );
}
