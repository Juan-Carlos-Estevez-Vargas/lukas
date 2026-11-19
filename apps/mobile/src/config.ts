/**
 * URL de la API. En desarrollo apunta al Worker local visto desde el emulador de Android
 * (`10.0.2.2` es el `localhost` del equipo). En CI se define `EXPO_PUBLIC_API_URL`.
 */
export const apiUrl: string = process.env.EXPO_PUBLIC_API_URL ?? "http://10.0.2.2:8787";
