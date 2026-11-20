import { describe, expect, it } from "vitest";
import {
  entitlementsOf,
  FEATURES,
  hasFeature,
  isFeature,
  isPlan,
  PLANS,
  PRICES,
  TRIAL_DAYS,
} from "./plans";
import {
  applyBillingEvent,
  type BillingEvent,
  canStartTrial,
  currentEntitlements,
  GRACE_DAYS,
  isEntitled,
  normalizeCouponCode,
  type Subscription,
  trialEndsAt,
} from "./subscription";

const at = (iso: string) => new Date(iso);
const DAY = 86_400_000;

const run = (current: Subscription | undefined, event: BillingEvent) =>
  applyBillingEvent(current, { userId: "u1", provider: "wompi", plan: "premium", event });

const changed = (current: Subscription | undefined, event: BillingEvent): Subscription => {
  const result = run(current, event);
  if (!result.ok || result.value.kind !== "changed") throw new Error("se esperaba un cambio");
  return result.value.subscription;
};

const paid = changed(undefined, {
  type: "payment_succeeded",
  at: at("2026-11-01T00:00:00Z"),
  periodEnd: at("2026-12-01T00:00:00Z"),
});

describe("planes", () => {
  it("premium incluye todo lo del plan gratis y más cuota", () => {
    const free = entitlementsOf("free");
    const premium = entitlementsOf("premium");
    for (const feature of free.features) expect(hasFeature(premium, feature)).toBe(true);
    expect(premium.aiDailyTokens).toBeGreaterThan(free.aiDailyTokens);
    expect(premium.aiDailyRequests).toBeGreaterThan(free.aiDailyRequests);
  });

  it("leer recibos y buscar por significado son premium", () => {
    expect(hasFeature(entitlementsOf("free"), "receiptReading")).toBe(false);
    expect(hasFeature(entitlementsOf("free"), "semanticSearch")).toBe(false);
    expect(hasFeature(entitlementsOf("premium"), "receiptReading")).toBe(true);
    expect(hasFeature(entitlementsOf("premium"), "semanticSearch")).toBe(true);
  });

  it("reconoce planes y funciones válidos", () => {
    expect(PLANS.every(isPlan)).toBe(true);
    expect(FEATURES.every(isFeature)).toBe(true);
    expect(isPlan("gold")).toBe(false);
    expect(isFeature("teleport")).toBe(false);
  });
});

describe("saga de la suscripción", () => {
  it("un pago activa premium hasta el fin del periodo", () => {
    expect(paid).toMatchObject({ status: "active", plan: "premium", provider: "wompi" });
    expect(isEntitled(paid, at("2026-11-30T23:59:59Z"))).toBe(true);
    expect(isEntitled(paid, at("2026-12-01T00:00:00Z"))).toBe(false);
    expect(currentEntitlements(paid, at("2026-11-15T00:00:00Z")).plan).toBe("premium");
    expect(currentEntitlements(paid, at("2026-12-02T00:00:00Z")).plan).toBe("free");
  });

  it("la prueba gratis dura hasta su fin y es solo para quien nunca tuvo premium", () => {
    const trial = changed(undefined, {
      type: "trial_started",
      at: at("2026-11-01T00:00:00Z"),
      endsAt: at("2026-11-15T00:00:00Z"),
    });
    expect(trial.status).toBe("trialing");
    expect(isEntitled(trial, at("2026-11-14T00:00:00Z"))).toBe(true);
    expect(isEntitled(trial, at("2026-11-15T00:00:00Z"))).toBe(false);
    const again = run(paid, {
      type: "trial_started",
      at: at("2026-11-02T00:00:00Z"),
      endsAt: at("2026-11-16T00:00:00Z"),
    });
    expect(again.ok).toBe(false);
  });

  it("un pago fallido deja unos días de gracia", () => {
    const failedAt = at("2026-12-01T00:00:00Z");
    const late = changed(paid, { type: "payment_failed", at: failedAt });
    expect(late.status).toBe("past_due");
    expect(isEntitled(late, new Date(failedAt.getTime() + (GRACE_DAYS * DAY - 1)))).toBe(true);
    expect(isEntitled(late, new Date(failedAt.getTime() + GRACE_DAYS * DAY))).toBe(false);
    const recovered = changed(late, {
      type: "payment_succeeded",
      at: at("2026-12-02T00:00:00Z"),
      periodEnd: at("2027-01-02T00:00:00Z"),
    });
    expect(recovered.status).toBe("active");
  });

  it("cancelar la renovación conserva premium hasta el fin del periodo pagado", () => {
    const canceled = changed(paid, { type: "renewal_canceled", at: at("2026-11-10T00:00:00Z") });
    expect(canceled.status).toBe("canceled");
    expect(canceled.periodEnd).toEqual(paid.periodEnd);
    expect(isEntitled(canceled, at("2026-11-20T00:00:00Z"))).toBe(true);
  });

  it("vencer o reembolsar quita premium de inmediato", () => {
    for (const type of ["expired", "refunded"] as const) {
      const ended = changed(paid, { type, at: at("2026-11-10T00:00:00Z") });
      expect(ended.status).toBe("expired");
      expect(isEntitled(ended, at("2026-11-10T00:00:01Z"))).toBe(false);
    }
  });

  it("ignora eventos más viejos que el último aplicado", () => {
    const result = run(paid, { type: "expired", at: at("2026-10-31T00:00:00Z") });
    expect(result).toEqual({ ok: true, value: { kind: "stale" } });
  });

  it("rechaza eventos que no tienen sentido", () => {
    const now = at("2026-11-01T00:00:00Z");
    const cases: BillingEvent[] = [
      { type: "payment_failed", at: now },
      { type: "renewal_canceled", at: now },
      { type: "expired", at: now },
      { type: "refunded", at: now },
      { type: "payment_succeeded", at: now, periodEnd: now },
      { type: "trial_started", at: now, endsAt: now },
    ];
    for (const event of cases) {
      const result = run(undefined, event);
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.error.code).toBe("billing_invalid_event");
    }
  });

  it("sin suscripción se usa el plan gratis", () => {
    expect(isEntitled(undefined, at("2026-11-01T00:00:00Z"))).toBe(false);
    expect(currentEntitlements(undefined, at("2026-11-01T00:00:00Z"))).toEqual(
      entitlementsOf("free"),
    );
  });
});

describe("prueba gratis, cupones y precios", () => {
  it("la prueba dura 14 días y vence sola", () => {
    const start = at("2026-11-20T12:00:00Z");
    const endsAt = trialEndsAt(start);
    expect(endsAt).toEqual(at("2026-12-04T12:00:00Z"));
    const trial = changed(undefined, { type: "trial_started", at: start, endsAt });
    expect(currentEntitlements(trial, at("2026-12-04T11:59:59Z")).plan).toBe("premium");
    expect(currentEntitlements(trial, at("2026-12-04T12:00:00Z")).plan).toBe("free");
    expect(canStartTrial(undefined)).toBe(true);
    expect(canStartTrial(trial)).toBe(false);
  });

  it("los días regalados se suman a lo vigente o empiezan hoy", () => {
    const extra = changed(paid, { type: "granted", at: at("2026-11-10T00:00:00Z"), days: 30 });
    expect(extra.periodEnd).toEqual(at("2026-12-31T00:00:00Z"));
    expect(extra.status).toBe("active");
    const fresh = changed(undefined, { type: "granted", at: at("2026-11-10T00:00:00Z"), days: 7 });
    expect(fresh.periodEnd).toEqual(at("2026-11-17T00:00:00Z"));
    const lapsed = changed(paid, { type: "granted", at: at("2027-01-01T00:00:00Z"), days: 1 });
    expect(lapsed.periodEnd).toEqual(at("2027-01-02T00:00:00Z"));
    for (const days of [0, 1.5, 367]) {
      expect(run(paid, { type: "granted", at: at("2026-11-10T00:00:00Z"), days }).ok).toBe(false);
    }
  });

  it("normaliza códigos de cupón y rechaza lo que no lo es", () => {
    expect(normalizeCouponCode("  beta-2026 ")).toBe("BETA-2026");
    expect(normalizeCouponCode("ami gos")).toBe("AMIGOS");
    for (const bad of ["", "ab", "-ABC", "ABC-", "CUPÓN", "X".repeat(33)]) {
      expect(normalizeCouponCode(bad)).toBeNull();
    }
  });

  it("los precios están en pesos enteros y el anual es más barato que doce meses", () => {
    const month = PRICES.find((p) => p.period === "month");
    const year = PRICES.find((p) => p.period === "year");
    expect(month?.amount.currencyCode).toBe("COP");
    expect(month && year && year.amount.amountMinor < month.amount.amountMinor * 12n).toBe(true);
    expect(TRIAL_DAYS).toBe(14);
  });
});
