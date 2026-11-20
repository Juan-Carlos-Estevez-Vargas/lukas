/** En la web el reporte se descarga directamente. */
export async function deliverFile(name: string, data: Uint8Array, mimeType: string): Promise<void> {
  const blob = new Blob([data.slice().buffer], { type: mimeType });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = name;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
