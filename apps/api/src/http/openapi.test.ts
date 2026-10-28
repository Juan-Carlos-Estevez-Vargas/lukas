import { createRoute, z } from "@hono/zod-openapi";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createApp } from "../app";
import { testEnv } from "../test/env";
import { createRouter, problemContent } from "./openapi";
import { problemResponse } from "./problem";

describe("validación con Zod", () => {
  afterEach(() => vi.restoreAllMocks());

  const router = createRouter().openapi(
    createRoute({
      method: "get",
      path: "/eco",
      request: {
        query: z.object({ monto: z.string().regex(/^\d+$/), moneda: z.string().length(3) }),
      },
      responses: {
        200: {
          description: "ok",
          content: { "application/json": { schema: z.object({ monto: z.string() }) } },
        },
        400: { description: "inválida", content: problemContent },
      },
    }),
    (c) => c.json({ monto: c.req.valid("query").monto }, 200),
  );
  router.onError((error, c) => problemResponse(c, error));

  it("deja pasar la entrada válida", async () => {
    const res = await router.request("/eco?monto=1500&moneda=COP");
    expect(await res.json()).toEqual({ monto: "1500" });
  });

  it("responde 400 problem+json con los errores por campo", async () => {
    const res = await router.request("/eco?monto=1.5&moneda=CO");
    expect(res.status).toBe(400);
    const body = (await res.json()) as { code: string; errors: { path: string }[] };
    expect(body.code).toBe("validation_failed");
    expect(body.errors.map((e) => e.path).sort()).toEqual(["moneda", "monto"]);
  });
});

describe("GET /v1/openapi.json", () => {
  it("publica el documento OpenAPI 3.1 con las rutas registradas", async () => {
    vi.spyOn(console, "log").mockImplementation(() => {});
    const res = await createApp().request("https://api.test/v1/openapi.json", {}, testEnv);
    expect(res.status).toBe(200);
    const doc = (await res.json()) as {
      openapi: string;
      info: { version: string };
      servers: { url: string }[];
      paths: Record<string, unknown>;
      components: { schemas: Record<string, unknown> };
    };
    expect(doc.openapi).toBe("3.1.0");
    expect(doc.info.version).toBe("0.0.0-test");
    expect(doc.servers[0]?.url).toBe("https://api.test/v1");
    expect(doc.paths).toHaveProperty("/health");
    expect(doc.components.schemas).toHaveProperty("Health");
  });

  it("usa 'dev' como versión si no hay una configurada", async () => {
    vi.spyOn(console, "log").mockImplementation(() => {});
    const res = await createApp().request("/v1/openapi.json", {}, { ENVIRONMENT: "development" });
    expect(((await res.json()) as { info: { version: string } }).info.version).toBe("dev");
  });
});
