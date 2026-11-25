import { describe, expect, it, vi } from "vitest";
import { noStore, periodOf, sortPackages, waitForPremium } from "./store";
import { storePurchases } from "./store-purchases";

describe("tienda de Android", () => {
  it("en web y pruebas no hay tienda", async () => {
    expect(storePurchases).toBe(noStore);
    expect(noStore.available).toBe(false);
    await expect(noStore.connect("u1")).resolves.toBeUndefined();
    expect(await noStore.packages()).toEqual([]);
    expect(await noStore.purchase("x")).toBe("failed");
    expect(await noStore.restore()).toBe("failed");
  });

  it("traduce y ordena los paquetes", () => {
    expect(periodOf("MONTHLY")).toBe("month");
    expect(periodOf("ANNUAL")).toBe("year");
    expect(periodOf("LIFETIME")).toBe("other");
    expect(
      sortPackages([
        { id: "y", priceText: "$149.000", period: "year" },
        { id: "l", priceText: "$999.000", period: "other" },
        { id: "m", priceText: "$14.900", period: "month" },
      ]).map((p) => p.id),
    ).toEqual(["m", "y"]);
  });

  it("espera a que el webhook active premium, con un límite", async () => {
    const sleep = vi.fn(async () => undefined);
    const answers = [false, false, true];
    expect(await waitForPremium(async () => answers.shift() ?? false, { sleep })).toBe(true);
    expect(sleep).toHaveBeenCalledTimes(2);
    sleep.mockClear();
    expect(await waitForPremium(async () => false, { tries: 3, sleep })).toBe(false);
    expect(sleep).toHaveBeenCalledTimes(2);
  });
});
