# 0001. Arquitectura local-first y monolito modular hexagonal

- Estado: Aceptado
- Fecha: 2026-10-28

## Contexto

Lukas es una app de finanzas personales para Android, iOS y web. Debe sentirse inmediata, funcionar sin conexión, proteger datos financieros sensibles y poder construirse y mantenerse con un equipo muy pequeño.

## Decisión

- **Local-first.** Cada cliente guarda sus datos en SQLite cifrado (SQLCipher) y lee siempre de ahí. Un protocolo de sincronización propio replica cambios con el servidor. Postgres es la fuente de verdad.
- **Un solo código de cliente** con React Native + Expo (Android, iOS y web).
- **Monolito modular** en Cloudflare Workers con Hono, dividido en módulos por dominio (Identity, Ledger, Budgeting, Sync, Ingestion, Insights, Billing, Investments, Households).
- **Arquitectura hexagonal** en cada módulo: `domain` (reglas puras), `application` (casos de uso), `ports` (interfaces) y `adapters` (Postgres, HTTP, proveedores). Los módulos solo se comunican por su API pública o por eventos de dominio.
- **Libro mayor de doble partida** con transacciones ACID en Postgres; montos en enteros (`bigint` de unidades menores) con código ISO 4217.
- **TypeScript estricto** en todo el monorepo (pnpm + Turborepo).

## Consecuencias

- La UI nunca espera a la red y la app funciona offline.
- La sincronización y la resolución de conflictos son responsabilidad nuestra (ver tareas FIN-202 y FIN-203).
- Partir un módulo en un servicio aparte es posible más adelante sin reescribir el dominio.
- Hono corre igual en Workers, Node o Bun, lo que evita quedar atados a Cloudflare.
