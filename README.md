# Lukas

App móvil y web de finanzas personales para Colombia: presupuestos, gastos, ingresos, deudas e inversiones, con captura automática de movimientos y un asistente de IA.

> Lukas: sabe dónde están tus lucas.

## Estado

En construcción, Fase 0 (cimientos). El trabajo se organiza en [`docs/backlog.md`](docs/backlog.md): cada tarea `FIN-xxx` es un PR y cada subtarea un commit.

## Principios

- **Local-first:** los datos viven cifrados en el dispositivo y la app funciona sin internet.
- **Nunca** se piden ni se guardan números de tarjeta, CVV ni claves bancarias.
- **100 % gratuito al inicio:** Cloudflare Workers, Neon Postgres, Expo y GitHub Actions en sus planes gratuitos. Todo servicio pago queda detrás de una interfaz para migrar por configuración.

## Requisitos

- Node.js 22 (ver `.nvmrc`)
- pnpm 10 (`corepack enable` lo activa con la versión de `packageManager`)

## Comandos

```sh
pnpm install     # instala dependencias
pnpm lint        # Biome + lint de cada paquete
pnpm typecheck   # verificación de tipos
pnpm test        # pruebas
pnpm format      # formatea y ordena imports
```

## Estructura

```
apps/        aplicaciones (mobile, api)
packages/    código compartido (config, domain, db, ui…)
docs/        backlog, ADRs y documentación
```

## Stack

TypeScript · pnpm + Turborepo · React Native + Expo · Hono en Cloudflare Workers · Neon Postgres + Drizzle · Better Auth.
