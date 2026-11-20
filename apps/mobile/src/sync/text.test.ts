import { describe, expect, it } from "vitest";
import { createTranslator } from "../i18n/translator";
import { syncLine } from "./text";

const t = createTranslator("es");
const status = (pending: number, lastSyncedAt: string | null) => ({
  pending,
  lastSyncedAt,
  lastError: null,
});

describe("estado de la sincronización", () => {
  it("dice qué está pasando", () => {
    expect(syncLine(t, "es-CO", { status: null, syncing: true, failed: false })).toBe(
      "Sincronizando…",
    );
    expect(
      syncLine(t, "es-CO", { status: status(3, null), syncing: false, failed: true }),
    ).toContain("3");
    expect(syncLine(t, "es-CO", { status: null, syncing: false, failed: false })).toBe(
      t("sync.never"),
    );
    const done = syncLine(t, "es-CO", {
      status: status(0, "2026-11-19T15:00:00Z"),
      syncing: false,
      failed: false,
    });
    expect(done).toMatch(/^Sincronizado/);
    const pending = syncLine(t, "es-CO", {
      status: status(2, "2026-11-19T15:00:00Z"),
      syncing: false,
      failed: false,
    });
    expect(pending).toContain("2 pendientes");
  });
});
