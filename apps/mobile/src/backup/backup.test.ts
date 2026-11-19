import { Money } from "@lukas/domain";
import { describe, expect, it } from "vitest";
import { createFromTemplate } from "../accounts/accounts";
import { cardFixture, cop, local } from "../accounts/card.test-helper";
import { templateByKey } from "../accounts/templates";
import { createBudget } from "../budgets/budgets";
import { createConnection } from "../data/connection";
import { migrate } from "../data/migrations";
import { nodeSqlite } from "../data/node-sqlite.test-helper";
import { LOCAL_MIGRATIONS } from "../data/schema";
import { createGoal } from "../goals/goals";
import { recordMovement } from "../movements/movements";
import { recordTransfer } from "../movements/transfers";
import { createRecurring } from "../recurring/recurring";
import { backupFileName, createBackup, restoreBackup } from "./backup";
import { BackupError, decryptBackup, encryptBackup, fromBase64, toBase64 } from "./crypto";
import { csvCell, movementsCsv } from "./csv";
import { BACKUP_TABLES, exportSnapshot, parseSnapshot, restoreSnapshot } from "./snapshot";

const FAST = { N: 2 ** 10, r: 8, p: 1 };
let seed = 0;
const random = (size: number) => Uint8Array.from({ length: size }, () => (seed++ * 37) & 0xff);
const today = { year: 2026, month: 11, day: 19 };

async function emptyDb() {
  const node = nodeSqlite();
  node.raw.exec("PRAGMA foreign_keys = ON");
  const db = createConnection(node);
  await migrate(db, LOCAL_MIGRATIONS);
  return db;
}

async function fullDb() {
  const fx = await cardFixture({ closingDay: 15, dueDay: 2 });
  const tpl = templateByKey("nequi");
  if (!tpl) throw new Error("falta Nequi");
  const nequi = await createFromTemplate(fx.db, tpl, { openingBalance: cop(500_000n) }, fx.clock);
  if (!nequi.ok) throw nequi.error;
  await fx.db.run(
    `INSERT INTO categories (id, parent_id, name, kind, created_at, updated_at)
     VALUES ('aseo', 'default.mercado', 'Aseo', 'expense', '2026-01-01', '2026-01-01')`,
  );
  const mov = await recordMovement(
    fx.db,
    {
      kind: "expense",
      accountId: nequi.value.id,
      categoryId: "aseo",
      amount: cop(45_900n),
      occurredAt: local(2026, 11, 3),
      merchant: "Éxito; Calle 80",
      note: '=HYPERLINK("x")',
      tags: ["hogar", "mes"],
    },
    fx.clock,
  );
  if (!mov.ok) throw mov.error;
  const tr = await recordTransfer(
    fx.db,
    {
      fromAccountId: nequi.value.id,
      toAccountId: fx.card.id,
      amount: cop(100_000n),
      occurredAt: local(2026, 11, 4),
    },
    fx.clock,
  );
  if (!tr.ok) throw tr.error;
  await createRecurring(
    fx.db,
    {
      name: "Arriendo",
      kind: "expense",
      accountId: nequi.value.id,
      categoryId: "default.arriendo",
      amount: cop(1_000_000n),
      recurrence: { frequency: "monthly", every: 1, startsOn: today, endsOn: null },
      autoPost: true,
      remind: true,
    },
    today,
    fx.clock,
  );
  await createBudget(
    fx.db,
    { categoryId: "default.mercado", period: "monthly", amount: cop(600_000n), rollover: true },
    today,
    fx.clock,
  );
  await createGoal(
    fx.db,
    {
      name: "Viaje",
      target: cop(3_000_000n),
      targetDate: { year: 2027, month: 6, day: 1 },
      accountId: null,
    },
    today,
    fx.clock,
  );
  return fx;
}

const dump = async (db: Awaited<ReturnType<typeof emptyDb>>) => {
  const out: Record<string, unknown[]> = {};
  for (const name of BACKUP_TABLES) out[name] = await db.all(`SELECT * FROM ${name} ORDER BY 1, 2`);
  return out;
};

describe("respaldo cifrado", () => {
  it("borrar y restaurar recupera todos los datos", async () => {
    const fx = await fullDb();
    const before = await dump(fx.db);
    const snapshot = await exportSnapshot(fx.db, new Date("2026-11-19T12:00:00Z"));
    const file = await encryptBackup(
      new TextEncoder().encode(JSON.stringify(snapshot)),
      "una clave larga",
      random,
      FAST,
    );
    expect(file).not.toContain("Éxito");

    const fresh = await emptyDb();
    const plain = await decryptBackup(file, "una clave larga");
    const restored = await restoreSnapshot(fresh, parseSnapshot(new TextDecoder().decode(plain)));
    expect(restored).toBeGreaterThan(20);
    expect(await dump(fresh)).toEqual(before);
  });

  it("restaurar reemplaza lo que había y deja todo igual si algo falla", async () => {
    const fx = await fullDb();
    const target = await fullDb();
    await target.db.run("UPDATE goals SET name = 'Otra'");
    await restoreSnapshot(target.db, await exportSnapshot(fx.db, new Date()));
    expect(await dump(target.db)).toEqual(await dump(fx.db));

    const before = await dump(target.db);
    const broken = parseSnapshot(
      JSON.stringify({
        format: "lukas-snapshot",
        schemaVersion: 1,
        tables: {
          entries: [
            {
              id: "e",
              transaction_id: "nada",
              amount_minor: 1,
              currency: "COP",
              account_id: "nada",
            },
          ],
        },
      }),
    );
    await expect(restoreSnapshot(target.db, broken)).rejects.toThrow();
    expect(await dump(target.db)).toEqual(before);
  });

  it("rechaza respaldos de una versión más nueva, tablas raras y columnas inventadas", async () => {
    const db = await emptyDb();
    const code = async (work: () => Promise<unknown> | unknown) => {
      try {
        await work();
        return null;
      } catch (error) {
        return error instanceof BackupError ? error.code : "otro";
      }
    };
    const snap = (body: unknown) => JSON.stringify(body);
    expect(
      await code(() =>
        restoreSnapshot(
          db,
          parseSnapshot(snap({ format: "lukas-snapshot", schemaVersion: 999, tables: {} })),
        ),
      ),
    ).toBe("too_new");
    expect(await code(() => parseSnapshot("no es json"))).toBe("invalid_file");
    expect(await code(() => parseSnapshot("null"))).toBe("invalid_file");
    expect(
      await code(() => parseSnapshot(snap({ format: "otro", schemaVersion: 1, tables: {} }))),
    ).toBe("invalid_file");
    expect(
      await code(() => parseSnapshot(snap({ format: "lukas-snapshot", schemaVersion: 1 }))),
    ).toBe("invalid_file");
    expect(
      await code(() =>
        parseSnapshot(
          snap({ format: "lukas-snapshot", schemaVersion: 1, tables: { sqlite_master: [] } }),
        ),
      ),
    ).toBe("invalid_file");
    expect(
      await code(() =>
        parseSnapshot(
          snap({ format: "lukas-snapshot", schemaVersion: 1, tables: { tags: [{ id: {} }] } }),
        ),
      ),
    ).toBe("invalid_file");
    expect(
      await code(() =>
        parseSnapshot(snap({ format: "lukas-snapshot", schemaVersion: 1, tables: { tags: "x" } })),
      ),
    ).toBe("invalid_file");
    const injected = parseSnapshot(
      snap({
        format: "lukas-snapshot",
        schemaVersion: 1,
        tables: { tags: [{ "id) VALUES (1); DROP TABLE accounts; --": "x" }] },
      }),
    );
    expect(await code(() => restoreSnapshot(db, injected))).toBe("invalid_file");
    expect(await db.get("SELECT 1 AS x FROM sqlite_master WHERE name = 'accounts'")).not.toBeNull();
  });

  it("contraseña equivocada, archivo alterado y contraseña corta", async () => {
    const file = await encryptBackup(new Uint8Array([1, 2, 3]), "correcta123", random, FAST);
    const code = async (work: () => Promise<unknown>) => {
      try {
        await work();
        return null;
      } catch (error) {
        return error instanceof BackupError ? error.code : "otro";
      }
    };
    expect(await decryptBackup(file, "correcta123")).toEqual(new Uint8Array([1, 2, 3]));
    expect(await code(() => decryptBackup(file, "otra clave"))).toBe("wrong_password");
    const env = JSON.parse(file);
    const tampered = JSON.stringify({
      ...env,
      data: toBase64(fromBase64(env.data).map((b, i) => (i === 0 ? b ^ 1 : b))),
    });
    expect(await code(() => decryptBackup(tampered, "correcta123"))).toBe("wrong_password");
    expect(
      await code(() =>
        decryptBackup(JSON.stringify({ ...env, kdf: { ...env.kdf, N: 2 ** 30 } }), "x"),
      ),
    ).toBe("invalid_file");
    expect(
      await code(() => decryptBackup(JSON.stringify({ ...env, data: "%%%" }), "correcta123")),
    ).toBe("invalid_file");
    expect(await code(() => decryptBackup("{}", "x"))).toBe("invalid_file");
    expect(await code(() => decryptBackup("no", "x"))).toBe("invalid_file");
    expect(await code(() => encryptBackup(new Uint8Array(), "corta", random, FAST))).toBe(
      "weak_password",
    );
  });

  it("base64 de ida y vuelta con todos los rellenos", () => {
    for (const n of [0, 1, 2, 3, 4, 5, 255]) {
      const bytes = Uint8Array.from({ length: n }, (_, i) => (i * 97) & 0xff);
      expect(fromBase64(toBase64(bytes))).toEqual(bytes);
    }
    expect(toBase64(new TextEncoder().encode("Lukas"))).toBe("THVrYXM=");
  });
});

describe("exportar CSV", () => {
  it("una fila por cuenta, con categorías, etiquetas y celdas seguras", async () => {
    const fx = await fullDb();
    const csv = await movementsCsv(fx.db, {
      headers: [
        "Fecha",
        "Tipo",
        "Cuenta",
        "Categoría",
        "Comercio",
        "Nota",
        "Monto",
        "Moneda",
        "Etiquetas",
      ],
      kinds: {
        expense: "Gasto",
        income: "Ingreso",
        transfer: "Transferencia",
        adjustment: "Ajuste",
      },
    });
    expect(csv.startsWith("﻿Fecha;Tipo;Cuenta;")).toBe(true);
    const lines = csv.trim().split("\r\n");
    expect(lines).toContain(
      `2026-11-03;Gasto;Nequi;Aseo;"Éxito; Calle 80";"'=HYPERLINK(""x"")";-45900,00;COP;hogar, mes`,
    );
    expect(lines.filter((l) => l.includes(";Transferencia;"))).toEqual([
      "2026-11-04;Transferencia;Nequi;;;;-100000,00;COP;",
      "2026-11-04;Transferencia;Visa;;;;100000,00;COP;",
    ]);
    expect(lines.some((l) => l.includes(";Ajuste;Nequi;"))).toBe(true);
  });

  it("neutraliza fórmulas y escapa comillas y saltos de línea", () => {
    expect(csvCell("+57 300")).toBe("'+57 300");
    expect(csvCell("@SUM")).toBe("'@SUM");
    expect(csvCell('dice "hola"')).toBe('"dice ""hola"""');
    expect(csvCell("dos\nlíneas")).toBe('"dos\nlíneas"');
    expect(csvCell("normal")).toBe("normal");
    expect(Money.zero("COP").isZero()).toBe(true);
  });
});

describe("flujo completo", () => {
  it("crea el archivo y lo restaura con la misma contraseña", async () => {
    const fx = await fullDb();
    const file = await createBackup(fx.db, "clave segura", random, new Date());
    const fresh = await emptyDb();
    expect(await restoreBackup(fresh, file, "clave segura")).toBeGreaterThan(20);
    expect(await dump(fresh)).toEqual(await dump(fx.db));
    expect(backupFileName(new Date(2026, 0, 5), "csv")).toBe("lukas-2026-01-05.csv");
  }, 30_000);
});
