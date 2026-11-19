import { Hono } from "hono";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createApp } from "../app";
import type { AppContext, Env } from "../env";
import { testEnv } from "../test/env";
import { fakeRateLimiter } from "../test/rate-limiter";
import { rateLimit } from "./rate-limit";

// Sin autenticación configurada Better Auth responde 503, pero el limitador actúa antes.
const appWithLogin = () => createApp({ auth: () => undefined });
const LOGIN = "/v1/auth/sign-in/email-otp";

const quiet = () => {
  vi.spyOn(console, "log").mockImplementation(() => {});
  vi.spyOn(console, "warn").mockImplementation(() => {});
  vi.spyOn(console, "error").mockImplementation(() => {});
};

describe("rate limiting", () => {
  afterEach(() => vi.restoreAllMocks());

  it("el intento 6 de login en un minuto recibe 429 con Retry-After", async () => {
    quiet();
    const env: Env = {
      ...testEnv,
      API_LIMITER: fakeRateLimiter(100),
      AUTH_LIMITER: fakeRateLimiter(5),
    };
    const app = appWithLogin();
    const login = () =>
      app.request(LOGIN, { method: "POST", headers: { "cf-connecting-ip": "203.0.113.7" } }, env);

    for (let i = 0; i < 5; i++) expect((await login()).status).toBe(503);
    const blocked = await login();
    expect(blocked.status).toBe(429);
    expect(blocked.headers.get("retry-after")).toBe("60");
    expect(blocked.headers.get("content-type")).toBe("application/problem+json");
    expect(await blocked.json()).toMatchObject({ code: "rate_limited" });
  });

  it("cuenta por IP: otra IP no queda bloqueada", async () => {
    quiet();
    const env: Env = {
      ...testEnv,
      API_LIMITER: fakeRateLimiter(100),
      AUTH_LIMITER: fakeRateLimiter(1),
    };
    const app = appWithLogin();
    const from = (ip: string) =>
      app.request(LOGIN, { method: "POST", headers: { "cf-connecting-ip": ip } }, env);
    expect((await from("203.0.113.1")).status).toBe(503);
    expect((await from("203.0.113.1")).status).toBe(429);
    expect((await from("203.0.113.2")).status).toBe(503);
  });

  it("aplica el límite general a /v1 pero no a /health de la raíz", async () => {
    quiet();
    const api = fakeRateLimiter(2);
    const env: Env = { ...testEnv, API_LIMITER: api, AUTH_LIMITER: fakeRateLimiter(5) };
    const app = createApp();
    for (let i = 0; i < 5; i++) expect((await app.request("/health", {}, env)).status).toBe(200);
    expect((await app.request("/v1/health", {}, env)).status).toBe(200);
    expect((await app.request("/v1/health", {}, env)).status).toBe(200);
    expect((await app.request("/v1/health", {}, env)).status).toBe(429);
    expect(api.keys).toEqual(["ip:desconocida", "ip:desconocida", "ip:desconocida"]);
  });

  it("usa el usuario como clave cuando hay sesión", async () => {
    const api = fakeRateLimiter(100);
    const app = new Hono<AppContext>()
      .use(async (c, next) => {
        c.set("userId", "usr_1");
        await next();
      })
      .use(rateLimit("API_LIMITER", 10))
      .get("/x", (c) => c.text("ok"));
    await app.request(
      "/x",
      { headers: { "cf-connecting-ip": "203.0.113.9" } },
      { ...testEnv, API_LIMITER: api },
    );
    expect(api.keys).toEqual(["u:usr_1"]);
  });

  it("en desarrollo funciona sin binding y en otros entornos falla cerrado", async () => {
    quiet();
    const app = createApp();
    expect((await app.request("/v1/health", {}, testEnv)).status).toBe(200);
    expect((await app.request("/v1/health", {}, { ENVIRONMENT: "staging" })).status).toBe(500);
  });
});
