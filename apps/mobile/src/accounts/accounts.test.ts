import { Money } from "@lukas/domain";
import { describe, expect, it } from "vitest";
import { createConnection } from "../data/connection";
import { sqliteAccounts } from "../data/ledger-sqlite";
import { migrate } from "../data/migrations";
import { nodeSqlite } from "../data/node-sqlite.test-helper";
import { LOCAL_MIGRATIONS } from "../data/schema";
import { createFromTemplate, editAccount, setArchived } from "./accounts";
import { ACCOUNT_TEMPLATES, groupAccounts, groupOf, templateByKey } from "./templates";

const now = new Date("2026-11-19T12:00:00.000Z");
const cop = (n: bigint) => Money.ofMinor(n, "COP");

async function setup() {
  const node = nodeSqlite();
  node.raw.exec("PRAGMA foreign_keys = ON");
  const db = createConnection(node);
  await migrate(db, LOCAL_MIGRATIONS);
  let n = 0;
  return { db, clock: { newId: () => `id-${++n}`, now: () => now } };
}

const nequi = () => {
  const t = templateByKey("nequi");
  if (!t) throw new Error("falta Nequi");
  return t;
};

describe("plantillas", () => {
  it("incluye las entidades colombianas del backlog", () => {
    expect(ACCOUNT_TEMPLATES.map((t) => t.name)).toEqual(
      expect.arrayContaining(["Nequi", "Daviplata", "Bancolombia", "Nu", "Lulo Bank"]),
    );
    expect(templateByKey("nada")).toBeUndefined();
  });

  it("agrupa por tipo en un orden fijo y omite grupos vacíos", () => {
    const rows = ["credit_card", "cash", "bank", "digital_wallet", "loan", "investment"].map(
      (type) => ({ account: { type } as const }),
    ) as { account: { type: Parameters<typeof groupOf>[0] } }[];
    expect(groupAccounts(rows).map((g) => g.group)).toEqual([
      "cash",
      "wallets",
      "banks",
      "cards",
      "investments",
      "debts",
    ]);
    expect(groupOf("other_liability")).toBe("debts");
    expect(groupOf("other_asset")).toBe("investments");
    expect(groupAccounts([])).toEqual([]);
  });
});

describe("cuentas", () => {
  it("crea una cuenta Nequi en un toque, sin más datos", async () => {
    const { db, clock } = await setup();
    const res = await createFromTemplate(db, nequi(), {}, clock);
    expect(res.ok && res.value).toMatchObject({
      name: "Nequi",
      type: "digital_wallet",
      institution: "Nequi",
      currency: "COP",
    });
    expect(await db.get("SELECT count(*) AS n FROM transactions")).toEqual({ n: 0 });
  });

  it("crea con nombre propio y saldo inicial cuadrado contra patrimonio", async () => {
    const { db, clock } = await setup();
    const res = await createFromTemplate(
      db,
      nequi(),
      { name: "Nequi de la casa", openingBalance: cop(80_000_00n) },
      clock,
    );
    if (!res.ok) throw res.error;
    expect(res.value.name).toBe("Nequi de la casa");
    expect(await sqliteAccounts(db).balance(res.value)).toEqual(cop(80_000_00n));
    expect(await db.get("SELECT sum(amount_minor) AS s FROM entries")).toEqual({ s: 0 });
  });

  it("no crea nada con un nombre inválido", async () => {
    const { db, clock } = await setup();
    const res = await createFromTemplate(db, { ...nequi(), name: " " }, { name: " " }, clock);
    expect(!res.ok && res.error.code).toBe("account_name_required");
    expect(await db.get("SELECT count(*) AS n FROM accounts")).toEqual({ n: 0 });
  });

  it("edita una cuenta existente", async () => {
    const { db, clock } = await setup();
    const res = await createFromTemplate(db, nequi(), {}, clock);
    if (!res.ok) throw res.error;
    const edited = await editAccount(db, res.value.id, { name: "Nequi personal" }, now);
    expect(edited?.ok && edited.value.version).toBe(2);
    expect((await sqliteAccounts(db).get(res.value.id))?.name).toBe("Nequi personal");
    expect(await editAccount(db, "nada", { name: "x" }, now)).toBeNull();
    const bad = await editAccount(db, res.value.id, { name: "" }, now);
    expect(bad?.ok).toBe(false);
  });

  it("archiva solo con saldo en cero y puede restaurar", async () => {
    const { db, clock } = await setup();
    const empty = await createFromTemplate(db, nequi(), {}, clock);
    const full = await createFromTemplate(db, nequi(), { openingBalance: cop(100n) }, clock);
    if (!empty.ok || !full.ok) throw new Error("no se crearon");
    const blocked = await setArchived(db, full.value.id, true, now);
    expect(blocked?.ok === false && blocked.error.code).toBe("balance_not_zero");
    expect((await setArchived(db, empty.value.id, true, now))?.ok).toBe(true);
    expect((await sqliteAccounts(db).list()).map((a) => a.id)).toEqual([full.value.id]);
    expect((await setArchived(db, empty.value.id, false, now))?.ok).toBe(true);
    expect(await sqliteAccounts(db).list()).toHaveLength(2);
    expect(await setArchived(db, "nada", true, now)).toBeNull();
  });
});
