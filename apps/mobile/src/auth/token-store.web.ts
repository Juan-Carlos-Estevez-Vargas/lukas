/**
 * En la web no hay Keystore/Keychain. El token vive en `sessionStorage`: se borra al cerrar la
 * pestaña y no se comparte entre pestañas ni sitios. La API y la web están en dominios distintos
 * (workers.dev y pages.dev), así que una cookie de sesión sería de terceros y los navegadores la
 * bloquean. La defensa contra XSS es la CSP estricta y no renderizar HTML externo.
 */
const KEY = "lukas.session";

const storage = (): Storage | null => {
  try {
    return globalThis.sessionStorage ?? null;
  } catch {
    return null;
  }
};

export const tokenStore = {
  read: async (): Promise<string | null> => storage()?.getItem(KEY) ?? null,
  write: async (token: string): Promise<void> => storage()?.setItem(KEY, token),
  clear: async (): Promise<void> => storage()?.removeItem(KEY),
};
