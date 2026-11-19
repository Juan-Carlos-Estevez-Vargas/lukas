import { describe, expect, it } from "vitest";
import {
  isBalanced,
  isUuid,
  MAX_OPS_PER_PUSH,
  parseCursor,
  parsePushRequest,
  SyncValidationError,
  syncId,
} from "./index";

const ID = (n: number) => `0190f3a0-0000-7000-8000-${String(n).padStart(12, "0")}`;
const NOW = "2026-11-19T15:00:00.000Z";

const account = {
  id: ID(1),
  name: "Nequi",
  type: "digital_wallet",
  currency: "COP",
  institution: "Nequi",
  last4: null,
  closingDay: null,
  dueDay: null,
  creditLimitMinor: null,
  archivedAt: null,
  createdAt: NOW,
  updatedAt: NOW,
};
const category = {
  id: ID(2),
  parentId: null,
  name: "Mercado",
  kind: "expense",
  icon: "🛒",
  color: null,
  isSystem: false,
  archivedAt: null,
  createdAt: NOW,
  updatedAt: NOW,
};
const transaction = {
  id: ID(3),
  occurredAt: NOW,
  description: "Mercado",
  merchant: "Éxito",
  notes: null,
  status: "cleared",
  source: "manual",
  deletedAt: null,
  createdAt: NOW,
  updatedAt: NOW,
  entries: [
    { id: ID(4), accountId: ID(1), categoryId: null, amountMinor: "-2500000", currency: "COP" },
    { id: ID(5), accountId: null, categoryId: ID(2), amountMinor: "2500000", currency: "COP" },
  ],
};

const upsert = (n: number, entity: string, record: object, baseVersion: number | null = null) => ({
  opId: ID(100 + n),
  entity,
  kind: "upsert",
  baseVersion,
  record,
});

const pathOf = (body: unknown): string => {
  try {
    parsePushRequest(body);
  } catch (error) {
    if (error instanceof SyncValidationError) return error.path;
    throw error;
  }
  throw new Error("debía fallar");
};

describe("validación del push", () => {
  it("acepta cuentas, categorías, transacciones y borrados", () => {
    const req = parsePushRequest({
      ops: [
        upsert(1, "accounts", {
          ...account,
          last4: "1234",
          closingDay: 15,
          dueDay: 30,
          creditLimitMinor: "500000000",
          type: "credit_card",
        }),
        upsert(2, "categories", category, 3),
        upsert(3, "transactions", transaction),
        { opId: ID(104), entity: "transactions", kind: "delete", id: ID(9), baseVersion: 2 },
      ],
    });
    expect(req.ops).toHaveLength(4);
    expect(req.ops[3]).toEqual({
      opId: ID(104),
      entity: "transactions",
      kind: "delete",
      id: ID(9),
      baseVersion: 2,
    });
  });

  it("dice qué campo está mal", () => {
    expect(pathOf(null)).toBe("body");
    expect(pathOf({ ops: [] })).toBe("ops");
    expect(
      pathOf({
        ops: Array.from({ length: MAX_OPS_PER_PUSH + 1 }, (_, i) => upsert(i, "accounts", account)),
      }),
    ).toBe("ops");
    expect(pathOf({ ops: [upsert(1, "accounts", account), upsert(1, "accounts", account)] })).toBe(
      "ops",
    );
    expect(pathOf({ ops: [upsert(1, "goals", account)] })).toBe("ops[0].entity");
    expect(pathOf({ ops: [{ ...upsert(1, "accounts", account), opId: "x" }] })).toBe("ops[0].opId");
    expect(pathOf({ ops: [upsert(1, "accounts", { ...account, name: "  " })] })).toBe(
      "ops[0].record.name",
    );
    expect(pathOf({ ops: [upsert(1, "accounts", { ...account, last4: "12a4" })] })).toBe(
      "ops[0].record.last4",
    );
    expect(pathOf({ ops: [upsert(1, "accounts", { ...account, dueDay: 32 })] })).toBe(
      "ops[0].record.dueDay",
    );
    expect(pathOf({ ops: [upsert(1, "accounts", { ...account, currency: "cop" })] })).toBe(
      "ops[0].record.currency",
    );
    expect(pathOf({ ops: [upsert(1, "accounts", { ...account, createdAt: "ayer" })] })).toBe(
      "ops[0].record.createdAt",
    );
    expect(pathOf({ ops: [upsert(1, "accounts", { ...account, creditLimitMinor: "1.5" })] })).toBe(
      "ops[0].record.creditLimitMinor",
    );
    expect(pathOf({ ops: [upsert(1, "accounts", account, 0)] })).toBe("ops[0].baseVersion");
    expect(pathOf({ ops: [upsert(1, "categories", { ...category, isSystem: 1 })] })).toBe(
      "ops[0].record.isSystem",
    );
    expect(
      pathOf({ ops: [upsert(1, "categories", { ...category, parentId: "default.mercado" })] }),
    ).toBe("ops[0].record.parentId");
    expect(pathOf({ ops: [upsert(1, "accounts", [])] })).toBe("ops[0].record");
  });

  it("rechaza asientos que no cuadran o mal formados", () => {
    const [a, b] = transaction.entries;
    const bad = (entries: unknown) =>
      pathOf({ ops: [upsert(1, "transactions", { ...transaction, entries })] });
    expect(bad([a])).toBe("ops[0].record.entries");
    expect(bad([a, { ...b, amountMinor: "2400000" }])).toBe("ops[0].record.entries");
    expect(bad([a, { ...b, accountId: ID(1) }])).toBe("ops[0].record.entries[1]");
    expect(bad([a, { ...b, amountMinor: "0" }])).toBe("ops[0].record.entries[1].amountMinor");
    expect(bad("nada")).toBe("ops[0].record.entries");
  });

  it("cuadra por moneda", () => {
    const e = (amountMinor: string, currency: string) => ({
      id: ID(1),
      accountId: ID(1),
      categoryId: null,
      amountMinor,
      currency,
    });
    expect(
      isBalanced([e("-100", "USD"), e("100", "USD"), e("-4000", "COP"), e("4000", "COP")]),
    ).toBe(true);
    expect(isBalanced([e("-100", "USD"), e("100", "COP")])).toBe(false);
  });
});

describe("ids del servidor", () => {
  it("deja igual los UUID y vuelve UUIDv8 las categorías por defecto", () => {
    expect(syncId("ana", ID(1))).toBe(ID(1));
    const mercado = syncId("ana", "default.mercado");
    expect(isUuid(mercado)).toBe(true);
    expect(mercado[14]).toBe("8");
    expect(syncId("ana", "default.mercado")).toBe(mercado);
    expect(syncId("beto", "default.mercado")).not.toBe(mercado);
    expect(syncId("ana", "default.transporte")).not.toBe(mercado);
  });
});

describe("cursor", () => {
  it("empieza en cero y rechaza basura", () => {
    expect(parseCursor(undefined)).toBe(0n);
    expect(parseCursor("")).toBe(0n);
    expect(parseCursor("42")).toBe(42n);
    expect(parseCursor("-1")).toBeNull();
    expect(parseCursor("abc")).toBeNull();
  });
});
