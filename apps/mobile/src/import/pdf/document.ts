import { inflateSync, unzlibSync } from "fflate";
import { type Security, securityHandler } from "./crypt";
import {
  isDict,
  Lexer,
  latin1,
  nameOf,
  numberOf,
  type PdfDict,
  PdfError,
  PdfOp,
  PdfRef,
  PdfStream,
  PdfString,
  type PdfValue,
} from "./syntax";

interface Slot {
  /** Posición en el archivo: la definición más tardía gana (actualizaciones incrementales). */
  readonly at: number;
  readonly gen: number;
  readonly value: PdfValue;
}

const MAX_BYTES = 20 * 1024 * 1024;

/**
 * Un PDF ya cargado. No se apoya en la tabla xref: recorre el archivo buscando `n g obj`, que es
 * más tolerante con archivos dañados o editados, y expande los flujos de objetos (`ObjStm`).
 */
export class PdfDocument {
  private readonly objects = new Map<number, Slot>();
  private trailer: PdfDict = new Map();

  private constructor(private readonly data: Uint8Array) {}

  /** Lanza `PdfError`: `password` si hace falta (otra) clave, `invalid` si no es un PDF. */
  static load(data: Uint8Array, password = ""): PdfDocument {
    if (data.length > MAX_BYTES) throw new PdfError("unsupported", "PDF demasiado grande");
    const head = latin1(data.subarray(0, 1024));
    if (!head.includes("%PDF-")) throw new PdfError("invalid", "No es un PDF");
    const doc = new PdfDocument(data);
    doc.scan();
    const encrypt = doc.resolve(doc.trailer.get("Encrypt"));
    if (isDict(encrypt)) {
      const ids = doc.trailer.get("ID");
      const id0 =
        Array.isArray(ids) && ids[0] instanceof PdfString ? ids[0].bytes : new Uint8Array();
      const security = securityHandler(encrypt, id0, password);
      const encryptRef = doc.trailer.get("Encrypt");
      doc.decryptAll(security, encryptRef instanceof PdfRef ? encryptRef.num : -1);
    }
    doc.expandObjectStreams();
    if (!isDict(doc.resolve(doc.trailer.get("Root")))) {
      throw new PdfError("invalid", "PDF sin catálogo");
    }
    return doc;
  }

  private scan(): void {
    const text = latin1(this.data);
    const header = /(\d+)\s+(\d+)\s+obj\b/g;
    let cursor = 0;
    for (let m = header.exec(text); m; m = header.exec(text)) {
      if (m.index < cursor) continue;
      const lex = new Lexer(this.data, m.index + m[0].length);
      try {
        const value = this.readBody(lex, text);
        this.objects.set(Number(m[1]), { at: m.index, gen: Number(m[2]), value });
        cursor = lex.pos;
        header.lastIndex = lex.pos;
        if (value instanceof PdfStream && nameOf(value.dict.get("Type")) === "XRef") {
          this.mergeTrailer(value.dict);
        }
      } catch {
        // Objeto ilegible: se ignora y se sigue con el resto.
      }
    }
    const trailers = /trailer\s*<</g;
    for (let m = trailers.exec(text); m; m = trailers.exec(text)) {
      const lex = new Lexer(this.data, m.index + "trailer".length);
      const dict = lex.value();
      if (dict instanceof Map) this.mergeTrailer(dict);
    }
  }

  private mergeTrailer(dict: PdfDict): void {
    for (const key of ["Root", "Encrypt", "ID", "Info"]) {
      const v = dict.get(key);
      if (v !== undefined) this.trailer.set(key, v);
    }
  }

  private readBody(lex: Lexer, text: string): PdfValue {
    const value = lex.value();
    if (value === undefined || value instanceof PdfOp) throw new Error("vacío");
    const save = lex.pos;
    const next = lex.token();
    if (!(next?.t === "kw" && next.v === "stream") || !isDict(value)) {
      lex.pos = save;
      return value;
    }
    let start = lex.pos;
    if (this.data[start] === 13) start++;
    if (this.data[start] === 10) start++;
    const length = value.get("Length");
    let end = typeof length === "number" ? start + length : -1;
    if (end < 0 || end > this.data.length || !text.startsWith("endstream", skipWhite(text, end))) {
      end = text.indexOf("endstream", start);
      if (end < 0) end = this.data.length;
      while (end > start && (this.data[end - 1] === 10 || this.data[end - 1] === 13)) end--;
    }
    lex.pos = text.indexOf("endstream", end) + "endstream".length;
    return new PdfStream(value, this.data.subarray(start, end));
  }

  private decryptAll(security: Security, encryptNum: number): void {
    for (const [num, slot] of this.objects) {
      if (num === encryptNum) continue;
      const v = slot.value;
      if (v instanceof PdfStream && nameOf(v.dict.get("Type")) === "XRef") continue;
      this.objects.set(num, { ...slot, value: decryptValue(v, num, slot.gen, security) });
    }
  }

  private expandObjectStreams(): void {
    for (const slot of [...this.objects.values()]) {
      const s = slot.value;
      if (!(s instanceof PdfStream) || nameOf(s.dict.get("Type")) !== "ObjStm") continue;
      let data: Uint8Array;
      try {
        data = this.decode(s);
      } catch {
        continue;
      }
      const n = numberOf(s.dict.get("N"));
      const first = numberOf(s.dict.get("First"));
      const lex = new Lexer(data);
      const pairs: [number, number][] = [];
      for (let i = 0; i < n; i++) {
        const num = lex.value(false);
        const off = lex.value(false);
        if (typeof num !== "number" || typeof off !== "number") break;
        pairs.push([num, off]);
      }
      for (const [num, off] of pairs) {
        const existing = this.objects.get(num);
        if (existing && existing.at > slot.at) continue;
        const v = new Lexer(data, first + off).value();
        if (v === undefined || v instanceof PdfOp) continue;
        this.objects.set(num, { at: slot.at, gen: 0, value: v });
      }
    }
  }

  resolve(v: PdfValue | undefined, depth = 0): PdfValue | undefined {
    if (v instanceof PdfRef && depth < 32)
      return this.resolve(this.objects.get(v.num)?.value, depth + 1);
    return v instanceof PdfRef ? undefined : v;
  }

  dict(v: PdfValue | undefined): PdfDict | null {
    const r = this.resolve(v);
    if (r instanceof PdfStream) return r.dict;
    return isDict(r) ? r : null;
  }

  /** Páginas en orden, con los recursos heredados del árbol. */
  pages(): { readonly page: PdfDict; readonly resources: PdfDict }[] {
    const out: { page: PdfDict; resources: PdfDict }[] = [];
    const root = this.dict(this.trailer.get("Root"));
    const seen = new Set<PdfDict>();
    const walk = (node: PdfDict | null, inherited: PdfDict) => {
      if (!node || seen.has(node) || out.length > 500) return;
      seen.add(node);
      const resources = this.dict(node.get("Resources")) ?? inherited;
      const kids = this.resolve(node.get("Kids"));
      if (Array.isArray(kids)) for (const k of kids) walk(this.dict(k), resources);
      else out.push({ page: node, resources });
    };
    walk(this.dict(root?.get("Pages")), new Map());
    return out;
  }

  /** Bytes de un flujo ya sin filtros. Lanza si usa un filtro que no se soporta. */
  decode(stream: PdfStream): Uint8Array {
    const filters = this.resolve(stream.dict.get("Filter"));
    const params = this.resolve(stream.dict.get("DecodeParms"));
    const names = Array.isArray(filters) ? filters : filters ? [filters] : [];
    let data = stream.data;
    names.forEach((f, i) => {
      const name = nameOf(this.resolve(f));
      const p = Array.isArray(params) ? this.dict(params[i]) : this.dict(params);
      data = applyFilter(name ?? "", data, p);
    });
    return data;
  }

  /** Contenido de un flujo o de un arreglo de flujos, concatenado. */
  contents(v: PdfValue | undefined): Uint8Array {
    const r = this.resolve(v);
    const parts: Uint8Array[] = [];
    const add = (x: PdfValue | undefined) => {
      const s = this.resolve(x);
      if (!(s instanceof PdfStream)) return;
      try {
        parts.push(this.decode(s), Uint8Array.of(10));
      } catch {
        // Contenido con un filtro desconocido: esa parte de la página se omite.
      }
    };
    if (Array.isArray(r)) r.forEach(add);
    else add(r);
    const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
    let at = 0;
    for (const p of parts) {
      out.set(p, at);
      at += p.length;
    }
    return out;
  }
}

const skipWhite = (text: string, at: number): number => {
  let i = at;
  while (i < text.length && /\s/.test(text[i] ?? "")) i++;
  return i;
};

function decryptValue(v: PdfValue, num: number, gen: number, security: Security): PdfValue {
  if (v instanceof PdfString) return new PdfString(security.decrypt(num, gen, v.bytes, "string"));
  if (Array.isArray(v)) return v.map((x) => decryptValue(x, num, gen, security));
  if (v instanceof PdfStream) {
    const dict = decryptValue(v.dict, num, gen, security) as PdfDict;
    return new PdfStream(dict, security.decrypt(num, gen, v.data, "stream"));
  }
  if (v instanceof Map) {
    const out: PdfDict = new Map();
    for (const [k, x] of v) out.set(k, decryptValue(x, num, gen, security));
    return out;
  }
  return v;
}

export function applyFilter(name: string, data: Uint8Array, params: PdfDict | null): Uint8Array {
  switch (name) {
    case "FlateDecode":
    case "Fl":
      return predict(inflate(data), params);
    case "LZWDecode":
    case "LZW":
      return predict(lzw(data, numberOf(params?.get("EarlyChange"), 1)), params);
    case "ASCIIHexDecode":
    case "AHx":
      return asciiHex(data);
    case "ASCII85Decode":
    case "A85":
      return ascii85(data);
    case "Crypt":
      return data;
    default:
      throw new PdfError("unsupported", `Filtro ${name}`);
  }
}

function inflate(data: Uint8Array): Uint8Array {
  try {
    return unzlibSync(data);
  } catch {
    // Algunos generadores escriben una suma de verificación mala o ninguna cabecera zlib.
    try {
      return inflateSync(data.subarray(2));
    } catch {
      return inflateSync(data);
    }
  }
}

/** Predictores PNG (10 a 15) de FlateDecode/LZW. */
function predict(data: Uint8Array, params: PdfDict | null): Uint8Array {
  const predictor = numberOf(params?.get("Predictor"), 1);
  if (predictor < 10) return data;
  const colors = numberOf(params?.get("Colors"), 1);
  const bits = numberOf(params?.get("BitsPerComponent"), 8);
  const columns = numberOf(params?.get("Columns"), 1);
  const bpp = Math.max(1, Math.ceil((colors * bits) / 8));
  const rowLength = Math.ceil((colors * bits * columns) / 8);
  const rows = Math.floor(data.length / (rowLength + 1));
  const out = new Uint8Array(rows * rowLength);
  for (let r = 0; r < rows; r++) {
    const type = data[r * (rowLength + 1)] ?? 0;
    const src = r * (rowLength + 1) + 1;
    const dst = r * rowLength;
    for (let i = 0; i < rowLength; i++) {
      const raw = data[src + i] ?? 0;
      const left = i >= bpp ? (out[dst + i - bpp] ?? 0) : 0;
      const up = r > 0 ? (out[dst + i - rowLength] ?? 0) : 0;
      const upLeft = r > 0 && i >= bpp ? (out[dst + i - rowLength - bpp] ?? 0) : 0;
      let v = raw;
      if (type === 1) v = raw + left;
      else if (type === 2) v = raw + up;
      else if (type === 3) v = raw + ((left + up) >> 1);
      else if (type === 4) {
        const p = left + up - upLeft;
        const pa = Math.abs(p - left);
        const pb = Math.abs(p - up);
        const pc = Math.abs(p - upLeft);
        v = raw + (pa <= pb && pa <= pc ? left : pb <= pc ? up : upLeft);
      }
      out[dst + i] = v & 0xff;
    }
  }
  return out;
}

function lzw(data: Uint8Array, early: number): Uint8Array {
  const out: number[] = [];
  let table: number[][] = [];
  const reset = () => {
    table = [];
    for (let i = 0; i < 256; i++) table.push([i]);
    table.push([], []);
  };
  reset();
  let width = 9;
  let buffer = 0;
  let count = 0;
  let prev: number[] | null = null;
  for (const byte of data) {
    buffer = (buffer << 8) | byte;
    count += 8;
    while (count >= width) {
      const code = (buffer >> (count - width)) & ((1 << width) - 1);
      count -= width;
      if (code === 256) {
        reset();
        width = 9;
        prev = null;
        continue;
      }
      if (code === 257) return Uint8Array.from(out);
      let entry = table[code];
      if (!entry && prev) entry = [...prev, prev[0] ?? 0];
      if (!entry) return Uint8Array.from(out);
      out.push(...entry);
      if (prev) table.push([...prev, entry[0] ?? 0]);
      prev = entry;
      if (table.length + early >= 1 << width && width < 12) width++;
    }
  }
  return Uint8Array.from(out);
}

function asciiHex(data: Uint8Array): Uint8Array {
  const text = latin1(data)
    .replace(/>[\s\S]*$/, "")
    .replace(/[^0-9a-f]/gi, "");
  const out = new Uint8Array(Math.ceil(text.length / 2));
  for (let i = 0; i < out.length; i++)
    out[i] = Number.parseInt(`${text.slice(i * 2, i * 2 + 2)}0`.slice(0, 2), 16);
  return out;
}

function ascii85(data: Uint8Array): Uint8Array {
  const text = latin1(data)
    .replace(/^<~/, "")
    .replace(/~>[\s\S]*$/, "")
    .replace(/\s/g, "");
  const out: number[] = [];
  let group: number[] = [];
  const flush = (n: number) => {
    while (group.length < 5) group.push(84);
    let v = 0;
    for (const g of group) v = v * 85 + g;
    const bytes = [(v >>> 24) & 0xff, (v >>> 16) & 0xff, (v >>> 8) & 0xff, v & 0xff];
    out.push(...bytes.slice(0, n));
    group = [];
  };
  for (const ch of text) {
    if (ch === "z" && group.length === 0) {
      out.push(0, 0, 0, 0);
      continue;
    }
    group.push(ch.charCodeAt(0) - 33);
    if (group.length === 5) flush(4);
  }
  if (group.length > 0) flush(group.length - 1);
  return Uint8Array.from(out);
}
