/** Archivo elegido por la persona, ya leído: nombre y bytes. */
export interface PickedFile {
  readonly name: string;
  readonly data: Uint8Array;
}

/** Tipos que se ofrecen al elegir: extractos en PDF, CSV, texto y Excel. */
export const TABLE_TYPES = [
  "application/pdf",
  "text/csv",
  "text/comma-separated-values",
  "text/plain",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  "application/vnd.ms-excel",
];
