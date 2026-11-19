# @lukas/mobile

App de Lukas para Android (y luego iOS) con Expo SDK 58 y Expo Router.

## Desarrollo

```sh
pnpm --filter @lukas/api dev      # API local en http://localhost:8787
pnpm --filter @lukas/mobile dev   # Metro; abre la app con Expo Go o un emulador Android
```

La app usa `EXPO_PUBLIC_API_URL` y, si no está definida, `http://10.0.2.2:8787` (el `localhost`
del equipo visto desde el emulador de Android). En desarrollo el código de acceso sale en la
consola de la API.

## Estructura

```
app/            rutas de Expo Router
  (auth)/       acceso con correo y código de 6 dígitos
  (tabs)/       Resumen, Movimientos, Presupuestos y Ajustes
src/api/        cliente HTTP de la API (lógica pura, con pruebas)
src/auth/       sesión y almacenamiento cifrado del token (expo-secure-store)
src/i18n/       textos en español (fuente de verdad) e inglés
src/theme/      tema claro u oscuro según el sistema, con tokens de @lukas/ui
```

## Seguridad

- El token de sesión se guarda en Keystore/Keychain (`WHEN_UNLOCKED_THIS_DEVICE_ONLY`), nunca en
  AsyncStorage, y `allowBackup` está desactivado en Android.
- Al abrir la app se valida el token con `GET /v1/me`; si la API lo rechaza, se borra.

## Versiones

La versión visible sale de `package.json` (la sube Changesets); el número de build lo lleva EAS.
Ver [docs/releases.md](../../docs/releases.md).

## Pendiente

- Passkeys en el móvil (requiere módulo nativo) y Turnstile en la app.
- Versión web: espera la decisión sobre `react-native-web` (política de confianza de pnpm).
