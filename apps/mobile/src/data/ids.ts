import { uuidv7 } from "@lukas/domain";
import { getRandomValues } from "expo-crypto";

/** UUIDv7 generado en el dispositivo con el generador seguro del sistema. */
export const newId = (): string =>
  uuidv7(Date.now, (bytes) => {
    getRandomValues(bytes);
  });
