import { afterEach, describe, expect, it, vi } from "vitest";
import type { Env } from "../../env";
import { testEnv } from "../../test/env";
import { missingMailer, neonAuthFactory } from "./factory";
import { consoleMailer } from "./mailer";

const configured = (overrides: Partial<Env> = {}): Env => ({
  ...testEnv,
  DATABASE_URL: "postgresql://lukas:clave@ep-prueba.us-east-1.aws.neon.tech/lukas",
  BETTER_AUTH_SECRET: "secreto-de-pruebas-con-mas-de-32-caracteres",
  ...overrides,
});

describe("fábrica de autenticación", () => {
  afterEach(() => vi.restoreAllMocks());

  it("no crea nada si faltan la base de datos o el secreto", () => {
    expect(neonAuthFactory(testEnv)).toBeUndefined();
    expect(neonAuthFactory({ ...testEnv, DATABASE_URL: "postgresql://x" })).toBeUndefined();
  });

  it("reutiliza la instancia del mismo entorno", () => {
    const env = configured();
    const first = neonAuthFactory(env);
    expect(first).toBeDefined();
    expect(neonAuthFactory(env)).toBe(first);
    expect(neonAuthFactory(configured())).not.toBe(first);
  });

  it("fuera de desarrollo usa un mailer que se niega a enviar códigos", async () => {
    await expect(
      missingMailer.sendOtp({ to: "ana@lukas.test", code: "123456", purpose: "sign-in" }),
    ).rejects.toThrow(/proveedor de correo/);
  });
});

describe("mailer de consola", () => {
  afterEach(() => vi.restoreAllMocks());

  it("registra el código en desarrollo", async () => {
    const info = vi.spyOn(console, "log").mockImplementation(() => {});
    await consoleMailer.sendOtp({ to: "ana@lukas.test", code: "123456", purpose: "sign-in" });
    expect(JSON.parse(String(info.mock.calls[0]?.[0]))).toMatchObject({
      message: "dev_otp",
      code: "123456",
    });
  });
});
