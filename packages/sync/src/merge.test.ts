import { describe, expect, it } from "vitest";
import { mergeRecords } from "./merge";
import type { AccountRecord, TransactionRecord } from "./protocol";

const base: AccountRecord = {
  id: "0190f3a0-0000-7000-8000-000000000001",
  name: "Nequi",
  type: "digital_wallet",
  currency: "COP",
  institution: "Nequi",
  last4: null,
  closingDay: null,
  dueDay: null,
  creditLimitMinor: null,
  archivedAt: null,
  createdAt: "2026-11-01T00:00:00.000Z",
  updatedAt: "2026-11-01T00:00:00.000Z",
};
const at = (minute: number) => `2026-11-19T15:${String(minute).padStart(2, "0")}:00.000Z`;

describe("fusión de tres vías", () => {
  it("cada lado conserva lo que solo él cambió", () => {
    const local = { ...base, name: "Nequi Ana", updatedAt: at(1) };
    const server = { ...base, institution: "Bancolombia", updatedAt: at(2) };
    const { merged, conflicts } = mergeRecords(base, local, server);
    expect(merged).toMatchObject({
      name: "Nequi Ana",
      institution: "Bancolombia",
      updatedAt: at(2),
    });
    expect(conflicts).toEqual([]);
  });

  it("si ambos cambian el mismo campo gana la edición más reciente y se registra", () => {
    const local = { ...base, name: "Desde el teléfono", updatedAt: at(5) };
    const server = { ...base, name: "Desde la web", updatedAt: at(3) };
    const res = mergeRecords(base, local, server);
    expect(res.merged).toMatchObject({ name: "Desde el teléfono", updatedAt: at(5) });
    expect(res.conflicts).toEqual([
      { field: "name", local: "Desde el teléfono", server: "Desde la web", kept: "local" },
    ]);
    const older = mergeRecords(base, { ...local, updatedAt: at(1) }, server);
    expect(older.merged).toMatchObject({ name: "Desde la web" });
    expect(older.conflicts[0]?.kept).toBe("server");
  });

  it("si ambos hacen el mismo cambio no hay conflicto", () => {
    const edit = { ...base, archivedAt: at(1), updatedAt: at(1) };
    expect(mergeRecords(base, edit, { ...edit, updatedAt: at(2) }).conflicts).toEqual([]);
  });

  it("sin base, toda diferencia es conflicto", () => {
    const res = mergeRecords(
      null,
      { ...base, name: "A", updatedAt: at(1) },
      { ...base, name: "B", updatedAt: at(2) },
    );
    expect(res.conflicts.map((c) => c.field)).toEqual(["name"]);
    expect(res.merged).toMatchObject({ name: "B" });
  });

  it("los asientos se toman completos de un lado", () => {
    const entry = (
      id: string,
      accountId: string | null,
      categoryId: string | null,
      amountMinor: string,
    ) => ({
      id,
      accountId,
      categoryId,
      amountMinor,
      currency: "COP",
    });
    const tx: TransactionRecord = {
      id: base.id,
      occurredAt: at(0),
      description: "Mercado",
      merchant: null,
      notes: null,
      status: "cleared",
      source: "manual",
      deletedAt: null,
      createdAt: at(0),
      updatedAt: at(0),
      entries: [entry("e1", "a", null, "-100"), entry("e2", null, "c", "100")],
    };
    const local = { ...tx, notes: "con nota", updatedAt: at(1) };
    const server = {
      ...tx,
      entries: [entry("e3", "a", null, "-200"), entry("e4", null, "c", "200")],
      updatedAt: at(2),
    };
    const { merged, conflicts } = mergeRecords(tx, local, server);
    expect(merged).toMatchObject({ notes: "con nota", entries: server.entries });
    expect(conflicts).toEqual([]);
  });
});
