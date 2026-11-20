import { describe, expect, it } from "vitest";
import { cardFixture } from "../accounts/card.test-helper";
import { createDeviceClient, forgetDevice, setWeeklySummary, weeklyEnabled } from "./weekly";

const API = "https://api.lukas.test";
const TOKEN = "ExponentPushToken[telefono-0123456789]";

function fakeApi(ok = true) {
  const calls: { method: string; body: unknown; auth: string | null }[] = [];
  const client = createDeviceClient(API, async (url, init) => {
    expect(url).toBe(`${API}/v1/notifications/device`);
    calls.push({
      method: String(init?.method),
      body: JSON.parse(String(init?.body)),
      auth: new Headers(init?.headers).get("authorization"),
    });
    return new Response(null, { status: ok ? 204 : 503 });
  });
  return { client, calls };
}

const source = (token: string | null) => ({
  available: true,
  token: async () => (token ? { token, platform: "android" as const } : null),
});

describe("resumen semanal en el teléfono", () => {
  it("al encenderlo registra el token y al apagarlo lo borra", async () => {
    const { db } = await cardFixture({ closingDay: null, dueDay: null });
    const api = fakeApi();
    const deps = { source: source(TOKEN), client: api.client, session: "tok" };
    expect(await weeklyEnabled(db)).toBe(false);
    expect(await setWeeklySummary(db, deps, true)).toBe("on");
    expect(await weeklyEnabled(db)).toBe(true);
    expect(api.calls[0]).toEqual({
      method: "PUT",
      body: { token: TOKEN, platform: "android", weeklySummary: true },
      auth: "Bearer tok",
    });
    expect(await setWeeklySummary(db, deps, false)).toBe("off");
    expect(api.calls[1]).toMatchObject({ method: "DELETE", body: { token: TOKEN } });
    expect(await weeklyEnabled(db)).toBe(false);
    // Apagarlo de nuevo no llama a la API.
    expect(await setWeeklySummary(db, deps, false)).toBe("off");
    expect(api.calls).toHaveLength(2);
  });

  it("sin permiso o sin conexión no cambia nada", async () => {
    const { db } = await cardFixture({ closingDay: null, dueDay: null });
    const down = fakeApi(false);
    expect(
      await setWeeklySummary(
        db,
        { source: source(null), client: down.client, session: "tok" },
        true,
      ),
    ).toBe("denied");
    expect(
      await setWeeklySummary(
        db,
        { source: source(TOKEN), client: down.client, session: "tok" },
        true,
      ),
    ).toBe("offline");
    expect(await weeklyEnabled(db)).toBe(false);

    const up = fakeApi();
    await setWeeklySummary(db, { source: source(TOKEN), client: up.client, session: "tok" }, true);
    expect(
      await setWeeklySummary(
        db,
        { source: source(TOKEN), client: down.client, session: "tok" },
        false,
      ),
    ).toBe("offline");
    expect(await weeklyEnabled(db)).toBe(true);
  });

  it("al cerrar sesión el teléfono deja de recibir resúmenes de esa cuenta", async () => {
    const { db } = await cardFixture({ closingDay: null, dueDay: null });
    const api = fakeApi();
    await forgetDevice(db, api.client, "tok");
    expect(api.calls).toEqual([]);
    await setWeeklySummary(db, { source: source(TOKEN), client: api.client, session: "tok" }, true);
    await forgetDevice(db, api.client, "tok");
    expect(api.calls.at(-1)).toMatchObject({ method: "DELETE" });
    expect(await weeklyEnabled(db)).toBe(false);
  });

  it("una falla de red cuenta como sin conexión", async () => {
    const client = createDeviceClient(API, () => Promise.reject(new TypeError("offline")));
    expect(
      await client.register("tok", { token: TOKEN, platform: "ios", weeklySummary: true }),
    ).toBe(false);
  });
});
