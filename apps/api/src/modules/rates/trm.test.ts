import { createTestDatabase } from "@lukas/db/testing";
import { describe, expect, it } from "vitest";
import {
  bogotaDay,
  DATOS_GOV_SOURCE,
  type DailyRate,
  datosGovTrm,
  drizzleRateStore,
  isDay,
  memoryRateStore,
  parseSocrataTrm,
  refreshTrm,
  type TrmSource,
  trmFor,
} from "./trm";

const rate = (day: string, value = "4012.35"): DailyRate => ({
  base: "USD",
  quote: "COP",
  day,
  rate: value,
  source: DATOS_GOV_SOURCE,
});

const fixedSource = (value: DailyRate | null | Error): TrmSource & { calls: string[] } => {
  const calls: string[] = [];
  return {
    calls,
    async rateOn(day) {
      calls.push(day);
      if (value instanceof Error) throw value;
      return value ? { ...value, day } : null;
    },
  };
};

describe("TRM de datos abiertos", () => {
  it("lee la fila de Socrata y valida el valor", () => {
    expect(parseSocrataTrm([{ valor: "4012.35", vigenciadesde: "x" }], "2026-11-19")).toEqual(
      rate("2026-11-19"),
    );
    expect(parseSocrataTrm([{ valor: 3999 }], "2026-11-19")?.rate).toBe("3999");
    for (const bad of [[], {}, null, [null], [{ valor: "abc" }], [{ valor: "0" }], [{}]]) {
      expect(parseSocrataTrm(bad, "2026-11-19")).toBeNull();
    }
  });

  it("consulta la vigencia del día en datos.gov.co", async () => {
    const urls: string[] = [];
    const source = datosGovTrm(async (url) => {
      urls.push(url);
      return Response.json([{ valor: "4100.10" }]);
    });
    expect((await source.rateOn("2026-11-21"))?.rate).toBe("4100.10");
    const query = new URL(urls[0] ?? "").searchParams;
    expect(query.get("$where")).toBe(
      "vigenciadesde <= '2026-11-21T00:00:00.000' AND vigenciahasta >= '2026-11-21T00:00:00.000'",
    );
    const down = datosGovTrm(async () => new Response("", { status: 503 }));
    await expect(down.rateOn("2026-11-21")).rejects.toThrow("503");
  });

  it("día en Colombia y validación de fechas", () => {
    expect(bogotaDay(new Date("2026-11-20T04:59:00Z"))).toBe("2026-11-19");
    expect(bogotaDay(new Date("2026-11-20T05:00:00Z"))).toBe("2026-11-20");
    expect(isDay("2026-02-28")).toBe(true);
    expect(isDay("2026-02-30")).toBe(false);
    expect(isDay("20261120")).toBe(false);
  });
});

describe("TRM guardada", () => {
  it("el cron guarda la tasa del día", async () => {
    const store = memoryRateStore();
    const saved = await refreshTrm(fixedSource(rate("x")), store, new Date("2026-11-19T13:00:00Z"));
    expect(saved?.day).toBe("2026-11-19");
    expect(store.rows).toHaveLength(1);
    expect(await refreshTrm(fixedSource(null), store, new Date())).toBeNull();
  });

  it("usa la guardada, si no la pide y la guarda, y si la fuente falla usa la última", async () => {
    const store = memoryRateStore();
    await store.save(rate("2026-11-14", "4000"));
    await store.save(rate("2026-11-14", "4001"));
    const ok = fixedSource(rate("x", "4050"));
    expect((await trmFor(ok, store, "2026-11-14"))?.rate).toBe("4001");
    expect(ok.calls).toEqual([]);

    expect((await trmFor(ok, store, "2026-11-19"))?.rate).toBe("4050");
    expect(store.rows.map((r) => r.day)).toEqual(["2026-11-14", "2026-11-19"]);

    const failing = fixedSource(new Error("sin red"));
    const fallback = await trmFor(failing, store, "2026-11-20");
    expect(fallback?.day).toBe("2026-11-19");
    expect(await trmFor(fixedSource(null), memoryRateStore(), "2026-11-20")).toBeNull();
  });

  it("en Postgres guarda, reemplaza y devuelve la última del día o antes", async () => {
    const { db } = await createTestDatabase();
    const store = drizzleRateStore(db);
    await store.save(rate("2026-11-18", "4010.5"));
    await store.save(rate("2026-11-19", "4000"));
    await store.save(rate("2026-11-19", "4012.35"));
    expect(await store.latestOnOrBefore("USD", "COP", "2026-11-19")).toEqual(rate("2026-11-19"));
    expect((await store.latestOnOrBefore("USD", "COP", "2026-11-18"))?.rate).toBe("4010.5");
    expect(await store.latestOnOrBefore("USD", "COP", "2026-11-01")).toBeNull();
    expect(await store.latestOnOrBefore("EUR", "COP", "2026-11-19")).toBeNull();
  });
});
