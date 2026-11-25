import { describe, expect, it } from "vitest";
import { createFromTemplate } from "../accounts/accounts";
import { cardFixture, cop, local } from "../accounts/card.test-helper";
import { templateByKey } from "../accounts/templates";
import { recordMovement } from "../movements/movements";
import { recordTransfer } from "../movements/transfers";
import {
  exemptAccount,
  gmfOutflows,
  hasForeignAccounts,
  setExemptAccount,
  taxFigures,
} from "./taxes";

async function year2025() {
  const fx = await cardFixture({ closingDay: 15, dueDay: 2 });
  const create = async (key: string, opening: bigint) => {
    const tpl = templateByKey(key);
    if (!tpl) throw new Error(key);
    const res = await createFromTemplate(
      fx.db,
      tpl,
      { openingBalance: cop(opening) },
      { ...fx.clock, now: () => local(2024, 12, 1) },
    );
    if (!res.ok) throw res.error;
    return res.value;
  };
  const bank = await create("bancolombia", 2_000_000n);
  const nequi = await create("nequi", 100_000n);
  const move = async (
    kind: "income" | "expense",
    accountId: string,
    categoryId: string,
    pesos: bigint,
    at: Date,
  ) => {
    const res = await recordMovement(
      fx.db,
      {
        kind,
        accountId,
        categoryId,
        amount: cop(pesos),
        occurredAt: at,
        merchant: null,
        note: null,
        tags: [],
      },
      fx.clock,
    );
    if (!res.ok) throw res.error;
  };
  await move("income", bank.id, "default.salario", 5_000_000n, local(2025, 3, 1));
  await move("income", bank.id, "default.salario", 5_000_000n, local(2025, 4, 1));
  await move("expense", fx.card.id, "default.mercado", 800_000n, local(2025, 3, 10));
  await move("expense", nequi.id, "default.transporte", 50_000n, local(2025, 3, 12));
  // Fuera del año: no cuenta.
  await move("income", bank.id, "default.salario", 9_000_000n, local(2026, 1, 2));
  const tr = await recordTransfer(
    fx.db,
    {
      fromAccountId: bank.id,
      toAccountId: nequi.id,
      amount: cop(300_000n),
      occurredAt: local(2025, 3, 15),
    },
    fx.clock,
  );
  if (!tr.ok) throw tr.error;
  return { ...fx, bank, nequi };
}

describe("cifras para la declaración", () => {
  it("suma ingresos, compras, tarjeta, consignaciones y patrimonio del año", async () => {
    const fx = await year2025();
    const f = await taxFigures(fx.db, 2025);
    expect(f.grossIncome.equals(cop(10_000_000n))).toBe(true);
    expect(f.totalPurchases.equals(cop(850_000n))).toBe(true);
    expect(f.creditCardSpending.equals(cop(800_000n))).toBe(true);
    // Salarios al banco más la transferencia que llegó a Nequi; los saldos iniciales no cuentan.
    expect(f.deposits.equals(cop(10_300_000n))).toBe(true);
    // Banco 2.000.000 + 10.000.000 − 300.000; Nequi 100.000 − 50.000 + 300.000. La tarjeta no suma.
    expect(f.grossAssets.equals(cop(12_050_000n))).toBe(true);
    expect(await hasForeignAccounts(fx.db)).toBe(false);
  });

  it("calcula lo que sale de bancos y billeteras para el 4×1000, con la cuenta exenta aparte", async () => {
    const fx = await year2025();
    let out = await gmfOutflows(fx.db, 2025, 3);
    expect(out.exempt.isZero()).toBe(true);
    expect(out.taxed.equals(cop(350_000n))).toBe(true);
    await setExemptAccount(fx.db, fx.bank.id);
    expect(await exemptAccount(fx.db)).toBe(fx.bank.id);
    out = await gmfOutflows(fx.db, 2025, 3);
    expect(out.exempt.equals(cop(300_000n))).toBe(true);
    expect(out.taxed.equals(cop(50_000n))).toBe(true);
    expect((await gmfOutflows(fx.db, 2025, 12)).taxed.isZero()).toBe(true);
    await setExemptAccount(fx.db, null);
    expect(await exemptAccount(fx.db)).toBeNull();
  });
});
