import type { Translate } from "../i18n/translator";
import type { SyncStatus } from "./sync";

/** Línea de estado de la sincronización para Ajustes. */
export function syncLine(
  t: Translate,
  locale: string,
  state: {
    readonly status: SyncStatus | null;
    readonly syncing: boolean;
    readonly failed: boolean;
  },
): string {
  if (state.syncing) return t("sync.running");
  const pending = state.status?.pending ?? 0;
  if (state.failed) return t("sync.failed", { pending });
  const last = state.status?.lastSyncedAt;
  if (!last) return t("sync.never");
  const when = new Date(last).toLocaleString(locale, { dateStyle: "short", timeStyle: "short" });
  return pending > 0 ? t("sync.donePending", { when, pending }) : t("sync.done", { when });
}
