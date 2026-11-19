import { describe, expect, it } from "vitest";
import { cardFixture, cop, local } from "../accounts/card.test-helper";
import {
  CARD_REMINDER_PREFIX,
  cardRemindersEnabled,
  setCardRemindersEnabled,
  syncCardReminders,
} from "./card-reminders";
import type { LocalReminder, ReminderScheduler } from "./scheduler";

function fakeScheduler(available = true) {
  const scheduled = new Map<string, LocalReminder>();
  scheduled.set("otro:1", {
    id: "otro:1",
    at: { year: 2027, month: 1, day: 1 },
    hour: 9,
    title: "",
    body: "",
  });
  scheduled.set(`${CARD_REMINDER_PREFIX}viejo`, {
    id: `${CARD_REMINDER_PREFIX}viejo`,
    at: { year: 2027, month: 1, day: 1 },
    hour: 9,
    title: "",
    body: "",
  });
  const scheduler: ReminderScheduler = {
    available,
    ensurePermission: async () => true,
    pending: async (prefix) => [...scheduled.keys()].filter((k) => k.startsWith(prefix)),
    cancel: async (id) => void scheduled.delete(id),
    schedule: async (r) => void scheduled.set(r.id, r),
  };
  return { scheduler, scheduled };
}

const texts = (card: { name: string }, daysLeft: number) => ({
  title: `Pago de ${card.name}`,
  body: daysLeft === 0 ? "Vence hoy" : `Vence en ${daysLeft} días`,
});

describe("syncCardReminders", () => {
  it("apagado: borra los avisos de tarjetas y respeta los demás", async () => {
    const { db } = await cardFixture({ closingDay: 15, dueDay: 2 });
    const { scheduler, scheduled } = fakeScheduler();
    expect(await cardRemindersEnabled(db)).toBe(false);
    expect(await syncCardReminders(db, scheduler, local(2026, 11, 19), texts)).toBe(0);
    expect([...scheduled.keys()]).toEqual(["otro:1"]);
  });

  it("programa 3 días antes y el día del pago, sin montos", async () => {
    const { db, move } = await cardFixture({ closingDay: 15, dueDay: 2 });
    await move(cop(-500_000n), local(2026, 11, 10));
    await setCardRemindersEnabled(db, true);
    const { scheduler, scheduled } = fakeScheduler();
    expect(await syncCardReminders(db, scheduler, local(2026, 11, 19), texts)).toBe(2);
    const card = [...scheduled.values()].filter((r) => r.id.startsWith(CARD_REMINDER_PREFIX));
    expect(card.map((r) => [r.at, r.body])).toEqual([
      [{ year: 2026, month: 11, day: 29 }, "Vence en 3 días"],
      [{ year: 2026, month: 12, day: 2 }, "Vence hoy"],
    ]);
    expect(card.every((r) => !/\d{3}/.test(r.title + r.body))).toBe(true);
  });

  it("si el extracto está pagado pero hay compras nuevas, avisa del siguiente pago", async () => {
    const { db, move } = await cardFixture({ closingDay: 15, dueDay: 2 });
    await move(cop(-100_000n), local(2026, 11, 18));
    await setCardRemindersEnabled(db, true);
    const { scheduler, scheduled } = fakeScheduler();
    await syncCardReminders(db, scheduler, local(2026, 11, 19), texts);
    const dates = [...scheduled.values()]
      .filter((r) => r.id.startsWith(CARD_REMINDER_PREFIX))
      .map((r) => r.at);
    expect(dates).toEqual([
      { year: 2026, month: 12, day: 30 },
      { year: 2027, month: 1, day: 2 },
    ]);
  });

  it("no programa nada sin deuda, ni avisos cuya hora ya pasó", async () => {
    const { db, move } = await cardFixture({ closingDay: 15, dueDay: 2 });
    await setCardRemindersEnabled(db, true);
    const { scheduler } = fakeScheduler();
    expect(await syncCardReminders(db, scheduler, local(2026, 11, 19), texts)).toBe(0);
    await move(cop(-100_000n), local(2026, 11, 10));
    // El 2 de diciembre a las 10: el aviso de las 9 ya pasó.
    expect(await syncCardReminders(db, scheduler, local(2026, 12, 2, 10), texts)).toBe(0);
  });

  it("sin notificaciones (web) no hace nada", async () => {
    const { db } = await cardFixture({ closingDay: 15, dueDay: 2 });
    await setCardRemindersEnabled(db, true);
    const { scheduler } = fakeScheduler(false);
    expect(await syncCardReminders(db, scheduler, local(2026, 11, 19), texts)).toBe(0);
  });
});
