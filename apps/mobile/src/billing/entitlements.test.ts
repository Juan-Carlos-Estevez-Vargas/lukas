import { entitlementsOf } from "@lukas/domain";
import { describe, expect, it } from "vitest";
import { cardFixture } from "../accounts/card.test-helper";
import {
  cachedEntitlements,
  canUse,
  createEntitlementsClient,
  forgetEntitlements,
  refreshEntitlements,
  toEntitlements,
} from "./entitlements";

const API = "https://api.lukas.test";
const premium = {
  plan: "premium",
  features: ["assistant", "receiptReading", "semanticSearch"],
  aiDailyTokens: 100_000,
  aiDailyRequests: 200,
  subscription: { status: "active", periodEnd: "2099-01-01T00:00:00.000Z" },
};

const api = (reply: () => Promise<Response>) => {
  const seen: { url: string; auth: string | null }[] = [];
  const client = createEntitlementsClient(API, async (url, init) => {
    seen.push({ url, auth: new Headers(init?.headers).get("authorization") });
    return reply();
  });
  return { client, seen };
};

describe("entitlements en el teléfono", () => {
  it("sin dato usa el plan gratis; al refrescar guarda lo que dice la API", async () => {
    const { db } = await cardFixture({ closingDay: null, dueDay: null });
    expect(await cachedEntitlements(db)).toEqual(entitlementsOf("free"));
    expect(await canUse(db, "receiptReading")).toBe(false);

    const { client, seen } = api(async () => Response.json(premium));
    const fresh = await refreshEntitlements(db, client, "tok");
    expect(seen).toEqual([{ url: `${API}/v1/billing/entitlements`, auth: "Bearer tok" }]);
    expect(fresh?.plan).toBe("premium");
    expect(await canUse(db, "receiptReading")).toBe(true);
    expect(await canUse(db, "semanticSearch")).toBe(true);

    await forgetEntitlements(db);
    expect(await canUse(db, "semanticSearch")).toBe(false);
  });

  it("sin red o con errores deja la caché como estaba", async () => {
    const { db } = await cardFixture({ closingDay: null, dueDay: null });
    await refreshEntitlements(db, api(async () => Response.json(premium)).client, "tok");
    for (const reply of [
      async () => Promise.reject(new Error("sin red")),
      async () => new Response("caído", { status: 503 }),
      async () => new Response("no es json"),
      async () => Response.json({ plan: "oro" }),
    ]) {
      expect(await refreshEntitlements(db, api(reply).client, "tok")).toBeNull();
      expect((await cachedEntitlements(db)).plan).toBe("premium");
    }
  });

  it("el build de e2e prueba todo con premium", async () => {
    const { db } = await cardFixture({ closingDay: null, dueDay: null });
    expect(await canUse(db, "semanticSearch", true)).toBe(true);
  });

  it("una caché dañada vuelve al plan gratis", async () => {
    const { db } = await cardFixture({ closingDay: null, dueDay: null });
    await db.run("INSERT INTO preferences (key, value) VALUES ('billing.entitlements', '{roto')");
    expect(await cachedEntitlements(db)).toEqual(entitlementsOf("free"));
    await db.run(
      "UPDATE preferences SET value = '{\"plan\":\"oro\"}' WHERE key = 'billing.entitlements'",
    );
    expect(await cachedEntitlements(db)).toEqual(entitlementsOf("free"));
  });

  it("valida cada campo y descarta funciones desconocidas", () => {
    expect(toEntitlements(null)).toBeNull();
    expect(toEntitlements({ ...premium, aiDailyTokens: -1 })).toBeNull();
    expect(toEntitlements({ ...premium, aiDailyRequests: 1.5 })).toBeNull();
    expect(toEntitlements({ ...premium, features: "todo" })).toBeNull();
    expect(toEntitlements({ ...premium, features: ["assistant", "teletransporte", 3] })).toEqual({
      plan: "premium",
      features: ["assistant"],
      aiDailyTokens: 100_000,
      aiDailyRequests: 200,
    });
  });
});
