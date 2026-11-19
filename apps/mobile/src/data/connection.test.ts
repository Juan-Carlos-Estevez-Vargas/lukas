import { describe, expect, it } from "vitest";
import { createConnection, NestedTransactionError } from "./connection";
import { nodeSqlite } from "./node-sqlite.test-helper";

const setup = async () => {
  const raw = nodeSqlite();
  const db = createConnection(raw);
  await db.exec("CREATE TABLE t (x INTEGER NOT NULL)");
  return db;
};

const count = async (db: Awaited<ReturnType<typeof setup>>) =>
  (await db.get<{ n: number }>("SELECT count(*) AS n FROM t"))?.n;

describe("conexión local", () => {
  it("confirma la transacción si todo sale bien", async () => {
    const db = await setup();
    await db.transaction(async (tx) => {
      await tx.exec("INSERT INTO t VALUES (1); INSERT INTO t VALUES (2);");
    });
    expect(await count(db)).toBe(2);
  });

  it("revierte todo si algo falla a mitad", async () => {
    const db = await setup();
    await expect(
      db.transaction(async (tx) => {
        await tx.exec("INSERT INTO t VALUES (1)");
        await tx.exec("INSERT INTO t VALUES (NULL)");
      }),
    ).rejects.toThrow();
    expect(await count(db)).toBe(0);
  });

  it("no deja que otra operación se cuele dentro de una transacción", async () => {
    const db = await setup();
    let release: () => void = () => undefined;
    const gate = new Promise<void>((r) => {
      release = r;
    });
    const tx = db.transaction(async (t) => {
      await t.exec("INSERT INTO t VALUES (1)");
      await gate;
      throw new Error("cancelada");
    });
    const outside = db.exec("INSERT INTO t VALUES (2)");
    release();
    await expect(tx).rejects.toThrow("cancelada");
    await outside;
    // La inserción de afuera esperó al ROLLBACK y no se perdió con él.
    expect(await db.get("SELECT x FROM t")).toEqual({ x: 2 });
  });

  it("rechaza transacciones anidadas", async () => {
    const db = await setup();
    await expect(
      db.transaction(async (tx) => tx.transaction(async () => undefined)),
    ).rejects.toBeInstanceOf(NestedTransactionError);
  });

  it("pasa parámetros a las consultas", async () => {
    const db = await setup();
    await db.exec("INSERT INTO t VALUES (7)");
    expect(await db.get("SELECT x FROM t WHERE x = ?", 7)).toEqual({ x: 7 });
    expect(await db.get("SELECT x FROM t WHERE x = ?", 8)).toBeNull();
  });
});
