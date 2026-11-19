import * as SecureStore from "expo-secure-store";

const KEY = "lukas.session";

/**
 * El token de sesión vive en el almacén cifrado del sistema (Keystore en Android, Keychain en iOS)
 * y solo se puede leer con el dispositivo desbloqueado. Nunca en AsyncStorage.
 */
const options: SecureStore.SecureStoreOptions = {
  keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY,
};

export const tokenStore = {
  read: (): Promise<string | null> => SecureStore.getItemAsync(KEY, options),
  write: (token: string): Promise<void> => SecureStore.setItemAsync(KEY, token, options),
  clear: (): Promise<void> => SecureStore.deleteItemAsync(KEY, options),
};
