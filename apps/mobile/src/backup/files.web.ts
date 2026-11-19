import type { BackupFiles } from "./port";

/** En la web no hay base local que respaldar. */
export const backupFiles: BackupFiles = {
  available: false,
  share: async () => undefined,
  pick: async () => null,
};
