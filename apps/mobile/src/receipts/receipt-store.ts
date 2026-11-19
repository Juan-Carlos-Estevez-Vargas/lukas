import { Directory, File, Paths } from "expo-file-system";
import { newId } from "../data/ids";
import { type ReceiptStore, receiptFileName } from "./store";

const folder = () => new Directory(Paths.document, "receipts");

export const receiptStore: ReceiptStore = {
  available: true,
  async save(sourceUri, mimeType) {
    const dir = folder();
    if (!dir.exists) dir.create({ intermediates: true });
    const stored = receiptFileName(newId(), mimeType);
    new File(sourceUri).copy(new File(dir, stored.fileName));
    return stored;
  },
  uriOf: (fileName) => new File(folder(), fileName).uri,
  async remove(fileName) {
    const file = new File(folder(), fileName);
    if (file.exists) file.delete();
  },
};
