import { Money } from "@lukas/domain";
import { describe, expect, it } from "vitest";
import { createConnection, type RawSql } from "../data/connection";
import { sqliteAccounts } from "../data/ledger-sqlite";
import { migrate } from "../data/migrations";
import { nodeSqlite } from "../data/node-sqlite.test-helper";
import { LOCAL_MIGRATIONS } from "../data/schema";
import {
  completeOnboarding,
  hasAccounts,
  isOnboarded,
  ONBOARDING_TEMPLATES,
  removeSampleData,
} from "./onboarding";

const now = new Date("2026-11-19T12:00:00.000Z");
const nequi = ONBOARDING_TEMPLATES.find((t) => t.key === "nequi");
if (!nequi) throw new Error("falta la plantilla de Nequi");

async function setup(failOn?: string) {
  const node = nodeSqlite();
  node.raw.exec("PRAGMA foreign_keys = ON");
  const raw: RawSql = {
    ...node,
    run: async (sql, params) => {
      if (failOn && sql.includes(failOn)) throw new Error("falla simulada");
      return node.run(sql, params);
    },
  };
  const db = createConnection(raw);
  await migrate(db, LOCAL_MIGRATIONS);
  let n = 0;
  return { db, deps: { newId: () => `id-${++n}`, now: () => now } };
}

const count = async (db: Awaited<ReturnType<typeof setup>>["db"], table: string) =>
  (await db.get<{ n: number }>(`SELECT count(*) AS n FROM ${table}`))?.n;

describe("onboarding", () => {
  it("crea la cuenta con su saldo inicial y marca el onboarding como hecho", async () => {
    const { db, deps } = await setup();
    expect(await isOnboarded(db)).toBe(false);
    expect(await hasAccounts(db)).toBe(false);
    const account = await completeOnboarding(
      db,
      { template: nequi, openingBalance: Money.ofMinor(150_000_00n, "COP"), sampleData: false },
      deps,
    );
    expect(account).toMatchObject({ name: "Nequi", type: "digital_wallet", institution: "Nequi" });
    expect(await sqliteAccounts(db).balance(account)).toEqual(Money.ofMinor(150_000_00n, "COP"));
    expect(await isOnboarded(db)).toBe(true);
    expect(await hasAccounts(db)).toBe(true);
  });

  it("sin saldo inicial no crea movimientos", async () => {
    const { db, deps } = await setup();
    await completeOnboarding(
      db,
      { template: nequi, openingBalance: null, sampleData: false },
      deps,
    );
    expect(await count(db, "transactions")).toBe(0);
  });

  it("agrega datos de ejemplo en su propia cuenta y los puede borrar", async () => {
    const { db, deps } = await setup();
    const account = await completeOnboarding(
      db,
      { template: nequi, openingBalance: Money.ofMinor(10_000_00n, "COP"), sampleData: true },
      deps,
    );
    expect(await count(db, "accounts")).toBe(2);
    expect(await count(db, "transactions")).toBe(4);
    await removeSampleData(db);
    expect(await count(db, "accounts")).toBe(1);
    expect(await count(db, "transactions")).toBe(1);
    expect(await sqliteAccounts(db).balance(account)).toEqual(Money.ofMinor(10_000_00n, "COP"));
    await removeSampleData(db);
  });

  it("si algo falla no deja la app a medio configurar", async () => {
    const { db, deps } = await setup("INSERT INTO preferences");
    await expect(
      completeOnboarding(
        db,
        { template: nequi, openingBalance: Money.ofMinor(100n, "COP"), sampleData: true },
        deps,
      ),
    ).rejects.toThrow("falla simulada");
    expect(await count(db, "accounts")).toBe(0);
    expect(await count(db, "transactions")).toBe(0);
    expect(await isOnboarded(db)).toBe(false);
  });

  it("reutiliza la categoría de saldo inicial", async () => {
    const { db, deps } = await setup();
    const input = { openingBalance: Money.ofMinor(100n, "COP"), sampleData: false };
    await completeOnboarding(db, { ...input, template: nequi }, deps);
    const cash = ONBOARDING_TEMPLATES[0];
    if (!cash) throw new Error("sin plantillas");
    await completeOnboarding(db, { ...input, template: cash }, deps);
    expect(await db.get("SELECT count(*) AS n FROM categories WHERE kind = 'equity'")).toEqual({
      n: 1,
    });
  });
});
