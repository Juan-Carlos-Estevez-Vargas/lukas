import { describe, expect, it } from "vitest";
import { createAssistantClient, HISTORY } from "./client";
import { e2eAssistantClient } from "./e2e-client";

const API = "https://api.lukas.test";

describe("cliente del asistente", () => {
  it("manda el historial reciente con bearer y lee la respuesta", async () => {
    const calls: { url: string; init: RequestInit | undefined }[] = [];
    const client = createAssistantClient(API, async (url, init) => {
      calls.push({ url, init });
      return new Response(
        'data: {"type":"text-delta","id":"t","delta":"Hola"}\n\ndata: [DONE]\n\n',
        {
          headers: { "content-type": "text/event-stream" },
        },
      );
    });
    const turns = Array.from({ length: 15 }, (_, i) => ({
      role: i % 2 === 0 ? ("user" as const) : ("assistant" as const),
      content: i === 3 ? "   " : `m${i}`,
    }));
    const res = await client.chat("tok", turns);
    expect(res).toEqual({ ok: true, value: { text: "Hola", proposals: [], failed: false } });
    expect(calls[0]?.url).toBe(`${API}/v1/agent/chat`);
    expect(new Headers(calls[0]?.init?.headers).get("authorization")).toBe("Bearer tok");
    const sent = JSON.parse(String(calls[0]?.init?.body)) as { messages: { content: string }[] };
    expect(sent.messages).toHaveLength(HISTORY);
    expect(sent.messages.at(-1)?.content).toBe("m14");
    expect(sent.messages.some((m) => m.content.trim() === "")).toBe(false);
  });

  it.each([
    [401, "signed_out"],
    [429, "quota"],
    [503, "unavailable"],
    [500, "unexpected"],
  ])("traduce %i", async (status, kind) => {
    const client = createAssistantClient(API, async () => new Response("{}", { status }));
    expect(await client.chat("tok", [{ role: "user", content: "hola" }])).toMatchObject({
      ok: false,
      error: { kind },
    });
  });

  it("reporta fallas de red, también a mitad de la respuesta", async () => {
    const offline = createAssistantClient(API, () => Promise.reject(new TypeError("offline")));
    expect(await offline.chat("tok", [{ role: "user", content: "hola" }])).toEqual({
      ok: false,
      error: { kind: "network" },
    });
    const cut = createAssistantClient(API, async () => {
      const res = new Response("data: x");
      Object.defineProperty(res, "text", { value: () => Promise.reject(new Error("corte")) });
      return res;
    });
    expect(await cut.chat("tok", [{ role: "user", content: "hola" }])).toMatchObject({
      error: { kind: "network" },
    });
  });

  it("el asistente de e2e siempre propone un presupuesto", async () => {
    const res = await e2eAssistantClient().chat("tok", []);
    expect(res.ok && res.value.proposals[0]?.type).toBe("budget");
  });
});
