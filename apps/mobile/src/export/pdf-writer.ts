import { zlibSync } from "fflate";
import { CP1252, standardWidth } from "../import/pdf/fonts";

/**
 * Escritor de PDF mínimo: páginas carta con texto en Helvetica (normal y negrita, WinAnsi) y
 * líneas. Suficiente para un reporte tabular; no incrusta fuentes, así que pesa pocos kB.
 */
export const PAGE = { width: 612, height: 792 } as const;

const TO_BYTE = new Map(Object.entries(CP1252).map(([code, ch]) => [ch, Number(code)]));

/** Texto a bytes WinAnsi; lo que no cabe en esa codificación sale como "?". */
export function winAnsi(text: string): number[] {
  const out: number[] = [];
  for (const ch of text.replace(/[  ]/g, " ")) {
    const code = ch.codePointAt(0) ?? 63;
    const mapped = TO_BYTE.get(ch);
    if (mapped !== undefined) out.push(mapped);
    else if ((code >= 32 && code < 127) || (code >= 160 && code < 256)) out.push(code);
    else out.push(63);
  }
  return out;
}

export const textWidth = (text: string, size: number): number =>
  (winAnsi(text).reduce((w, b) => w + standardWidth("Helvetica", b), 0) / 1000) * size;

/** Recorta con "…" para que quepa en `max` puntos. */
export function clip(text: string, size: number, max: number): string {
  if (textWidth(text, size) <= max) return text;
  let out = text;
  while (out.length > 1 && textWidth(`${out}…`, size) > max) out = out.slice(0, -1);
  return `${out.trimEnd()}…`;
}

const literal = (codes: number[]): string =>
  codes
    .map((b) =>
      b === 40 || b === 41 || b === 92
        ? `\\${String.fromCharCode(b)}`
        : b < 32 || b > 126
          ? `\\${b.toString(8).padStart(3, "0")}`
          : String.fromCharCode(b),
    )
    .join("");

const num = (n: number) => (Math.round(n * 100) / 100).toString();

export interface TextOptions {
  readonly size?: number;
  readonly bold?: boolean;
  readonly align?: "left" | "right";
  /** Gris de 0 (negro) a 1 (blanco). */
  readonly gray?: number;
}

export class PdfWriter {
  private readonly pages: string[][] = [[]];
  private current = 0;

  constructor(private readonly title: string) {}

  get pageCount(): number {
    return this.pages.length;
  }

  newPage(): void {
    this.pages.push([]);
    this.current = this.pages.length - 1;
  }

  /** Vuelve a una página ya creada (p. ej. para numerarlas al final). */
  goTo(index: number): void {
    if (index >= 0 && index < this.pages.length) this.current = index;
  }

  private push(op: string): void {
    this.pages[this.current]?.push(op);
  }

  text(x: number, y: number, value: string, options: TextOptions = {}): void {
    const size = options.size ?? 9;
    const left = options.align === "right" ? x - textWidth(value, size) : x;
    this.push(
      `BT ${num(options.gray ?? 0)} g /${options.bold ? "F2" : "F1"} ${num(size)} Tf ${num(left)} ${num(y)} Td (${literal(winAnsi(value))}) Tj ET`,
    );
  }

  line(x1: number, y1: number, x2: number, y2: number, gray = 0.75): void {
    this.push(`${num(gray)} G 0.5 w ${num(x1)} ${num(y1)} m ${num(x2)} ${num(y2)} l S`);
  }

  finish(): Uint8Array {
    const objects: (string | Uint8Array)[] = [];
    const add = (o: string | Uint8Array) => {
      objects.push(o);
      return objects.length;
    };
    const catalog = add("");
    const pages = add("");
    const font = (name: string) =>
      add(`<< /Type /Font /Subtype /Type1 /BaseFont /${name} /Encoding /WinAnsiEncoding >>`);
    const f1 = font("Helvetica");
    const f2 = font("Helvetica-Bold");
    const info = add(`<< /Title (${literal(winAnsi(this.title))}) /Producer (Lukas) >>`);
    const kids: number[] = [];
    for (const ops of this.pages) {
      const data = zlibSync(bytes(ops.join("\n")));
      const head = `<< /Length ${data.length} /Filter /FlateDecode >>\nstream\n`;
      const content = add(concat(bytes(head), data, bytes("\nendstream")));
      kids.push(
        add(
          `<< /Type /Page /Parent ${pages} 0 R /MediaBox [0 0 ${PAGE.width} ${PAGE.height}] /Resources << /Font << /F1 ${f1} 0 R /F2 ${f2} 0 R >> >> /Contents ${content} 0 R >>`,
        ),
      );
    }
    objects[catalog - 1] = `<< /Type /Catalog /Pages ${pages} 0 R >>`;
    objects[pages - 1] =
      `<< /Type /Pages /Kids [${kids.map((k) => `${k} 0 R`).join(" ")}] /Count ${kids.length} >>`;

    const parts: Uint8Array[] = [bytes("%PDF-1.4\n%\xe2\xe3\xcf\xd3\n")];
    let offset = parts[0]?.length ?? 0;
    const offsets: number[] = [];
    objects.forEach((o, i) => {
      offsets.push(offset);
      const chunk = concat(
        bytes(`${i + 1} 0 obj\n`),
        typeof o === "string" ? bytes(o) : o,
        bytes("\nendobj\n"),
      );
      parts.push(chunk);
      offset += chunk.length;
    });
    const xref = [
      "xref",
      `0 ${objects.length + 1}`,
      "0000000000 65535 f ",
      ...offsets.map((o) => `${String(o).padStart(10, "0")} 00000 n `),
      "trailer",
      `<< /Size ${objects.length + 1} /Root ${catalog} 0 R /Info ${info} 0 R >>`,
      "startxref",
      String(offset),
      "%%EOF",
      "",
    ].join("\n");
    parts.push(bytes(xref));
    return concat(...parts);
  }
}

const bytes = (s: string): Uint8Array => Uint8Array.from(s, (c) => c.charCodeAt(0) & 0xff);

function concat(...parts: Uint8Array[]): Uint8Array {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let at = 0;
  for (const p of parts) {
    out.set(p, at);
    at += p.length;
  }
  return out;
}
