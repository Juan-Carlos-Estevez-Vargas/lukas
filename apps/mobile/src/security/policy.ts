import { sqlitePreferences } from "../data/preferences";
import type { SqlConnection } from "../data/sql";
import type { DeviceSecurityModule } from "./device-security";

/** Señales que el módulo nativo puede reportar. Otras se ignoran. */
export const ROOT_SIGNALS = ["test-keys", "su-binary", "root-app", "su-in-path"] as const;
export type RootSignal = (typeof ROOT_SIGNALS)[number];

/**
 * Señales de root del teléfono. Si el módulo no existe (web, iOS) o falla, no hay señales: la
 * advertencia es informativa y no debe aparecer por un error.
 */
export function rootSignals(module: DeviceSecurityModule | null): readonly RootSignal[] {
  if (!module) return [];
  try {
    const found = module.rootSignals();
    return ROOT_SIGNALS.filter((s) => found.includes(s));
  } catch {
    return [];
  }
}

/**
 * Las capturas de pantalla arrancan bloqueadas: Lukas muestra saldos y movimientos, y una captura
 * termina en la galería, en la nube o en otra app. La persona puede permitirlas en Ajustes.
 */
export async function screenshotsAllowed(db: SqlConnection): Promise<boolean> {
  return (await sqlitePreferences(db).get("security.allowScreenshots")) === "1";
}

export async function setScreenshotsAllowed(db: SqlConnection, allowed: boolean): Promise<void> {
  if (allowed) await sqlitePreferences(db).set("security.allowScreenshots", "1");
  else await sqlitePreferences(db).remove("security.allowScreenshots");
}

/**
 * Si la ventana debe ir con FLAG_SECURE. El build de e2e la deja libre para que Maestro pueda
 * guardar capturas cuando un flujo falla.
 */
export const shouldBlockScreenshots = (allowed: boolean, e2e: boolean): boolean => !allowed && !e2e;

/** Aplica la protección en el teléfono; no hace nada sin módulo nativo. */
export function applyScreenProtection(module: DeviceSecurityModule | null, block: boolean): void {
  try {
    module?.setSecure(block);
  } catch {
    // Sin actividad (app en segundo plano): se vuelve a aplicar al volver.
  }
}
