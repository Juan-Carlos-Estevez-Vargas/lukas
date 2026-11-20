import * as DocumentPicker from "expo-document-picker";
import { File } from "expo-file-system";
import { type PickedFile, TABLE_TYPES } from "./picked";

/** Deja elegir un PDF, CSV o .xlsx y devuelve sus bytes; la copia en caché se borra enseguida. */
export async function pickTableFile(): Promise<PickedFile | null> {
  const res = await DocumentPicker.getDocumentAsync({
    type: TABLE_TYPES,
    copyToCacheDirectory: true,
    multiple: false,
  });
  const asset = res.canceled ? undefined : res.assets[0];
  if (!asset) return null;
  const file = new File(asset.uri);
  try {
    return { name: asset.name, data: new Uint8Array(await file.arrayBuffer()) };
  } finally {
    if (file.exists) file.delete();
  }
}
