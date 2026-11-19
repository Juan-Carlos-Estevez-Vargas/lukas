import { Money } from "@lukas/domain";
import { describe, expect, it } from "vitest";
import { createFromTemplate } from "../accounts/accounts";
import { cardFixture, cop } from "../accounts/card.test-helper";
import { templateByKey } from "../accounts/templates";
import {
  copRates,
  createRatesClient,
  latestRate,
  needsUsd,
  type RatesClient,
  refreshRates,
  saveRate,
} from "./rates";

const today = { year: 2026, month: 11, day: 19 };
const now = new Date(2026, 10, 19, 9);

function fakeClient(rate: string | null) {
  const calls: string[] = [];
  const client: RatesClient = {
    async usdCop(day) {
      calls.push(day);
      return rate ? { rate, day, source: "test" } : null;
    },
  };
  return { client, calls };
}

async function withUsdAccount() {
  const fx = await cardFixture({ closingDay: 15, dueDay: 2 });
  const tpl = templateByKey("bancolombia");
  if (!tpl) throw new Error("falta plantilla");
  const usd = await createFromTemplate(
    fx.db,
    tpl,
    { name: "Cuenta USD", currency: "USD", openingBalance: Money.ofMinor(10_000n, "USD") },
    fx.clock,
  );
  if (!usd.ok) throw usd.error;
  return { ...fx, usd: usd.value };
}

describe("TRM en el teléfono", () => {
  it("la pide una vez al día y solo si hay cuentas en dólares", async () => {
    const plain = await cardFixture({ closingDay: 15, dueDay: 2 });
    const none = fakeClient("4000");
    await refreshRates(plain.db, none.client, today, now);
    expect(none.calls).toEqual([]);
    expect(await needsUsd(plain.db)).toBe(false);

    const fx = await withUsdAccount();
    const api = fakeClient("4012.35");
    await refreshRates(fx.db, api.client, today, now);
    await refreshRates(fx.db, api.client, today, now);
    expect(api.calls).toEqual(["2026-11-19"]);
    expect(await latestRate(fx.db, "USD", "COP")).toEqual({
      rate: "4012.35",
      day: "2026-11-19",
      source: "test",
    });
  });

  it("sin conexión se queda con la última guardada", async () => {
    const fx = await withUsdAccount();
    await saveRate(fx.db, "USD", "COP", { rate: "4000", day: "2026-11-14", source: "x" }, now);
    await saveRate(fx.db, "USD", "COP", { rate: "4001", day: "2026-11-14", source: "x" }, now);
    await refreshRates(fx.db, fakeClient(null).client, today, now);
    const { table, usd } = await copRates(fx.db);
    expect(usd?.day).toBe("2026-11-14");
    expect(table.get("USD")).toBe("4001");
    const empty = await copRates((await cardFixture({ closingDay: 1, dueDay: 2 })).db);
    expect(empty.table.size).toBe(0);
    expect(cop(1n).currencyCode).toBe("COP");
  });

  it("el cliente HTTP valida la respuesta y no lanza sin red", async () => {
    const urls: string[] = [];
    const ok = createRatesClient("https://api.test", async (url) => {
      urls.push(url);
      return Response.json({ rate: "4012.35", rateDay: "2026-11-18", source: "s" });
    });
    expect(await ok.usdCop("2026-11-19")).toEqual({
      rate: "4012.35",
      day: "2026-11-18",
      source: "s",
    });
    expect(urls).toEqual(["https://api.test/v1/rates/usd-cop?day=2026-11-19"]);

    const cases: (() => Promise<Response>)[] = [
      async () => new Response("", { status: 404 }),
      async () => Response.json({ rate: 4012, rateDay: "d", source: "s" }),
      async () => Response.json({ rate: "1e9", rateDay: "d", source: "s" }),
      async () => Response.json({ rate: "1", rateDay: 1, source: "s" }),
      async () => {
        throw new TypeError("Network request failed");
      },
    ];
    for (const impl of cases) {
      expect(await createRatesClient("https://api.test", impl).usdCop("2026-11-19")).toBeNull();
    }
  });
});
