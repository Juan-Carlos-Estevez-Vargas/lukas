/**
 * Lectura de tablas de bancos y hojas de cálculo: CSV (con `;`, `,` o tabulador) y la primera hoja
 * de un .xlsx. Todo llega como texto; interpretar fechas y montos es trabajo de `columns.ts`.
 */
import { strFromU8, unzipSync } from "fflate";

export type Table = readonly (readonly string[])[];

const DELIMITERS = [";", ",", "\t"] as const;

/** El separador que más se repite en las primeras líneas, sin contar lo que va entre comillas. */
export function detectDelimiter(text: string): string {
  const sample = text
    .split(/\r?\n/)
    .slice(0, 10)
    .join("\n")
    .replace(/"[^"]*"/g, "");
  let best: string = ",";
  let most = -1;
  for (const d of DELIMITERS) {
    const count = sample.split(d).length - 1;
    if (count > most) {
      best = d;
      most = count;
    }
  }
  return best;
}

/** CSV según RFC 4180: comillas dobles, `""` como comilla y saltos de línea dentro de comillas. */
export function parseCsv(text: string, delimiter = detectDelimiter(text)): string[][] {
  const src = text.replace(/^﻿/, "");
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let quoted = false;
  for (let i = 0; i < src.length; i++) {
    const ch = src[i];
    if (quoted) {
      if (ch === '"' && src[i + 1] === '"') {
        cell += '"';
        i++;
      } else if (ch === '"') quoted = false;
      else cell += ch;
    } else if (ch === '"' && cell === "") quoted = true;
    else if (ch === delimiter) {
      row.push(cell);
      cell = "";
    } else if (ch === "\n" || ch === "\r") {
      if (ch === "\r" && src[i + 1] === "\n") i++;
      row.push(cell);
      rows.push(row);
      row = [];
      cell = "";
    } else cell += ch;
  }
  if (cell !== "" || row.length > 0) {
    row.push(cell);
    rows.push(row);
  }
  return rows.map((r) => r.map((c) => c.trim())).filter((r) => r.some((c) => c !== ""));
}

const XML_ENTITIES: Record<string, string> = {
  amp: "&",
  lt: "<",
  gt: ">",
  quot: '"',
  apos: "'",
};

const unescapeXml = (s: string) =>
  s.replace(/&(#x[0-9a-f]+|#\d+|\w+);/gi, (m, e: string) => {
    if (e.startsWith("#x") || e.startsWith("#X"))
      return String.fromCodePoint(Number.parseInt(e.slice(2), 16));
    if (e.startsWith("#")) return String.fromCodePoint(Number(e.slice(1)));
    return XML_ENTITIES[e] ?? m;
  });

/** Texto de un `<si>` o `<is>`: une todos sus `<t>` (los textos con formato vienen partidos). */
const textOf = (xml: string) =>
  [...xml.matchAll(/<t(?:\s[^>]*)?>([\s\S]*?)<\/t>/g)].map((m) => unescapeXml(m[1] ?? "")).join("");

/** "C12" → columna 2 (desde 0). */
export function columnIndex(ref: string): number {
  const letters = /^[A-Z]+/i.exec(ref)?.[0].toUpperCase() ?? "A";
  let n = 0;
  for (const ch of letters) n = n * 26 + (ch.charCodeAt(0) - 64);
  return n - 1;
}

/** Tope para no colgar el teléfono con un archivo enorme (un extracto real tiene cientos de filas). */
export const MAX_ROWS = 5000;

/**
 * Primera hoja de un .xlsx como tabla de texto. Los números quedan como vienen (una fecha de Excel
 * es un número de días: `columns.ts` la reconoce). Lanza `Error` si el archivo no es un .xlsx.
 */
export function parseXlsx(data: Uint8Array): string[][] {
  const files = unzipSync(data, {
    filter: (f) =>
      f.name === "xl/sharedStrings.xml" ||
      f.name === "xl/workbook.xml" ||
      f.name === "xl/_rels/workbook.xml.rels" ||
      f.name.startsWith("xl/worksheets/sheet"),
  });
  const read = (name: string) => {
    const f = files[name];
    return f ? strFromU8(f) : null;
  };
  const shared = [...(read("xl/sharedStrings.xml") ?? "").matchAll(/<si>([\s\S]*?)<\/si>/g)].map(
    (m) => textOf(m[1] ?? ""),
  );
  const sheet = read(firstSheetPath(read("xl/workbook.xml"), read("xl/_rels/workbook.xml.rels")));
  if (!sheet) throw new Error("El archivo no tiene hojas");
  const rows: string[][] = [];
  for (const r of sheet.matchAll(/<row\b[^>]*>([\s\S]*?)<\/row>/g)) {
    if (rows.length >= MAX_ROWS) break;
    const row: string[] = [];
    for (const c of (r[1] ?? "").matchAll(/<c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g)) {
      const attrs = c[1] ?? "";
      const body = c[2] ?? "";
      const at = columnIndex(
        /\br="([A-Z]+)\d+"/i.exec(attrs)?.[1] ?? String.fromCharCode(65 + row.length),
      );
      const type = /\bt="(\w+)"/.exec(attrs)?.[1];
      const v = unescapeXml(/<v>([\s\S]*?)<\/v>/.exec(body)?.[1] ?? "");
      const value =
        type === "s" ? (shared[Number(v)] ?? "") : type === "inlineStr" ? textOf(body) : v;
      while (row.length < at) row.push("");
      row[at] = value.trim();
    }
    if (row.some((c) => c !== "")) rows.push(row);
  }
  return rows;
}

/** La hoja que el libro lista primero; si no se puede saber, `sheet1.xml`. */
function firstSheetPath(workbook: string | null, rels: string | null): string {
  const fallback = "xl/worksheets/sheet1.xml";
  const rid = workbook ? /<sheet\b[^>]*\br:id="([^"]+)"/.exec(workbook)?.[1] : undefined;
  if (!rid || !rels) return fallback;
  // Se recorren las relaciones con una expresión fija: el id viene del archivo y no debe armar
  // una expresión regular (ReDoS).
  const rel = [...rels.matchAll(/<Relationship\b[^>]*>/g)]
    .map((m) => m[0])
    .find((tag) => /\bId="([^"]+)"/.exec(tag)?.[1] === rid);
  const target = rel ? /Target="([^"]+)"/.exec(rel)?.[1] : undefined;
  if (!target) return fallback;
  return target.startsWith("/") ? target.slice(1) : `xl/${target}`;
}

/** Un .xlsx es un zip: empieza por "PK". */
export const looksLikeXlsx = (data: Uint8Array): boolean => data[0] === 0x50 && data[1] === 0x4b;

/** Tabla desde los bytes del archivo: .xlsx si es un zip; si no, CSV en UTF-8 (o Latin-1). */
export function readTable(data: Uint8Array): string[][] {
  if (looksLikeXlsx(data)) return parseXlsx(data);
  return parseCsv(decodeText(data)).slice(0, MAX_ROWS);
}

/**
 * UTF-8 si se lee bien; si no, Latin-1 (los CSV de algunos bancos salen de Excel en Windows). Se
 * decodifica Latin-1 a mano porque Hermes solo trae UTF-8 en `TextDecoder`.
 */
export function decodeText(data: Uint8Array): string {
  const utf8 = new TextDecoder("utf-8").decode(data);
  if (!utf8.includes("\uFFFD")) return utf8;
  let out = "";
  for (const byte of data) out += String.fromCharCode(byte);
  return out;
}
