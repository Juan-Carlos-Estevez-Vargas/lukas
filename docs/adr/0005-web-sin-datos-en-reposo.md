# 0005. La web no guarda finanzas en el navegador

- Estado: Aceptado
- Fecha: 2026-11-19

## Contexto

La app web (FIN-204) reutiliza las pantallas de Expo y la lógica local-first, que trabaja sobre
SQLite. En el teléfono la base va cifrada con SQLCipher y la clave vive en Keystore/Keychain. El
navegador no tiene un lugar equivalente para la clave: lo que se guarde en IndexedDB u OPFS queda
legible para cualquier script del origen, extensiones o quien use el equipo.

## Decisión

- En la web la base es SQLite en memoria (`expo-sqlite` sobre wa-sqlite, `:memory:`), con las
  mismas migraciones que el teléfono. Nada se escribe en disco.
- Al entrar se llena con el sync (pull). Mientras no termine el primer sync no se decide si falta
  el onboarding, para no crear cuentas duplicadas; si falla, se muestra "Sin conexión" con
  reintento.
- Los cambios se suben en segundos (se revisa la cola cada 3 s) y, si al cerrar queda algo sin
  subir, el navegador pide confirmación.
- SQLite en la web necesita `SharedArrayBuffer`: el origen se aísla con COOP `same-origin` y COEP
  `require-corp` (Safari no admite `credentialless`). La CSP solo suma `'wasm-unsafe-eval'` y
  `worker-src 'self' blob:`.

## Consecuencias

- Cerrar la pestaña no deja datos financieros en el equipo; el token ya vivía en `sessionStorage`.
- La web necesita red para abrir. Sin conexión no hay datos (a diferencia del teléfono).
- Lo que aún no sincroniza (presupuestos, metas, recurrentes, etiquetas, recibos) vive solo durante
  la visita en la web, hasta que se sumen al protocolo.
- Si más adelante se quiere modo sin conexión en la web, hará falta un ADR nuevo con una clave
  derivada (p. ej. WebAuthn PRF) en lugar de guardar la base en claro.
