import type { Clock } from "../accounts/accounts";
import type { SqlConnection } from "../data/sql";
import { isCaptureApp } from "./apps";
import { ingestCapture } from "./ingest";
import { type PostedNotification, parseNotification } from "./notification";

export interface DrainResult {
  /** Nuevos en la bandeja (sin contar duplicados ni lo que no era un movimiento). */
  readonly added: number;
  readonly ignored: number;
}

/**
 * Pasa a la bandeja lo que dejó el lector. Todo ocurre en el teléfono: el texto se lee aquí, se
 * guarda solo lo normalizado y el aviso original se descarta.
 */
export async function ingestNotifications(
  db: SqlConnection,
  posted: readonly PostedNotification[],
  clock: Clock,
): Promise<DrainResult> {
  let added = 0;
  let ignored = 0;
  for (const n of posted) {
    const raw = isCaptureApp(n.app) ? parseNotification(n) : null;
    const result = raw ? await ingestCapture(db, raw, clock) : null;
    if (result?.status === "pending") added++;
    else if (!result) ignored++;
  }
  return { added, ignored };
}
