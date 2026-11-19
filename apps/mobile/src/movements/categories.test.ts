import { describe, expect, it } from "vitest";
import { cardFixture, cop, local } from "../accounts/card.test-helper";
import {
  addRule,
  archiveCategory,
  categoryTree,
  createCategory,
  listRules,
  removeRule,
  renameCategory,
} from "./categories";
import { recategorize, recordMovement, suggestCategory } from "./movements";

async function setup() {
  const fx = await cardFixture({ closingDay: 15, dueDay: 2 });
  const spend = (merchant: string, categoryId: string, suggested?: string | null) =>
    recordMovement(
      fx.db,
      {
        kind: "expense",
        accountId: fx.card.id,
        categoryId,
        amount: cop(10_000n),
        occurredAt: local(2026, 11, 19),
        merchant,
        ...(suggested !== undefined ? { suggestedCategoryId: suggested } : {}),
      },
      fx.clock,
    );
  return { ...fx, spend };
}

describe("jerarquía", () => {
  it("crea subcategorías con ícono y arma el árbol", async () => {
    const { db, clock } = await setup();
    const res = await createCategory(
      db,
      { name: " Mascotas ", kind: "expense", icon: "🐶" },
      clock,
    );
    if (!res.ok) throw res.error;
    const child = await createCategory(
      db,
      { name: "Veterinario", kind: "expense", parentId: res.value, icon: "🩺" },
      clock,
    );
    expect(child.ok).toBe(true);
    const tree = await categoryTree(db, "expense");
    const pets = tree.find((n) => n.id === res.value);
    expect(pets).toMatchObject({ name: "Mascotas", icon: "🐶" });
    expect(pets?.children.map((c) => c.name)).toEqual(["Veterinario"]);
    expect(tree.some((n) => n.name === "Veterinario")).toBe(false);
  });

  it("valida nombre, tipo de la madre y un solo nivel", async () => {
    const { db, clock } = await setup();
    const empty = await createCategory(db, { name: " ", kind: "expense" }, clock);
    expect(!empty.ok && empty.error.code).toBe("category_name_required");
    const other = await createCategory(
      db,
      { name: "X", kind: "expense", parentId: "default.salario" },
      clock,
    );
    expect(!other.ok && other.error.code).toBe("invalid_category");
    const child = await createCategory(
      db,
      { name: "Hija", kind: "expense", parentId: "default.mercado" },
      clock,
    );
    if (!child.ok) throw child.error;
    const deep = await createCategory(
      db,
      { name: "Nieta", kind: "expense", parentId: child.value },
      clock,
    );
    expect(!deep.ok && deep.error.code).toBe("too_deep");
    const system = await createCategory(
      db,
      { name: "Y", kind: "expense", parentId: "system.cambio" },
      clock,
    );
    expect(!system.ok && system.error.code).toBe("not_found");
  });

  it("renombra y archiva con sus hijas; una hija huérfana sube a la raíz", async () => {
    const { db, clock } = await setup();
    const child = await createCategory(
      db,
      { name: "Aseo", kind: "expense", parentId: "default.mercado" },
      clock,
    );
    if (!child.ok) throw child.error;
    expect(
      (await renameCategory(db, "default.mercado", { name: "Súper", icon: "🧺" }, new Date())).ok,
    ).toBe(true);
    const bad = await renameCategory(db, "default.mercado", { name: "" }, new Date());
    expect(!bad.ok && bad.error.code).toBe("category_name_required");
    expect((await categoryTree(db, "expense")).find((n) => n.id === "default.mercado")?.name).toBe(
      "Súper",
    );
    await db.run("UPDATE categories SET archived_at = 'x' WHERE id = 'default.mercado'");
    expect((await categoryTree(db, "expense")).some((n) => n.id === child.value)).toBe(true);
    await db.run("UPDATE categories SET archived_at = NULL WHERE id = 'default.mercado'");
    await archiveCategory(db, "default.mercado", new Date());
    const ids = (await categoryTree(db, "expense")).map((n) => n.id);
    expect(ids).not.toContain("default.mercado");
    expect(ids).not.toContain(child.value);
  });
});

describe("reglas", () => {
  it("una regla de la persona gana sobre el historial", async () => {
    const { db, clock, spend } = await setup();
    await spend("Tienda Don José", "default.mercado");
    expect(await suggestCategory(db, "Tienda Don José", "expense")).toBe("default.mercado");
    await addRule(
      db,
      { match: "keyword", pattern: "don jose", categoryId: "default.compras" },
      clock,
    );
    expect(await suggestCategory(db, "TIENDA DON JOSÉ", "expense")).toBe("default.compras");
    const empty = await addRule(db, { match: "keyword", pattern: " ", categoryId: "x" }, clock);
    expect(!empty.ok && empty.error.code).toBe("rule_pattern_required");
    const rules = await listRules(db);
    expect(rules).toHaveLength(1);
    await removeRule(db, rules[0]?.id ?? "");
    expect(await listRules(db)).toHaveLength(0);
  });

  it("al corregir la sugerencia, el siguiente del mismo comercio sale bien", async () => {
    const { db, spend } = await setup();
    // Tres veces en Mercado: el historial diría Mercado.
    await spend("Éxito", "default.mercado");
    await spend("Éxito", "default.mercado");
    expect(await suggestCategory(db, "Éxito", "expense")).toBe("default.mercado");
    await spend("Éxito", "default.compras", "default.mercado");
    expect(await suggestCategory(db, "exito", "expense")).toBe("default.compras");
    // Aceptar la sugerencia no aprende nada nuevo.
    await spend("Éxito", "default.compras", "default.compras");
    expect((await listRules(db)).map((r) => [r.source, r.pattern, r.categoryId])).toEqual([
      ["learned", "exito", "default.compras"],
    ]);
    // Una regla aprendida no aplica a otro tipo de movimiento.
    expect(await suggestCategory(db, "Éxito", "income")).toBeNull();
  });

  it("recategorizar un movimiento corrige y aprende", async () => {
    const { db, clock, spend } = await setup();
    const res = await spend("Rappi", "default.restaurantes");
    if (!res.ok) throw res.error;
    expect((await recategorize(db, res.value.id, "default.mercado", clock)).ok).toBe(true);
    expect(await suggestCategory(db, "Rappi", "expense")).toBe("default.mercado");
    const cat = await db.get<{ category_id: string }>(
      "SELECT category_id FROM entries WHERE transaction_id = ? AND category_id IS NOT NULL",
      res.value.id,
    );
    expect(cat?.category_id).toBe("default.mercado");
    const wrong = await recategorize(db, res.value.id, "default.salario", clock);
    expect(!wrong.ok && wrong.error.code).toBe("invalid_category");
    const missing = await recategorize(db, "no-existe", "default.mercado", clock);
    expect(!missing.ok && missing.error.code).toBe("not_found");
  });
});
