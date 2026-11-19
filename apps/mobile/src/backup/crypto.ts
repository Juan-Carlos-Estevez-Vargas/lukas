import { xchacha20poly1305 } from "@noble/ciphers/chacha.js";
import { scryptAsync } from "@noble/hashes/scrypt.js";

/** Formato del archivo de respaldo: JSON con el texto cifrado y lo necesario para derivar la clave. */
export interface BackupEnvelope {
  readonly format: "lukas-backup";
  readonly version: 1;
  readonly kdf: {
    readonly name: "scrypt";
    readonly N: number;
    readonly r: number;
    readonly p: number;
    readonly salt: string;
  };
  readonly cipher: { readonly name: "xchacha20poly1305"; readonly nonce: string };
  readonly data: string;
}

export class BackupError extends Error {
  constructor(readonly code: "invalid_file" | "wrong_password" | "weak_password" | "too_new") {
    super(code);
    this.name = "BackupError";
  }
}

export type RandomBytes = (size: number) => Uint8Array;

/** scrypt N=2^15 (32 MiB): lento para quien prueba claves a ciegas, tolerable en el teléfono. */
export const DEFAULT_KDF = { N: 2 ** 15, r: 8, p: 1 } as const;
export const MIN_PASSWORD_LENGTH = 8;

const B64 = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";

export function toBase64(bytes: Uint8Array): string {
  let out = "";
  for (let i = 0; i < bytes.length; i += 3) {
    const [a = 0, b = 0, c = 0] = [bytes[i], bytes[i + 1], bytes[i + 2]];
    const n = (a << 16) | (b << 8) | c;
    out += B64[(n >> 18) & 63] ?? "";
    out += B64[(n >> 12) & 63] ?? "";
    out += i + 1 < bytes.length ? (B64[(n >> 6) & 63] ?? "") : "=";
    out += i + 2 < bytes.length ? (B64[n & 63] ?? "") : "=";
  }
  return out;
}

export function fromBase64(text: string): Uint8Array {
  if (!/^[A-Za-z0-9+/]*={0,2}$/.test(text) || text.length % 4 !== 0) {
    throw new BackupError("invalid_file");
  }
  const clean = text.replace(/=+$/, "");
  const out = new Uint8Array(Math.floor((clean.length * 3) / 4));
  let bits = 0;
  let value = 0;
  let o = 0;
  for (const ch of clean) {
    value = (value << 6) | B64.indexOf(ch);
    bits += 6;
    if (bits >= 8) {
      bits -= 8;
      out[o++] = (value >> bits) & 0xff;
    }
  }
  return out;
}

const encoder = new TextEncoder();

async function deriveKey(
  password: string,
  salt: Uint8Array,
  kdf: { N: number; r: number; p: number },
): Promise<Uint8Array> {
  return scryptAsync(encoder.encode(password.normalize("NFKC")), salt, { ...kdf, dkLen: 32 });
}

/** Cifra el respaldo con una clave derivada de la contraseña (scrypt + XChaCha20-Poly1305). */
export async function encryptBackup(
  plaintext: Uint8Array,
  password: string,
  random: RandomBytes,
  kdf: { N: number; r: number; p: number } = DEFAULT_KDF,
): Promise<string> {
  if (password.length < MIN_PASSWORD_LENGTH) throw new BackupError("weak_password");
  const salt = random(16);
  const nonce = random(24);
  const key = await deriveKey(password, salt, kdf);
  const sealed = xchacha20poly1305(key, nonce).encrypt(plaintext);
  key.fill(0);
  const envelope: BackupEnvelope = {
    format: "lukas-backup",
    version: 1,
    kdf: { name: "scrypt", ...kdf, salt: toBase64(salt) },
    cipher: { name: "xchacha20poly1305", nonce: toBase64(nonce) },
    data: toBase64(sealed),
  };
  return JSON.stringify(envelope);
}

const isEnvelope = (v: unknown): v is BackupEnvelope => {
  if (typeof v !== "object" || v === null) return false;
  const e = v as Record<string, unknown>;
  const kdf = e.kdf as Record<string, unknown> | undefined;
  const cipher = e.cipher as Record<string, unknown> | undefined;
  return (
    e.format === "lukas-backup" &&
    e.version === 1 &&
    typeof e.data === "string" &&
    kdf?.name === "scrypt" &&
    typeof kdf.salt === "string" &&
    [kdf.N, kdf.r, kdf.p].every((n) => Number.isInteger(n)) &&
    cipher?.name === "xchacha20poly1305" &&
    typeof cipher.nonce === "string"
  );
};

/** Descifra un respaldo. Una contraseña equivocada o un archivo alterado fallan igual: la etiqueta no cuadra. */
export async function decryptBackup(text: string, password: string): Promise<Uint8Array> {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new BackupError("invalid_file");
  }
  if (!isEnvelope(parsed)) throw new BackupError("invalid_file");
  const { N, r, p } = parsed.kdf;
  // Límites para que un archivo malicioso no pida memoria o tiempo absurdos.
  if (N < 2 ** 10 || N > 2 ** 20 || (N & (N - 1)) !== 0 || r < 1 || r > 16 || p < 1 || p > 4) {
    throw new BackupError("invalid_file");
  }
  const key = await deriveKey(password, fromBase64(parsed.kdf.salt), { N, r, p });
  try {
    return xchacha20poly1305(key, fromBase64(parsed.cipher.nonce)).decrypt(fromBase64(parsed.data));
  } catch (error) {
    if (error instanceof BackupError) throw error;
    throw new BackupError("wrong_password");
  } finally {
    key.fill(0);
  }
}
