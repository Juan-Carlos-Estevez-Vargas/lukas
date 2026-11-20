import type { SyncRecord } from "./protocol";

export interface FieldConflict {
  readonly field: string;
  readonly local: unknown;
  readonly server: unknown;
  /** Qué valor quedó: el de la edición más reciente (`updatedAt`); en empate, el del servidor. */
  readonly kept: "local" | "server";
}

export interface MergeResult {
  readonly merged: SyncRecord;
  readonly conflicts: readonly FieldConflict[];
}

/** Campos que no se fusionan: identidad y marcas de tiempo, que se calculan aparte. */
const FIXED = new Set(["id", "createdAt", "updatedAt"]);

const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

/**
 * Fusión de tres vías campo por campo (FIN-203). `base` es la versión del servidor que el
 * teléfono conocía antes de editar; `local` y `server` son las dos ediciones.
 * - Si solo un lado cambió un campo, gana ese lado: nada se pierde.
 * - Si ambos lo cambiaron distinto, gana la edición más reciente y queda en `conflicts` (con los
 *   dos valores) para poder revisarlo. Sin `base`, cualquier diferencia cuenta como de ambos.
 * Los asientos de una transacción son un solo campo: no se mezclan asientos de dos versiones.
 */
export function mergeRecords(
  base: SyncRecord | null,
  local: SyncRecord,
  server: SyncRecord,
): MergeResult {
  const localWins = Date.parse(local.updatedAt) > Date.parse(server.updatedAt);
  const out: Record<string, unknown> = { ...server };
  const conflicts: FieldConflict[] = [];
  const b = base as Record<string, unknown> | null;
  const l = local as unknown as Record<string, unknown>;
  const s = server as unknown as Record<string, unknown>;
  for (const field of Object.keys(s)) {
    if (FIXED.has(field) || same(l[field], s[field])) continue;
    const localChanged = !b || !same(l[field], b[field]);
    const serverChanged = !b || !same(s[field], b[field]);
    if (localChanged && !serverChanged) out[field] = l[field];
    else if (localChanged && serverChanged) {
      const kept = localWins ? "local" : "server";
      out[field] = kept === "local" ? l[field] : s[field];
      conflicts.push({ field, local: l[field], server: s[field], kept });
    }
  }
  out.updatedAt = localWins ? local.updatedAt : server.updatedAt;
  return { merged: out as unknown as SyncRecord, conflicts };
}
