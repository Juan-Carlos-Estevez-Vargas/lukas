import { cbc } from "@noble/ciphers/aes.js";
import { md5 } from "@noble/hashes/legacy.js";
import { sha256, sha384, sha512 } from "@noble/hashes/sha2.js";
import {
  isDict,
  nameOf,
  numberOf,
  type PdfDict,
  PdfError,
  PdfString,
  type PdfValue,
} from "./syntax";

/**
 * Manejador de seguridad estándar de PDF (ISO 32000-2, 7.6.4): RC4 y AES-128 (revisiones 2 a 4)
 * y AES-256 (revisiones 5 y 6). Los extractos de los bancos suelen venir con la cédula como
 * clave de apertura; la clave solo vive en memoria mientras se lee el archivo.
 */
export interface Security {
  decrypt(num: number, gen: number, data: Uint8Array, kind: "string" | "stream"): Uint8Array;
}

type Method = "none" | "rc4" | "aes128" | "aes256";

const PAD = Uint8Array.from([
  0x28, 0xbf, 0x4e, 0x5e, 0x4e, 0x75, 0x8a, 0x41, 0x64, 0x00, 0x4e, 0x56, 0xff, 0xfa, 0x01, 0x08,
  0x2e, 0x2e, 0x00, 0xb6, 0xd0, 0x68, 0x3e, 0x80, 0x2f, 0x0c, 0xa9, 0xfe, 0x64, 0x53, 0x69, 0x7a,
]);

export function rc4(key: Uint8Array, data: Uint8Array): Uint8Array {
  const s = new Uint8Array(256);
  for (let i = 0; i < 256; i++) s[i] = i;
  let j = 0;
  for (let i = 0; i < 256; i++) {
    j = (j + (s[i] ?? 0) + (key[i % key.length] ?? 0)) & 0xff;
    const t = s[i] ?? 0;
    s[i] = s[j] ?? 0;
    s[j] = t;
  }
  const out = new Uint8Array(data.length);
  let a = 0;
  let b = 0;
  for (let k = 0; k < data.length; k++) {
    a = (a + 1) & 0xff;
    b = (b + (s[a] ?? 0)) & 0xff;
    const t = s[a] ?? 0;
    s[a] = s[b] ?? 0;
    s[b] = t;
    out[k] = (data[k] ?? 0) ^ (s[((s[a] ?? 0) + (s[b] ?? 0)) & 0xff] ?? 0);
  }
  return out;
}

const concat = (...parts: Uint8Array[]): Uint8Array => {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let at = 0;
  for (const p of parts) {
    out.set(p, at);
    at += p.length;
  }
  return out;
};

const equal = (a: Uint8Array, b: Uint8Array): boolean =>
  a.length === b.length && a.every((v, i) => v === b[i]);

const bytesOf = (v: PdfValue | undefined): Uint8Array =>
  v instanceof PdfString ? v.bytes : new Uint8Array(0);

/** Contraseña de las revisiones 2 a 4: Latin-1, rellenada a 32 bytes. */
const padded = (password: string): Uint8Array => {
  const raw = Uint8Array.from([...password].map((ch) => ch.charCodeAt(0) & 0xff)).subarray(0, 32);
  return concat(raw, PAD.subarray(0, 32 - raw.length));
};

function aesDecrypt(key: Uint8Array, data: Uint8Array): Uint8Array {
  if (data.length < 32 || data.length % 16 !== 0) return new Uint8Array(0);
  const iv = data.subarray(0, 16);
  const body = data.subarray(16);
  try {
    return cbc(key, iv).decrypt(body);
  } catch {
    // Relleno dañado: se devuelve tal cual antes que perder el contenido.
    return cbc(key, iv, { disablePadding: true }).decrypt(body);
  }
}

function methodOf(encrypt: PdfDict, filter: string | null, v: number): Method {
  if (v < 4) return "rc4";
  if (!filter || filter === "Identity") return "none";
  const cf = encrypt.get("CF");
  const entry = isDict(cf) ? cf.get(filter) : undefined;
  const cfm = isDict(entry) ? nameOf(entry.get("CFM")) : null;
  if (cfm === "AESV2") return "aes128";
  if (cfm === "AESV3") return "aes256";
  if (cfm === "V2") return "rc4";
  return "none";
}

/** Algoritmo 2: llave del archivo para las revisiones 2 a 4. */
function legacyKey(encrypt: PdfDict, id0: Uint8Array, password: string): Uint8Array {
  const r = numberOf(encrypt.get("R"), 2);
  const length = r === 2 ? 5 : numberOf(encrypt.get("Length"), 40) / 8;
  const p = numberOf(encrypt.get("P"));
  const pBytes = Uint8Array.from([p & 0xff, (p >> 8) & 0xff, (p >> 16) & 0xff, (p >>> 24) & 0xff]);
  const metadata = encrypt.get("EncryptMetadata") === false && r >= 4;
  let hash = md5(
    concat(
      padded(password),
      bytesOf(encrypt.get("O")).subarray(0, 32),
      pBytes,
      id0,
      metadata ? Uint8Array.from([255, 255, 255, 255]) : new Uint8Array(0),
    ),
  );
  if (r >= 3) for (let i = 0; i < 50; i++) hash = md5(hash.subarray(0, length));
  return hash.slice(0, length);
}

function legacyUserOk(encrypt: PdfDict, id0: Uint8Array, key: Uint8Array): boolean {
  const r = numberOf(encrypt.get("R"), 2);
  const u = bytesOf(encrypt.get("U"));
  if (r === 2) return equal(rc4(key, PAD), u.subarray(0, 32));
  let x = rc4(key, md5(concat(PAD, id0)));
  for (let i = 1; i <= 19; i++)
    x = rc4(
      Uint8Array.from(key, (b) => b ^ i),
      x,
    );
  return equal(x, u.subarray(0, 16));
}

/** Algoritmo 2.B (revisión 6); la revisión 5 usa solo el primer SHA-256. */
function hash6(password: Uint8Array, salt: Uint8Array, udata: Uint8Array, r: number): Uint8Array {
  let k = sha256(concat(password, salt, udata));
  if (r < 6) return k;
  for (let round = 0; ; round++) {
    const block = concat(password, k, udata);
    const k1 = new Uint8Array(block.length * 64);
    for (let i = 0; i < 64; i++) k1.set(block, i * block.length);
    const e = cbc(k.subarray(0, 16), k.subarray(16, 32), { disablePadding: true }).encrypt(k1);
    let sum = 0;
    for (let i = 0; i < 16; i++) sum += e[i] ?? 0;
    const pick = sum % 3;
    k = pick === 0 ? sha256(e) : pick === 1 ? sha384(e) : sha512(e);
    if (round >= 63 && (e[e.length - 1] ?? 0) <= round - 31) break;
  }
  return k.subarray(0, 32);
}

function aes256Key(encrypt: PdfDict, password: string): Uint8Array | null {
  const r = numberOf(encrypt.get("R"), 6);
  const pw = new TextEncoder().encode(password).subarray(0, 127);
  const u = bytesOf(encrypt.get("U"));
  const o = bytesOf(encrypt.get("O"));
  const zero = new Uint8Array(16);
  const unwrap = (key: Uint8Array, wrapped: Uint8Array) =>
    cbc(key, zero, { disablePadding: true }).decrypt(wrapped.subarray(0, 32));
  if (equal(hash6(pw, u.subarray(32, 40), new Uint8Array(0), r), u.subarray(0, 32))) {
    return unwrap(hash6(pw, u.subarray(40, 48), new Uint8Array(0), r), bytesOf(encrypt.get("UE")));
  }
  const u48 = u.subarray(0, 48);
  if (equal(hash6(pw, o.subarray(32, 40), u48, r), o.subarray(0, 32))) {
    return unwrap(hash6(pw, o.subarray(40, 48), u48, r), bytesOf(encrypt.get("OE")));
  }
  return null;
}

/**
 * Prepara el descifrado. Lanza `PdfError("password")` si la clave no abre el archivo (también
 * cuando hace falta una y no se dio).
 */
export function securityHandler(encrypt: PdfDict, id0: Uint8Array, password: string): Security {
  if (nameOf(encrypt.get("Filter")) !== "Standard") {
    throw new PdfError("unsupported", "Cifrado no estándar");
  }
  const v = numberOf(encrypt.get("V"));
  const stream = methodOf(encrypt, nameOf(encrypt.get("StmF")), v);
  const string = methodOf(encrypt, nameOf(encrypt.get("StrF")), v);

  if (v >= 5) {
    const key = aes256Key(encrypt, password);
    if (!key) throw new PdfError("password", "La clave no abre el PDF");
    return {
      decrypt: (_num, _gen, data, kind) =>
        (kind === "stream" ? stream : string) === "none" ? data : aesDecrypt(key, data),
    };
  }

  const key = legacyKey(encrypt, id0, password);
  if (!legacyUserOk(encrypt, id0, key)) throw new PdfError("password", "La clave no abre el PDF");
  return {
    decrypt(num, gen, data, kind) {
      const method = kind === "stream" ? stream : string;
      if (method === "none") return data;
      const salt =
        method === "aes128" ? Uint8Array.from([0x73, 0x41, 0x6c, 0x54]) : new Uint8Array(0);
      const objectKey = md5(
        concat(
          key,
          Uint8Array.from([
            num & 0xff,
            (num >> 8) & 0xff,
            (num >> 16) & 0xff,
            gen & 0xff,
            gen >> 8,
          ]),
          salt,
        ),
      ).subarray(0, Math.min(key.length + 5, 16));
      return method === "aes128" ? aesDecrypt(objectKey, data) : rc4(objectKey, data);
    },
  };
}
