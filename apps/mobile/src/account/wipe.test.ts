import { describe, expect, it } from "vitest";
import { createFromTemplate } from "../accounts/accounts";
import { cardFixture, cop } from "../accounts/card.test-helper";
import { templateByKey } from "../accounts/templates";
import { createConnection } from "../data/connection";
import { migrate } from "../data/migrations";
import { nodeSqlite } from "../data/node-sqlite.test-helper";
import { LOCAL_MIGRATIONS } from "../data/schema";
import { wipeLocalData } from "./wipe";

/** Una base con una cuenta de Nequi con saldo inicial y la foto de un recibo. */
async function usedDb(fileName: string) {
  const fx = await cardFixture({ closingDay: 15, dueDay: 2 });
  const tpl = templateByKey("nequi");
  if (!tpl) throw new Error("falta Nequi");
  const nequi = await createFromTemplate(fx.db, tpl, { openingBalance: cop(50_000n) }, fx.clock);
  if (!nequi.ok) throw nequi.error;
  const tx = await fx.db.get<{ id: string }>("SELECT id FROM transactions LIMIT 1");
  await fx.db.run(
    `INSERT INTO attachments (id, transaction_id, file_name, mime_type, created_at)
     VALUES ('a1', ?, ?, 'image/jpeg', '2026-11-25T00:00:00Z')`,
    tx?.id ?? "",
    fileName,
  );
  return fx.db;
}

async function freshCategories() {
  const node = nodeSqlite();
  const db = createConnection(node);
  await migrate(db, LOCAL_MIGRATIONS);
  return db.all("SELECT id, name, is_system FROM categories ORDER BY id");
}

describe("borrar los datos del teléfono", () => {
  it("deja la base como recién instalada y borra las fotos", async () => {
    const db = await usedDb("recibo.jpg");
    await db.run("INSERT INTO preferences (key, value) VALUES ('privacidad', 'x')");
    const version = await db.get<{ user_version: number }>("PRAGMA user_version");

    const removed: string[] = [];
    await wipeLocalData(db, async (name) => void removed.push(name));

    expect(removed).toEqual(["recibo.jpg"]);
    for (const table of ["accounts", "transactions", "entries", "attachments", "preferences"]) {
      expect(await db.get<{ n: number }>(`SELECT count(*) AS n FROM ${table}`)).toEqual({ n: 0 });
    }
    expect(await db.all("SELECT id, name, is_system FROM categories ORDER BY id")).toEqual(
      await freshCategories(),
    );
    expect(await db.get("PRAGMA user_version")).toEqual(version);
    expect(await db.get("PRAGMA foreign_keys")).toEqual({ foreign_keys: 1 });
  });

  it("sigue aunque una foto ya no exista", async () => {
    const db = await usedDb("perdida.jpg");
    await wipeLocalData(db, async () => {
      throw new Error("no existe");
    });
    expect(await db.get("SELECT count(*) AS n FROM attachments")).toEqual({ n: 0 });
  });
});
