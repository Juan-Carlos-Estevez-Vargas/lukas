import { describe, expect, it } from "vitest";
import { createSearchClient, toResult } from "./search";

const API = "https://api.lukas.test";

describe("búsqueda por significado en la app", () => {
  it("manda la consulta con bearer y valida los resultados", async () => {
    const calls: { url: string; init: RequestInit | undefined }[] = [];
    const client = createSearchClient(API, async (url, init) => {
      calls.push({ url, init });
      return Response.json({
        results: [
          {
            id: "t1",
            date: "2026-11-12T17:00:00.000Z",
            merchant: "Crepes & Waffles",
            description: "",
            category: "Restaurantes",
            amount: { amount: "85000.00", currency: "COP" },
            score: 0.9,
          },
          { id: "", date: "x" },
        ],
      });
    });
    const res = await client.search("tok", `  salidas a comer ${"x".repeat(300)}`);
    expect(res.ok && res.value).toEqual([
      {
        id: "t1",
        date: new Date("2026-11-12T17:00:00.000Z"),
        merchant: "Crepes & Waffles",
        description: "",
        category: "Restaurantes",
        amount: { amount: "85000.00", currency: "COP" },
      },
    ]);
    expect(new Headers(calls[0]?.init?.headers).get("authorization")).toBe("Bearer tok");
    expect((JSON.parse(String(calls[0]?.init?.body)) as { query: string }).query).toHaveLength(200);
  });

  it.each([
    [401, "signed_out"],
    [402, "premium"],
    [429, "quota"],
    [503, "unavailable"],
    [500, "unexpected"],
  ])("traduce %i", async (status, error) => {
    const client = createSearchClient(API, async () => new Response("{}", { status }));
    expect(await client.search("tok", "comida")).toEqual({ ok: false, error });
  });

  it("reporta la red caída y respuestas raras", async () => {
    const offline = createSearchClient(API, () => Promise.reject(new TypeError("offline")));
    expect(await offline.search("tok", "comida")).toEqual({ ok: false, error: "network" });
    const odd = createSearchClient(API, async () => new Response("no es json"));
    expect(await odd.search("tok", "comida")).toEqual({ ok: false, error: "unexpected" });
  });

  it("descarta resultados incompletos", () => {
    expect(toResult(null)).toBeNull();
    expect(toResult({ id: "a", date: "nunca" })).toBeNull();
    expect(toResult({ id: "a", date: "2026-11-01", amount: null, merchant: 4 })).toEqual({
      id: "a",
      date: new Date("2026-11-01"),
      merchant: null,
      description: "",
      category: null,
      amount: null,
    });
  });
});
