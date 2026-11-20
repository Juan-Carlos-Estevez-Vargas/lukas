import { ImageManipulator, SaveFormat } from "expo-image-manipulator";

/** Ancho máximo: de sobra para leer un recibo y deja la foto en ~150–300 KB. */
const MAX_WIDTH = 1280;

/**
 * Achica y comprime la foto del recibo antes de mandarla a leer. Devuelve JPEG en base64; el
 * archivo guardado en el teléfono no cambia.
 */
export async function compressForReading(
  uri: string,
): Promise<{ base64: string; mediaType: "image/jpeg" }> {
  const context = ImageManipulator.manipulate(uri);
  const probe = await context.renderAsync();
  if (probe.width > MAX_WIDTH) context.resize({ width: MAX_WIDTH });
  const image = await context.renderAsync();
  const saved = await image.saveAsync({ compress: 0.6, format: SaveFormat.JPEG, base64: true });
  if (!saved.base64) throw new Error("La foto no se pudo comprimir");
  return { base64: saved.base64, mediaType: "image/jpeg" };
}
