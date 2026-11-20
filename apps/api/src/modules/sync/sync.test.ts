import type { PGlite } from "@electric-sql/pglite";
import { createTestDatabase } from "@lukas/db/testing";
import type { Operation, PullResponse, PushResponse, TransactionRecord } from "@lukas/sync";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { createApp } from "../../app";
import type { Env } from "../../env";
import { testEnv } from "../../test/env";
import { createAuth } from "../auth/auth";
import type { Mailer } from "../auth/mailer";
import { neonSyncFactory } from "./factory";
import { drizzleSyncStore } from "./store";

const ORIGIN = "http://localhost:8081";
const env: Env = {
  ...testEnv,
  AUTH_URL: "http://localhost:8787",
  BETTER_AUTH_SECRET: "secreto-de-pruebas-con-mas-de-32-caracteres",
  PASSKEY_RP_ID: "localhost",
  CORS_ORIGINS: ORIGIN,
};

const mail: { to: string; code: string }[] = [];
const mailer: Mailer = {
  sendOtp: async (m) => {
    mail.push(m);
  },
};

let client: PGlite;
let app: ReturnType<typeof createApp>;
let closes = 0;

beforeAll(async () => {
  const database = await createTestDatabase();
  client = database.client;
  const auth = createAuth({ db: database.db, env, mailer });
  const store = drizzleSyncStore(database.db);
  app = createApp({
    auth: () => auth,
    sync: () => ({
      store,
      close: async () => {
        closes += 1;
      },
    }),
  });
  vi.spyOn(console, "log").mockImplementation(() => {});
  vi.spyOn(console, "warn").mockImplementation(() => {});
});

afterAll(async () => {
  vi.restoreAllMocks();
  await client.close();
});

const call = (path: string, token: string | null, body?: unknown) =>
  app.request(
    `http://localhost:8787${path}`,
    {
      method: body === undefined ? "GET" : "POST",
      headers: {
        Origin: ORIGIN,
        "Content-Type": "application/json",
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      ...(body === undefined
        ? {}
        : { body: typeof body === "string" ? body : JSON.stringify(body) }),
    },
    env,
  );

const signIn = async (email: string) => {
  await call("/v1/auth/email-otp/send-verification-otp", null, { email, type: "sign-in" });
  const code = mail.findLast((m) => m.to === email)?.code ?? "";
  const res = await call("/v1/auth/sign-in/email-otp", null, { email, otp: code });
  return res.headers.get("set-auth-token") ?? "";
};

let n = 0;
const uuid = () => `0190f3a0-0000-7000-8000-${String(++n).padStart(12, "0")}`;
const NOW = "2026-11-19T15:00:00.000Z";

const push = async (token: string, ops: Operation[]) => {
  const res = await call("/v1/sync/push", token, { ops });
  expect(res.status).toBe(200);
  return ((await res.json()) as PushResponse).results;
};

const pullAll = async (token: string, cursor = "0", limit?: number) => {
  const res = await call(`/v1/sync/pull?cursor=${cursor}${limit ? `&limit=${limit}` : ""}`, token);
  expect(res.status).toBe(200);
  return (await res.json()) as PullResponse;
};

const accountOp = (
  id: string,
  name: string,
  baseVersion: number | null = null,
  currency = "COP",
): Operation => ({
  opId: uuid(),
  entity: "accounts",
  kind: "upsert",
  baseVersion,
  record: {
    id,
    name,
    type: "digital_wallet",
    currency,
    institution: null,
    last4: null,
    closingDay: null,
    dueDay: null,
    creditLimitMinor: null,
    archivedAt: null,
    createdAt: NOW,
    updatedAt: NOW,
  },
});

const categoryOp = (id: string): Operation => ({
  opId: uuid(),
  entity: "categories",
  kind: "upsert",
  baseVersion: null,
  record: {
    id,
    parentId: null,
    name: "Mercado",
    kind: "expense",
    icon: "🛒",
    color: null,
    isSystem: false,
    archivedAt: null,
    createdAt: NOW,
    updatedAt: NOW,
  },
});

const expense = (
  id: string,
  account: string,
  category: string,
  amount: string,
): TransactionRecord => ({
  id,
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
    {
      id: uuid(),
      accountId: account,
      categoryId: null,
      amountMinor: `-${amount}`,
      currency: "COP",
    },
    { id: uuid(), accountId: null, categoryId: category, amountMinor: amount, currency: "COP" },
  ],
});

const txOp = (record: TransactionRecord, baseVersion: number | null = null): Operation => ({
  opId: uuid(),
  entity: "transactions",
  kind: "upsert",
  baseVersion,
  record,
});

describe("IDOR: ids de otra persona en el sync", () => {
  let cata = "";
  let dario = "";
  const cuenta = uuid();
  const categoria = uuid();
  const movimiento = uuid();

  beforeAll(async () => {
    cata = await signIn("cata@lukas.test");
    dario = await signIn("dario@lukas.test");
    const setup = await push(cata, [
      accountOp(cuenta, "Bancolombia"),
      categoryOp(categoria),
      txOp(expense(movimiento, cuenta, categoria, "500000")),
    ]);
    expect(setup.map((r) => r.status)).toEqual(["applied", "applied", "applied"]);
  });

  const reasons = (results: Awaited<ReturnType<typeof push>>) =>
    results.map((r) => (r.status === "rejected" ? r.reason : r.status));

  it("no se puede gastar desde la cuenta de otra persona ni usar su categoría", async () => {
    const suya = uuid();
    const results = await push(dario, [
      accountOp(suya, "Mía"),
      txOp(expense(uuid(), cuenta, uuid(), "1000")),
      txOp(expense(uuid(), suya, categoria, "1000")),
    ]);
    expect(reasons(results)).toEqual(["applied", "invalid", "invalid"]);
  });

  it("no se puede sobrescribir, editar ni borrar con el id de un registro ajeno", async () => {
    const mia = uuid();
    const [cuentaMia] = await push(dario, [accountOp(mia, "Propia")]);
    expect(cuentaMia?.status).toBe("applied");
    const results = await push(dario, [
      categoryOp(categoria),
      txOp(expense(movimiento, mia, uuid(), "1")),
      txOp(expense(movimiento, mia, uuid(), "1"), 1),
      { opId: uuid(), entity: "transactions", kind: "delete", id: movimiento, baseVersion: 1 },
      { opId: uuid(), entity: "categories", kind: "delete", id: categoria, baseVersion: 1 },
    ]);
    expect(reasons(results.slice(0, 3))).toEqual(["id_taken", "id_taken", "id_taken"]);
    expect(results.slice(3)).toEqual([
      expect.objectContaining({ status: "applied", version: 0 }),
      expect.objectContaining({ status: "applied", version: 0 }),
    ]);
    const ids = (changes: PullResponse["changes"]) =>
      changes.map((c) => `${c.kind}:${"record" in c ? c.record.id : c.id}`);
    const intact = ids((await pullAll(cata)).changes);
    expect(intact).toEqual(
      expect.arrayContaining([`upsert:${movimiento}`, `upsert:${categoria}`, `upsert:${cuenta}`]),
    );
    expect(intact.filter((c) => c.startsWith("delete:"))).toEqual([]);
    expect(ids((await pullAll(dario)).changes)).not.toContain(`upsert:${movimiento}`);
  });
});

describe("sincronización push / pull", () => {
  let ana = "";
  let anaLaptop = "";
  let beto = "";
  const nequi = uuid();
  const mercado = uuid();
  const gasto = uuid();

  beforeAll(async () => {
    ana = await signIn("ana@lukas.test");
    anaLaptop = await signIn("ana@lukas.test");
    beto = await signIn("beto@lukas.test");
  });

  it("los cambios del teléfono llegan a otro dispositivo del mismo usuario", async () => {
    const results = await push(ana, [
      accountOp(nequi, "Nequi"),
      categoryOp(mercado),
      txOp(expense(gasto, nequi, mercado, "2500000")),
    ]);
    expect(results.map((r) => r.status)).toEqual(["applied", "applied", "applied"]);

    const page = await pullAll(anaLaptop);
    expect(page.hasMore).toBe(false);
    expect(page.changes.map((c) => c.entity)).toEqual(["accounts", "categories", "transactions"]);
    const tx = page.changes[2];
    expect(tx).toMatchObject({
      kind: "upsert",
      version: 1,
      record: { id: gasto, merchant: "Éxito" },
    });
    if (tx?.kind === "upsert" && tx.entity === "transactions") {
      expect(tx.record.entries.map((e) => e.amountMinor).sort()).toEqual(["-2500000", "2500000"]);
    }
    expect(closes).toBeGreaterThan(0);
  });

  it("otro usuario no recibe nada ni puede tocar esos registros", async () => {
    expect((await pullAll(beto)).changes).toEqual([]);
    const [result] = await push(beto, [accountOp(nequi, "Robada")]);
    expect(result).toMatchObject({ status: "rejected", reason: "id_taken" });
    const [del] = await push(beto, [
      { opId: uuid(), entity: "accounts", kind: "delete", id: nequi, baseVersion: 1 },
    ]);
    expect(del).toMatchObject({ status: "applied", version: 0 });
    expect((await pullAll(anaLaptop)).changes[0]).toMatchObject({ record: { name: "Nequi" } });
  });

  it("reenviar la misma operación no la aplica dos veces", async () => {
    const op = accountOp(uuid(), "Efectivo");
    const [first] = await push(ana, [op]);
    const [again] = await push(ana, [op]);
    expect(first).toMatchObject({ status: "applied", version: 1 });
    expect(again).toMatchObject({ status: "duplicate", version: 1 });
  });

  it("actualiza con la versión correcta y avisa conflicto con una vieja", async () => {
    const [ok] = await push(ana, [accountOp(nequi, "Nequi Ana", 1)]);
    expect(ok).toMatchObject({ status: "applied", version: 2 });
    const [stale] = await push(anaLaptop, [accountOp(nequi, "Nequi viejo", 1)]);
    expect(stale).toMatchObject({ status: "conflict", version: 2, current: { name: "Nequi Ana" } });
  });

  it("reemplaza los asientos al editar una transacción y la borra", async () => {
    const [edit] = await push(ana, [txOp(expense(gasto, nequi, mercado, "3000000"), 1)]);
    expect(edit).toMatchObject({ status: "applied", version: 2 });
    const [del] = await push(ana, [
      { opId: uuid(), entity: "transactions", kind: "delete", id: gasto, baseVersion: 2 },
    ]);
    expect(del).toMatchObject({ status: "applied", version: 3 });
    const page = await pullAll(anaLaptop);
    expect(page.changes).toContainEqual({ entity: "transactions", kind: "delete", id: gasto });
  });

  it("rechaza lo que la base no admite sin tumbar el resto del lote", async () => {
    const otherCurrency = uuid();
    const usd = accountOp(otherCurrency, "Dólares", null, "USD");
    const wrongCurrency = expense(uuid(), otherCurrency, mercado, "1000");
    const results = await push(ana, [
      usd,
      txOp(wrongCurrency),
      txOp(expense(uuid(), uuid(), mercado, "1000")),
      { opId: uuid(), entity: "categories", kind: "delete", id: mercado, baseVersion: 1 },
      accountOp(uuid(), "Sigue"),
    ]);
    expect(results.map((r) => (r.status === "rejected" ? r.reason : r.status))).toEqual([
      "applied",
      "invalid",
      // El trigger de dueño de los asientos responde antes que la llave foránea.
      "invalid",
      "applied",
      "applied",
    ]);
  });

  it("pagina con el cursor", async () => {
    const first = await pullAll(anaLaptop, "0", 2);
    expect(first.hasMore).toBe(true);
    expect(first.changes).toHaveLength(2);
    const rest = await pullAll(anaLaptop, first.cursor);
    expect(rest.hasMore).toBe(false);
    const end = await pullAll(anaLaptop, rest.cursor);
    expect(end).toEqual({ changes: [], cursor: rest.cursor, hasMore: false });
  });

  it("valida la entrada y exige sesión", async () => {
    expect((await call("/v1/sync/pull", null)).status).toBe(401);
    expect((await call("/v1/sync/push", null, { ops: [] })).status).toBe(401);
    const bad = await call("/v1/sync/push", ana, {
      ops: [{ ...accountOp(uuid(), " "), opId: uuid() }],
    });
    expect(bad.status).toBe(400);
    expect(await bad.json()).toMatchObject({
      code: "invalid_sync_push",
      errors: [{ path: "ops[0].record.name" }],
    });
    const notJson = await call("/v1/sync/push", ana, "{");
    expect(notJson.status).toBe(400);
    expect((await call("/v1/sync/pull?cursor=abc", ana)).status).toBe(400);
  });

  it("503 sin base de datos", async () => {
    const auth = createAuth({ db: (await createTestDatabase()).db, env, mailer });
    const offline = createApp({ auth: () => auth, sync: () => undefined });
    await offline.request(
      "http://localhost:8787/v1/auth/email-otp/send-verification-otp",
      {
        method: "POST",
        headers: { Origin: ORIGIN, "Content-Type": "application/json" },
        body: JSON.stringify({ email: "x@lukas.test", type: "sign-in" }),
      },
      env,
    );
    const code = mail.findLast((m) => m.to === "x@lukas.test")?.code ?? "";
    const signed = await offline.request(
      "http://localhost:8787/v1/auth/sign-in/email-otp",
      {
        method: "POST",
        headers: { Origin: ORIGIN, "Content-Type": "application/json" },
        body: JSON.stringify({ email: "x@lukas.test", otp: code }),
      },
      env,
    );
    const token = signed.headers.get("set-auth-token") ?? "";
    const res = await offline.request(
      "http://localhost:8787/v1/sync/pull",
      { headers: { Origin: ORIGIN, Authorization: `Bearer ${token}` } },
      env,
    );
    expect(res.status).toBe(503);
  });
});

describe("fábrica de Neon", () => {
  it("no hay sync sin base y con base crea un pool por petición", async () => {
    expect(neonSyncFactory(testEnv)).toBeUndefined();
    const backend = neonSyncFactory({ ...testEnv, DATABASE_URL: "postgres://u:p@localhost/db" });
    expect(backend?.store).toBeDefined();
    await backend?.close();
  });
});
