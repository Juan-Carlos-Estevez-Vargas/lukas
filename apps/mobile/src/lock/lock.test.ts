/// <reference types="node" />
import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { checkPin, constantTimeEqual, createPinRecord, verifyPin } from "./pin";
import {
  FREE_ATTEMPTS,
  NO_LOCKOUT,
  parseLockout,
  registerFailure,
  shouldLockOnResume,
  waitMs,
} from "./policy";

const sha256 = async (text: string) => createHash("sha256").update(text).digest("hex");

describe("PIN", () => {
  it.each([
    ["2580", null],
    ["739164", null],
    ["123", "length"],
    ["1234567", "length"],
    ["12a4", "digits"],
    ["1111", "repeated"],
    ["1234", "sequence"],
    ["987654", "sequence"],
    ["9012", "sequence"],
  ])("%s → %s", (pin, problem) => {
    expect(checkPin(pin)).toBe(problem);
  });

  it("guarda solo el hash con sal y verifica el PIN correcto", async () => {
    const record = await createPinRecord("2580", "sal", sha256);
    expect(record.hash).toMatch(/^[0-9a-f]{64}$/);
    expect(record.hash).not.toContain("2580");
    expect(await verifyPin("2580", record, sha256)).toBe(true);
    expect(await verifyPin("2581", record, sha256)).toBe(false);
  });

  it("la misma clave con otra sal da otro hash", async () => {
    const a = await createPinRecord("2580", "a", sha256);
    const b = await createPinRecord("2580", "b", sha256);
    expect(a.hash).not.toBe(b.hash);
  });

  it("no crea un registro con un PIN débil", async () => {
    await expect(createPinRecord("1111", "s", sha256)).rejects.toThrow(/repeated/);
  });

  it("compara en tiempo constante", () => {
    expect(constantTimeEqual("abc", "abc")).toBe(true);
    expect(constantTimeEqual("abc", "abd")).toBe(false);
    expect(constantTimeEqual("abc", "ab")).toBe(false);
  });
});

describe("bloqueo progresivo", () => {
  it("deja intentar libremente y luego duplica la espera hasta 15 minutos", () => {
    let state = NO_LOCKOUT;
    for (let i = 1; i < FREE_ATTEMPTS; i++) {
      state = registerFailure(state, 0);
      expect(waitMs(state, 0)).toBe(0);
    }
    const waits: number[] = [];
    for (let i = 0; i < 8; i++) {
      state = registerFailure(state, 0);
      waits.push(waitMs(state, 0));
    }
    expect(waits).toEqual([30_000, 60_000, 120_000, 240_000, 480_000, 900_000, 900_000, 900_000]);
    expect(waitMs(state, 900_000)).toBe(0);
  });

  it("bloquea al volver si pasó el tiempo en segundo plano", () => {
    expect(shouldLockOnResume(null, 10_000, 60_000)).toBe(false);
    expect(shouldLockOnResume(0, 59_999, 60_000)).toBe(false);
    expect(shouldLockOnResume(0, 60_000, 60_000)).toBe(true);
  });

  it("lee el estado guardado y trata uno dañado como sospechoso", () => {
    expect(parseLockout(null)).toEqual(NO_LOCKOUT);
    expect(parseLockout('{"failures":2,"lockedUntil":0}')).toEqual({ failures: 2, lockedUntil: 0 });
    expect(parseLockout("{roto")).toEqual({ failures: FREE_ATTEMPTS, lockedUntil: 0 });
    expect(parseLockout('{"failures":-1}')).toEqual({ failures: FREE_ATTEMPTS, lockedUntil: 0 });
  });
});
