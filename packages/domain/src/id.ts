/** Fuente de bytes aleatorios criptográficamente seguros. */
export type RandomSource = (bytes: Uint8Array) => void;

interface CryptoLike {
  getRandomValues(bytes: Uint8Array): Uint8Array;
}

const defaultRandom: RandomSource = (bytes) => {
  const crypto = (globalThis as { crypto?: CryptoLike }).crypto;
  if (!crypto) throw new Error("No hay una fuente de aleatoriedad segura disponible");
  crypto.getRandomValues(bytes);
};

const HEX = Array.from({ length: 256 }, (_, i) => i.toString(16).padStart(2, "0"));

/**
 * Genera un UUID versión 7 (RFC 9562): 48 bits de tiempo Unix en milisegundos seguidos de bits
 * aleatorios. Son ordenables por fecha de creación y se pueden generar sin conexión en el cliente.
 */
export const uuidv7 = (
  now: () => number = Date.now,
  random: RandomSource = defaultRandom,
): string => {
  const bytes = new Uint8Array(16);
  random(bytes);

  const timestamp = BigInt(now());
  for (let i = 0; i < 6; i++) {
    bytes[i] = Number((timestamp >> BigInt(8 * (5 - i))) & 0xffn);
  }
  bytes[6] = ((bytes[6] ?? 0) & 0x0f) | 0x70; // versión 7
  bytes[8] = ((bytes[8] ?? 0) & 0x3f) | 0x80; // variante RFC 9562

  let out = "";
  for (let i = 0; i < 16; i++) {
    if (i === 4 || i === 6 || i === 8 || i === 10) out += "-";
    out += HEX[bytes[i] ?? 0];
  }
  return out;
};

const UUID_V7_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

export const isUuidV7 = (value: string): boolean => UUID_V7_PATTERN.test(value);

/** Milisegundos Unix codificados en un UUID v7. */
export const uuidv7Timestamp = (id: string): number =>
  Number.parseInt(id.replaceAll("-", "").slice(0, 12), 16);
