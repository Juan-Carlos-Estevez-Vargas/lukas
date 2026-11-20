import { describe, expect, it } from "vitest";
import { normalizeCapture } from "../normalize";
import { parseNotification } from "../notification";
import { BANKS, bankFor } from "./banks";
import { FIXTURES } from "./fixtures";
import { occurredAt } from "./rules";

const posted = new Date(2026, 10, 5, 13, 3).getTime();
const pad = (n: number) => String(n).padStart(2, "0");

describe.each(BANKS.map((b) => [b.bank, b] as const))("avisos de %s", (_, bank) => {
  const app = bank.apps[0] ?? "";
  const fixtures = FIXTURES[app] ?? [];

  it("tiene ejemplos", () => {
    expect(fixtures.length).toBeGreaterThan(1);
    expect(bankFor(app)).toBe(bank);
  });

  it.each(fixtures.map((f) => [f.text, f] as const))("%s", (_, f) => {
    const raw = parseNotification({
      id: f.text,
      app,
      title: f.title,
      text: f.text,
      postedAt: posted,
    });
    const c = raw ? normalizeCapture(raw) : null;
    if (!f.expect) {
      expect(c).toBeNull();
      return;
    }
    expect(c).not.toBeNull();
    expect({
      kind: c?.kind,
      amount: c?.amount.toDecimalString(),
      merchant: c?.merchant,
      last4: c?.last4 ?? undefined,
    }).toEqual({ ...f.expect, at: undefined, last4: f.expect.last4 });
    const at = c?.occurredAt ?? new Date(0);
    const when = `${pad(at.getDate())}/${pad(at.getMonth() + 1)} ${pad(at.getHours())}:${pad(at.getMinutes())}`;
    expect(when).toBe(f.expect.at ?? "05/11 13:03");
  });
});

describe("fecha del aviso", () => {
  const base = new Date(2026, 10, 5, 13, 3);
  it("usa la hora del texto y descarta lo imposible", () => {
    expect(occurredAt("05/11/26", "08:15", base)?.getHours()).toBe(8);
    expect(occurredAt(undefined, "09:30", base)?.getDate()).toBe(5);
    expect(occurredAt("06/11/2026", undefined, base)).toBeNull();
    expect(occurredAt("31/02/2026", "10:00", base)).toBeNull();
    expect(occurredAt("05/11/2026", "25:00", base)).toBeNull();
    expect(occurredAt("5 nov", undefined, base)).toBeNull();
    expect(occurredAt(undefined, "9h", base)).toBeNull();
    expect(occurredAt()).toBeNull();
  });
});
