import { describe, expect, it } from "vitest";
import { createApp } from "../../app";
import { testEnv } from "../../test/env";

describe("GET /health", () => {
  const app = createApp();

  it.each(["/health", "/v1/health"])("%s responde con el estado del servicio", async (path) => {
    const res = await app.request(path, {}, testEnv);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      status: "ok",
      environment: "development",
      version: "0.0.0-test",
    });
  });

  it("usa 'dev' si no hay versión configurada", async () => {
    const res = await app.request("/health", {}, { ENVIRONMENT: "preview" });
    expect(await res.json()).toMatchObject({ version: "dev" });
  });
});
