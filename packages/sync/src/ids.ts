import { sha256 } from "@noble/hashes/sha2.js";
import { utf8ToBytes } from "@noble/hashes/utils.js";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

export const isUuid = (value: string): boolean => UUID.test(value);

/**
 * Id del registro en el servidor. Los ids del teléfono son UUIDv7, salvo las categorías por
 * defecto (`default.mercado`…), que son iguales en todos los teléfonos. Para que no choquen entre
 * usuarios se convierten en un UUIDv8 determinístico a partir del usuario y el id local:
 * el mismo usuario en dos teléfonos obtiene el mismo id, y otro usuario uno distinto.
 */
export const syncId = (userId: string, localId: string): string => {
  if (isUuid(localId)) return localId;
  const bytes = sha256(utf8ToBytes(`lukas:${userId}:${localId}`)).slice(0, 16);
  bytes[6] = ((bytes[6] as number) & 0x0f) | 0x80; // versión 8
  bytes[8] = ((bytes[8] as number) & 0x3f) | 0x80; // variante RFC 9562
  const hex = Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
};
