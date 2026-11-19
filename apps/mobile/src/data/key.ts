/** 256 bits: la clave cruda de SQLCipher (AES-256). */
export const KEY_BYTES = 32;

const HEX_KEY = /^[0-9a-f]{64}$/;

/** Dónde se guarda la clave. En la app es SecureStore (Keystore en Android, Keychain en iOS). */
export interface KeyStore {
  read(): Promise<string | null>;
  write(value: string): Promise<void>;
}

export type RandomBytes = (size: number) => Promise<Uint8Array>;

export interface DatabaseKey {
  /** Clave en hexadecimal, 64 caracteres. Nunca se registra ni sale del dispositivo. */
  readonly hex: string;
  /** `true` si se acaba de crear: cualquier base anterior no se puede abrir con ella. */
  readonly created: boolean;
}

export function toHex(bytes: Uint8Array): string {
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}

export const isHexKey = (value: string): boolean => HEX_KEY.test(value);

/**
 * Lee la clave de la base o crea una aleatoria la primera vez. No se deriva de un PIN ni de la
 * sesión: así el bloqueo de la app (FIN-103) puede cambiar sin recifrar la base.
 */
export async function getOrCreateDatabaseKey(
  store: KeyStore,
  random: RandomBytes,
): Promise<DatabaseKey> {
  const existing = await store.read();
  if (existing !== null) {
    if (!isHexKey(existing)) throw new Error("La clave guardada de la base local está dañada");
    return { hex: existing, created: false };
  }
  const bytes = await random(KEY_BYTES);
  if (bytes.length !== KEY_BYTES) throw new Error("El generador no devolvió 32 bytes");
  const hex = toHex(bytes);
  await store.write(hex);
  return { hex, created: true };
}

/**
 * PRAGMA que abre la base con la clave cruda (sin PBKDF2, porque ya es aleatoria de 256 bits).
 * La clave se valida antes de interpolarla: PRAGMA no acepta parámetros.
 */
export function keyPragma(hex: string): string {
  if (!isHexKey(hex)) throw new Error("Clave inválida");
  return `PRAGMA key = "x'${hex}'"`;
}
