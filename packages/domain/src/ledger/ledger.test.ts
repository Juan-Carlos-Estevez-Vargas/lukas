import { describe, expect, it } from "vitest";
import { Money } from "../money";
import { type Account, createAccount } from "./account";
import type { LedgerRepositories, UnitOfWork } from "./ports";
import { accountIdOf, checkBalanced, type Entry, type Transaction } from "./transaction";
import { transferFunds } from "./transfer";

const now = new Date("2026-11-19T12:00:00Z");
const cop = (n: bigint) => Money.ofMinor(n, "COP");
const entry = (id: string, accountId: string, amount: Money): Entry => ({
  id,
  target: { accountId },
  amount,
});

const account = (id: string, extra: Partial<Account> = {}): Account => {
  const res = createAccount({ name: id, type: "bank", currency: "COP" }, id, now);
  if (!res.ok) throw res.error;
  return { ...res.value, ...extra };
};

describe("createAccount", () => {
  it("crea una cuenta válida con valores por defecto", () => {
    const res = createAccount(
      { name: "  Nequi ", type: "digital_wallet", currency: "COP", institution: " " },
      "a1",
      now,
    );
    expect(res.ok && res.value).toMatchObject({
      name: "Nequi",
      institution: null,
      last4: null,
      version: 1,
      archivedAt: null,
    });
  });

  it.each([
    [{ name: " " }, "account_name_required"],
    [{ last4: "123" }, "invalid_last4"],
    [{ last4: "12a4" }, "invalid_last4"],
    [{ closingDay: 0 }, "invalid_day"],
    [{ dueDay: 32 }, "invalid_day"],
    [{ creditLimit: Money.ofMinor(100n, "USD") }, "currency_mismatch"],
  ])("rechaza %o", (patch, code) => {
    const res = createAccount(
      { name: "Visa", type: "credit_card", currency: "COP", ...patch },
      "a1",
      now,
    );
    expect(!res.ok && res.error.code).toBe(code);
  });

  it("acepta una tarjeta con últimos 4 dígitos, días y cupo", () => {
    const res = createAccount(
      {
        name: "Visa",
        type: "credit_card",
        currency: "COP",
        last4: "1234",
        closingDay: 15,
        dueDay: 30,
        creditLimit: cop(500_000_000n),
      },
      "a1",
      now,
    );
    expect(res.ok).toBe(true);
  });
});

describe("checkBalanced", () => {
  it("acepta asientos que suman cero por moneda", () => {
    expect(
      checkBalanced([
        entry("1", "a", cop(-100n)),
        entry("2", "b", cop(100n)),
        entry("3", "c", Money.ofMinor(5n, "USD")),
        entry("4", "d", Money.ofMinor(-5n, "USD")),
      ]).ok,
    ).toBe(true);
  });

  it.each([
    [[entry("1", "a", cop(100n))], "too_few_entries"],
    [[entry("1", "a", cop(0n)), entry("2", "b", cop(0n))], "zero_entry"],
    [[entry("1", "a", cop(-100n)), entry("2", "b", cop(99n))], "unbalanced"],
  ])("rechaza asientos inválidos (%#)", (entries, code) => {
    const res = checkBalanced(entries);
    expect(!res.ok && res.error.code).toBe(code);
  });

  it("identifica la cuenta de un asiento", () => {
    expect(accountIdOf(entry("1", "a", cop(1n)))).toBe("a");
    expect(accountIdOf({ id: "2", target: { categoryId: "c" }, amount: cop(1n) })).toBeNull();
  });
});

/** Unidad de trabajo en memoria: confirma solo si `work` termina sin lanzar. */
function memoryLedger(accounts: Account[]) {
  const saved: Transaction[] = [];
  const store = new Map(accounts.map((a) => [a.id, a]));
  const repos = (pending: Transaction[]): LedgerRepositories => ({
    accounts: {
      get: async (id) => store.get(id) ?? null,
      list: async () => [...store.values()],
      save: async (a) => {
        store.set(a.id, a);
      },
      balance: async (a) =>
        [...saved, ...pending]
          .flatMap((t) => t.entries)
          .filter((e) => accountIdOf(e) === a.id)
          .reduce((sum, e) => sum.add(e.amount), Money.zero(a.currency)),
    },
    transactions: {
      get: async (id) => saved.find((t) => t.id === id) ?? null,
      save: async (t) => {
        pending.push(t);
      },
    },
  });
  const uow: UnitOfWork = {
    run: async (work) => {
      const pending: Transaction[] = [];
      const result = await work(repos(pending));
      saved.push(...pending);
      return result;
    },
  };
  let n = 0;
  return { uow, saved, newId: () => `id-${++n}`, now: () => now };
}

describe("transferFunds", () => {
  const input = {
    fromAccountId: "a",
    toAccountId: "b",
    amount: cop(5_000_000n),
    occurredAt: now,
  };

  it("crea una transacción balanceada entre dos cuentas", async () => {
    const ledger = memoryLedger([account("a"), account("b")]);
    const res = await transferFunds(ledger, input);
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.value.description).toBe("a → b");
    expect(res.value.entries.map((e) => [accountIdOf(e), e.amount.amountMinor])).toEqual([
      ["a", -5_000_000n],
      ["b", 5_000_000n],
    ]);
    expect(ledger.saved).toHaveLength(1);
  });

  it.each([
    [{ toAccountId: "a" }, "same_account"],
    [{ amount: cop(0n) }, "invalid_amount"],
    [{ amount: cop(-1n) }, "invalid_amount"],
    [{ toAccountId: "zz" }, "account_not_found"],
    [{ toAccountId: "arch" }, "account_archived"],
    [{ toAccountId: "usd" }, "currency_mismatch"],
  ])("rechaza %o sin guardar nada", async (patch, code) => {
    const ledger = memoryLedger([
      account("a"),
      account("b"),
      account("arch", { archivedAt: now }),
      account("usd", { currency: "USD" }),
    ]);
    const res = await transferFunds(ledger, { ...input, ...patch });
    expect(!res.ok && res.error.code).toBe(code);
    expect(ledger.saved).toHaveLength(0);
  });

  it("registra la comisión como gasto de la cuenta de origen", async () => {
    const ledger = memoryLedger([account("a"), account("b")]);
    const res = await transferFunds(ledger, {
      ...input,
      fee: { amount: cop(20_000n), categoryId: "comisiones" },
    });
    if (!res.ok) throw res.error;
    expect(res.value.entries.map((e) => [e.target, e.amount.amountMinor])).toEqual([
      [{ accountId: "a" }, -5_000_000n],
      [{ accountId: "b" }, 5_000_000n],
      [{ accountId: "a" }, -20_000n],
      [{ categoryId: "comisiones" }, 20_000n],
    ]);
  });

  it("entre monedas, cada moneda cuadra por la categoría de cambio", async () => {
    const ledger = memoryLedger([account("usd", { currency: "USD" }), account("b")]);
    const usd = Money.ofMinor(10_000n, "USD"); // US$100
    const res = await transferFunds(ledger, {
      ...input,
      fromAccountId: "usd",
      amount: usd,
      exchange: { received: cop(39_000_000n), categoryId: "cambio" },
      fee: { amount: Money.ofMinor(300n, "USD"), categoryId: "comisiones" },
    });
    if (!res.ok) throw res.error;
    expect(
      res.value.entries.map((e) => [e.target, e.amount.toDecimalString(), e.amount.currencyCode]),
    ).toEqual([
      [{ accountId: "usd" }, "-100.00", "USD"],
      [{ categoryId: "cambio" }, "100.00", "USD"],
      [{ categoryId: "cambio" }, "-390000.00", "COP"],
      [{ accountId: "b" }, "390000.00", "COP"],
      [{ accountId: "usd" }, "-3.00", "USD"],
      [{ categoryId: "comisiones" }, "3.00", "USD"],
    ]);
  });

  it.each([
    ["comisión en cero", { fee: { amount: cop(0n), categoryId: "f" } }, "invalid_fee"],
    [
      "comisión en otra moneda",
      { fee: { amount: Money.ofMinor(1n, "USD"), categoryId: "f" } },
      "currency_mismatch",
    ],
    [
      "recibido en cero",
      { toAccountId: "usd", exchange: { received: Money.ofMinor(0n, "USD"), categoryId: "x" } },
      "invalid_amount",
    ],
    [
      "recibido en otra moneda",
      { toAccountId: "usd", exchange: { received: cop(1n), categoryId: "x" } },
      "currency_mismatch",
    ],
    [
      "cambio entre la misma moneda",
      { exchange: { received: cop(1n), categoryId: "x" } },
      "currency_mismatch",
    ],
  ] as const)("rechaza %s", async (_name, patch, code) => {
    const ledger = memoryLedger([account("a"), account("b"), account("usd", { currency: "USD" })]);
    const res = await transferFunds(ledger, { ...input, ...patch });
    expect(!res.ok && res.error.code).toBe(code);
    expect(ledger.saved).toHaveLength(0);
  });

  it("usa la descripción dada", async () => {
    const ledger = memoryLedger([account("a"), account("b")]);
    const res = await transferFunds(ledger, { ...input, description: " Ahorro " });
    expect(res.ok && res.value.description).toBe("Ahorro");
  });
});
