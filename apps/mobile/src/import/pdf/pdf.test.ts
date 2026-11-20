import { readFileSync } from "node:fs";
import { zlibSync } from "fflate";
import { describe, expect, it } from "vitest";
import { rc4 } from "./crypt";
import { applyFilter, PdfDocument } from "./document";
import { CMap, glyphText } from "./fonts";
import { Lexer, PdfError, PdfName, type PdfOp, PdfRef, type PdfString } from "./syntax";
import { lineText, readPdfLines, toLines } from "./text";

const fixture = (name: string) =>
  new Uint8Array(readFileSync(`src/import/statements/fixtures/${name}.pdf`));
const ascii = (s: string) => Uint8Array.from([...s].map((c) => c.charCodeAt(0)));
const text = (b: Uint8Array) => String.fromCharCode(...b);

/** Arma un PDF mínimo sin xref (el lector no la necesita). */
function pdf(objects: readonly (string | Uint8Array)[], trailer = "<< /Root 1 0 R >>"): Uint8Array {
  const parts: Uint8Array[] = [ascii("%PDF-1.4\n")];
  objects.forEach((o, i) => {
    parts.push(
      ascii(`${i + 1} 0 obj\n`),
      typeof o === "string" ? ascii(o) : o,
      ascii("\nendobj\n"),
    );
  });
  parts.push(ascii(`trailer\n${trailer}\n%%EOF\n`));
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let at = 0;
  for (const p of parts) {
    out.set(p, at);
    at += p.length;
  }
  return out;
}

const stream = (dict: string, data: Uint8Array | string): Uint8Array => {
  const body = typeof data === "string" ? ascii(data) : data;
  const head = ascii(`<< ${dict} /Length ${body.length} >>\nstream\n`);
  const tail = ascii("\nendstream");
  const out = new Uint8Array(head.length + body.length + tail.length);
  out.set(head);
  out.set(body, head.length);
  out.set(tail, head.length + body.length);
  return out;
};

describe("sintaxis", () => {
  it("lee cadenas, nombres, referencias y diccionarios", () => {
    const lex = new Lexer(
      ascii(
        "<< /A#20B (a\\(b\\)\\n\\101\\\nc) /H <48 6f 6C> /R [1 0 R 2] /N -.5 /T true /X null >>",
      ),
    );
    const d = lex.value();
    expect(d).toBeInstanceOf(Map);
    const m = d as Map<string, unknown>;
    expect(text((m.get("A B") as PdfString).bytes)).toBe("a(b)\nAc");
    expect(text((m.get("H") as PdfString).bytes)).toBe("Hol");
    const r = m.get("R") as unknown[];
    expect(r[0]).toBeInstanceOf(PdfRef);
    expect(r[1]).toBe(2);
    expect(m.get("N")).toBe(-0.5);
    expect(m.get("T")).toBe(true);
    expect(m.get("X")).toBeNull();
  });

  it("en contenido devuelve operadores y salta comentarios", () => {
    const lex = new Lexer(ascii("% nota\n/F1 12 Tf <4>Tj"));
    expect(lex.value(false)).toBeInstanceOf(PdfName);
    expect(lex.value(false)).toBe(12);
    expect((lex.value(false) as PdfOp).op).toBe("Tf");
    expect([...(lex.value(false) as PdfString).bytes]).toEqual([0x40]);
    expect((lex.value(false) as PdfOp).op).toBe("Tj");
    expect(lex.value(false)).toBeUndefined();
  });
});

describe("filtros", () => {
  it("ASCIIHex, ASCII85 y Flate con predictor PNG", () => {
    expect(text(applyFilter("ASCIIHexDecode", ascii("48 6F 6c6>"), null))).toBe("Hol`");
    expect(text(applyFilter("A85", ascii('<~88i<Q+Dl7=A8a"AAU&<;@:OCt+T~>'), null))).toBe(
      "Hola mundo, extracto!",
    );
    // Dos filas de 3 bytes con predictor "Up" (2): la segunda suma la de arriba.
    const raw = Uint8Array.from([2, 1, 2, 3, 2, 1, 1, 1]);
    const params = new Map([
      ["Predictor", 12],
      ["Columns", 3],
    ]);
    expect([...applyFilter("FlateDecode", zlibSync(raw), params)]).toEqual([1, 2, 3, 2, 3, 4]);
    expect(() => applyFilter("DCTDecode", raw, null)).toThrow(PdfError);
  });

  it("LZW", () => {
    // "ABABABA" codificado a mano: 65 66 258 260 257 con códigos de 9 bits.
    const codes = [256, 65, 66, 258, 260, 257];
    let bits = "";
    for (const c of codes) bits += c.toString(2).padStart(9, "0");
    while (bits.length % 8) bits += "0";
    const bytes = Uint8Array.from(bits.match(/.{8}/g) ?? [], (b) => Number.parseInt(b, 2));
    expect(text(applyFilter("LZWDecode", bytes, null))).toBe("ABABABA");
  });

  it("RC4 es simétrico", () => {
    const key = ascii("llave");
    expect(text(rc4(key, rc4(key, ascii("hola"))))).toBe("hola");
  });
});

describe("fuentes", () => {
  it("traduce nombres de glifos", () => {
    expect(glyphText("A")).toBe("A");
    expect(glyphText("eacute")).toBe("é");
    expect(glyphText("Ntilde")).toBe("Ñ");
    expect(glyphText("uni20AC")).toBe("€");
    expect(glyphText("five.sc")).toBe("5");
    expect(glyphText("raro")).toBe("");
  });

  it("lee una CMap ToUnicode con bfchar y bfrange", () => {
    const cmap = CMap.parse(
      ascii(
        "1 begincodespacerange <0000> <FFFF> endcodespacerange 1 beginbfchar <0003> <0020> endbfchar " +
          "2 beginbfrange <0010> <0012> <0041> <0020> <0021> [<00E9> <00F1>] endbfrange",
      ),
    );
    expect(cmap.map.get(3)).toBe(" ");
    expect(cmap.map.get(0x11)).toBe("B");
    expect(cmap.map.get(0x21)).toBe("ñ");
    expect(cmap.codeLength(Uint8Array.from([0, 3]), 0, 1)).toBe(2);
  });
});

describe("documento", () => {
  const font =
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding << /Differences [65 /Aacute /ntilde] >> >>";

  it("extrae texto con TJ, comillas, saltos de línea y formularios", () => {
    const content =
      "BT /F1 10 Tf 14 TL 50 700 Td (Fecha) Tj 100 0 Td [(V) -20 (alor)] TJ T* (x) Tj ET " +
      "BT /F1 10 Tf 50 680 Td (03/10) Tj 0 -14 TD (A) ' 1 0 (B) \" ET " +
      "q 1 0 0 1 0 -100 cm /X1 Do Q BI /W 1 /H 1 ID \x00\x01 EI";
    const form = stream(
      "/Type /XObject /Subtype /Form /BBox [0 0 600 800]",
      "BT /F1 10 Tf 50 650 Td (dentro) Tj ET",
    );
    const data = pdf([
      "<< /Type /Catalog /Pages 2 0 R >>",
      "<< /Type /Pages /Kids [3 0 R] /Count 1 /Resources << /Font << /F1 4 0 R >> /XObject << /X1 6 0 R >> >> >>",
      "<< /Type /Page /Parent 2 0 R /Contents 5 0 R >>",
      font,
      stream("", content),
      form,
    ]);
    const lines = readPdfLines(data).map(lineText);
    expect(lines).toEqual(["Fecha Valor", "x", "03/10", "Á", "ñ", "dentro"]);
  });

  it("lee objetos comprimidos en flujos de objetos", () => {
    const objstm = `4 0 ${font}`;
    const data = pdf([
      "<< /Type /Catalog /Pages 2 0 R >>",
      "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
      "<< /Type /Page /Parent 2 0 R /Resources << /Font << /F1 4 0 R >> >> /Contents [6 0 R] >>",
      "null",
      stream("/Type /ObjStm /N 1 /First 4 /Filter /FlateDecode", zlibSync(ascii(objstm))),
      stream("/Filter /FlateDecode", zlibSync(ascii("BT /F1 9 Tf 10 10 Td (Hola) Tj ET"))),
    ]);
    // El 4 suelto es anterior al flujo de objetos, así que gana la versión comprimida.
    expect(readPdfLines(data).map(lineText)).toEqual(["Hola"]);
  });

  it("rechaza lo que no es PDF y pide la clave cuando falta o no sirve", () => {
    expect(() => PdfDocument.load(ascii("hola"))).toThrow(PdfError);
    expect(() => PdfDocument.load(ascii("%PDF-1.4\n"))).toThrow(/catálogo/);
    for (const password of ["", "0000"]) {
      try {
        readPdfLines(fixture("nequi"), password);
        expect.unreachable();
      } catch (e) {
        expect(e).toBeInstanceOf(PdfError);
        expect((e as PdfError).reason).toBe("password");
      }
    }
  });

  it("abre los extractos cifrados con RC4 y AES-256", () => {
    expect(readPdfLines(fixture("nequi"), "1020304050").map(lineText)[0]).toBe("Nequi");
    expect(readPdfLines(fixture("bbva"), "1020304050").map(lineText)[0]).toBe("BBVA Colombia");
  });

  it("separa columnas por el hueco entre textos", () => {
    const lines = toLines([
      { page: 1, x: 10, end: 30, y: 100, size: 10, text: "Hola" },
      { page: 1, x: 32, end: 50, y: 100.5, size: 10, text: "mundo" },
      { page: 1, x: 200, end: 230, y: 100, size: 10, text: "$ 5" },
      { page: 1, x: 10, end: 30, y: 80, size: 10, text: "ﬁn" },
    ]);
    expect(lines.map((l) => l.cells.map((c) => c.text))).toEqual([["Hola mundo", "$ 5"], ["fin"]]);
  });
});
