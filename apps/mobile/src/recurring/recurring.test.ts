import { type CivilDate, Money, type Recurrence } from "@lukas/domain";
import { describe, expect, it } from "vitest";
import { createFromTemplate } from "../accounts/accounts";
import { cardFixture, cop } from "../accounts/card.test-helper";
import { templateByKey } from "../accounts/templates";
import type { SqlConnection } from "../data/sql";
import type { LocalReminder, ReminderScheduler } from "../reminders/scheduler";
import {
  archiveRecurring,
  civilKey,
  createRecurring,
  listRecurring,
  noonOf,
  parseCivil,
  pendingOf,
  postDueRecurring,
  postOccurrence,
  type Recurring,
  type RecurringInput,
  recurringById,
  skipOccurrence,
  upcomingOf,
} from "./recurring";
import { RECURRING_REMINDER_PREFIX, syncRecurringReminders } from "./recurring-reminders";

const d = (year: number, month: number, day: number): CivilDate => ({ year, month, day });
const monthly = (startsOn: CivilDate, endsOn: CivilDate | null = null): Recurrence => ({
  frequency: "monthly",
  every: 1,
  startsOn,
  endsOn,
});

const archiveAccountById = (db: SqlConnection, id: string) =>
  db.run("UPDATE accounts SET archived_at = '2026-01-01T00:00:00Z' WHERE id = ?", id);

async function setup() {
  const fx = await cardFixture({ closingDay: 15, dueDay: 2 });
  const tpl = templateByKey("nequi");
  if (!tpl) throw new Error("falta Nequi");
  const nequi = await createFromTemplate(fx.db, tpl, {}, fx.clock);
  if (!nequi.ok) throw nequi.error;
  const rent: RecurringInput = {
    name: "  Arriendo  ",
    kind: "expense",
    accountId: nequi.value.id,
    categoryId: "default.arriendo",
    amount: cop(1_200_000n),
    recurrence: monthly(d(2026, 1, 31)),
    autoPost: true,
    remind: true,
  };
  const create = async (input: Partial<RecurringInput> = {}, today = d(2026, 1, 1)) => {
    const res = await createRecurring(fx.db, { ...rent, ...input }, today, fx.clock);
    if (!res.ok) throw res.error;
    return res.value;
  };
  const balance = async () =>
    (
      await fx.db.get<{ s: number }>(
        "SELECT coalesce(sum(amount_minor), 0) AS s FROM entries WHERE account_id = ?",
        nequi.value.id,
      )
    )?.s;
  return { ...fx, nequi: nequi.value, rent, create, balance };
}

describe("recurrentes", () => {
  it("el arriendo aparece solo cada mes, ajustado a meses cortos, y sin duplicarse", async () => {
    const fx = await setup();
    const r = await fx.create();
    expect(r.name).toBe("Arriendo");
    expect(r.postedThrough).toBeNull();

    expect(await postDueRecurring(fx.db, d(2026, 1, 30), fx.clock)).toEqual({
      posted: 0,
      failed: [],
    });
    expect(await postDueRecurring(fx.db, d(2026, 3, 1), fx.clock)).toEqual({
      posted: 2,
      failed: [],
    });
    // Abrir la app otra vez el mismo día no registra nada nuevo.
    expect((await postDueRecurring(fx.db, d(2026, 3, 1), fx.clock)).posted).toBe(0);
    expect(await fx.balance()).toBe(-2 * 120_000_000);

    const txs = await fx.db.all<{ occurred_at: string; source: string; merchant: string }>(
      "SELECT occurred_at, source, merchant FROM transactions ORDER BY occurred_at",
    );
    expect(txs.map((t) => t.occurred_at)).toEqual([
      noonOf(d(2026, 1, 31)).toISOString(),
      noonOf(d(2026, 2, 28)).toISOString(),
    ]);
    expect(txs.every((t) => t.source === "recurring" && t.merchant === "Arriendo")).toBe(true);
    expect((await recurringById(fx.db, r.id))?.postedThrough).toEqual(d(2026, 2, 28));
  });

  it("si empieza en el pasado no rellena la historia", async () => {
    const fx = await setup();
    const r = await fx.create({ recurrence: monthly(d(2025, 1, 5)) }, d(2026, 3, 10));
    expect(r.postedThrough).toEqual(d(2026, 3, 9));
    expect(pendingOf(r, d(2026, 3, 10))).toEqual([]);
    expect(upcomingOf(r, d(2026, 3, 10))).toEqual(d(2026, 4, 5));
  });

  it("los que solo avisan quedan pendientes hasta registrarlos u omitirlos", async () => {
    const fx = await setup();
    const r = await fx.create({ autoPost: false, recurrence: monthly(d(2026, 1, 10)) });
    expect((await postDueRecurring(fx.db, d(2026, 3, 15), fx.clock)).posted).toBe(0);
    const [jan, feb, mar] = pendingOf(r, d(2026, 3, 15));
    if (!jan || !feb || !mar) throw new Error("faltan ocurrencias");

    await skipOccurrence(fx.db, r, jan, fx.clock);
    await skipOccurrence(fx.db, r, jan, fx.clock);
    const posted = await postOccurrence(fx.db, r, mar, fx.clock);
    expect(posted.ok && posted.value?.source).toBe("recurring");
    // Ya registrada: no se repite.
    const again = await postOccurrence(fx.db, r, mar, fx.clock);
    expect(again).toEqual({ ok: true, value: null });

    const fresh = await recurringById(fx.db, r.id);
    if (!fresh) throw new Error("no está");
    // Registrar marzo no reabre febrero ni lo deja colgado: queda hasta marzo.
    expect(fresh.postedThrough).toEqual(mar);
    expect(await fx.balance()).toBe(-120_000_000);
  });

  it("si la cuenta se archiva no registra y lo informa", async () => {
    const fx = await setup();
    const r = await fx.create({ recurrence: monthly(d(2026, 1, 5)) });
    await archiveAccountById(fx.db, fx.nequi.id);
    expect(await postDueRecurring(fx.db, d(2026, 2, 10), fx.clock)).toEqual({
      posted: 0,
      failed: [r.id],
    });
    expect((await recurringById(fx.db, r.id))?.postedThrough).toBeNull();
  });

  it("valida lo que se crea", async () => {
    const fx = await setup();
    const code = async (input: Partial<RecurringInput>) => {
      const res = await createRecurring(fx.db, { ...fx.rent, ...input }, d(2026, 1, 1), fx.clock);
      return res.ok ? null : res.error.code;
    };
    expect(await code({ name: "  " })).toBe("recurring_name_required");
    expect(await code({ amount: cop(0n) })).toBe("invalid_amount");
    expect(await code({ recurrence: { ...monthly(d(2026, 1, 1)), every: 0 } })).toBe(
      "invalid_interval",
    );
    expect(await code({ accountId: "nada" })).toBe("account_not_found");
    expect(await code({ categoryId: "default.salario" })).toBe("invalid_category");
    expect(await code({ categoryId: "system.cambio" })).toBe("invalid_category");
    expect(await code({ accountId: fx.card.id, amount: cop(1n) })).toBeNull();
    await archiveAccountById(fx.db, fx.nequi.id);
    expect(await code({})).toBe("account_archived");
  });

  it("no acepta montos en otra moneda", async () => {
    const fx = await setup();
    const usd = await createRecurring(
      fx.db,
      { ...fx.rent, amount: Money.ofMinor(100n, "USD") },
      d(2026, 1, 1),
      fx.clock,
    );
    expect(!usd.ok && usd.error.code).toBe("currency_mismatch");
  });

  it("lista solo los activos y en orden", async () => {
    const fx = await setup();
    const a = await fx.create({ name: "netflix" });
    await fx.create({ name: "Arriendo" });
    await archiveRecurring(fx.db, a.id, fx.clock);
    expect((await listRecurring(fx.db)).map((r) => r.name)).toEqual(["Arriendo"]);
    expect(await recurringById(fx.db, "nada")).toBeNull();
  });

  it("fechas en texto", () => {
    expect(civilKey(d(2026, 3, 5))).toBe("2026-03-05");
    expect(parseCivil(" 2026-3-5 ")).toEqual(d(2026, 3, 5));
    expect(parseCivil("2026-02-30")).toBeNull();
    expect(parseCivil("ayer")).toBeNull();
  });
});

function fakeScheduler(available = true) {
  const scheduled = new Map<string, LocalReminder>();
  const old = `${RECURRING_REMINDER_PREFIX}viejo`;
  scheduled.set(old, { id: old, at: d(2027, 1, 1), hour: 9, title: "", body: "" });
  const scheduler: ReminderScheduler = {
    available,
    ensurePermission: async () => true,
    pending: async (prefix) => [...scheduled.keys()].filter((k) => k.startsWith(prefix)),
    cancel: async (id) => void scheduled.delete(id),
    schedule: async (r) => void scheduled.set(r.id, r),
  };
  return { scheduler, scheduled };
}

const texts = (r: Recurring) => ({ title: r.name, body: r.autoPost ? "auto" : "confirma" });

describe("avisos de recurrentes", () => {
  it("programa la siguiente ocurrencia a las 9 a. m. sin montos", async () => {
    const fx = await setup();
    const r = await fx.create({ recurrence: monthly(d(2026, 1, 10)) });
    await fx.create({ name: "Sin aviso", remind: false });
    const { scheduler, scheduled } = fakeScheduler();

    expect(await syncRecurringReminders(fx.db, scheduler, new Date(2026, 0, 10, 8), texts)).toBe(1);
    expect([...scheduled.keys()]).toEqual([`${RECURRING_REMINDER_PREFIX}${r.id}:2026-01-10`]);
    expect([...scheduled.values()][0]).toMatchObject({ hour: 9, title: "Arriendo", body: "auto" });

    // Pasadas las 9, el aviso de hoy ya no sirve: el siguiente es el del próximo mes.
    await syncRecurringReminders(fx.db, scheduler, new Date(2026, 0, 10, 10), texts);
    expect([...scheduled.keys()]).toEqual([`${RECURRING_REMINDER_PREFIX}${r.id}:2026-02-10`]);
  });

  it("no programa nada si el teléfono no tiene notificaciones o la regla terminó", async () => {
    const fx = await setup();
    await fx.create({ recurrence: monthly(d(2026, 1, 10), d(2026, 1, 10)) });
    expect(
      await syncRecurringReminders(fx.db, fakeScheduler(false).scheduler, new Date(), texts),
    ).toBe(0);
    const { scheduler, scheduled } = fakeScheduler();
    expect(await syncRecurringReminders(fx.db, scheduler, new Date(2026, 0, 11), texts)).toBe(0);
    expect(scheduled.size).toBe(0);
  });
});
