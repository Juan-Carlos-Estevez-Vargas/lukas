import { describe, expect, it, vi } from "vitest";
import { appVersionOf, createFeedbackClient } from "./client";

const context = { appVersion: "0.4.0", platform: "android" } as const;
const reply = (status: number) => vi.fn(async () => new Response(null, { status }));

describe("cliente de comentarios", () => {
  it("manda el texto limpio, sin tarjetas", async () => {
    const fetchImpl = reply(204);
    const client = createFeedbackClient("https://api.test", context, fetchImpl);
    const res = await client.send("tok", { kind: "bug", message: " pagué con 4111111111111111 " });
    expect(res).toEqual({ ok: true });
    const [url, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("https://api.test/v1/feedback");
    expect(init.headers).toMatchObject({ authorization: "Bearer tok" });
    expect(JSON.parse(String(init.body))).toEqual({
      kind: "bug",
      message: "pagué con [tarjeta]",
      appVersion: "0.4.0",
      platform: "android",
    });
  });

  it("no llama a la API con un mensaje muy corto", async () => {
    const fetchImpl = reply(204);
    const client = createFeedbackClient("https://api.test", context, fetchImpl);
    expect(await client.send("tok", { kind: "idea", message: "ok" })).toEqual({
      ok: false,
      error: "length",
    });
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("traduce los errores de la API y de la red", async () => {
    const draft = { kind: "other", message: "Una idea larga" } as const;
    const cases: [number, string][] = [
      [401, "signed_out"],
      [422, "length"],
      [429, "rate_limited"],
      [503, "unavailable"],
      [500, "unexpected"],
    ];
    for (const [status, error] of cases) {
      const client = createFeedbackClient("https://api.test", context, reply(status));
      expect(await client.send("tok", draft)).toEqual({ ok: false, error });
    }
    const offline = createFeedbackClient("https://api.test", context, async () => {
      throw new TypeError("sin red");
    });
    expect(await offline.send("tok", draft)).toEqual({ ok: false, error: "network" });
  });

  it("limpia la versión de la app", () => {
    expect(appVersionOf("0.4.0")).toBe("0.4.0");
    expect(appVersionOf("1.0 beta<1>")).toBe("1.0beta1");
    expect(appVersionOf(undefined)).toBe("0.0.0");
  });
});
