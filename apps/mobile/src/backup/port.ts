/** Puerto de archivos para respaldos y exportaciones. */
export interface BackupFiles {
  readonly available: boolean;
  /** Abre el menú de compartir con el archivo (guardar en Drive, enviar por correo…). */
  share(name: string, contents: string, mimeType: string): Promise<void>;
  /** Deja elegir un archivo y devuelve su texto; `null` si se canceló. */
  pick(): Promise<string | null>;
}
