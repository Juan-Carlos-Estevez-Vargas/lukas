import { describe, expect, it } from "vitest";
import { cardFixture } from "../accounts/card.test-helper";
import type { DeviceSecurityModule } from "./device-security";
import {
  applyScreenProtection,
  rootSignals,
  screenshotsAllowed,
  setScreenshotsAllowed,
  shouldBlockScreenshots,
} from "./policy";

const fakeModule = (signals: string[] | Error): DeviceSecurityModule & { secure: boolean[] } => {
  const secure: boolean[] = [];
  return {
    secure,
    setSecure: (on) => {
      if (signals instanceof Error) throw signals;
      secure.push(on);
      return true;
    },
    rootSignals: () => {
      if (signals instanceof Error) throw signals;
      return signals;
    },
  };
};

describe("seguridad del teléfono", () => {
  it("las capturas arrancan bloqueadas y la persona puede permitirlas", async () => {
    const { db } = await cardFixture({ closingDay: null, dueDay: null });
    expect(await screenshotsAllowed(db)).toBe(false);
    await setScreenshotsAllowed(db, true);
    expect(await screenshotsAllowed(db)).toBe(true);
    await setScreenshotsAllowed(db, false);
    expect(await screenshotsAllowed(db)).toBe(false);
  });

  it("bloquea salvo que la persona lo permita o sea el build de e2e", () => {
    expect(shouldBlockScreenshots(false, false)).toBe(true);
    expect(shouldBlockScreenshots(true, false)).toBe(false);
    expect(shouldBlockScreenshots(false, true)).toBe(false);
  });

  it("aplica FLAG_SECURE con el módulo y no falla sin él", () => {
    const module = fakeModule([]);
    applyScreenProtection(module, true);
    applyScreenProtection(module, false);
    expect(module.secure).toEqual([true, false]);
    expect(() => applyScreenProtection(null, true)).not.toThrow();
    expect(() => applyScreenProtection(fakeModule(new Error("sin actividad")), true)).not.toThrow();
  });

  it("reporta solo señales de root conocidas y nada si el módulo falla", () => {
    expect(rootSignals(null)).toEqual([]);
    expect(rootSignals(fakeModule([]))).toEqual([]);
    expect(rootSignals(fakeModule(["su-binary", "inventada", "test-keys"]))).toEqual([
      "test-keys",
      "su-binary",
    ]);
    expect(rootSignals(fakeModule(new Error("roto")))).toEqual([]);
  });
});
