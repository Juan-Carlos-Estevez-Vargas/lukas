# 0002. Operar solo con planes gratuitos al inicio

- Estado: Aceptado
- Fecha: 2026-10-28

## Contexto

El proyecto arranca sin presupuesto. Se quiere probar la app con usuarios reales antes de pagar dominio, cuentas de desarrollador en tiendas o servicios.

## Decisión

- Usar solo planes gratuitos: GitHub Actions, Cloudflare (Workers, Pages, R2, Workers AI), Neon Postgres y Expo (EAS).
- Publicar en direcciones gratuitas (`*.workers.dev`, `*.pages.dev`), distribuir Android como APK firmado y ofrecer la web instalable (PWA) para iPhone.
- Probar pagos en sandbox (Wompi y modo de prueba de RevenueCat).
- Aplazar a la Fase 5 todo lo que requiere pago: dominio, Google Play, App Store, correo transaccional, captura por correo y cobros reales.
- Todo proveedor externo queda detrás de un puerto y se elige por variables de entorno. Ninguna URL queda fija en el código.

## Consecuencias

- Mientras tanto no hay verificación de correo (se usan passkeys, TOTP y códigos de recuperación), ni app nativa iOS, ni captura de alertas por correo.
- Hay que vigilar las cuotas gratuitas (FIN-012 deja un documento y alertas de consumo).
- Migrar a servicios pagos es cambiar configuración y agregar adaptadores, no reescribir.
