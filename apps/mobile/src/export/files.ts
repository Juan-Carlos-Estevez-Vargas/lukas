import { File, Paths } from "expo-file-system";
import * as Sharing from "expo-sharing";

/** Entrega el reporte con el menú de compartir (guardar en Archivos, Drive, WhatsApp…). */
export async function deliverFile(name: string, data: Uint8Array, mimeType: string): Promise<void> {
  const file = new File(Paths.cache, name);
  if (file.exists) file.delete();
  file.create();
  file.write(data);
  try {
    await Sharing.shareAsync(file.uri, { mimeType, dialogTitle: name });
  } finally {
    // No dejar copias en el teléfono: el archivo ya salió por donde la persona eligió.
    if (file.exists) file.delete();
  }
}
