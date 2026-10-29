import { afterEach, describe, expect, it, vi } from "vitest";
import { createApp } from "../app";
import type { Env } from "../env";
import { testEnv } from "../test/env";

const env: Env = { ...testEnv, CORS_ORIGINS: "https://lukas.pages.dev, http://localhost:8081" };

describe("cabeceras de seguridad", () => {
  afterEach(() => vi.restoreAllMocks());

  it("agrega CSP, HSTS, nosniff, no-referrer y no-store", async () => {
    vi.spyOn(console, "log").mockImplementation(() => {});
    const res = await createApp().request("/health", {}, env);
    expect(res.headers.get("content-security-policy")).toBe(
      "default-src 'none'; frame-ancestors 'none'",
    );
    expect(res.headers.get("strict-transport-security")).toContain("max-age=63072000");
    expect(res.headers.get("x-content-type-options")).toBe("nosniff");
    expect(res.headers.get("x-frame-options")).toBe("SAMEORIGIN");
    expect(res.headers.get("referrer-policy")).toBe("no-referrer");
    expect(res.headers.get("cache-control")).toBe("no-store");
    expect(res.headers.get("x-powered-by")).toBeNull();
  });

  it("también protege las respuestas de error", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const res = await createApp().request("/no-existe", {}, env);
    expect(res.status).toBe(404);
    expect(res.headers.get("content-security-policy")).toBe(
      "default-src 'none'; frame-ancestors 'none'",
    );
  });

  it("respeta un Cache-Control explícito", async () => {
    vi.spyOn(console, "log").mockImplementation(() => {});
    const app = createApp();
    app.get("/publico", (c) => c.text("ok", 200, { "Cache-Control": "public, max-age=60" }));
    const res = await app.request("/publico", {}, env);
    expect(res.headers.get("cache-control")).toBe("public, max-age=60");
  });
});

describe("CORS cerrado", () => {
  afterEach(() => vi.restoreAllMocks());

  it("permite un origen de la lista, con credenciales", async () => {
    vi.spyOn(console, "log").mockImplementation(() => {});
    const res = await createApp().request(
      "/v1/health",
      { headers: { Origin: "https://lukas.pages.dev" } },
      env,
    );
    expect(res.headers.get("access-control-allow-origin")).toBe("https://lukas.pages.dev");
    expect(res.headers.get("access-control-allow-credentials")).toBe("true");
    expect(res.headers.get("access-control-expose-headers")).toContain("X-Request-Id");
  });

  it("responde el preflight de un origen permitido", async () => {
    vi.spyOn(console, "log").mockImplementation(() => {});
    const res = await createApp().request(
      "/v1/health",
      {
        method: "OPTIONS",
        headers: { Origin: "http://localhost:8081", "Access-Control-Request-Method": "POST" },
      },
      env,
    );
    expect(res.status).toBe(204);
    expect(res.headers.get("access-control-allow-origin")).toBe("http://localhost:8081");
    expect(res.headers.get("access-control-allow-headers")).toContain("Idempotency-Key");
  });

  it.each([
    ["un origen desconocido", env],
    ["cualquier origen si no hay lista", testEnv],
  ])("no devuelve cabeceras CORS para %s", async (_, e) => {
    vi.spyOn(console, "log").mockImplementation(() => {});
    const res = await createApp().request(
      "/v1/health",
      { headers: { Origin: "https://evil.example" } },
      e,
    );
    expect(res.headers.get("access-control-allow-origin")).toBeNull();
  });
});
