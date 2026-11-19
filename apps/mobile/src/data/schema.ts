import type { Migration } from "./migrations";

/**
 * Esquema local. Refleja el libro contable del servidor (packages/db/src/schema/ledger.ts) sin
 * `user_id`: la base del dispositivo es de una sola persona. Tablas STRICT para que SQLite rechace
 * tipos equivocados. Los montos son INTEGER (unidades menores, 64 bits); nunca REAL.
 * Fechas en texto ISO 8601 UTC. `version` y `updated_at` sirven para el sync de la fase 2.
 */
const v1 = `
CREATE TABLE accounts (
  id TEXT PRIMARY KEY NOT NULL,
  name TEXT NOT NULL CHECK (length(trim(name)) > 0),
  type TEXT NOT NULL CHECK (type IN ('cash', 'bank', 'digital_wallet', 'credit_card', 'loan',
    'investment', 'other_asset', 'other_liability')),
  currency TEXT NOT NULL CHECK (length(currency) = 3 AND currency = upper(currency)),
  institution TEXT,
  last4 TEXT CHECK (last4 IS NULL OR (length(last4) = 4 AND last4 NOT GLOB '*[^0-9]*')),
  closing_day INTEGER CHECK (closing_day IS NULL OR closing_day BETWEEN 1 AND 31),
  due_day INTEGER CHECK (due_day IS NULL OR due_day BETWEEN 1 AND 31),
  credit_limit_minor INTEGER,
  archived_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  version INTEGER NOT NULL DEFAULT 1
) STRICT;

CREATE TABLE categories (
  id TEXT PRIMARY KEY NOT NULL,
  parent_id TEXT REFERENCES categories (id) ON DELETE RESTRICT,
  name TEXT NOT NULL CHECK (length(trim(name)) > 0),
  kind TEXT NOT NULL CHECK (kind IN ('income', 'expense', 'equity', 'trading')),
  icon TEXT,
  color TEXT,
  is_system INTEGER NOT NULL DEFAULT 0 CHECK (is_system IN (0, 1)),
  archived_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  version INTEGER NOT NULL DEFAULT 1
) STRICT;

CREATE TABLE transactions (
  id TEXT PRIMARY KEY NOT NULL,
  occurred_at TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  merchant TEXT,
  notes TEXT,
  status TEXT NOT NULL DEFAULT 'cleared' CHECK (status IN ('pending', 'cleared', 'reconciled')),
  source TEXT NOT NULL DEFAULT 'manual' CHECK (source IN ('manual', 'notification', 'statement',
    'receipt', 'email', 'import', 'recurring')),
  deleted_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  version INTEGER NOT NULL DEFAULT 1
) STRICT;

CREATE INDEX transactions_occurred_idx ON transactions (occurred_at DESC);

-- Doble partida: cada asiento toca una cuenta o una categoría, nunca ambas. Que cada transacción
-- sume cero por moneda lo garantiza la Unit of Work (FIN-102): SQLite no tiene triggers diferidos.
CREATE TABLE entries (
  id TEXT PRIMARY KEY NOT NULL,
  transaction_id TEXT NOT NULL REFERENCES transactions (id) ON DELETE CASCADE,
  account_id TEXT REFERENCES accounts (id) ON DELETE RESTRICT,
  category_id TEXT REFERENCES categories (id) ON DELETE RESTRICT,
  amount_minor INTEGER NOT NULL CHECK (amount_minor <> 0),
  currency TEXT NOT NULL CHECK (length(currency) = 3 AND currency = upper(currency)),
  CHECK ((account_id IS NULL) <> (category_id IS NULL))
) STRICT;

CREATE INDEX entries_transaction_idx ON entries (transaction_id);
CREATE INDEX entries_account_idx ON entries (account_id);
CREATE INDEX entries_category_idx ON entries (category_id);
`;

export const LOCAL_MIGRATIONS: readonly Migration[] = [
  { version: 1, name: "libro contable", sql: v1 },
];
