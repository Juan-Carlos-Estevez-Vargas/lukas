/** Foto de un recibo guardada en el almacenamiento privado de la app. */
export interface StoredReceipt {
  readonly fileName: string;
  readonly mimeType: string;
}

/**
 * Puerto de recibos. La app copia la foto a su carpeta privada (excluida del respaldo, porque
 * `allowBackup` está apagado); nunca sale del teléfono. En la web no hay recibos.
 */
export interface ReceiptStore {
  readonly available: boolean;
  /** Copia la imagen elegida o tomada y devuelve el nombre con que quedó guardada. */
  save(sourceUri: string, mimeType: string | null): Promise<StoredReceipt>;
  uriOf(fileName: string): string;
  remove(fileName: string): Promise<void>;
}

const EXTENSIONS: Record<string, string> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
  "image/heic": "heic",
};

/** Nombre de archivo propio: id + extensión según el tipo; nunca el nombre original. */
export function receiptFileName(id: string, mimeType: string | null): StoredReceipt {
  const mime = mimeType && EXTENSIONS[mimeType] ? mimeType : "image/jpeg";
  return { fileName: `${id}.${EXTENSIONS[mime]}`, mimeType: mime };
}
