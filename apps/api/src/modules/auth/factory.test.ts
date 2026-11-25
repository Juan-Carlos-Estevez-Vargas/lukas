import { afterEach, describe, expect, it, vi } from "vitest";
import type { Env } from "../../env";
import { testEnv } from "../../test/env";
import { DEFAULT_MAIL_FROM, mailerFor, missingMailer, neonAuthFactory } from "./factory";
import { consoleMailer, otpEmail, resendMailer } from "./mailer";

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

describe("elección del mailer", () => {
  it("usa la consola en desarrollo, Resend con llave y si no, ninguno", () => {
    expect(mailerFor({ ...testEnv, ENVIRONMENT: "development", RESEND_API_KEY: "re_x" })).toBe(
      consoleMailer,
    );
    expect(mailerFor({ ...testEnv, ENVIRONMENT: "staging" })).toBe(missingMailer);
    const resend = mailerFor({ ...testEnv, ENVIRONMENT: "staging", RESEND_API_KEY: "re_x" });
    expect(resend).not.toBe(missingMailer);
    expect(resend).not.toBe(consoleMailer);
  });
});

describe("mailer de Resend", () => {
  afterEach(() => vi.restoreAllMocks());

  it("envía el código con el remitente configurado", async () => {
    const calls: { url: string; init?: RequestInit }[] = [];
    const mailer = resendMailer("re_prueba", DEFAULT_MAIL_FROM, async (url, init) => {
      calls.push({ url, ...(init ? { init } : {}) });
      return new Response(JSON.stringify({ id: "1" }), { status: 200 });
    });
    await mailer.sendOtp({ to: "ana@lukas.test", code: "123456", purpose: "sign-in" });
    expect(calls[0]?.url).toBe("https://api.resend.com/emails");
    const headers = new Headers(calls[0]?.init?.headers);
    expect(headers.get("authorization")).toBe("Bearer re_prueba");
    const body = JSON.parse(String(calls[0]?.init?.body)) as Record<string, unknown>;
    expect(body).toMatchObject({
      from: DEFAULT_MAIL_FROM,
      to: ["ana@lukas.test"],
      subject: "Tu código para entrar a Lukas",
    });
    expect(String(body.text)).toContain("123456");
    expect(String(body.html)).toContain("123456");
  });

  it("falla si Resend rechaza el envío, sin registrar el correo ni el código", async () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    const mailer = resendMailer(
      "re_prueba",
      DEFAULT_MAIL_FROM,
      async () => new Response("{}", { status: 403 }),
    );
    await expect(
      mailer.sendOtp({ to: "ana@lukas.test", code: "123456", purpose: "sign-in" }),
    ).rejects.toThrow(/403/);
    const line = String(error.mock.calls[0]?.[0]);
    expect(line).toContain("mail_failed");
    expect(line).not.toContain("ana@lukas.test");
    expect(line).not.toContain("123456");
  });

  it("arma un asunto distinto para cada propósito", () => {
    expect(otpEmail("111111", "email-verification").subject).toMatch(/Confirma tu correo/);
    expect(otpEmail("111111", "change-email").subject).toMatch(/nuevo correo/);
    expect(otpEmail("111111", "forget-password").subject).toMatch(/recuperar/);
  });
});
