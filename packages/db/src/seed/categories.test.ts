import { eq, isNull } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { categories } from "../schema";
import { createTestDatabase, insertUsers, newId } from "../test/database";
import { DEFAULT_CATEGORIES, seedDefaultCategories } from "./categories";

describe("semilla de categorías", () => {
  it("crea las categorías por defecto con su jerarquía", async () => {
    const { client, db } = await createTestDatabase();
    await insertUsers(db, "user_1");
    const created = await seedDefaultCategories(db, "user_1", newId);

    const expected = DEFAULT_CATEGORIES.reduce((n, c) => n + 1 + (c.children?.length ?? 0), 0);
    expect(created).toBe(expected);

    const roots = await db.select().from(categories).where(isNull(categories.parentId));
    expect(roots).toHaveLength(DEFAULT_CATEGORIES.length);

    const hogar = roots.find((c) => c.name === "Hogar");
    const children = await db
      .select()
      .from(categories)
      .where(eq(categories.parentId, hogar?.id ?? ""));
    expect(children.map((c) => c.name)).toContain("Arriendo");
    expect(children.every((c) => c.kind === "expense")).toBe(true);

    const system = roots.filter((c) => c.isSystem).map((c) => c.kind);
    expect(system.sort()).toEqual(["equity", "trading"]);
    await client.close();
  });
});
