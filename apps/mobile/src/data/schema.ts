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

/** Preferencias de la app en el dispositivo (onboarding, modo discreto). Nada secreto: el PIN vive en SecureStore. */
const v2 = `
CREATE TABLE preferences (
  key TEXT PRIMARY KEY NOT NULL,
  value TEXT NOT NULL
) STRICT;
`;

/**
 * Categorías por defecto para registrar desde el primer gasto. Ids fijos (`default.*`) para que las
 * reglas de sugerencia las encuentren; la persona puede renombrarlas o archivarlas.
 */
const v3 = `
INSERT INTO categories (id, name, kind, icon, created_at, updated_at) VALUES
  ('default.mercado', 'Mercado', 'expense', '🛒', '2026-11-19T00:00:00.000Z', '2026-11-19T00:00:00.000Z'),
  ('default.restaurantes', 'Restaurantes y domicilios', 'expense', '🍽️', '2026-11-19T00:00:00.000Z', '2026-11-19T00:00:00.000Z'),
  ('default.transporte', 'Transporte', 'expense', '🚌', '2026-11-19T00:00:00.000Z', '2026-11-19T00:00:00.000Z'),
  ('default.servicios', 'Servicios públicos', 'expense', '💡', '2026-11-19T00:00:00.000Z', '2026-11-19T00:00:00.000Z'),
  ('default.celular', 'Celular e internet', 'expense', '📱', '2026-11-19T00:00:00.000Z', '2026-11-19T00:00:00.000Z'),
  ('default.arriendo', 'Arriendo', 'expense', '🏠', '2026-11-19T00:00:00.000Z', '2026-11-19T00:00:00.000Z'),
  ('default.salud', 'Salud', 'expense', '🩺', '2026-11-19T00:00:00.000Z', '2026-11-19T00:00:00.000Z'),
  ('default.educacion', 'Educación', 'expense', '🎓', '2026-11-19T00:00:00.000Z', '2026-11-19T00:00:00.000Z'),
  ('default.entretenimiento', 'Entretenimiento', 'expense', '🎬', '2026-11-19T00:00:00.000Z', '2026-11-19T00:00:00.000Z'),
  ('default.compras', 'Compras', 'expense', '🛍️', '2026-11-19T00:00:00.000Z', '2026-11-19T00:00:00.000Z'),
  ('default.otros_gastos', 'Otros gastos', 'expense', '📦', '2026-11-19T00:00:00.000Z', '2026-11-19T00:00:00.000Z'),
  ('default.salario', 'Salario', 'income', '💼', '2026-11-19T00:00:00.000Z', '2026-11-19T00:00:00.000Z'),
  ('default.ventas', 'Ventas e independiente', 'income', '🧾', '2026-11-19T00:00:00.000Z', '2026-11-19T00:00:00.000Z'),
  ('default.otros_ingresos', 'Otros ingresos', 'income', '➕', '2026-11-19T00:00:00.000Z', '2026-11-19T00:00:00.000Z');

CREATE INDEX transactions_merchant_idx ON transactions (merchant);
`;

/** Transferencias: comisiones como gasto y una categoría de sistema para el cambio de moneda. */
const v4 = `
INSERT INTO categories (id, name, kind, icon, is_system, created_at, updated_at) VALUES
  ('default.comisiones', 'Comisiones e impuestos bancarios', 'expense', '🏦', 0,
    '2026-11-19T00:00:00.000Z', '2026-11-19T00:00:00.000Z'),
  ('system.cambio', 'Cambio de moneda', 'trading', '💱', 1,
    '2026-11-19T00:00:00.000Z', '2026-11-19T00:00:00.000Z');
`;

/**
 * Etiquetas y recibos. Del recibo solo se guarda el nombre del archivo: la foto vive en el
 * almacenamiento privado de la app y la ruta absoluta cambia entre instalaciones.
 */
const v5 = `
CREATE TABLE tags (
  id TEXT PRIMARY KEY NOT NULL,
  name TEXT NOT NULL COLLATE NOCASE UNIQUE CHECK (length(trim(name)) BETWEEN 1 AND 30),
  created_at TEXT NOT NULL
) STRICT;

CREATE TABLE transaction_tags (
  transaction_id TEXT NOT NULL REFERENCES transactions (id) ON DELETE CASCADE,
  tag_id TEXT NOT NULL REFERENCES tags (id) ON DELETE CASCADE,
  PRIMARY KEY (transaction_id, tag_id)
) STRICT, WITHOUT ROWID;

CREATE INDEX transaction_tags_tag_idx ON transaction_tags (tag_id);

CREATE TABLE attachments (
  id TEXT PRIMARY KEY NOT NULL,
  transaction_id TEXT NOT NULL REFERENCES transactions (id) ON DELETE CASCADE,
  file_name TEXT NOT NULL UNIQUE CHECK (file_name NOT LIKE '%/%' AND file_name NOT LIKE '%..%'),
  mime_type TEXT NOT NULL,
  created_at TEXT NOT NULL
) STRICT;

CREATE INDEX attachments_transaction_idx ON attachments (transaction_id);
`;

export const LOCAL_MIGRATIONS: readonly Migration[] = [
  { version: 1, name: "libro contable", sql: v1 },
  { version: 2, name: "preferencias", sql: v2 },
  { version: 3, name: "categorías por defecto", sql: v3 },
  { version: 4, name: "comisiones y cambio de moneda", sql: v4 },
  { version: 5, name: "etiquetas y recibos", sql: v5 },
];
