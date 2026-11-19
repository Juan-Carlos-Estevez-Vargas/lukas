import type { PinRecord, Sha256 } from "./pin";

/**
 * En la web no hay Keystore ni base local: el bloqueo no aplica. La sesión vive en
 * `sessionStorage` y se cierra con la pestaña.
 */
export const lockStore = {
  available: false,
  readPin: async (): Promise<PinRecord | null> => null,
  writePin: async (_record: PinRecord) => undefined,
  clearPin: async () => undefined,
  readLockout: async (): Promise<string | null> => null,
  writeLockout: async (_raw: string) => undefined,
  readBiometric: async () => false,
  writeBiometric: async (_on: boolean) => undefined,
};

export const sha256: Sha256 = async () => {
  throw new Error("Bloqueo no disponible en la web");
};

export const newSalt = async (): Promise<string> => "";
export const biometricsAvailable = async () => false;
export const authenticateWithBiometrics = async (_prompt: string, _cancel: string) => false;
