import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { E2E_CODE, e2eAuthClient } from "./e2e-auth-client";

describe("autenticación del build de e2e", () => {
  const client = e2eAuthClient();

  it("pide un correo válido", async () => {
    expect(await client.sendCode("e2e@lukas.test")).toEqual({ ok: true, value: undefined });
    expect(await client.sendCode("nada")).toEqual({ ok: false, error: { kind: "invalid" } });
  });

  it("solo acepta el código fijo y devuelve una sesión que `me` reconoce", async () => {
    expect((await client.verifyCode("e2e@lukas.test", "000000")).ok).toBe(false);
    const res = await client.verifyCode("e2e@lukas.test", E2E_CODE);
    if (!res.ok) throw new Error("debía entrar");
    expect(await client.me(res.value)).toEqual({
      ok: true,
      value: { userId: "e2e-user", sessionId: "e2e-session" },
    });
    expect(await client.me("otro")).toEqual({ ok: true, value: null });
    expect(await client.signOut(res.value)).toEqual({ ok: true, value: undefined });
  });

  it("ningún perfil de EAS activa el modo e2e", () => {
    const eas = readFileSync(new URL("../../eas.json", import.meta.url), "utf8");
    expect(eas).not.toContain("EXPO_PUBLIC_E2E");
  });
});
