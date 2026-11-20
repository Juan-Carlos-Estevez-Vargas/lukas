# Documentos legales

Los textos que ve la persona viven en [`apps/mobile/src/legal/documents.ts`](../../apps/mobile/src/legal/documents.ts). Ahí están la política de tratamiento de datos (Ley 1581 de 2012 y Decreto 1074 de 2015) y los términos y condiciones. La app los muestra en `/legal/privacy` y `/legal/terms`, y se pueden leer sin sesión.

## Autorización

- Al registrarse, la persona marca "Autorizo el tratamiento de mis datos y acepto los términos". Sin eso no se envía el código de acceso.
- Con la sesión abierta, la app registra en la API (`POST /v1/legal/consents`) qué versión de cada documento aceptó. Queda en `app.legal_consents` con la fecha, y esa es la prueba de la autorización (Decreto 1377, art. 8).
- Las filas solo se agregan: nadie las puede cambiar ni borrar desde la app, solo se borran con la cuenta.

## Cambiar un documento

1. Edita el texto en `documents.ts`.
2. Sube la versión en `LEGAL_VERSIONS` (`packages/domain/src/legal.ts`) a la fecha en que empieza a regir.
3. Al abrir la app, quien aceptó una versión anterior ve los documentos nuevos y tiene que aceptarlos para seguir.

## Pendiente antes de la beta

- Los datos del Responsable (nombre, identificación y correo de contacto) están "por definir" en `CONTROLLER`.
- Un abogado debe revisar los textos. Son una base escrita en lenguaje claro, no asesoría legal.
- Borrar la cuenta se hace por correo; falta hacerlo desde la app.
