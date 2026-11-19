import { CryptoDigestAlgorithm, digestStringAsync, getRandomBytesAsync } from "expo-crypto";
import * as LocalAuthentication from "expo-local-authentication";
import * as SecureStore from "expo-secure-store";
import type { PinRecord, Sha256 } from "./pin";

const PIN = "lukas.lock.pin";
const LOCKOUT = "lukas.lock.lockout";
const BIOMETRIC = "lukas.lock.biometric";

const secure: SecureStore.SecureStoreOptions = {
  keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY,
};

/** Todo lo del bloqueo vive en Keystore/Keychain, fuera de la base cifrada. */
export const lockStore = {
  available: true,
  async readPin(): Promise<PinRecord | null> {
    const raw = await SecureStore.getItemAsync(PIN, secure);
    if (!raw) return null;
    try {
      const value = JSON.parse(raw) as PinRecord;
      return typeof value.salt === "string" && typeof value.hash === "string" ? value : null;
    } catch {
      return null;
    }
  },
  writePin: (record: PinRecord) => SecureStore.setItemAsync(PIN, JSON.stringify(record), secure),
  clearPin: () => SecureStore.deleteItemAsync(PIN, secure),
  readLockout: () => SecureStore.getItemAsync(LOCKOUT, secure),
  writeLockout: (raw: string) => SecureStore.setItemAsync(LOCKOUT, raw, secure),
  async readBiometric(): Promise<boolean> {
    return (await SecureStore.getItemAsync(BIOMETRIC, secure)) === "1";
  },
  writeBiometric: (on: boolean) => SecureStore.setItemAsync(BIOMETRIC, on ? "1" : "0", secure),
};

export const sha256: Sha256 = (text) => digestStringAsync(CryptoDigestAlgorithm.SHA256, text);

export async function newSalt(): Promise<string> {
  const bytes = await getRandomBytesAsync(16);
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}

/** ¿El teléfono tiene huella o rostro registrados? */
export async function biometricsAvailable(): Promise<boolean> {
  return (
    (await LocalAuthentication.hasHardwareAsync()) && (await LocalAuthentication.isEnrolledAsync())
  );
}

/** Pide huella o rostro. Sin respaldo al PIN del sistema: el respaldo es el PIN de Lukas. */
export async function authenticateWithBiometrics(prompt: string, cancel: string): Promise<boolean> {
  const result = await LocalAuthentication.authenticateAsync({
    promptMessage: prompt,
    cancelLabel: cancel,
    disableDeviceFallback: true,
  });
  return result.success;
}
