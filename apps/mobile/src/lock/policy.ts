/** Intentos fallidos y hasta cuándo está bloqueado el ingreso de PIN. Se guarda en SecureStore. */
export interface Lockout {
  readonly failures: number;
  /** Milisegundos Unix; 0 si no hay espera. */
  readonly lockedUntil: number;
}

export const NO_LOCKOUT: Lockout = { failures: 0, lockedUntil: 0 };

/** Intentos libres antes de empezar a esperar. */
export const FREE_ATTEMPTS = 5;
const BASE_WAIT_MS = 30_000;
const MAX_WAIT_MS = 15 * 60_000;

/** Tras 5 fallos: 30 s, luego 1, 2, 4, 8 y como máximo 15 minutos por intento. */
export function registerFailure(state: Lockout, now: number): Lockout {
  const failures = state.failures + 1;
  if (failures < FREE_ATTEMPTS) return { failures, lockedUntil: 0 };
  const wait = Math.min(BASE_WAIT_MS * 2 ** (failures - FREE_ATTEMPTS), MAX_WAIT_MS);
  return { failures, lockedUntil: now + wait };
}

/** Milisegundos que faltan para poder intentar; 0 si ya se puede. */
export const waitMs = (state: Lockout, now: number): number => Math.max(0, state.lockedUntil - now);

/** Al volver del fondo, ¿hay que pedir el PIN? */
export function shouldLockOnResume(
  backgroundedAt: number | null,
  now: number,
  timeoutMs: number,
): boolean {
  return backgroundedAt !== null && now - backgroundedAt >= timeoutMs;
}

/** Tiempo en segundo plano antes de bloquear. */
export const AUTO_LOCK_MS = 60_000;

export function parseLockout(raw: string | null): Lockout {
  if (!raw) return NO_LOCKOUT;
  try {
    const value = JSON.parse(raw) as Partial<Lockout>;
    const failures = Number(value.failures);
    const lockedUntil = Number(value.lockedUntil);
    if (Number.isInteger(failures) && failures >= 0 && Number.isFinite(lockedUntil)) {
      return { failures, lockedUntil };
    }
  } catch {
    // Valor dañado: se trata como el peor caso razonable, sin borrar los fallos.
  }
  return { failures: FREE_ATTEMPTS, lockedUntil: 0 };
}
