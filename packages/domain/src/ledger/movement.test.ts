import { describe, expect, it } from "vitest";
import { Money } from "../money";
import { type Account, createAccount } from "./account";
import {
  type MovementCategory,
  merchantKey,
  newMovement,
  newSplitMovement,
  normalizeTag,
  parseTags,
  suggestFromHistory,
} from "./movement";

const now = new Date("2026-11-19T12:00:00Z");
const cop = (pesos: bigint) => Money.ofMinor(pesos * 100n, "COP");

function account(overrides: Partial<Account> = {}): Account {
  const res = createAccount({ name: "Nequi", type: "digital_wallet", currency: "COP" }, "a1", now);
  if (!res.ok) throw res.error;
  return { ...res.value, ...overrides };
}

const groceries: MovementCategory = { id: "c-mercado", kind: "expense", archivedAt: null };
const salary: MovementCategory = { id: "c-salario", kind: "income", archivedAt: null };

function deps() {
  let n = 0;
  return { newId: () => `id-${++n}`, now: () => now };
}

describe("newMovement", () => {
  it("un gasto sale de la cuenta y entra a la categoría", () => {
    const res = newMovement(
      account(),
      groceries,
      {
        kind: "expense",
        amount: cop(45_900n),
        occurredAt: now,
        merchant: "  Éxito   Calle 80 ",
        note: " ",
      },
      deps(),
    );
    if (!res.ok) throw res.error;
    expect(res.value.merchant).toBe("Éxito Calle 80");
    expect(res.value.description).toBe("Éxito Calle 80");
    expect(res.value.notes).toBeNull();
    const [toAccount, toCategory] = res.value.entries;
    expect(toAccount?.target).toEqual({ accountId: "a1" });
    expect(toAccount?.amount.equals(cop(-45_900n))).toBe(true);
    expect(toCategory?.amount.equals(cop(45_900n))).toBe(true);
  });

  it("conserva el origen cuando no es manual", () => {
    const res = newMovement(
      account(),
      groceries,
      { kind: "expense", amount: cop(1n), occurredAt: now, source: "recurring" },
      deps(),
    );
    expect(res.ok && res.value.source).toBe("recurring");
  });

  it("un ingreso entra a la cuenta", () => {
    const res = newMovement(
      account(),
      salary,
      { kind: "income", amount: cop(2_800_000n), occurredAt: now, note: "Quincena" },
      deps(),
    );
    if (!res.ok) throw res.error;
    expect(res.value.entries[0]?.amount.equals(cop(2_800_000n))).toBe(true);
    expect(res.value.notes).toBe("Quincena");
    expect(res.value.merchant).toBeNull();
    expect(res.value.description).toBe("");
  });

  it.each([
    ["monto cero", account(), groceries, cop(0n), "expense", "invalid_amount"],
    ["monto negativo", account(), groceries, cop(-1n), "expense", "invalid_amount"],
    [
      "cuenta archivada",
      account({ archivedAt: now }),
      groceries,
      cop(1n),
      "expense",
      "account_archived",
    ],
    [
      "otra moneda",
      account(),
      groceries,
      Money.ofMinor(100n, "USD"),
      "expense",
      "currency_mismatch",
    ],
    ["categoría de ingreso en un gasto", account(), salary, cop(1n), "expense", "invalid_category"],
    [
      "categoría archivada",
      account(),
      { ...groceries, archivedAt: now },
      cop(1n),
      "expense",
      "invalid_category",
    ],
  ] as const)("rechaza %s", (_name, acc, cat, amount, kind, code) => {
    const res = newMovement(acc, cat, { kind, amount, occurredAt: now }, deps());
    expect(!res.ok && res.error.code).toBe(code);
  });
});

describe("merchantKey", () => {
  it("ignora tildes, mayúsculas y signos", () => {
    expect(merchantKey("  ÉXITO  Calle-80 ")).toBe("exito calle 80");
    expect(merchantKey("Panadería Doña Mery")).toBe("panaderia dona mery");
  });
});

describe("suggestFromHistory", () => {
  const at = (day: number) => new Date(Date.UTC(2026, 10, day));

  it("elige la más usada y, si empatan, la más reciente", () => {
    expect(suggestFromHistory([])).toBeNull();
    expect(
      suggestFromHistory([
        { categoryId: "a", occurredAt: at(1) },
        { categoryId: "b", occurredAt: at(2) },
        { categoryId: "a", occurredAt: at(3) },
      ]),
    ).toBe("a");
    expect(
      suggestFromHistory([
        { categoryId: "a", occurredAt: at(1) },
        { categoryId: "b", occurredAt: at(5) },
      ]),
    ).toBe("b");
  });
});

describe("newSplitMovement", () => {
  const household: MovementCategory = { id: "c-aseo", kind: "expense", archivedAt: null };
  const input = { kind: "expense" as const, amount: cop(100_000n), occurredAt: now };

  it("un asiento a la cuenta por el total y uno por categoría", () => {
    const res = newSplitMovement(
      account(),
      [
        { category: groceries, amount: cop(70_000n) },
        { category: household, amount: cop(30_000n) },
      ],
      input,
      deps(),
    );
    if (!res.ok) throw res.error;
    expect(res.value.entries.map((e) => [e.target, e.amount.toDecimalString()])).toEqual([
      [{ accountId: "a1" }, "-100000.00"],
      [{ categoryId: "c-mercado" }, "70000.00"],
      [{ categoryId: "c-aseo" }, "30000.00"],
    ]);
  });

  it.each([
    ["sin partes", [], "invalid_category"],
    ["partes que no suman", [{ category: groceries, amount: cop(99_999n) }], "split_mismatch"],
    [
      "categoría repetida",
      [
        { category: groceries, amount: cop(50_000n) },
        { category: groceries, amount: cop(50_000n) },
      ],
      "invalid_category",
    ],
    [
      "parte en cero",
      [
        { category: groceries, amount: cop(100_000n) },
        { category: household, amount: cop(0n) },
      ],
      "invalid_split",
    ],
  ] as const)("rechaza %s", (_name, splits, code) => {
    const res = newSplitMovement(account(), splits, input, deps());
    expect(!res.ok && res.error.code).toBe(code);
  });
});

describe("etiquetas", () => {
  it("limpia y quita duplicados sin importar mayúsculas", () => {
    expect(normalizeTag("  #Viaje   Cartagena ")).toBe("Viaje Cartagena");
    expect(normalizeTag(" # ")).toBeNull();
    expect(normalizeTag("x".repeat(40))).toHaveLength(30);
    expect(parseTags("viaje, Viaje ,#oficina,, ")).toEqual(["viaje", "oficina"]);
  });
});
