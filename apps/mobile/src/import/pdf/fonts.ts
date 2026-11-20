import type { PdfDocument } from "./document";
import {
  isDict,
  Lexer,
  nameOf,
  numberOf,
  type PdfDict,
  PdfName,
  PdfOp,
  PdfStream,
  PdfString,
} from "./syntax";

/** Un código de la cadena ya traducido: texto Unicode y ancho en milésimas de em. */
export interface Glyph {
  readonly text: string;
  readonly width: number;
  /** Byte 32 en fuentes de un byte: ahí se suma el espaciado entre palabras (`Tw`). */
  readonly isSpace: boolean;
}

export interface Font {
  glyphs(bytes: Uint8Array): Glyph[];
}

// Windows-1252 en 0x80–0x9F; el resto coincide con Latin-1.
export const CP1252: Record<number, string> = {
  128: "€",
  130: "‚",
  131: "ƒ",
  132: "„",
  133: "…",
  134: "†",
  135: "‡",
  136: "ˆ",
  137: "‰",
  138: "Š",
  139: "‹",
  140: "Œ",
  142: "Ž",
  145: "‘",
  146: "’",
  147: "“",
  148: "”",
  149: "•",
  150: "–",
  151: "—",
  152: "˜",
  153: "™",
  154: "š",
  155: "›",
  156: "œ",
  158: "ž",
  159: "Ÿ",
};

const winAnsi = (code: number): string =>
  CP1252[code] ??
  (code >= 32 && code !== 127 && (code < 128 || code >= 160) ? String.fromCharCode(code) : "");

const NAMED: Record<string, string> = {
  space: " ",
  exclam: "!",
  quotedbl: '"',
  numbersign: "#",
  dollar: "$",
  percent: "%",
  ampersand: "&",
  quotesingle: "'",
  quoteright: "’",
  quoteleft: "‘",
  parenleft: "(",
  parenright: ")",
  asterisk: "*",
  plus: "+",
  comma: ",",
  hyphen: "-",
  minus: "-",
  period: ".",
  slash: "/",
  zero: "0",
  one: "1",
  two: "2",
  three: "3",
  four: "4",
  five: "5",
  six: "6",
  seven: "7",
  eight: "8",
  nine: "9",
  colon: ":",
  semicolon: ";",
  less: "<",
  equal: "=",
  greater: ">",
  question: "?",
  at: "@",
  bracketleft: "[",
  backslash: "\\",
  bracketright: "]",
  asciicircum: "^",
  underscore: "_",
  grave: "`",
  braceleft: "{",
  bar: "|",
  braceright: "}",
  asciitilde: "~",
  endash: "–",
  emdash: "—",
  bullet: "•",
  degree: "°",
  ordfeminine: "ª",
  ordmasculine: "º",
  questiondown: "¿",
  exclamdown: "¡",
  nbspace: " ",
  Euro: "€",
};

const ACCENTS: Record<string, Record<string, string>> = {
  acute: { a: "á", e: "é", i: "í", o: "ó", u: "ú", A: "Á", E: "É", I: "Í", O: "Ó", U: "Ú" },
  grave: { a: "à", e: "è", i: "ì", o: "ò", u: "ù", A: "À", E: "È", I: "Ì", O: "Ò", U: "Ù" },
  dieresis: { a: "ä", e: "ë", i: "ï", o: "ö", u: "ü", A: "Ä", E: "Ë", I: "Ï", O: "Ö", U: "Ü" },
  circumflex: { a: "â", e: "ê", i: "î", o: "ô", u: "û", A: "Â", E: "Ê", I: "Î", O: "Ô", U: "Û" },
  tilde: { n: "ñ", N: "Ñ", a: "ã", o: "õ", A: "Ã", O: "Õ" },
  cedilla: { c: "ç", C: "Ç" },
};

/** Texto de un nombre de glifo (Adobe Glyph List, lo común en español). */
export function glyphText(name: string): string {
  if (/^[A-Za-z]$/.test(name)) return name;
  const named = NAMED[name];
  if (named !== undefined) return named;
  const uni = /^uni([0-9A-F]{4})/i.exec(name) ?? /^u([0-9A-F]{4,6})$/i.exec(name);
  if (uni?.[1]) return String.fromCodePoint(Number.parseInt(uni[1], 16));
  for (const [suffix, table] of Object.entries(ACCENTS)) {
    if (name.length === suffix.length + 1 && name.endsWith(suffix))
      return table[name[0] ?? ""] ?? "";
  }
  const base = name.split(".")[0] ?? "";
  return base !== name ? glyphText(base) : "";
}

// Anchos de Helvetica (AFM) para 32–126; sirven también de aproximación para las otras 14 estándar.
const HELVETICA = [
  278, 278, 355, 556, 556, 889, 667, 191, 333, 333, 389, 584, 278, 333, 278, 278, 556, 556, 556,
  556, 556, 556, 556, 556, 556, 556, 278, 278, 584, 584, 584, 556, 1015, 667, 667, 722, 722, 667,
  611, 778, 722, 278, 500, 667, 556, 833, 722, 778, 667, 778, 722, 667, 611, 722, 667, 944, 667,
  667, 611, 278, 278, 278, 469, 556, 333, 556, 556, 500, 556, 556, 278, 556, 556, 222, 222, 500,
  222, 833, 556, 556, 556, 556, 333, 500, 278, 556, 500, 722, 500, 500, 500, 334, 260, 334, 584,
];

export const standardWidth = (baseFont: string, code: number): number => {
  if (/courier/i.test(baseFont)) return 600;
  return HELVETICA[code - 32] ?? 556;
};

/** Mapa ToUnicode: rangos de códigos (longitud en bytes) y su texto. */
export class CMap {
  readonly lengths: { readonly bytes: number; readonly lo: number; readonly hi: number }[] = [];
  readonly map = new Map<number, string>();

  static parse(data: Uint8Array): CMap {
    const cmap = new CMap();
    const lex = new Lexer(data);
    const stack: (PdfString | number | PdfString[])[] = [];
    for (let v = lex.value(false); v !== undefined; v = lex.value(false)) {
      if (v instanceof PdfOp) {
        cmap.apply(v.op, stack);
        stack.length = 0;
      } else if (v instanceof PdfString || typeof v === "number") stack.push(v);
      else if (Array.isArray(v))
        stack.push(v.filter((x): x is PdfString => x instanceof PdfString));
    }
    return cmap;
  }

  private apply(op: string, stack: (PdfString | number | PdfString[])[]): void {
    if (op === "endcodespacerange") {
      for (let i = 0; i + 1 < stack.length; i += 2) {
        const lo = stack[i];
        const hi = stack[i + 1];
        if (lo instanceof PdfString && hi instanceof PdfString) {
          this.lengths.push({ bytes: lo.bytes.length, lo: toInt(lo.bytes), hi: toInt(hi.bytes) });
        }
      }
    } else if (op === "endbfchar") {
      for (let i = 0; i + 1 < stack.length; i += 2) {
        const src = stack[i];
        const dst = stack[i + 1];
        if (src instanceof PdfString && dst instanceof PdfString) {
          this.map.set(toInt(src.bytes), utf16(dst.bytes));
        }
      }
    } else if (op === "endbfrange") {
      for (let i = 0; i + 2 < stack.length; i += 3) {
        const lo = stack[i];
        const hi = stack[i + 1];
        const dst = stack[i + 2];
        if (!(lo instanceof PdfString && hi instanceof PdfString)) continue;
        const from = toInt(lo.bytes);
        const to = Math.min(toInt(hi.bytes), from + 65535);
        for (let code = from; code <= to; code++) {
          if (Array.isArray(dst)) {
            const item = dst[code - from];
            if (item) this.map.set(code, utf16(item.bytes));
          } else if (dst instanceof PdfString) {
            const bytes = Uint8Array.from(dst.bytes);
            const last = bytes.length - 1;
            if (last >= 0) bytes[last] = ((bytes[last] ?? 0) + code - from) & 0xff;
            this.map.set(code, utf16(bytes));
          }
        }
      }
    }
  }

  /** Cuántos bytes ocupa el código que empieza en `at`, según los rangos declarados. */
  codeLength(bytes: Uint8Array, at: number, fallback: number): number {
    if (this.lengths.length === 0) return fallback;
    for (let n = 1; n <= 4; n++) {
      const code = toInt(bytes.subarray(at, at + n));
      if (this.lengths.some((r) => r.bytes === n && code >= r.lo && code <= r.hi)) return n;
    }
    return fallback;
  }
}

const toInt = (bytes: Uint8Array): number => bytes.reduce((v, b) => v * 256 + b, 0);

function utf16(bytes: Uint8Array): string {
  let s = "";
  for (let i = 0; i + 1 < bytes.length; i += 2)
    s += String.fromCharCode(((bytes[i] ?? 0) << 8) | (bytes[i + 1] ?? 0));
  if (bytes.length % 2 === 1) s += String.fromCharCode(bytes[bytes.length - 1] ?? 0);
  return s;
}

/** Fuente de un byte (Type1, TrueType, Type3): codificación base + Differences, o ToUnicode. */
class SimpleFont implements Font {
  constructor(
    private readonly text: (code: number) => string,
    private readonly width: (code: number) => number,
  ) {}

  glyphs(bytes: Uint8Array): Glyph[] {
    return [...bytes].map((code) => ({
      text: this.text(code),
      width: this.width(code),
      isSpace: code === 32,
    }));
  }
}

/** Fuente compuesta (Type0): códigos de 1 a 4 bytes según la CMap, casi siempre 2 (Identity-H). */
class CompositeFont implements Font {
  constructor(
    private readonly toUnicode: CMap | null,
    private readonly widths: Map<number, number>,
    private readonly defaultWidth: number,
  ) {}

  glyphs(bytes: Uint8Array): Glyph[] {
    const out: Glyph[] = [];
    for (let at = 0; at < bytes.length; ) {
      const n = this.toUnicode?.codeLength(bytes, at, 2) ?? 2;
      const code = toInt(bytes.subarray(at, at + n));
      at += n;
      out.push({
        text: this.toUnicode?.map.get(code) ?? "",
        width: this.widths.get(code) ?? this.defaultWidth,
        isSpace: n === 1 && code === 32,
      });
    }
    return out;
  }
}

function readToUnicode(doc: PdfDocument, dict: PdfDict): CMap | null {
  const s = doc.resolve(dict.get("ToUnicode"));
  if (!(s instanceof PdfStream)) return null;
  try {
    return CMap.parse(doc.decode(s));
  } catch {
    return null;
  }
}

function cidWidths(doc: PdfDocument, w: unknown): Map<number, number> {
  const out = new Map<number, number>();
  const items = Array.isArray(w) ? w.map((x) => doc.resolve(x)) : [];
  for (let i = 0; i < items.length; ) {
    const first = items[i];
    const next = items[i + 1];
    if (typeof first !== "number") break;
    if (Array.isArray(next)) {
      next.forEach((v, k) => {
        out.set(first + k, numberOf(doc.resolve(v)));
      });
      i += 2;
    } else {
      const last = numberOf(next);
      const width = numberOf(items[i + 2]);
      for (let c = first; c <= last && c - first < 65536; c++) out.set(c, width);
      i += 3;
    }
  }
  return out;
}

export function loadFont(doc: PdfDocument, dict: PdfDict): Font {
  const toUnicode = readToUnicode(doc, dict);
  const subtype = nameOf(doc.resolve(dict.get("Subtype")));
  if (subtype === "Type0") {
    const kids = doc.resolve(dict.get("DescendantFonts"));
    const cid = doc.dict(Array.isArray(kids) ? kids[0] : undefined);
    const widths = cidWidths(doc, doc.resolve(cid?.get("W")));
    return new CompositeFont(toUnicode, widths, numberOf(doc.resolve(cid?.get("DW")), 1000));
  }

  const differences = new Map<number, string>();
  const enc = doc.resolve(dict.get("Encoding"));
  if (isDict(enc)) {
    let code = 0;
    const diffs = doc.resolve(enc.get("Differences"));
    for (const d of Array.isArray(diffs) ? diffs : []) {
      if (typeof d === "number") code = d;
      else if (d instanceof PdfName) differences.set(code++, glyphText(d.name));
    }
  }
  const text = (code: number): string =>
    toUnicode?.map.get(code) ?? differences.get(code) ?? winAnsi(code);

  const firstChar = numberOf(doc.resolve(dict.get("FirstChar")));
  const widthList = doc.resolve(dict.get("Widths"));
  const matrix = doc.resolve(dict.get("FontMatrix"));
  // Type3 mide en su propio espacio de glifo; se lleva a milésimas.
  const scale = Array.isArray(matrix) ? numberOf(matrix[0], 0.001) * 1000 : 1;
  const baseFont = nameOf(doc.resolve(dict.get("BaseFont"))) ?? "";
  const width = (code: number): number => {
    if (Array.isArray(widthList)) {
      const w = doc.resolve(widthList[code - firstChar]);
      if (typeof w === "number") return w * scale;
    }
    return standardWidth(baseFont, code);
  };
  return new SimpleFont(text, width);
}
