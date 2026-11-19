import type { Money } from "../money";
import type { Account } from "./account";
import type { Transaction } from "./transaction";

/**
 * Puertos del libro contable. La app los implementa sobre SQLite cifrado y el servidor sobre
 * Postgres; los casos de uso solo conocen estas interfaces.
 */
export interface AccountRepository {
  get(id: string): Promise<Account | null>;
  list(options?: { includeArchived?: boolean }): Promise<Account[]>;
  /** Crea o reemplaza la cuenta. */
  save(account: Account): Promise<void>;
  /** Saldo: suma de los asientos de transacciones no borradas, en la moneda de la cuenta. */
  balance(account: Account): Promise<Money>;
}

export interface TransactionRepository {
  get(id: string): Promise<Transaction | null>;
  /** Guarda la transacción con todos sus asientos. Rechaza transacciones descuadradas. */
  save(transaction: Transaction): Promise<void>;
}

export interface LedgerRepositories {
  readonly accounts: AccountRepository;
  readonly transactions: TransactionRepository;
}

/**
 * Unidad de trabajo: todo lo que pase dentro de `run` se confirma junto o no se confirma.
 * Si `work` lanza, se revierte cada escritura hecha con los repositorios que recibe.
 */
export interface UnitOfWork {
  run<T>(work: (repos: LedgerRepositories) => Promise<T>): Promise<T>;
}
