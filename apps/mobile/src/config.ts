/**
 * URL de la API. En desarrollo apunta al Worker local visto desde el emulador de Android
 * (`10.0.2.2` es el `localhost` del equipo). En CI se define `EXPO_PUBLIC_API_URL`.
 */
export const apiUrl: string = process.env.EXPO_PUBLIC_API_URL ?? "http://10.0.2.2:8787";

/**
 * Build de pruebas de extremo a extremo (Maestro en el emulador del CI). Solo lo activa
 * `EXPO_PUBLIC_E2E=1` al compilar el APK de e2e.yml; los perfiles de eas.json nunca lo definen.
 */
export const e2eMode: boolean = process.env.EXPO_PUBLIC_E2E === "1";
