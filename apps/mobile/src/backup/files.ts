import * as DocumentPicker from "expo-document-picker";
import { File, Paths } from "expo-file-system";
import * as Sharing from "expo-sharing";
import type { BackupFiles } from "./port";

/** Archivos de respaldo y CSV: se escriben en la caché privada y se entregan con el menú de compartir. */
export const backupFiles: BackupFiles = {
  available: true,
  async share(name, contents, mimeType) {
    const file = new File(Paths.cache, name);
    if (file.exists) file.delete();
    file.create();
    file.write(contents);
    try {
      await Sharing.shareAsync(file.uri, { mimeType, dialogTitle: name });
    } finally {
      // No dejar copias en el teléfono: el archivo ya salió por donde la persona eligió.
      if (file.exists) file.delete();
    }
  },
  async pick() {
    const res = await DocumentPicker.getDocumentAsync({
      copyToCacheDirectory: true,
      multiple: false,
    });
    const asset = res.canceled ? undefined : res.assets[0];
    if (!asset) return null;
    const file = new File(asset.uri);
    try {
      return await file.text();
    } finally {
      if (file.exists) file.delete();
    }
  },
};
