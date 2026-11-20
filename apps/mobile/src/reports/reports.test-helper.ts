import { createFromTemplate } from "../accounts/accounts";
import { cardFixture, cop, local } from "../accounts/card.test-helper";
import { templateByKey } from "../accounts/templates";
import { recordMovement } from "../movements/movements";

/** Nequi con ingresos y gastos de septiembre a noviembre de 2026. */
export async function setup() {
  const fx = await cardFixture({ closingDay: 15, dueDay: 2 });
  const tpl = templateByKey("nequi");
  if (!tpl) throw new Error("falta Nequi");
  const nequi = await createFromTemplate(fx.db, tpl, {}, fx.clock);
  if (!nequi.ok) throw nequi.error;
  const add = async (pesos: bigint, at: Date, categoryId: string, kind: "expense" | "income") => {
    const res = await recordMovement(
      fx.db,
      { kind, accountId: nequi.value.id, categoryId, amount: cop(pesos), occurredAt: at },
      fx.clock,
    );
    if (!res.ok) throw res.error;
  };
  await add(3_000_000n, local(2026, 9, 1), "default.salario", "income");
  await add(500_000n, local(2026, 9, 10), "default.mercado", "expense");
  await add(3_000_000n, local(2026, 10, 1), "default.salario", "income");
  await add(800_000n, local(2026, 10, 5), "default.mercado", "expense");
  await add(1_200_000n, local(2026, 10, 6), "default.arriendo", "expense");
  await add(40_000n, local(2026, 11, 2), "default.transporte", "expense");
  return fx;
}
