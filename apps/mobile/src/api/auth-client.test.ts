import { describe, expect, it } from "vitest";
import { createAuthClient, isSixDigitCode, looksLikeEmail } from "./auth-client";

type Call = { url: string; init: RequestInit | undefined };

const fakeFetch = (respond: (call: Call) => Response | Promise<Response>) => {
  const calls: Call[] = [];
  const impl = async (url: string, init?: RequestInit) => {
    const call = { url, init };
    calls.push(call);
    return respond(call);
  };
  return { impl, calls };
};

const API = "https://api.lukas.test";

describe("cliente de autenticación", () => {
  it("pide el código de inicio de sesión", async () => {
    const { impl, calls } = fakeFetch(() => new Response("{}", { status: 200 }));
    const result = await createAuthClient(API, impl).sendCode("ana@lukas.co");
    expect(result).toEqual({ ok: true, value: undefined });
    expect(calls[0]?.url).toBe(`${API}/v1/auth/email-otp/send-verification-otp`);
    expect(JSON.parse(String(calls[0]?.init?.body))).toEqual({
      email: "ana@lukas.co",
      type: "sign-in",
    });
  });

  it("devuelve el token bearer al verificar el código", async () => {
    const { impl } = fakeFetch(
      () => new Response("{}", { status: 200, headers: { "set-auth-token": "tok.firma" } }),
    );
    expect(await createAuthClient(API, impl).verifyCode("ana@lukas.co", "123456")).toEqual({
      ok: true,
      value: "tok.firma",
    });
  });

  it("trata una respuesta sin token como inesperada", async () => {
    const { impl } = fakeFetch(() => new Response("{}", { status: 200 }));
    expect(await createAuthClient(API, impl).verifyCode("a@b.co", "123456")).toEqual({
      ok: false,
      error: { kind: "unexpected", status: 200 },
    });
  });

  it("traduce un código inválido y el rate limit con Retry-After", async () => {
    const invalid = fakeFetch(() => new Response("{}", { status: 400 }));
    expect(await createAuthClient(API, invalid.impl).verifyCode("a@b.co", "000000")).toEqual({
      ok: false,
      error: { kind: "invalid" },
    });
    const limited = fakeFetch(
      () => new Response("{}", { status: 429, headers: { "retry-after": "60" } }),
    );
    expect(await createAuthClient(API, limited.impl).sendCode("a@b.co")).toEqual({
      ok: false,
      error: { kind: "rate_limited", retryAfterSeconds: 60 },
    });
    const noHeader = fakeFetch(() => new Response("{}", { status: 429 }));
    expect(await createAuthClient(API, noHeader.impl).sendCode("a@b.co")).toMatchObject({
      error: { retryAfterSeconds: 60 },
    });
  });

  it("reporta fallas de red y errores del servidor", async () => {
    const offline = fakeFetch(() => Promise.reject(new TypeError("Network request failed")));
    expect(await createAuthClient(API, offline.impl).sendCode("a@b.co")).toEqual({
      ok: false,
      error: { kind: "network" },
    });
    const broken = fakeFetch(() => new Response("{}", { status: 503 }));
    expect(await createAuthClient(API, broken.impl).signOut("tok")).toEqual({
      ok: false,
      error: { kind: "unexpected", status: 503 },
    });
  });

  it("consulta la sesión con bearer y trata la sesión vencida como ausencia de usuario", async () => {
    const valid = fakeFetch(() => Response.json({ userId: "u1", sessionId: "s1" }));
    const client = createAuthClient(API, valid.impl);
    expect(await client.me("tok")).toEqual({ ok: true, value: { userId: "u1", sessionId: "s1" } });
    expect(new Headers(valid.calls[0]?.init?.headers).get("authorization")).toBe("Bearer tok");

    const expired = fakeFetch(() => new Response("{}", { status: 401 }));
    expect(await createAuthClient(API, expired.impl).me("tok")).toEqual({ ok: true, value: null });
    const down = fakeFetch(() => new Response("{}", { status: 500 }));
    expect(await createAuthClient(API, down.impl).me("tok")).toMatchObject({ ok: false });
  });

  it("cierra la sesión enviando el bearer", async () => {
    const { impl, calls } = fakeFetch(() => new Response("{}", { status: 200 }));
    expect(await createAuthClient(API, impl).signOut("tok")).toEqual({
      ok: true,
      value: undefined,
    });
    expect(calls[0]?.url).toBe(`${API}/v1/auth/sign-out`);
    expect(new Headers(calls[0]?.init?.headers).get("authorization")).toBe("Bearer tok");
  });
});

describe("validaciones locales", () => {
  it.each([
    ["ana@lukas.co", true],
    ["  ana@lukas.co ", true],
    ["ana@lukas", false],
    ["ana lukas@x.co", false],
    ["", false],
  ])("correo %j → %s", (value, expected) => {
    expect(looksLikeEmail(value)).toBe(expected);
  });

  it.each([
    ["123456", true],
    ["12345", false],
    ["12345a", false],
  ])("código %j → %s", (value, expected) => {
    expect(isSixDigitCode(value)).toBe(expected);
  });
});
