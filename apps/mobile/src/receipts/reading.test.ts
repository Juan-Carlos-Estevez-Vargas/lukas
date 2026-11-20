import { describe, expect, it } from "vitest";
import { createReceiptReader, e2eReceiptReader, patchFromReading, toReading } from "./reading";

const API = "https://api.lukas.test";
const NOW = new Date(2026, 10, 20, 15);
const cop = (amount: string) => ({ amount, currency: "COP" as const });
const image = { base64: "aGVsbG8=", mediaType: "image/jpeg" };

describe("lectura de recibos en la app", () => {
  it("manda la foto con bearer y valida lo leído", async () => {
    const calls: { url: string; init: RequestInit | undefined }[] = [];
    const reader = createReceiptReader(API, async (url, init) => {
      calls.push({ url, init });
      return Response.json({ merchant: " Carulla ", amount: cop("52300.00"), date: "2026-11-19" });
    });
    expect(await reader.read("tok", image)).toEqual({
      ok: true,
      value: { merchant: "Carulla", amount: cop("52300.00"), date: "2026-11-19" },
    });
    expect(calls[0]?.url).toBe(`${API}/v1/agent/receipt`);
    expect(new Headers(calls[0]?.init?.headers).get("authorization")).toBe("Bearer tok");
    expect(JSON.parse(String(calls[0]?.init?.body))).toEqual({
      image: "aGVsbG8=",
      mediaType: "image/jpeg",
    });
  });

  it.each([
    [401, "signed_out"],
    [422, "unreadable"],
    [429, "quota"],
    [503, "unavailable"],
    [500, "unexpected"],
  ])("traduce %i", async (status, kind) => {
    const reader = createReceiptReader(API, async () => new Response("{}", { status }));
    expect(await reader.read("tok", image)).toMatchObject({ ok: false, error: { kind } });
  });

  it("reporta la red caída y respuestas raras", async () => {
    const offline = createReceiptReader(API, () => Promise.reject(new TypeError("offline")));
    expect(await offline.read("tok", image)).toEqual({ ok: false, error: { kind: "network" } });
    const odd = createReceiptReader(API, async () => new Response("no es json"));
    expect(await odd.read("tok", image)).toMatchObject({ error: { kind: "unexpected" } });
  });

  it("descarta lo que no sirve", () => {
    expect(toReading(null)).toBeNull();
    expect(toReading({ merchant: "", amount: null, date: null })).toBeNull();
    expect(
      toReading({ merchant: "Ara", amount: { amount: 5, currency: "COP" }, date: "ayer" }),
    ).toEqual({
      merchant: "Ara",
      amount: null,
      date: null,
    });
  });

  it("el lector de e2e siempre lee un mercado", async () => {
    const res = await e2eReceiptReader().read("tok", image);
    expect(res.ok && res.value.merchant).toBe("Carulla");
  });
});

describe("llenar el formulario con lo leído", () => {
  it("monto en pesos, comercio y día cercano", () => {
    expect(
      patchFromReading({ merchant: "Éxito", amount: cop("187450.00"), date: "2026-11-19" }, NOW),
    ).toEqual({ digits: "187450", merchant: "Éxito", daysAgo: 1 });
    expect(patchFromReading({ merchant: null, amount: null, date: "2026-11-20" }, NOW)).toEqual({
      daysAgo: 0,
    });
  });

  it("redondea los centavos y deja otras monedas para escribir a mano", () => {
    expect(
      patchFromReading({ merchant: null, amount: cop("9999.50"), date: null }, NOW).digits,
    ).toBe("10000");
    expect(
      patchFromReading({ merchant: null, amount: cop("9999.49"), date: null }, NOW).digits,
    ).toBe("9999");
    expect(patchFromReading({ merchant: null, amount: cop("0.20"), date: null }, NOW)).toEqual({});
    expect(
      patchFromReading(
        { merchant: null, amount: { amount: "20.00", currency: "USD" }, date: null },
        NOW,
      ),
    ).toEqual({});
  });

  it("una fecha vieja va aparte y una futura se ignora", () => {
    const old = patchFromReading({ merchant: null, amount: null, date: "2026-11-02" }, NOW);
    expect(old.daysAgo).toBeUndefined();
    expect(old.date?.getDate()).toBe(2);
    expect(patchFromReading({ merchant: null, amount: null, date: "2026-11-25" }, NOW)).toEqual({});
  });
});
