import { Money } from "@lukas/domain";
import { describe, expect, it } from "vitest";
import { createFromTemplate } from "../accounts/accounts";
import { cardFixture, cop, local } from "../accounts/card.test-helper";
import { templateByKey } from "../accounts/templates";
import { sqliteAccounts } from "../data/ledger-sqlite";
import { recordTransfer } from "./transfers";

async function setup() {
  const fx = await cardFixture({ closingDay: 15, dueDay: 2 });
  const make = async (key: string, opening: Money, currency?: "USD") => {
    const tpl = templateByKey(key);
    if (!tpl) throw new Error(key);
    const res = await createFromTemplate(
      fx.db,
      tpl,
      { openingBalance: opening, ...(currency ? { currency, name: "Dólares" } : {}) },
      fx.clock,
    );
    if (!res.ok) throw res.error;
    return res.value;
  };
  const nequi = await make("nequi", cop(1_000_000n));
  const bancolombia = await make("bancolombia", cop(0n));
  const dollars = await make("savings", Money.ofMinor(50_000n, "USD"), "USD");
  const balance = async (a: typeof nequi) =>
    (await sqliteAccounts(fx.db).balance(a)).toDecimalString();
  return { ...fx, nequi, bancolombia, dollars, balance };
}

describe("recordTransfer", () => {
  it("mueve dinero y cobra la comisión en el origen", async () => {
    const { db, clock, nequi, bancolombia, balance } = await setup();
    const res = await recordTransfer(
      db,
      {
        fromAccountId: nequi.id,
        toAccountId: bancolombia.id,
        amount: cop(300_000n),
        fee: cop(1_200n),
        occurredAt: local(2026, 11, 19),
      },
      clock,
    );
    expect(res.ok).toBe(true);
    expect(await balance(nequi)).toBe("698800.00");
    expect(await balance(bancolombia)).toBe("300000.00");
  });

  it("paga la tarjeta desde una cuenta", async () => {
    const { db, clock, nequi, card, balance } = await setup();
    await recordTransfer(
      db,
      {
        fromAccountId: nequi.id,
        toAccountId: card.id,
        amount: cop(200_000n),
        occurredAt: local(2026, 11, 19),
        description: "Pago tarjeta",
      },
      clock,
    );
    expect(await balance(card)).toBe("200000.00");
  });

  it("cambia dólares a pesos con la tasa implícita", async () => {
    const { db, clock, dollars, nequi, balance } = await setup();
    expect(dollars.currency).toBe("USD");
    const res = await recordTransfer(
      db,
      {
        fromAccountId: dollars.id,
        toAccountId: nequi.id,
        amount: Money.ofMinor(10_000n, "USD"),
        received: cop(390_000n),
        occurredAt: local(2026, 11, 19),
      },
      clock,
    );
    expect(res.ok).toBe(true);
    expect(await balance(dollars)).toBe("400.00");
    expect(await balance(nequi)).toBe("1390000.00");
  });

  it("entre monedas sin monto recibido no guarda nada", async () => {
    const { db, clock, dollars, nequi, balance } = await setup();
    const res = await recordTransfer(
      db,
      {
        fromAccountId: dollars.id,
        toAccountId: nequi.id,
        amount: Money.ofMinor(1n, "USD"),
        occurredAt: local(2026, 11, 19),
      },
      clock,
    );
    expect(!res.ok && res.error.code).toBe("currency_mismatch");
    expect(await balance(dollars)).toBe("500.00");
  });
});
