import * as DocumentPicker from "expo-document-picker";
import type { PickedFile } from "./picked";

/** En la web el archivo no se copia a ningún lado: se lee del navegador y queda en memoria. */
export async function pickTableFile(): Promise<PickedFile | null> {
  const res = await DocumentPicker.getDocumentAsync({ multiple: false });
  const asset = res.canceled ? undefined : res.assets[0];
  if (!asset?.file) return null;
  return { name: asset.name, data: new Uint8Array(await asset.file.arrayBuffer()) };
}
