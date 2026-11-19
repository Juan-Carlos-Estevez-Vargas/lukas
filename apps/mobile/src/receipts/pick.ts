import * as ImagePicker from "expo-image-picker";

export type ReceiptSource = "camera" | "library";

/** Toma o elige la foto del recibo. `null` si la persona cancela o niega el permiso. */
export async function pickReceipt(
  source: ReceiptSource,
): Promise<{ uri: string; mimeType: string | null } | null> {
  const options: ImagePicker.ImagePickerOptions = {
    mediaTypes: ["images"],
    quality: 0.6,
    exif: false,
  };
  if (source === "camera") {
    const permission = await ImagePicker.requestCameraPermissionsAsync();
    if (!permission.granted) return null;
  }
  const result =
    source === "camera"
      ? await ImagePicker.launchCameraAsync(options)
      : await ImagePicker.launchImageLibraryAsync(options);
  const asset = result.canceled ? undefined : result.assets[0];
  return asset ? { uri: asset.uri, mimeType: asset.mimeType ?? null } : null;
}
