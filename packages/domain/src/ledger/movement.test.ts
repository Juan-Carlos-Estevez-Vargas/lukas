import { describe, expect, it } from "vitest";
import { Money } from "../money";
import { type Account, createAccount } from "./account";
import { type MovementCategory, merchantKey, newMovement, suggestFromHistory } from "./movement";

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
