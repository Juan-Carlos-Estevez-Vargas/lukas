import {
  type CategoryRule,
  DomainError,
  err,
  learnFromCorrection,
  type MovementKind,
  merchantKey,
  ok,
  type Result,
} from "@lukas/domain";
import type { Clock } from "../accounts/accounts";
import type { SqlConnection } from "../data/sql";

export interface CategoryNode {
  readonly id: string;
  readonly name: string;
  readonly kind: MovementKind;
  readonly icon: string | null;
  readonly parentId: string | null;
  readonly children: readonly CategoryNode[];
}

interface CategoryRow {
  id: string;
  name: string;
  kind: MovementKind;
  icon: string | null;
  parent_id: string | null;
}

/** Árbol de categorías activas de un tipo: padres en orden alfabético con sus hijas. */
export async function categoryTree(db: SqlConnection, kind: MovementKind): Promise<CategoryNode[]> {
  const rows = await db.all<CategoryRow>(
    `SELECT id, name, kind, icon, parent_id FROM categories
     WHERE kind = ? AND archived_at IS NULL AND is_system = 0 ORDER BY name`,
    kind,
  );
  const node = (r: CategoryRow, children: CategoryNode[] = []): CategoryNode => ({
    id: r.id,
    name: r.name,
    kind: r.kind,
    icon: r.icon,
    parentId: r.parent_id,
    children,
  });
  const ids = new Set(rows.map((r) => r.id));
  // Una hija cuyo padre está archivado sube a la raíz para no perderse.
  const roots = rows.filter((r) => !r.parent_id || !ids.has(r.parent_id));
  return roots.map((p) =>
    node(
      p,
      rows.filter((c) => c.parent_id === p.id).map((c) => node(c)),
    ),
  );
}

const fail = (code: string, message: string) => err(new DomainError(code, message));

export interface NewCategory {
  readonly name: string;
  readonly kind: MovementKind;
  readonly icon?: string | null;
  readonly parentId?: string | null;
}

/** Crea una categoría o subcategoría. Solo un nivel: la madre no puede ser a su vez hija. */
export async function createCategory(
  db: SqlConnection,
  input: NewCategory,
  clock: Clock,
): Promise<Result<string, DomainError>> {
  const name = input.name.trim().replace(/\s+/g, " ");
  if (!name) return fail("category_name_required", "La categoría necesita un nombre");
  if (input.parentId) {
    const parent = await db.get<{ kind: string; parent_id: string | null; is_system: number }>(
      "SELECT kind, parent_id, is_system FROM categories WHERE id = ? AND archived_at IS NULL",
      input.parentId,
    );
    if (!parent || parent.is_system) return fail("not_found", "No existe la categoría madre");
    if (parent.kind !== input.kind) return fail("invalid_category", "La madre es de otro tipo");
    if (parent.parent_id) return fail("too_deep", "Las subcategorías no pueden tener hijas");
  }
  const id = clock.newId();
  const now = clock.now().toISOString();
  await db.run(
    `INSERT INTO categories (id, parent_id, name, kind, icon, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
    id,
    input.parentId ?? null,
    name,
    input.kind,
    input.icon?.trim() || null,
    now,
    now,
  );
  return ok(id);
}

export async function renameCategory(
  db: SqlConnection,
  id: string,
  changes: { name: string; icon?: string | null },
  now: Date,
): Promise<Result<true, DomainError>> {
  const name = changes.name.trim().replace(/\s+/g, " ");
  if (!name) return fail("category_name_required", "La categoría necesita un nombre");
  await db.run(
    `UPDATE categories SET name = ?, icon = ?, updated_at = ?, version = version + 1
     WHERE id = ? AND is_system = 0`,
    name,
    changes.icon?.trim() || null,
    now.toISOString(),
    id,
  );
  return ok(true);
}

/** Archiva la categoría y sus hijas. Los movimientos ya registrados la conservan. */
export async function archiveCategory(db: SqlConnection, id: string, now: Date): Promise<void> {
  await db.run(
    `UPDATE categories SET archived_at = ?, updated_at = ?, version = version + 1
     WHERE (id = ? OR parent_id = ?) AND is_system = 0 AND archived_at IS NULL`,
    now.toISOString(),
    now.toISOString(),
    id,
    id,
  );
}

interface RuleRow {
  id: string;
  match: "merchant" | "keyword";
  pattern: string;
  category_id: string;
  source: "user" | "learned";
  updated_at: string;
}

/** Reglas cuya categoría sigue activa, opcionalmente solo de un tipo de movimiento. */
export async function listRules(db: SqlConnection, kind?: MovementKind): Promise<CategoryRule[]> {
  const rows = await db.all<RuleRow>(
    `SELECT r.id, r.match, r.pattern, r.category_id, r.source, r.updated_at
     FROM category_rules r JOIN categories c ON c.id = r.category_id
     WHERE c.archived_at IS NULL ${kind ? "AND c.kind = ?" : ""}
     ORDER BY r.source DESC, r.pattern`,
    ...(kind ? [kind] : []),
  );
  return rows.map((r) => ({
    id: r.id,
    match: r.match,
    pattern: r.pattern,
    categoryId: r.category_id,
    source: r.source,
    updatedAt: new Date(r.updated_at),
  }));
}

/** Regla escrita por la persona: "si el comercio es X" o "si contiene la palabra X". */
export async function addRule(
  db: SqlConnection,
  input: { match: "merchant" | "keyword"; pattern: string; categoryId: string },
  clock: Clock,
): Promise<Result<true, DomainError>> {
  const pattern = merchantKey(input.pattern);
  if (!pattern) return fail("rule_pattern_required", "Escribe el comercio o la palabra");
  const now = clock.now().toISOString();
  await db.run(
    `INSERT INTO category_rules (id, match, pattern, category_id, source, created_at, updated_at)
     VALUES (?, ?, ?, ?, 'user', ?, ?)
     ON CONFLICT (source, match, pattern) DO UPDATE SET category_id = excluded.category_id,
       updated_at = excluded.updated_at`,
    clock.newId(),
    input.match,
    pattern,
    input.categoryId,
    now,
    now,
  );
  return ok(true);
}

export async function removeRule(db: SqlConnection, id: string): Promise<void> {
  await db.run("DELETE FROM category_rules WHERE id = ?", id);
}

/**
 * Si la persona eligió otra categoría que la sugerida para un comercio, guarda (o reemplaza) la
 * regla aprendida para que la próxima vez salga bien.
 */
export async function learnCorrection(
  db: SqlConnection,
  merchant: string | null,
  suggested: string | null,
  chosen: string,
  clock: Clock,
): Promise<boolean> {
  const lesson = learnFromCorrection(merchant, suggested, chosen);
  if (!lesson) return false;
  const now = clock.now().toISOString();
  await db.run(
    `INSERT INTO category_rules (id, match, pattern, category_id, source, created_at, updated_at)
     VALUES (?, 'merchant', ?, ?, 'learned', ?, ?)
     ON CONFLICT (source, match, pattern) DO UPDATE SET category_id = excluded.category_id,
       updated_at = excluded.updated_at`,
    clock.newId(),
    lesson.pattern,
    lesson.categoryId,
    now,
    now,
  );
  return true;
}
