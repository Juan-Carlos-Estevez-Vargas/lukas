/** El PIN guardado: nunca el PIN, solo su hash con sal. */
export interface PinRecord {
  readonly salt: string;
  readonly hash: string;
}

/** SHA-256 en hexadecimal (expo-crypto en la app, node:crypto en las pruebas). */
export type Sha256 = (text: string) => Promise<string>;

export type PinProblem = "length" | "digits" | "repeated" | "sequence";

const SEQUENCES = "0123456789012345678909876543210";

/**
 * Reglas del PIN: 4 a 6 dígitos, sin todos iguales (1111) ni seguidos (1234, 9876).
 * Un PIN tiene poca entropía; lo que lo protege es el bloqueo progresivo tras intentos fallidos
 * (`policy.ts`) y que el hash vive en Keystore/Keychain, no en la base.
 */
export function checkPin(pin: string): PinProblem | null {
  if (!/^[0-9]*$/.test(pin)) return "digits";
  if (pin.length < 4 || pin.length > 6) return "length";
  if (/^(\d)\1+$/.test(pin)) return "repeated";
  if (SEQUENCES.includes(pin)) return "sequence";
  return null;
}

/** Iteraciones de SHA-256: encarecen probar PINes si alguien extrae el registro del Keystore. */
export const PIN_ROUNDS = 1000;

export async function hashPin(pin: string, salt: string, sha256: Sha256): Promise<string> {
  let digest = `${salt}:${pin}`;
  for (let i = 0; i < PIN_ROUNDS; i++) digest = await sha256(`${salt}:${digest}`);
  return digest;
}

export async function createPinRecord(
  pin: string,
  salt: string,
  sha256: Sha256,
): Promise<PinRecord> {
  const problem = checkPin(pin);
  if (problem) throw new Error(`PIN inválido: ${problem}`);
  return { salt, hash: await hashPin(pin, salt, sha256) };
}

/** Compara en tiempo constante para no filtrar cuántos caracteres coinciden. */
export function constantTimeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

export async function verifyPin(pin: string, record: PinRecord, sha256: Sha256): Promise<boolean> {
  return constantTimeEqual(await hashPin(pin, record.salt, sha256), record.hash);
}
