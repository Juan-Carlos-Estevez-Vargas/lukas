# Lukas

App móvil y web de finanzas personales para Colombia: presupuestos, gastos, ingresos, deudas e inversiones, con captura automática de movimientos y un asistente de IA.

> Lukas: sabe dónde están tus lucas.

## Estado

En construcción. Fase 0 (cimientos). El trabajo se organiza en [`docs/backlog.md`](docs/backlog.md): cada tarea `FIN-xxx` es un PR y cada subtarea un commit.

## Principios

- **Local-first:** los datos viven cifrados en el dispositivo y la app funciona sin internet.
- **Nunca** se piden ni se guardan números de tarjeta, CVV ni claves bancarias.
- **100 % gratuito al inicio:** Cloudflare Workers, Neon Postgres, Expo y GitHub Actions en sus planes gratuitos; todo servicio pago queda detrás de una interfaz para migrar por configuración.

## Stack

TypeScript · pnpm + Turborepo · React Native + Expo · Hono en Cloudflare Workers · Neon Postgres + Drizzle · Better Auth.
