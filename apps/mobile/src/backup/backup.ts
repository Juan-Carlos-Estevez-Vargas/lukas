import type { SqlConnection } from "../data/sql";
import { decryptBackup, encryptBackup, type RandomBytes } from "./crypto";
import { exportSnapshot, parseSnapshot, restoreSnapshot } from "./snapshot";

const pad = (n: number) => String(n).padStart(2, "0");

/** Nombre del archivo con la fecha local: `lukas-2026-11-19.lukas`. */
export const backupFileName = (now: Date, extension: "lukas" | "csv") =>
  `lukas-${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}.${extension}`;

/** Respaldo completo de la base, cifrado con la contraseña. */
export async function createBackup(
  db: SqlConnection,
  password: string,
  random: RandomBytes,
  now: Date,
): Promise<string> {
  const snapshot = await exportSnapshot(db, now);
  return encryptBackup(new TextEncoder().encode(JSON.stringify(snapshot)), password, random);
}

/** Descifra, valida y reemplaza todos los datos. Devuelve cuántas filas se cargaron. */
export async function restoreBackup(
  db: SqlConnection,
  fileText: string,
  password: string,
): Promise<number> {
  const plain = await decryptBackup(fileText, password);
  return restoreSnapshot(db, parseSnapshot(new TextDecoder().decode(plain)));
}
