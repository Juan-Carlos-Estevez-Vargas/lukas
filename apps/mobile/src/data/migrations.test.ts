import { describe, expect, it } from "vitest";
import { createConnection } from "./connection";
import { assertSequential, DatabaseTooNewError, type Migration, migrate } from "./migrations";
import { nodeSqlite } from "./node-sqlite.test-helper";
import { LOCAL_MIGRATIONS } from "./schema";

const setup = () => {
  const raw = nodeSqlite();
  raw.raw.exec("PRAGMA foreign_keys = ON");
  return { raw, db: createConnection(raw) };
};

const version = async (db: ReturnType<typeof setup>["db"]) =>
  (await db.get<{ user_version: number }>("PRAGMA user_version"))?.user_version;

describe("migraciones locales", () => {
  it("aplica todas en una base nueva y no repite en la segunda vuelta", async () => {
    const { db } = setup();
    expect(await migrate(db, LOCAL_MIGRATIONS)).toEqual({ from: 0, to: LOCAL_MIGRATIONS.length });
    expect(await version(db)).toBe(LOCAL_MIGRATIONS.length);
    expect(await migrate(db, LOCAL_MIGRATIONS)).toEqual({
      from: LOCAL_MIGRATIONS.length,
      to: LOCAL_MIGRATIONS.length,
    });
  });

  it("aplica solo las pendientes", async () => {
    const { db } = setup();
    const extra: Migration[] = [
      ...LOCAL_MIGRATIONS,
      { version: LOCAL_MIGRATIONS.length + 1, name: "extra", sql: "CREATE TABLE extra (x TEXT)" },
    ];
    await migrate(db, LOCAL_MIGRATIONS);
    expect(await migrate(db, extra)).toEqual({
      from: LOCAL_MIGRATIONS.length,
      to: LOCAL_MIGRATIONS.length + 1,
    });
    expect(await db.get("SELECT name FROM sqlite_master WHERE name = 'extra'")).toEqual({
      name: "extra",
    });
  });

  it("revierte una migración que falla y deja la versión anterior", async () => {
    const { db } = setup();
    const broken: Migration[] = [
      { version: 1, name: "ok", sql: "CREATE TABLE a (x TEXT)" },
      { version: 2, name: "rota", sql: "CREATE TABLE b (x TEXT); SELECT * FROM no_existe;" },
    ];
    await expect(migrate(db, broken)).rejects.toThrow();
    expect(await version(db)).toBe(1);
    expect(await db.get("SELECT name FROM sqlite_master WHERE name = 'b'")).toBeNull();
  });

  it("no abre una base de una versión más nueva de la app", async () => {
    const { db } = setup();
    await db.exec("PRAGMA user_version = 99");
    await expect(migrate(db, LOCAL_MIGRATIONS)).rejects.toBeInstanceOf(DatabaseTooNewError);
  });

  it("exige migraciones consecutivas desde 1", () => {
    expect(() => assertSequential([{ version: 2, name: "x", sql: "" }])).toThrow(/orden/);
    expect(() => assertSequential(LOCAL_MIGRATIONS)).not.toThrow();
  });
});

describe("esquema v1", () => {
  const now = "2026-11-19T00:00:00.000Z";
  const ready = async () => {
    const s = setup();
    await migrate(s.db, LOCAL_MIGRATIONS);
    const ins = (sql: string) => s.raw.raw.exec(sql);
    ins(`INSERT INTO accounts (id, name, type, currency, created_at, updated_at)
      VALUES ('a1', 'Nequi', 'digital_wallet', 'COP', '${now}', '${now}')`);
    ins(`INSERT INTO categories (id, name, kind, created_at, updated_at)
      VALUES ('c1', 'Mercado', 'expense', '${now}', '${now}')`);
    ins(`INSERT INTO transactions (id, occurred_at, created_at, updated_at)
      VALUES ('t1', '${now}', '${now}', '${now}')`);
    return { ...s, ins };
  };

  it("guarda una transacción de doble partida con montos enteros", async () => {
    const { ins, db } = await ready();
    ins(`INSERT INTO entries VALUES ('e1', 't1', 'a1', NULL, -2500000, 'COP')`);
    ins(`INSERT INTO entries VALUES ('e2', 't1', NULL, 'c1', 2500000, 'COP')`);
    expect(
      await db.get("SELECT sum(amount_minor) AS total FROM entries WHERE transaction_id = 't1'"),
    ).toEqual({ total: 0 });
  });

  it.each([
    ["monto decimal", `('e1', 't1', 'a1', NULL, 12.5, 'COP')`],
    ["monto cero", `('e1', 't1', 'a1', NULL, 0, 'COP')`],
    ["cuenta y categoría a la vez", `('e1', 't1', 'a1', 'c1', 100, 'COP')`],
    ["ni cuenta ni categoría", `('e1', 't1', NULL, NULL, 100, 'COP')`],
    ["moneda en minúscula", `('e1', 't1', 'a1', NULL, 100, 'cop')`],
    ["cuenta inexistente", `('e1', 't1', 'zz', NULL, 100, 'COP')`],
  ])("rechaza un asiento con %s", async (_, values) => {
    const { ins } = await ready();
    expect(() => ins(`INSERT INTO entries VALUES ${values}`)).toThrow();
  });

  it("solo acepta los últimos 4 dígitos numéricos de una tarjeta", async () => {
    const { ins } = await ready();
    const card = (id: string, last4: string) =>
      ins(`INSERT INTO accounts (id, name, type, currency, last4, created_at, updated_at)
        VALUES ('${id}', 'Visa', 'credit_card', 'COP', '${last4}', '${now}', '${now}')`);
    expect(() => card("k1", "1234")).not.toThrow();
    expect(() => card("k2", "12a4")).toThrow();
    expect(() => card("k3", "12345")).toThrow();
  });

  it("borra los asientos al borrar la transacción", async () => {
    const { ins, db } = await ready();
    ins(`INSERT INTO entries VALUES ('e1', 't1', 'a1', NULL, -100, 'COP')`);
    ins(`DELETE FROM transactions WHERE id = 't1'`);
    expect(await db.get("SELECT count(*) AS n FROM entries")).toEqual({ n: 0 });
  });
});
