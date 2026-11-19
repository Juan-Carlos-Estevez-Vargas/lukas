import { describe, expect, it } from "vitest";
import { createApp } from "../../app";
import { testEnv } from "../../test/env";
import { defaultRatesFactory } from "./factory";
import { DATOS_GOV_SOURCE, memoryRateStore, type TrmSource } from "./trm";

const offline: TrmSource = {
  rateOn: async () => {
    throw new Error("sin red");
  },
};

describe("GET /v1/rates/usd-cop", () => {
  const store = memoryRateStore();
  const app = createApp({ rates: () => ({ source: offline, store }) });

  it("devuelve la TRM del día pedido o la última anterior", async () => {
    await store.save({
      base: "USD",
      quote: "COP",
      day: "2026-11-14",
      rate: "4012.35",
      source: DATOS_GOV_SOURCE,
    });
    const res = await app.request("/v1/rates/usd-cop?day=2026-11-16", {}, testEnv);
    expect(res.status).toBe(200);
    expect(res.headers.get("cache-control")).toBe("public, max-age=3600");
    expect(await res.json()).toEqual({
      base: "USD",
      quote: "COP",
      day: "2026-11-16",
      rateDay: "2026-11-14",
      rate: "4012.35",
      source: DATOS_GOV_SOURCE,
    });
  });

  it("sin día usa el de hoy en Colombia", async () => {
    const res = await app.request("/v1/rates/usd-cop", {}, testEnv);
    expect(res.status).toBe(200);
  });

  it("404 si no hay ninguna tasa y 400 si la fecha no es válida", async () => {
    const empty = createApp({ rates: () => ({ source: offline, store: memoryRateStore() }) });
    const missing = await empty.request("/v1/rates/usd-cop?day=2026-11-16", {}, testEnv);
    expect(missing.status).toBe(404);
    expect(await missing.json()).toMatchObject({ code: "rate_not_found" });
    const bad = await app.request("/v1/rates/usd-cop?day=2026-13-01", {}, testEnv);
    expect(bad.status).toBe(400);
  });

  it("la fábrica por defecto usa memoria sin base y la reutiliza", () => {
    const env = { ...testEnv };
    const a = defaultRatesFactory(env);
    expect(defaultRatesFactory(env)).toBe(a);
    const withDb = defaultRatesFactory({ ...testEnv, DATABASE_URL: "postgres://u:p@localhost/db" });
    expect(withDb.store).not.toBe(a.store);
  });
});
