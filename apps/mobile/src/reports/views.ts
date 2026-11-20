import type { Preferences } from "../data/preferences";
import type { CompareBase } from "./advanced";

/**
 * Una comparación guardada para repetirla en un toque: siempre relativa al mes que se está viendo
 * ("contra el mes anterior", "contra el mismo mes del año pasado"), opcionalmente de una categoría.
 * Vive en las preferencias del teléfono; no se sincroniza.
 */
export interface SavedView {
  readonly id: string;
  readonly name: string;
  readonly base: CompareBase;
  readonly categoryId: string | null;
}

export const MAX_VIEWS = 8;
const KEY = "reports.views";

const isView = (v: unknown): v is SavedView => {
  if (typeof v !== "object" || v === null) return false;
  const r = v as Record<string, unknown>;
  return (
    typeof r.id === "string" &&
    typeof r.name === "string" &&
    (r.base === "previous" || r.base === "lastYear") &&
    (r.categoryId === null || typeof r.categoryId === "string")
  );
};

/** Las vistas guardadas; ignora lo que no tenga la forma esperada en vez de fallar. */
export async function loadViews(prefs: Preferences): Promise<SavedView[]> {
  const raw = await prefs.get(KEY);
  if (!raw) return [];
  try {
    const parsed: unknown = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.filter(isView).slice(0, MAX_VIEWS) : [];
  } catch {
    return [];
  }
}

/**
 * Guarda una vista nueva al principio; si ya había una igual (misma base y categoría) la reemplaza
 * con el nombre nuevo. Se quedan las `MAX_VIEWS` más recientes.
 */
export async function saveView(
  prefs: Preferences,
  view: Omit<SavedView, "id">,
  newId: () => string,
): Promise<SavedView[]> {
  const name = view.name.trim();
  if (!name) return loadViews(prefs);
  const others = (await loadViews(prefs)).filter(
    (v) => v.base !== view.base || v.categoryId !== view.categoryId,
  );
  const next = [{ ...view, name, id: newId() }, ...others].slice(0, MAX_VIEWS);
  await prefs.set(KEY, JSON.stringify(next));
  return next;
}

export async function removeView(prefs: Preferences, id: string): Promise<SavedView[]> {
  const next = (await loadViews(prefs)).filter((v) => v.id !== id);
  await prefs.set(KEY, JSON.stringify(next));
  return next;
}
