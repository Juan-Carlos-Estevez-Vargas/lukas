import { DomainError, uuidv7 } from "@lukas/domain";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createApp } from "../app";
import { testEnv } from "../test/env";
import { HttpProblem } from "./problem";

const appWithFailures = () => {
  const app = createApp();
  app.get("/boom/http", () => {
    throw new HttpProblem(409, "conflict", "Conflicto de versión", "La versión cambió", [
      { path: "version", message: "desactualizada" },
    ]);
  });
  app.get("/boom/title-only", () => {
    throw new HttpProblem(403, "forbidden", "Prohibido");
  });
  app.get("/boom/domain", () => {
    throw new DomainError("currency_mismatch", "No se pueden operar COP y USD");
  });
  app.get("/boom/unknown", () => {
    throw new Error("secreto interno con datos");
  });
  return app;
};

describe("errores RFC 9457", () => {
  afterEach(() => vi.restoreAllMocks());

  it("responde 404 como problem+json con requestId", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const res = await createApp().request("/no-existe", {}, testEnv);
    expect(res.status).toBe(404);
    expect(res.headers.get("content-type")).toBe("application/problem+json");
    const body = (await res.json()) as { requestId?: string };
    expect(body).toMatchObject({ status: 404, code: "not_found", instance: "/no-existe" });
    expect(body.requestId).toBe(res.headers.get("x-request-id"));
  });

  it("traduce HttpProblem con detalle y errores de campo", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    vi.spyOn(console, "error").mockImplementation(() => {});
    const app = appWithFailures();
    const res = await app.request("/boom/http", {}, testEnv);
    expect(res.status).toBe(409);
    expect(await res.json()).toMatchObject({
      type: "https://lukas.app/problems/conflict",
      title: "Conflicto de versión",
      detail: "La versión cambió",
      errors: [{ path: "version", message: "desactualizada" }],
    });
    const titleOnly = await (await app.request("/boom/title-only", {}, testEnv)).json();
    expect(titleOnly).not.toHaveProperty("detail");
  });

  it("traduce DomainError a 422 con su código", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    vi.spyOn(console, "error").mockImplementation(() => {});
    const res = await appWithFailures().request("/boom/domain", {}, testEnv);
    expect(res.status).toBe(422);
    expect(await res.json()).toMatchObject({ code: "currency_mismatch" });
  });

  it("oculta el mensaje de errores inesperados y los registra", async () => {
    const errorLog = vi.spyOn(console, "error").mockImplementation(() => {});
    const res = await appWithFailures().request("/boom/unknown", {}, testEnv);
    expect(res.status).toBe(500);
    const body = await res.json();
    expect(body).toMatchObject({ code: "internal_error", title: "Error interno" });
    expect(JSON.stringify(body)).not.toContain("secreto");
    expect(errorLog).toHaveBeenCalled();
  });
});

describe("contexto de petición", () => {
  afterEach(() => vi.restoreAllMocks());

  it("genera un X-Request-Id y registra la petición en JSON sin query string", async () => {
    const info = vi.spyOn(console, "log").mockImplementation(() => {});
    const res = await createApp().request("/health?token=abc", {}, testEnv);
    const id = res.headers.get("x-request-id");
    expect(id).toMatch(/^[0-9a-f-]{36}$/);
    const line = JSON.parse(String(info.mock.calls[0]?.[0]));
    expect(line).toMatchObject({ level: "info", message: "request", path: "/health", status: 200 });
    expect(JSON.stringify(line)).not.toContain("token");
  });

  it("respeta un X-Request-Id entrante válido y reemplaza uno inválido", async () => {
    vi.spyOn(console, "log").mockImplementation(() => {});
    const valid = uuidv7();
    const kept = await createApp().request(
      "/health",
      { headers: { "x-request-id": valid } },
      testEnv,
    );
    expect(kept.headers.get("x-request-id")).toBe(valid);
    const replaced = await createApp().request(
      "/health",
      { headers: { "x-request-id": "<script>" } },
      testEnv,
    );
    expect(replaced.headers.get("x-request-id")).not.toBe("<script>");
  });
});
