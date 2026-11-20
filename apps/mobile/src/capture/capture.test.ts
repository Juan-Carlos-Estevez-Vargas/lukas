import { describe, expect, it } from "vitest";
import { createFromTemplate, editAccount } from "../accounts/accounts";
import { cardFixture, cop, local } from "../accounts/card.test-helper";
import { templateByKey } from "../accounts/templates";
import { recordMovement } from "../movements/movements";
import {
  acceptCapture,
  dismissCapture,
  inbox,
  ingestCapture,
  linkCapture,
  matchAccount,
  pendingCount,
} from "./ingest";
import {
  cleanMerchant,
  findLast4,
  fingerprint,
  normalizeCapture,
  type RawCapture,
  sameMovement,
  similarMerchants,
} from "./normalize";

const at = (h: number, m: number, day = 5) => new Date(2026, 10, day, h, m);

const notification = (over: Partial<RawCapture> = {}): RawCapture => ({
  source: "notification",
  app: "com.todo1.mobile",
  receivedAt: at(13, 2),
  amount: "$ 45.900",
  merchant: "Compra en RAPPI*RESTAURANTE",
  text: "Bancolombia: Compraste $45.900 en RAPPI*RESTAURANTE con tu T.Deb *1234",
  ...over,
});

const email = (over: Partial<RawCapture> = {}): RawCapture => ({
  source: "email",
  app: "alertas@bancolombia.com.co",
  receivedAt: at(13, 9),
  occurredAt: at(13, 1),
  amount: "45900.00",
  merchant: "Rappi",
  last4: "1234",
  ...over,
});

describe("normalización", () => {
  it("limpia comercios y encuentra la tarjeta", () => {
    expect(cleanMerchant("Compra en RAPPI*RESTAURANTE.")).toBe("Rappi*Restaurante");
    expect(cleanMerchant("  Pagaste a   Juan  ")).toBe("Juan");
    expect(cleanMerchant("Pago en Tiendas Ara")).toBe("Tiendas Ara");
    expect(cleanMerchant("EXITO CALLE 80")).toBe("Exito Calle 80");
    expect(cleanMerchant("1234")).toBeNull();
    expect(cleanMerchant(null)).toBeNull();
    expect(findLast4("con tu T.Deb *1234")).toBe("1234");
    expect(findLast4("Tarjeta terminada en 9876.")).toBe("9876");
    expect(findLast4("cuenta **** 4321")).toBe("4321");
    expect(findLast4("sin número")).toBeNull();
  });

  it("deduce tipo, monto positivo y hora", () => {
    const c = normalizeCapture(notification());
    expect(c?.amount.toDecimalString()).toBe("45900.00");
    expect(c?.kind).toBe("expense");
    expect(c?.last4).toBe("1234");
    expect(c?.occurredAt).toEqual(at(13, 2));
    expect(normalizeCapture(notification({ amount: "-12.000" }))?.kind).toBe("expense");
    const income = normalizeCapture(
      notification({ amount: "50.000", text: "Recibiste $50.000 de PEDRO", merchant: null }),
    );
    expect(income?.kind).toBe("income");
    expect(normalizeCapture(notification({ amount: "gratis" }))).toBeNull();
    expect(normalizeCapture(notification({ amount: "0" }))).toBeNull();
    expect(normalizeCapture(notification({ amount: cop(5n), currency: "USD" }))).toBeNull();
  });

  it("reconoce la misma compra por dos vías y no confunde otras", () => {
    const a = normalizeCapture(notification());
    const b = normalizeCapture(email());
    if (!a || !b) throw new Error("no normalizó");
    expect(fingerprint(a)).toBe(fingerprint(b));
    expect(sameMovement(a, b)).toBe(true);
    const later = normalizeCapture(email({ occurredAt: at(13, 30) }));
    const otherCard = normalizeCapture(email({ last4: "9999" }));
    const otherAmount = normalizeCapture(email({ amount: "45901" }));
    if (!later || !otherCard || !otherAmount) throw new Error("no normalizó");
    expect(sameMovement(a, later)).toBe(false);
    expect(sameMovement(a, otherCard)).toBe(false);
    expect(sameMovement(a, otherAmount)).toBe(false);
    const statement = normalizeCapture({ ...email(), source: "statement", occurredAt: at(0, 0) });
    if (!statement) throw new Error("no normalizó");
    expect(sameMovement(a, statement)).toBe(true);
    expect(similarMerchants("Éxito Calle 80", "exito")).toBe(true);
    expect(similarMerchants("Éxito", "Carulla")).toBe(false);
    expect(similarMerchants(null, "Carulla")).toBe(true);
  });
});

async function setup() {
  const fx = await cardFixture({ closingDay: 15, dueDay: 2 });
  const tpl = templateByKey("bancolombia");
  if (!tpl) throw new Error("falta la plantilla");
  const acc = await createFromTemplate(fx.db, tpl, {}, fx.clock);
  if (!acc.ok) throw acc.error;
  return { ...fx, accountId: acc.value.id };
}

describe("pipeline", () => {
  it("la misma compra capturada por dos vías aparece una vez", async () => {
    const fx = await setup();
    const first = await ingestCapture(fx.db, notification(), fx.clock);
    const second = await ingestCapture(fx.db, email(), fx.clock);
    expect(first?.status).toBe("pending");
    expect(second?.status).toBe("duplicate");
    expect(await pendingCount(fx.db)).toBe(1);
    // Una tercera vía (extracto) días después tampoco la repite.
    const third = await ingestCapture(
      fx.db,
      { ...email(), source: "statement", occurredAt: at(0, 0) },
      fx.clock,
    );
    expect(third?.status).toBe("duplicate");
    expect(await ingestCapture(fx.db, notification({ amount: "nada" }), fx.clock)).toBeNull();
  });

  it("asocia la cuenta por los 4 dígitos o por el banco de la app", async () => {
    const fx = await setup();
    const c = normalizeCapture(notification());
    if (!c) throw new Error("no normalizó");
    // Sin 4 dígitos registrados, la única cuenta Bancolombia sirve.
    expect(await matchAccount(fx.db, c)).toBe(fx.accountId);
    expect(await matchAccount(fx.db, { ...c, app: "otra.app", last4: null })).toBeNull();
    await editAccount(fx.db, fx.accountId, { last4: "1234" }, fx.clock.now());
    expect(await matchAccount(fx.db, { ...c, app: null })).toBe(fx.accountId);
    expect(await matchAccount(fx.db, { ...c, app: null, last4: "0000" })).toBeNull();
  });

  it("aceptar crea el movimiento; descartar y 'ya estaba' no", async () => {
    const fx = await setup();
    const manual = await recordMovement(
      fx.db,
      {
        kind: "expense",
        accountId: fx.accountId,
        categoryId: "default.mercado",
        amount: cop(20_000n),
        occurredAt: local(2026, 11, 5, 9),
        merchant: "Éxito",
      },
      fx.clock,
    );
    if (!manual.ok) throw manual.error;
    const a = await ingestCapture(fx.db, notification(), fx.clock);
    const b = await ingestCapture(
      fx.db,
      notification({ amount: "20.000", merchant: "Éxito", receivedAt: at(10, 0) }),
      fx.clock,
    );
    const c = await ingestCapture(
      fx.db,
      notification({ amount: "7.000", merchant: "Tinto", receivedAt: at(11, 0) }),
      fx.clock,
    );
    if (!a || !b || !c) throw new Error("sin captura");
    const items = await inbox(fx.db);
    expect(items.map((i) => i.merchant)).toEqual(["Rappi*Restaurante", "Tinto", "Éxito"]);
    const exito = items.find((i) => i.id === b.id);
    expect(exito?.matchTransactionId).toBe(manual.value.id);
    expect(exito?.categoryId).toBe("default.mercado");

    expect(await linkCapture(fx.db, b.id)).toBe(true);
    expect(await linkCapture(fx.db, a.id)).toBe(false);
    expect(await dismissCapture(fx.db, c.id)).toBe(true);
    expect(await dismissCapture(fx.db, c.id)).toBe(false);
    const accepted = await acceptCapture(fx.db, a.id, { accountId: fx.accountId }, fx.clock);
    expect(accepted.ok).toBe(true);
    expect((await acceptCapture(fx.db, a.id, { accountId: fx.accountId }, fx.clock)).ok).toBe(
      false,
    );
    expect(await pendingCount(fx.db)).toBe(0);
    const tx = await fx.db.get<{ source: string; merchant: string }>(
      "SELECT source, merchant FROM transactions WHERE id = ?",
      accepted.ok ? accepted.value : "",
    );
    expect(tx).toEqual({ source: "notification", merchant: "Rappi*Restaurante" });
    // Llega el correo de la compra ya aceptada: no vuelve a la bandeja.
    expect((await ingestCapture(fx.db, email(), fx.clock))?.status).toBe("duplicate");
  });

  it("si la cuenta no sirve, no acepta", async () => {
    const fx = await setup();
    const a = await ingestCapture(fx.db, notification(), fx.clock);
    if (!a) throw new Error("sin captura");
    const res = await acceptCapture(fx.db, a.id, { accountId: "no-existe" }, fx.clock);
    expect(res.ok).toBe(false);
    expect(await pendingCount(fx.db)).toBe(1);
  });
});
