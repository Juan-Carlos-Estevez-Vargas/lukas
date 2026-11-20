/**
 * Sintaxis de PDF (ISO 32000, sección 7.3): lo justo para leer objetos y flujos de contenido.
 * Todo trabaja sobre bytes; las cadenas se guardan como bytes porque su codificación depende de
 * la fuente con la que se pintan.
 */

export class PdfName {
  constructor(readonly name: string) {}
}

export class PdfRef {
  constructor(
    readonly num: number,
    readonly gen: number,
  ) {}
}

export class PdfString {
  constructor(readonly bytes: Uint8Array) {}
}

/** Operador de un flujo de contenido (`Tj`, `cm`, `BT`…). */
export class PdfOp {
  constructor(readonly op: string) {}
}

export type PdfDict = Map<string, PdfValue>;

export class PdfStream {
  constructor(
    readonly dict: PdfDict,
    readonly data: Uint8Array,
  ) {}
}

export type PdfValue =
  | null
  | boolean
  | number
  | PdfName
  | PdfString
  | PdfRef
  | PdfDict
  | PdfStream
  | PdfValue[];

export class PdfError extends Error {
  constructor(
    readonly reason: "invalid" | "password" | "unsupported",
    message: string,
  ) {
    super(message);
  }
}

const isWhite = (c: number) => c === 0 || c === 9 || c === 10 || c === 12 || c === 13 || c === 32;
// ( ) < > [ ] { } / %
const isDelim = (c: number) =>
  c === 40 ||
  c === 41 ||
  c === 60 ||
  c === 62 ||
  c === 91 ||
  c === 93 ||
  c === 123 ||
  c === 125 ||
  c === 47 ||
  c === 37;
const isRegular = (c: number) => !isWhite(c) && !isDelim(c);

const hexValue = (c: number): number => {
  if (c >= 48 && c <= 57) return c - 48;
  if (c >= 65 && c <= 70) return c - 55;
  if (c >= 97 && c <= 102) return c - 87;
  return -1;
};

const ESCAPES: Record<number, number> = { 110: 10, 114: 13, 116: 9, 98: 8, 102: 12 };

type Token =
  | { readonly t: "value"; readonly v: PdfValue }
  | { readonly t: "kw"; readonly v: string }
  | { readonly t: "open" | "close" | "dictOpen" | "dictClose" };

/** Lee tokens y objetos desde `pos`. Avanza sobre `buf` sin copiarlo. */
export class Lexer {
  constructor(
    readonly buf: Uint8Array,
    public pos = 0,
  ) {}

  skipWhite(): void {
    const { buf } = this;
    while (this.pos < buf.length) {
      const c = buf[this.pos] ?? 0;
      if (isWhite(c)) this.pos++;
      else if (c === 37) {
        while (this.pos < buf.length && buf[this.pos] !== 10 && buf[this.pos] !== 13) this.pos++;
      } else break;
    }
  }

  private byte(offset = 0): number {
    return this.buf[this.pos + offset] ?? -1;
  }

  token(): Token | null {
    this.skipWhite();
    const c = this.byte();
    if (c < 0) return null;
    if (c === 91) {
      this.pos++;
      return { t: "open" };
    }
    if (c === 93) {
      this.pos++;
      return { t: "close" };
    }
    if (c === 60 && this.byte(1) === 60) {
      this.pos += 2;
      return { t: "dictOpen" };
    }
    if (c === 62 && this.byte(1) === 62) {
      this.pos += 2;
      return { t: "dictClose" };
    }
    if (c === 60) return { t: "value", v: this.hexString() };
    if (c === 40) return { t: "value", v: this.literalString() };
    if (c === 47) return { t: "value", v: this.name() };
    if (c === 123 || c === 125 || c === 41 || c === 62) {
      this.pos++;
      return this.token();
    }
    const start = this.pos;
    while (this.pos < this.buf.length && isRegular(this.byte())) this.pos++;
    let word = "";
    for (let i = start; i < this.pos; i++) word += String.fromCharCode(this.buf[i] ?? 0);
    if (/^[+-]?(\d+\.?\d*|\.\d+)$/.test(word)) return { t: "value", v: Number(word) };
    if (word === "true") return { t: "value", v: true };
    if (word === "false") return { t: "value", v: false };
    if (word === "null") return { t: "value", v: null };
    return { t: "kw", v: word };
  }

  private name(): PdfName {
    this.pos++;
    let out = "";
    while (this.pos < this.buf.length && isRegular(this.byte())) {
      const c = this.byte();
      const hi = hexValue(this.byte(1));
      const lo = hexValue(this.byte(2));
      if (c === 35 && hi >= 0 && lo >= 0) {
        out += String.fromCharCode(hi * 16 + lo);
        this.pos += 3;
      } else {
        out += String.fromCharCode(c);
        this.pos++;
      }
    }
    return new PdfName(out);
  }

  private hexString(): PdfString {
    this.pos++;
    const out: number[] = [];
    let high = -1;
    while (this.pos < this.buf.length) {
      const c = this.byte();
      this.pos++;
      if (c === 62) break;
      const v = hexValue(c);
      if (v < 0) continue;
      if (high < 0) high = v;
      else {
        out.push(high * 16 + v);
        high = -1;
      }
    }
    if (high >= 0) out.push(high * 16);
    return new PdfString(Uint8Array.from(out));
  }

  private literalString(): PdfString {
    this.pos++;
    const out: number[] = [];
    let depth = 1;
    while (this.pos < this.buf.length) {
      const c = this.byte();
      this.pos++;
      if (c === 92) {
        const n = this.byte();
        this.pos++;
        if (n in ESCAPES) out.push(ESCAPES[n] ?? 0);
        else if (n >= 48 && n <= 55) {
          let v = n - 48;
          for (let i = 0; i < 2 && this.byte() >= 48 && this.byte() <= 55; i++) {
            v = v * 8 + (this.byte() - 48);
            this.pos++;
          }
          out.push(v & 0xff);
        } else if (n === 13) {
          if (this.byte() === 10) this.pos++;
        } else if (n !== 10) out.push(n);
        continue;
      }
      if (c === 40) depth++;
      if (c === 41 && --depth === 0) break;
      out.push(c);
    }
    return new PdfString(Uint8Array.from(out));
  }

  /**
   * Un objeto completo. En el cuerpo del archivo (`refs`) `1 0 R` es una referencia; en un flujo
   * de contenido las palabras sueltas son operadores y salen como `PdfOp`.
   */
  value(refs = true): PdfValue | PdfOp | null | undefined {
    const tok = this.token();
    if (!tok) return undefined;
    return this.fromToken(tok, refs);
  }

  private fromToken(tok: Token, refs: boolean): PdfValue | PdfOp | undefined {
    switch (tok.t) {
      case "open": {
        const items: PdfValue[] = [];
        for (;;) {
          const next = this.token();
          if (!next || next.t === "close") return items;
          const v = this.fromToken(next, refs);
          if (v !== undefined && !(v instanceof PdfOp)) items.push(v);
        }
      }
      case "dictOpen": {
        const dict: PdfDict = new Map();
        for (;;) {
          const key = this.token();
          if (!key || key.t === "dictClose") return dict;
          if (key.t !== "value" || !(key.v instanceof PdfName)) continue;
          const v = this.value(refs);
          if (v === undefined) return dict;
          if (v instanceof PdfOp) continue;
          dict.set(key.v.name, v);
        }
      }
      case "kw":
        return new PdfOp(tok.v);
      case "value": {
        if (refs && typeof tok.v === "number" && Number.isInteger(tok.v)) {
          const save = this.pos;
          const gen = this.token();
          if (gen?.t === "value" && typeof gen.v === "number") {
            const r = this.token();
            if (r?.t === "kw" && r.v === "R") return new PdfRef(tok.v, gen.v);
          }
          this.pos = save;
        }
        return tok.v;
      }
      default:
        return undefined;
    }
  }
}

export const isDict = (v: PdfValue | undefined): v is PdfDict => v instanceof Map;

export const nameOf = (v: PdfValue | undefined): string | null =>
  v instanceof PdfName ? v.name : null;

export const numberOf = (v: PdfValue | undefined, fallback = 0): number =>
  typeof v === "number" ? v : fallback;

export const latin1 = (bytes: Uint8Array): string => {
  let s = "";
  for (let i = 0; i < bytes.length; i += 8192) {
    s += String.fromCharCode(...bytes.subarray(i, i + 8192));
  }
  return s;
};
