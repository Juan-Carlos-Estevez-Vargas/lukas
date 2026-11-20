import { describe, expect, it } from "vitest";
import { cardFixture, cop } from "../accounts/card.test-helper";
import { recordMovement } from "../movements/movements";
import { listRecurring } from "../recurring/recurring";
import {
  acceptSubscription,
  detectDuplicates,
  detectSubscriptions,
  dismissInsight,
} from "./subscriptions";

async function setup() {
  const fx = await cardFixture({ closingDay: 15, dueDay: 2 });
  const spend = async (merchant: string, pesos: bigint, at: Date, categoryId = "cat") => {
    const res = await recordMovement(
      fx.db,
      {
        kind: "expense",
        accountId: fx.card.id,
        categoryId,
        amount: cop(pesos),
        occurredAt: at,
        merchant,
      },
      fx.clock,
    );
    if (!res.ok) throw res.error;
    return res.value.id;
  };
  return { ...fx, spend };
}

const at = (month: number, day: number, hour = 10) => new Date(2026, month - 1, day, hour);

describe("suscripciones", () => {
  it("Netflix se detecta como suscripción tras dos cobros", async () => {
    const fx = await setup();
    await fx.spend("NETFLIX.COM", 44_900n, at(9, 14));
    expect(await detectSubscriptions(fx.db, at(9, 20))).toEqual([]);
    await fx.spend("Netflix.com", 44_900n, at(10, 14));
    await fx.spend("Carulla", 230_000n, at(10, 3));
    const [netflix, ...rest] = await detectSubscriptions(fx.db, at(10, 20));
    expect(rest).toEqual([]);
    expect(netflix?.frequency).toBe("monthly");
    expect(netflix?.amount.toDecimalString()).toBe("44900.00");
    expect(netflix?.nextOn).toEqual({ year: 2026, month: 11, day: 14 });
    expect(netflix?.dates).toHaveLength(2);

    // Al aceptarla queda un recurrente que avisa y deja de sugerirse.
    if (!netflix) throw new Error("falta Netflix");
    const res = await acceptSubscription(fx.db, netflix, { ...fx.clock, now: () => at(10, 20) });
    expect(res.ok).toBe(true);
    const [r] = await listRecurring(fx.db);
    expect(r?.autoPost).toBe(false);
    expect(r?.recurrence.startsOn).toEqual({ year: 2026, month: 11, day: 14 });
    expect(await detectSubscriptions(fx.db, at(10, 20))).toEqual([]);
  });

  it("acepta cambios pequeños de monto, semanas y años; descarta lo vencido y lo descartado", async () => {
    const fx = await setup();
    await fx.spend("Spotify", 16_900n, at(8, 2));
    await fx.spend("Spotify", 17_900n, at(9, 2));
    await fx.spend("Gimnasio", 30_000n, at(10, 1));
    await fx.spend("Gimnasio", 30_000n, at(10, 8));
    await fx.spend("Dominio web", 60_000n, at(1, 5));
    await fx.spend("Dominio web", 60_000n, new Date(2025, 0, 6));
    await fx.spend("Disney", 38_900n, at(6, 20));
    await fx.spend("Disney", 38_900n, at(7, 20));
    await fx.spend("Mercado", 100_000n, at(10, 1));
    await fx.spend("Mercado", 400_000n, at(10, 31));
    const found = await detectSubscriptions(fx.db, at(10, 10));
    expect(found.map((s) => [s.merchant, s.frequency])).toEqual([
      ["Dominio web", "yearly"],
      ["Gimnasio", "weekly"],
      ["Spotify", "monthly"],
    ]);
    // Disney dejó de cobrar hace más de 45 días y el mercado varía demasiado.
    const gym = found.find((s) => s.merchant === "Gimnasio");
    if (!gym) throw new Error("falta el gimnasio");
    await dismissInsight(fx.db, gym.key);
    expect((await detectSubscriptions(fx.db, at(10, 10))).map((s) => s.merchant)).toEqual([
      "Dominio web",
      "Spotify",
    ]);
  });
});

describe("cobros duplicados", () => {
  it("avisa dos cargos iguales al mismo comercio en menos de un día", async () => {
    const fx = await setup();
    const a = await fx.spend("RAPPI*RESTAURANTE", 45_900n, at(10, 5, 13));
    const b = await fx.spend("Rappi Restaurante", 45_900n, new Date(2026, 9, 5, 13, 4));
    await fx.spend("Rappi Restaurante", 45_900n, at(10, 7, 13));
    await fx.spend("Rappi Restaurante", 12_000n, at(10, 7, 14));
    const [dup, ...rest] = await detectDuplicates(fx.db, at(10, 8));
    expect(rest).toEqual([]);
    expect(dup?.transactionIds).toEqual([a, b]);
    expect(dup?.amount.toDecimalString()).toBe("45900.00");
    if (!dup) throw new Error("falta el duplicado");
    await dismissInsight(fx.db, dup.key);
    expect(await detectDuplicates(fx.db, at(10, 8))).toEqual([]);
    // Pasada la semana ya no se muestra.
    await fx.spend("Uber", 9_000n, at(9, 1, 8));
    await fx.spend("Uber", 9_000n, at(9, 1, 9));
    expect(await detectDuplicates(fx.db, at(10, 8))).toEqual([]);
  });

  it("ignora preferencias dañadas", async () => {
    const fx = await setup();
    await fx.db.run("INSERT INTO preferences (key, value) VALUES ('insights.dismissed', '{no')");
    await fx.spend("Uber", 9_000n, at(10, 1, 8));
    await fx.spend("Uber", 9_000n, at(10, 1, 9));
    expect(await detectDuplicates(fx.db, at(10, 2))).toHaveLength(1);
  });
});
