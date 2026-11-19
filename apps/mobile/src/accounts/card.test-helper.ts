import { Money, type Transaction } from "@lukas/domain";
import { createConnection } from "../data/connection";
import { sqliteRepositories } from "../data/ledger-sqlite";
import { migrate } from "../data/migrations";
import { nodeSqlite } from "../data/node-sqlite.test-helper";
import { LOCAL_MIGRATIONS } from "../data/schema";
import { createFromTemplate } from "./accounts";
import { templateByKey } from "./templates";

export const cop = (pesos: bigint) => Money.ofMinor(pesos * 100n, "COP");
export const local = (y: number, m: number, d: number, h = 12) => new Date(y, m - 1, d, h);

/** Base en memoria con una tarjeta "Visa" de cupo $5.000.000 y una función para moverla. */
export async function cardFixture(options: { closingDay: number | null; dueDay: number | null }) {
  const node = nodeSqlite();
  node.raw.exec("PRAGMA foreign_keys = ON");
  const db = createConnection(node);
  await migrate(db, LOCAL_MIGRATIONS);
  let n = 0;
  const clock = { newId: () => `id-${++n}`, now: () => local(2026, 10, 1) };
  const tpl = templateByKey("credit_card");
  if (!tpl) throw new Error("falta la plantilla de tarjeta");
  const res = await createFromTemplate(
    db,
    tpl,
    { name: "Visa", card: { creditLimit: cop(5_000_000n), ...options } },
    clock,
  );
  if (!res.ok) throw res.error;
  await db.run(
    `INSERT INTO categories (id, name, kind, is_system, created_at, updated_at)
     VALUES ('cat', 'Compras', 'expense', 0, '2026-01-01T00:00:00Z', '2026-01-01T00:00:00Z')`,
  );
  const move = async (amount: Money, at: Date) => {
    const t: Transaction = {
      id: clock.newId(),
      occurredAt: at,
      description: "Movimiento",
      merchant: null,
      notes: null,
      status: "cleared",
      source: "manual",
      entries: [
        { id: clock.newId(), target: { accountId: res.value.id }, amount },
        { id: clock.newId(), target: { categoryId: "cat" }, amount: amount.negate() },
      ],
      createdAt: at,
      updatedAt: at,
      version: 1,
    };
    await sqliteRepositories(db).transactions.save(t);
  };
  return { db, card: res.value, move, clock };
}
