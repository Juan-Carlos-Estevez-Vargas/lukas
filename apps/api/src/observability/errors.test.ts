import { describe, expect, it, vi } from "vitest";
import { createApp } from "../app";
import type { Env } from "../env";
import { testEnv } from "../test/env";
import { type ErrorReporter, sentryReporter } from "./errors";

const DSN = "https://llave@o1.ingest.sentry.io/42";

describe("reporte de errores a Sentry", () => {
  it("sin DSN no reporta", () => {
    expect(sentryReporter()({ ...testEnv, SENTRY_DSN: "" })).toBeUndefined();
    expect(sentryReporter()({ ...testEnv, SENTRY_DSN: "no-es-un-dsn" })).toBeUndefined();
  });

  it("manda el sobre limpio y no falla si Sentry no responde", async () => {
    const fetchImpl = vi.fn(async () => new Response(null, { status: 200 }));
    const report = sentryReporter(fetchImpl)({ ...testEnv, SENTRY_DSN: DSN, APP_VERSION: "0.5.0" });
    await report?.(new Error("falló con ana@lukas.co"), { where: "POST /v1/x", requestId: "r1" });
    const [url, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("https://o1.ingest.sentry.io/api/42/envelope/");
    expect(init.headers).toMatchObject({
      "X-Sentry-Auth": "Sentry sentry_version=7, sentry_key=llave, sentry_client=lukas-api/0.5.0",
    });
    expect(String(init.body)).toContain("[correo]");
    expect(String(init.body)).not.toContain("ana@");

    const down = sentryReporter(async () => {
      throw new TypeError("sin red");
    })({ ...testEnv, SENTRY_DSN: DSN });
    await expect(down?.(new Error("x"), { where: "GET /" })).resolves.toBeUndefined();
  });

  it("la API reporta los 5xx con la ruta y no los 4xx", async () => {
    const seen: { error: unknown; where: string; requestId?: string }[] = [];
    const reporter: ErrorReporter = async (error, ctx) => void seen.push({ error, ...ctx });
    const app = createApp({ errors: () => reporter });
    const env: Env = { ...testEnv };
    const res = await app.request("http://localhost/v1/nada", {}, env);
    expect(res.status).toBe(404);
    expect(seen).toHaveLength(0);

    const app500 = createApp({
      errors: () => reporter,
      rates: () => {
        throw new Error("base caída");
      },
    });
    const fail = await app500.request("http://localhost/v1/rates/usd-cop", {}, env);
    expect(fail.status).toBe(500);
    expect(seen).toHaveLength(1);
    expect(seen[0]?.where).toMatch(/^GET \/v1\/rates/);
    expect(seen[0]?.requestId).toBeTruthy();
  });
});
