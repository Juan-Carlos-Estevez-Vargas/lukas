/** Archivo elegido por la persona, ya leído: nombre y bytes. */
export interface PickedFile {
  readonly name: string;
  readonly data: Uint8Array;
}

/** Tipos que se ofrecen al elegir: CSV, texto y Excel. */
export const TABLE_TYPES = [
  "text/csv",
  "text/comma-separated-values",
  "text/plain",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  "application/vnd.ms-excel",
];
