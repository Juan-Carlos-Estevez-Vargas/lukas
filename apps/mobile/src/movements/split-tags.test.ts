import { describe, expect, it } from "vitest";
import { cardFixture, cop, local } from "../accounts/card.test-helper";
import { sqliteAccounts } from "../data/ledger-sqlite";
import { receiptFileName } from "../receipts/store";
import { recordMovement } from "./movements";
import { recentTags, tagsOf } from "./tags";

const base = (accountId: string) => ({
  kind: "expense" as const,
  accountId,
  categoryId: "default.mercado",
  amount: cop(100_000n),
  occurredAt: local(2026, 11, 19),
});

describe("movimientos divididos, etiquetas y recibos", () => {
  it("divide el total entre categorías", async () => {
    const { db, card, clock } = await cardFixture({ closingDay: 15, dueDay: 2 });
    const res = await recordMovement(
      db,
      {
        ...base(card.id),
        splits: [
          { categoryId: "default.mercado", amount: cop(70_000n) },
          { categoryId: "default.compras", amount: cop(30_000n) },
        ],
      },
      clock,
    );
    if (!res.ok) throw res.error;
    expect(res.value.entries).toHaveLength(3);
    expect((await sqliteAccounts(db).balance(card)).equals(cop(-100_000n))).toBe(true);
  });

  it("rechaza partes que no suman o con categoría inexistente, sin escribir", async () => {
    const { db, card, clock } = await cardFixture({ closingDay: 15, dueDay: 2 });
    const bad = await recordMovement(
      db,
      { ...base(card.id), splits: [{ categoryId: "default.mercado", amount: cop(1n) }] },
      clock,
    );
    expect(!bad.ok && bad.error.code).toBe("split_mismatch");
    const missing = await recordMovement(
      db,
      { ...base(card.id), splits: [{ categoryId: "no-existe", amount: cop(100_000n) }] },
      clock,
    );
    expect(!missing.ok && missing.error.code).toBe("not_found");
    expect((await sqliteAccounts(db).balance(card)).isZero()).toBe(true);
  });

  it("guarda etiquetas sin duplicar y el recibo", async () => {
    const { db, card, clock } = await cardFixture({ closingDay: 15, dueDay: 2 });
    const first = await recordMovement(
      db,
      {
        ...base(card.id),
        tags: ["Viaje", "#viaje", "Cartagena", " "],
        receipt: { fileName: "r1.jpg", mimeType: "image/jpeg" },
      },
      clock,
    );
    if (!first.ok) throw first.error;
    expect(await tagsOf(db, first.value.id)).toEqual(["Cartagena", "Viaje"]);
    await recordMovement(
      db,
      { ...base(card.id), occurredAt: local(2026, 11, 20), tags: ["VIAJE"] },
      clock,
    );
    expect(await recentTags(db)).toEqual(["Viaje", "Cartagena"]);
    expect((await db.get<{ n: number }>("SELECT count(*) AS n FROM tags"))?.n).toBe(2);
    const att = await db.get<{ file_name: string }>(
      "SELECT file_name FROM attachments WHERE transaction_id = ?",
      first.value.id,
    );
    expect(att?.file_name).toBe("r1.jpg");
  });

  it("la base no acepta rutas como nombre de recibo", async () => {
    const { db, card, clock } = await cardFixture({ closingDay: 15, dueDay: 2 });
    await expect(
      recordMovement(
        db,
        { ...base(card.id), receipt: { fileName: "../../x.jpg", mimeType: "image/jpeg" } },
        clock,
      ),
    ).rejects.toThrow();
    expect((await sqliteAccounts(db).balance(card)).isZero()).toBe(true);
  });
});

describe("receiptFileName", () => {
  it("usa el id y una extensión según el tipo", () => {
    expect(receiptFileName("abc", "image/png")).toEqual({
      fileName: "abc.png",
      mimeType: "image/png",
    });
    expect(receiptFileName("abc", null)).toEqual({ fileName: "abc.jpg", mimeType: "image/jpeg" });
    expect(receiptFileName("abc", "application/pdf").fileName).toBe("abc.jpg");
  });
});
