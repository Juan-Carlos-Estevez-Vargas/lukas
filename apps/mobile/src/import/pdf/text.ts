import { PdfDocument } from "./document";
import { type Font, loadFont } from "./fonts";
import {
  isDict,
  Lexer,
  nameOf,
  numberOf,
  type PdfDict,
  PdfOp,
  PdfStream,
  PdfString,
  type PdfValue,
} from "./syntax";

/** Un trozo de texto pintado: dónde empieza y termina en la página (puntos, origen abajo). */
export interface TextItem {
  readonly page: number;
  readonly x: number;
  readonly end: number;
  readonly y: number;
  readonly size: number;
  readonly text: string;
}

export interface PdfCell {
  readonly x: number;
  readonly end: number;
  readonly text: string;
}

/** Una línea visual de la página: celdas de izquierda a derecha. */
export interface PdfLine {
  readonly page: number;
  readonly y: number;
  readonly cells: readonly PdfCell[];
}

type Matrix = readonly [number, number, number, number, number, number];
const IDENTITY: Matrix = [1, 0, 0, 1, 0, 0];

const multiply = (m: Matrix, n: Matrix): Matrix => [
  m[0] * n[0] + m[1] * n[2],
  m[0] * n[1] + m[1] * n[3],
  m[2] * n[0] + m[3] * n[2],
  m[2] * n[1] + m[3] * n[3],
  m[4] * n[0] + m[5] * n[2] + n[4],
  m[4] * n[1] + m[5] * n[3] + n[5],
];

const translate = (tx: number, ty: number): Matrix => [1, 0, 0, 1, tx, ty];

interface State {
  ctm: Matrix;
  font: Font | null;
  size: number;
  charSpace: number;
  wordSpace: number;
  scale: number;
  leading: number;
  rise: number;
}

const MAX_FORM_DEPTH = 6;

class PageReader {
  readonly items: TextItem[] = [];
  private readonly fonts = new Map<PdfDict, Font>();

  constructor(
    private readonly doc: PdfDocument,
    private readonly page: number,
  ) {}

  private font(resources: PdfDict, name: string): Font | null {
    const fonts = this.doc.dict(resources.get("Font"));
    const dict = this.doc.dict(fonts?.get(name));
    if (!dict) return null;
    let font = this.fonts.get(dict);
    if (!font) {
      font = loadFont(this.doc, dict);
      this.fonts.set(dict, font);
    }
    return font;
  }

  run(content: Uint8Array, resources: PdfDict, base: Matrix, depth = 0): void {
    const lex = new Lexer(content);
    let state: State = {
      ctm: base,
      font: null,
      size: 0,
      charSpace: 0,
      wordSpace: 0,
      scale: 1,
      leading: 0,
      rise: 0,
    };
    const stack: State[] = [];
    let tm: Matrix = IDENTITY;
    let tlm: Matrix = IDENTITY;
    const operands: PdfValue[] = [];
    const num = (i: number) => numberOf(operands[i]);

    const show = (s: PdfString) => {
      if (!state.font) return;
      let text = "";
      const start = multiply(
        multiply([state.size * state.scale, 0, 0, state.size, 0, state.rise], tm),
        state.ctm,
      );
      for (const g of state.font.glyphs(s.bytes)) {
        text += g.text;
        const advance =
          ((g.width / 1000) * state.size + state.charSpace + (g.isSpace ? state.wordSpace : 0)) *
          state.scale;
        tm = multiply(translate(advance, 0), tm);
      }
      const finish = multiply(multiply([1, 0, 0, 1, 0, state.rise], tm), state.ctm);
      const size = Math.hypot(start[2], start[3]);
      if (text.trim() !== "") {
        this.items.push({ page: this.page, x: start[4], end: finish[4], y: start[5], size, text });
      }
    };
    const nextLine = (tx: number, ty: number) => {
      tlm = multiply(translate(tx, ty), tlm);
      tm = tlm;
    };

    for (let v = lex.value(false); v !== undefined; v = lex.value(false)) {
      if (!(v instanceof PdfOp)) {
        operands.push(v);
        continue;
      }
      switch (v.op) {
        case "q":
          stack.push({ ...state });
          break;
        case "Q":
          state = stack.pop() ?? state;
          break;
        case "cm":
          state.ctm = multiply([num(0), num(1), num(2), num(3), num(4), num(5)], state.ctm);
          break;
        case "BT":
          tm = IDENTITY;
          tlm = IDENTITY;
          break;
        case "Tf": {
          const name = nameOf(operands[0]);
          state.font = name ? this.font(resources, name) : null;
          state.size = num(1);
          break;
        }
        case "Tc":
          state.charSpace = num(0);
          break;
        case "Tw":
          state.wordSpace = num(0);
          break;
        case "Tz":
          state.scale = num(0) / 100;
          break;
        case "TL":
          state.leading = num(0);
          break;
        case "Ts":
          state.rise = num(0);
          break;
        case "Td":
          nextLine(num(0), num(1));
          break;
        case "TD":
          state.leading = -num(1);
          nextLine(num(0), num(1));
          break;
        case "Tm":
          tlm = [num(0), num(1), num(2), num(3), num(4), num(5)];
          tm = tlm;
          break;
        case "T*":
          nextLine(0, -state.leading);
          break;
        case "Tj":
          if (operands[0] instanceof PdfString) show(operands[0]);
          break;
        case "'":
          nextLine(0, -state.leading);
          if (operands[0] instanceof PdfString) show(operands[0]);
          break;
        case '"':
          state.wordSpace = num(0);
          state.charSpace = num(1);
          nextLine(0, -state.leading);
          if (operands[2] instanceof PdfString) show(operands[2]);
          break;
        case "TJ": {
          const parts = Array.isArray(operands[0]) ? operands[0] : [];
          for (const p of parts) {
            if (p instanceof PdfString) show(p);
            else if (typeof p === "number") {
              tm = multiply(translate((-p / 1000) * state.size * state.scale, 0), tm);
            }
          }
          break;
        }
        case "Do":
          if (depth < MAX_FORM_DEPTH) this.form(resources, nameOf(operands[0]), state.ctm, depth);
          break;
        case "BI":
          skipInlineImage(lex);
          break;
        default:
          break;
      }
      operands.length = 0;
    }
  }

  private form(resources: PdfDict, name: string | null, ctm: Matrix, depth: number): void {
    if (!name) return;
    const xobjects = this.doc.dict(resources.get("XObject"));
    const form = this.doc.resolve(xobjects?.get(name));
    if (!(form instanceof PdfStream) || nameOf(form.dict.get("Subtype")) !== "Form") return;
    const m = this.doc.resolve(form.dict.get("Matrix"));
    const matrix: Matrix =
      Array.isArray(m) && m.length === 6
        ? [
            numberOf(m[0]),
            numberOf(m[1]),
            numberOf(m[2]),
            numberOf(m[3]),
            numberOf(m[4]),
            numberOf(m[5]),
          ]
        : IDENTITY;
    let data: Uint8Array;
    try {
      data = this.doc.decode(form);
    } catch {
      return;
    }
    const own = this.doc.dict(form.dict.get("Resources"));
    this.run(data, own ?? resources, multiply(matrix, ctm), depth + 1);
  }
}

function skipInlineImage(lex: Lexer): void {
  const { buf } = lex;
  for (let i = lex.pos; i + 2 < buf.length; i++) {
    // "EI" rodeado de espacios.
    if (
      buf[i] === 69 &&
      buf[i + 1] === 73 &&
      (buf[i + 2] ?? 32) <= 32 &&
      (buf[i - 1] ?? 32) <= 32
    ) {
      lex.pos = i + 2;
      return;
    }
  }
  lex.pos = buf.length;
}

/** Todo el texto del documento con su posición. */
export function extractItems(doc: PdfDocument): TextItem[] {
  const items: TextItem[] = [];
  doc.pages().forEach(({ page, resources }, index) => {
    const reader = new PageReader(doc, index + 1);
    reader.run(
      doc.contents(page.get("Contents")),
      isDict(resources) ? resources : new Map(),
      IDENTITY,
    );
    items.push(...reader.items);
  });
  return items;
}

/**
 * Agrupa en líneas (misma altura, con tolerancia) y, dentro de cada línea, junta en celdas lo que
 * está pegado. Un hueco de más de ~0,4 em (más que un
 * espacio entre palabras) separa columnas.
 */
export function toLines(items: readonly TextItem[]): PdfLine[] {
  const sorted = [...items].sort((a, b) => a.page - b.page || b.y - a.y || a.x - b.x);
  const groups: TextItem[][] = [];
  for (const item of sorted) {
    const current = groups[groups.length - 1];
    const ref = current?.[0];
    if (
      current &&
      ref &&
      ref.page === item.page &&
      Math.abs(ref.y - item.y) <= Math.max(2, ref.size * 0.4)
    ) {
      current.push(item);
    } else groups.push([item]);
  }
  return groups.map((group) => {
    const parts = [...group].sort((a, b) => a.x - b.x);
    const cells: { x: number; end: number; text: string }[] = [];
    for (const p of parts) {
      const last = cells[cells.length - 1];
      const gap = last ? p.x - last.end : Number.POSITIVE_INFINITY;
      const size = p.size || 10;
      if (last && gap <= size * 0.4) {
        const space = gap > size * 0.15 && !last.text.endsWith(" ") && !p.text.startsWith(" ");
        last.text += (space ? " " : "") + p.text;
        last.end = Math.max(last.end, p.end);
      } else cells.push({ x: p.x, end: p.end, text: p.text });
    }
    return {
      page: group[0]?.page ?? 1,
      y: group[0]?.y ?? 0,
      cells: cells.map((c) => ({ ...c, text: clean(c.text) })).filter((c) => c.text !== ""),
    };
  });
}

const LIGATURES: Record<string, string> = { ﬀ: "ff", ﬁ: "fi", ﬂ: "fl", ﬃ: "ffi", ﬄ: "ffl" };

const clean = (text: string): string =>
  text
    .replace(/[ﬀ-ﬄ]/g, (l) => LIGATURES[l] ?? l)
    .replace(/[\s\u00a0]+/g, " ")
    .trim();

/** Lee un PDF y devuelve sus líneas. Lanza `PdfError` (clave, archivo inválido o no soportado). */
export function readPdfLines(data: Uint8Array, password = ""): PdfLine[] {
  return toLines(extractItems(PdfDocument.load(data, password)));
}

export const lineText = (line: PdfLine): string => line.cells.map((c) => c.text).join(" ");
