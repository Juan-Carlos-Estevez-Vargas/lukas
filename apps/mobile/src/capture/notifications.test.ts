import { describe, expect, it } from "vitest";
import { cardFixture } from "../accounts/card.test-helper";
import { CAPTURE_APPS, isCaptureApp } from "./apps";
import { ingestNotifications } from "./from-notifications";
import { inbox } from "./ingest";
import { normalizeCapture } from "./normalize";
import { type PostedNotification, parseNotification } from "./notification";

const posted = (text: string, over: Partial<PostedNotification> = {}): PostedNotification => ({
  id: text,
  app: "com.nequi.MobileApp",
  title: "Nequi",
  text,
  postedAt: new Date(2026, 10, 5, 13, 2).getTime(),
  ...over,
});

const read = (text: string, over: Partial<PostedNotification> = {}) => {
  const raw = parseNotification(posted(text, over));
  return raw ? normalizeCapture(raw) : null;
};

describe("avisos del banco", () => {
  it("lee monto, tipo y comercio de un pago", () => {
    const c = read("Pagaste $23.450 en TIENDAS ARA");
    expect(c?.amount.toDecimalString()).toBe("23450.00");
    expect(c?.kind).toBe("expense");
    expect(c?.merchant).toBe("Tiendas Ara");
    expect(c?.app).toBe("com.nequi.MobileApp");
    expect(c?.occurredAt.getHours()).toBe(13);
  });

  it("reconoce ingresos, decimales y la tarjeta", () => {
    const income = read("Recibiste $1.250.000,50 de EMPRESA SAS");
    expect(income?.kind).toBe("income");
    expect(income?.amount.toDecimalString()).toBe("1250000.50");
    const card = read("Compra aprobada en EXITO CALLE 80 por COP 45.900 con tu tarjeta *1234.", {
      app: "com.todo1.mobile",
      title: "Bancolombia",
    });
    expect(card?.merchant).toBe("Exito Calle 80");
    expect(card?.amount.toDecimalString()).toBe("45900.00");
    expect(card?.last4).toBe("1234");
    expect(read("Te enviaron 50.000 pesos")?.kind).toBe("income");
  });

  it("ignora lo que no es un movimiento", () => {
    expect(read("Tu código de seguridad para el pago es 123456")).toBeNull();
    expect(read("¡Gana 20% de descuento en tu próxima compra de $50.000!")).toBeNull();
    expect(read("Tu factura vence mañana")).toBeNull();
    expect(read("Pagaste en TIENDAS ARA")).toBeNull();
  });

  it("solo conoce las apps de la lista", () => {
    expect(CAPTURE_APPS.length).toBeGreaterThan(0);
    expect(isCaptureApp("com.nequi.MobileApp")).toBe(true);
    expect(isCaptureApp("com.whatsapp")).toBe(false);
  });

  it("un pago con Nequi llega a la bandeja una sola vez", async () => {
    const fx = await cardFixture({ closingDay: 15, dueDay: 2 });
    const pay = posted("Pagaste $23.450 en TIENDAS ARA");
    const first = await ingestNotifications(
      fx.db,
      [pay, posted("Tu código es 9876"), posted("Pagaste $9.000 en OTRA", { app: "com.whatsapp" })],
      fx.clock,
    );
    expect(first).toEqual({ added: 1, ignored: 2 });
    // Android puede repetir el mismo aviso; la huella lo deja como duplicado.
    expect(await ingestNotifications(fx.db, [pay], fx.clock)).toEqual({ added: 0, ignored: 0 });
    const items = await inbox(fx.db);
    expect(items).toHaveLength(1);
    expect(items[0]?.merchant).toBe("Tiendas Ara");
  });
});
