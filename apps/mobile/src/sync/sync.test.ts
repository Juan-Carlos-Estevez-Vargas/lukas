import { Money } from "@lukas/domain";
import {
  type Change,
  type Operation,
  type OpResult,
  type PullResponse,
  parsePushRequest,
  type SyncRecord,
} from "@lukas/sync";
import { describe, expect, it } from "vitest";
import { createFromTemplate } from "../accounts/accounts";
import { templateByKey } from "../accounts/templates";
import { createConnection } from "../data/connection";
import { migrate } from "../data/migrations";
import { nodeSqlite } from "../data/node-sqlite.test-helper";
import { LOCAL_MIGRATIONS } from "../data/schema";
import type { SqlConnection } from "../data/sql";
import { recordMovement } from "../movements/movements";
import { createSyncApi, type SyncApi, SyncHttpError } from "./client";
import { syncNow, syncStatus } from "./sync";

const USER = "user_ana";

/** Servidor en memoria con las mismas reglas que /v1/sync: versiones, opId y registro de cambios. */
function fakeServer() {
  const records = new Map<string, { version: number; record: SyncRecord }>();
  const log: { seq: number; entity: string; id: string; op: "upsert" | "delete" }[] = [];
  const seen = new Map<string, OpResult>();
  let reject: ((op: Operation) => string | null) | null = null;
  const apply = (op: Operation): OpResult => {
    const prior = seen.get(op.opId);
    if (prior) return prior.status === "applied" ? { ...prior, status: "duplicate" } : prior;
    const id = op.kind === "upsert" ? op.record.id : op.id;
    const key = `${op.entity}:${id}`;
    const current = records.get(key);
    if (current && current.version !== op.baseVersion) {
      return {
        opId: op.opId,
        status: "conflict",
        version: current.version,
        current: current.record,
      };
    }
    const reason = reject?.(op);
    if (reason) return { opId: op.opId, status: "rejected", reason };
    const version = (current?.version ?? 0) + 1;
    if (op.kind === "upsert") records.set(key, { version, record: op.record });
    else records.delete(key);
    log.push({ seq: log.length + 1, entity: op.entity, id, op: op.kind });
    const result: OpResult = { opId: op.opId, status: "applied", version };
    seen.set(op.opId, result);
    return result;
  };
  const api: SyncApi = {
    push: async (ops) => ({
      results: parsePushRequest(JSON.parse(JSON.stringify({ ops }))).ops.map(apply),
    }),
    pull: async (cursor): Promise<PullResponse> => {
      const page = log.filter((c) => c.seq > Number(cursor)).slice(0, 3);
      const changes: Change[] = page.map((c) => {
        const r = records.get(`${c.entity}:${c.id}`);
        return r
          ? ({ entity: c.entity, kind: "upsert", version: r.version, record: r.record } as Change)
          : ({ entity: c.entity, kind: "delete", id: c.id } as Change);
      });
      const last = page.at(-1)?.seq ?? Number(cursor);
      return { changes, cursor: String(last), hasMore: log.some((c) => c.seq > last) };
    },
  };
  return {
    api,
    records,
    rejectWhen: (fn: (op: Operation) => string | null) => {
      reject = fn;
    },
    edit: (entity: string, id: string, change: (r: SyncRecord) => SyncRecord) => {
      const key = `${entity}:${id}`;
      const r = records.get(key);
      if (!r) throw new Error("no existe");
      records.set(key, { version: r.version + 1, record: change(r.record) });
      log.push({ seq: log.length + 1, entity, id, op: "upsert" });
    },
  };
}

let ids = 0;
const uuid = () => `0190f3a0-0000-7000-8000-${String(++ids).padStart(12, "0")}`;
const clock = { newId: uuid, now: () => new Date("2026-11-19T15:00:00Z") };

async function phone(): Promise<SqlConnection> {
  const node = nodeSqlite();
  node.raw.exec("PRAGMA foreign_keys = ON");
  const db = createConnection(node);
  await migrate(db, LOCAL_MIGRATIONS);
  return db;
}

async function withNequiAndExpense(db: SqlConnection) {
  const tpl = templateByKey("nequi");
  if (!tpl) throw new Error("falta Nequi");
  const nequi = await createFromTemplate(db, tpl, {}, clock);
  if (!nequi.ok) throw nequi.error;
  const spent = await recordMovement(
    db,
    {
      kind: "expense",
      accountId: nequi.value.id,
      categoryId: "default.mercado",
      amount: Money.ofMinor(2_500_000n, "COP"),
      occurredAt: new Date("2026-11-19T15:00:00Z"),
      merchant: "Éxito",
    },
    clock,
  );
  if (!spent.ok) throw spent.error;
  return { nequi: nequi.value.id, expense: spent.value.id };
}

const count = async (db: SqlConnection, sql: string, ...params: string[]) =>
  (await db.get<{ n: number }>(`SELECT count(*) AS n FROM ${sql}`, ...params))?.n ?? 0;

describe("sincronización del teléfono", () => {
  it("lo hecho sin conexión llega a otro teléfono al sincronizar", async () => {
    const server = fakeServer();
    const a = await phone();
    const b = await phone();
    const { nequi, expense } = await withNequiAndExpense(a);

    const first = await syncNow(a, server.api, USER);
    expect(first.pushed).toBeGreaterThan(10); // cuenta, categorías por defecto y el gasto
    expect((await syncStatus(a)).pending).toBe(0);

    const got = await syncNow(b, server.api, USER);
    expect(got.pulled).toBeGreaterThan(10);
    const row = await b.get<{ merchant: string; search_text: string }>(
      "SELECT merchant, search_text FROM transactions WHERE id = ?",
      expense,
    );
    expect(row).toEqual({ merchant: "Éxito", search_text: expect.stringContaining("exito") });
    // Las categorías por defecto vuelven a su id local, no al UUID del servidor.
    expect(
      await count(
        b,
        "entries WHERE transaction_id = ? AND category_id = 'default.mercado'",
        expense,
      ),
    ).toBe(1);
    expect(await count(b, "accounts WHERE id = ?", nequi)).toBe(1);
    // Lo que se aplicó desde el servidor no vuelve a la cola.
    expect((await syncStatus(b)).pending).toBe(0);
  });

  it("los cambios posteriores viajan con su versión y los borrados también", async () => {
    const server = fakeServer();
    const a = await phone();
    const b = await phone();
    const { nequi, expense } = await withNequiAndExpense(a);
    await syncNow(a, server.api, USER);
    await syncNow(b, server.api, USER);

    await a.run("UPDATE accounts SET name = 'Nequi Ana' WHERE id = ?", nequi);
    await a.run("DELETE FROM transactions WHERE id = ?", expense);
    expect((await syncStatus(a)).pending).toBe(2);
    expect(await syncNow(a, server.api, USER)).toMatchObject({ pushed: 2, conflicts: 0 });
    expect(server.records.get(`accounts:${nequi}`)?.version).toBe(2);

    await syncNow(b, server.api, USER);
    expect(await b.get("SELECT name FROM accounts WHERE id = ?", nequi)).toEqual({
      name: "Nequi Ana",
    });
    expect(await count(b, "transactions WHERE id = ?", expense)).toBe(0);
  });

  it("reintentar tras un corte no duplica: el opId es el mismo", async () => {
    const server = fakeServer();
    const a = await phone();
    await withNequiAndExpense(a);
    const flaky: SyncApi = {
      push: async (ops) => {
        await server.api.push(ops); // el servidor lo aplica…
        throw new Error("se cayó la red"); // …pero la respuesta no llega
      },
      pull: server.api.pull,
    };
    await expect(syncNow(a, flaky, USER)).rejects.toThrow("se cayó la red");
    expect((await syncStatus(a)).lastError).toBe("se cayó la red");
    const retry = await syncNow(a, server.api, USER);
    expect(retry.conflicts).toBe(0);
    expect((await syncStatus(a)).pending).toBe(0);
  });

  it("lo rechazado sale de la cola y queda el motivo", async () => {
    const server = fakeServer();
    const a = await phone();
    const { nequi } = await withNequiAndExpense(a);
    await syncNow(a, server.api, USER);
    server.rejectWhen((op) => (op.entity === "accounts" ? "invalid" : null));
    await a.run("UPDATE accounts SET institution = 'X' WHERE id = ?", nequi);
    const rejected = await syncNow(a, server.api, USER);
    expect(rejected.rejected).toBe(1);
    expect(await syncStatus(a)).toMatchObject({ pending: 0, lastError: "accounts:invalid" });
  });

  it("un borrado del servidor archiva la cuenta si aún tiene movimientos", async () => {
    const server = fakeServer();
    const a = await phone();
    const b = await phone();
    const { nequi } = await withNequiAndExpense(a);
    await syncNow(a, server.api, USER);
    await syncNow(b, server.api, USER);
    // Otro dispositivo borra la cuenta en el servidor, pero en b sigue teniendo asientos.
    await server.api.push([
      { opId: uuid(), entity: "accounts", kind: "delete", id: nequi, baseVersion: 1 },
    ]);
    await syncNow(b, server.api, USER);
    const row = await b.get<{ archived_at: string | null }>(
      "SELECT archived_at FROM accounts WHERE id = ?",
      nequi,
    );
    expect(row?.archived_at).not.toBeNull();
  });
});

describe("conflictos entre dos teléfonos (FIN-203)", () => {
  const edit = (db: SqlConnection, sql: string, minute: number, id: string) =>
    db.run(
      sql.replace(
        "SET ",
        `SET updated_at = '2026-11-19T16:${String(minute).padStart(2, "0")}:00.000Z', `,
      ),
      id,
    );

  async function twoPhones() {
    const server = fakeServer();
    const a = await phone();
    const b = await phone();
    const data = await withNequiAndExpense(a);
    await syncNow(a, server.api, USER);
    await syncNow(b, server.api, USER);
    return { server, a, b, ...data };
  }

  const settle = async (server: ReturnType<typeof fakeServer>, ...phones: SqlConnection[]) => {
    for (const p of [...phones, ...phones]) await syncNow(p, server.api, USER);
  };

  it("editar campos distintos sin conexión conserva ambos cambios en los dos", async () => {
    const { server, a, b, nequi } = await twoPhones();
    await edit(a, "UPDATE accounts SET name = 'Nequi Ana' WHERE id = ?", 1, nequi);
    await edit(b, "UPDATE accounts SET institution = 'Nequi S.A.' WHERE id = ?", 2, nequi);
    await settle(server, a, b);
    for (const p of [a, b]) {
      expect(await p.get("SELECT name, institution FROM accounts WHERE id = ?", nequi)).toEqual({
        name: "Nequi Ana",
        institution: "Nequi S.A.",
      });
    }
    expect(await count(b, "sync_conflicts")).toBe(0);
  });

  it("el mismo campo editado en ambos: gana la edición más reciente y queda registro", async () => {
    const { server, a, b, nequi, expense } = await twoPhones();
    await edit(
      a,
      "UPDATE transactions SET notes = 'nota vieja del teléfono A' WHERE id = ?",
      1,
      expense,
    );
    await edit(
      b,
      "UPDATE transactions SET notes = 'nota nueva del teléfono B' WHERE id = ?",
      9,
      expense,
    );
    await edit(a, "UPDATE accounts SET name = 'Nueva de A' WHERE id = ?", 8, nequi);
    await edit(b, "UPDATE accounts SET name = 'Vieja de B' WHERE id = ?", 2, nequi);
    await settle(server, a, b);
    for (const p of [a, b]) {
      expect(await p.get("SELECT notes FROM transactions WHERE id = ?", expense)).toEqual({
        notes: "nota nueva del teléfono B",
      });
      expect(await p.get("SELECT name FROM accounts WHERE id = ?", nequi)).toEqual({
        name: "Nueva de A",
      });
    }
    const log = await b.all<{ field: string; kept: string; local_value: string }>(
      "SELECT field, kept, local_value FROM sync_conflicts ORDER BY id",
    );
    expect(log).toEqual(
      expect.arrayContaining([
        { field: "notes", kept: "local", local_value: JSON.stringify("nota nueva del teléfono B") },
        { field: "name", kept: "server", local_value: JSON.stringify("Vieja de B") },
      ]),
    );
  });

  it("borrar en uno y editar en otro: la edición no se pierde", async () => {
    const { server, a, b, expense } = await twoPhones();
    await edit(a, "UPDATE transactions SET merchant = 'Carulla' WHERE id = ?", 3, expense);
    await b.run("DELETE FROM transactions WHERE id = ?", expense);
    await settle(server, a, b);
    for (const p of [a, b]) {
      expect(await p.get("SELECT merchant FROM transactions WHERE id = ?", expense)).toEqual({
        merchant: "Carulla",
      });
    }

    // Al revés: primero llega el borrado y después la edición de un teléfono que no se enteró.
    await b.run("DELETE FROM transactions WHERE id = ?", expense);
    await syncNow(b, server.api, USER);
    await edit(a, "UPDATE transactions SET merchant = 'Olímpica' WHERE id = ?", 4, expense);
    await settle(server, a, b);
    for (const p of [a, b]) {
      expect(await p.get("SELECT merchant FROM transactions WHERE id = ?", expense)).toEqual({
        merchant: "Olímpica",
      });
    }
  });
});

describe("cliente HTTP del sync", () => {
  it("manda el token y lanza con el estado si falla", async () => {
    const calls: { url: string; init: RequestInit | undefined }[] = [];
    const api = createSyncApi("https://api.test", "tok", async (url, init) => {
      calls.push({ url, init });
      return url.includes("pull")
        ? new Response(JSON.stringify({ changes: [], cursor: "5", hasMore: false }))
        : new Response("{}", { status: 503 });
    });
    expect(await api.pull("0")).toEqual({ changes: [], cursor: "5", hasMore: false });
    expect(calls[0]?.url).toBe("https://api.test/v1/sync/pull?cursor=0");
    expect(new Headers(calls[0]?.init?.headers).get("authorization")).toBe("Bearer tok");
    await expect(api.push([])).rejects.toBeInstanceOf(SyncHttpError);
  });
});
