# Lukas: guía para agentes

## Flujo de trabajo
- El backlog vive en `docs/backlog.md`. Cada tarea `FIN-xxx` tiene un issue en GitHub, una rama y un PR que la cierra (`Closes #N`).
- Ramas: `<tipo>/FIN-xxx-descripcion-corta` (p. ej. `feat/FIN-006-esquema-db`).
- Cada subtarea de la tarea es un commit con Conventional Commits en español: `<tipo>(<alcance>): <descripción> [FIN-xxx]`.
- Un PR se fusiona (squash no; merge normal para conservar los commits) cuando el CI está en verde. Publicar en producción o cualquier cosa con costo requiere aprobación explícita del dueño.

## Autoría
- Los commits van a nombre del dueño del repo: `Juan Carlos Estevez Vargas <85718854+Juan-Carlos-Estevez-Vargas@users.noreply.github.com>`.
- No agregar trailers de coautoría de Claude salvo en commits de cambios muy complejos.

## Reglas técnicas
- TypeScript estricto en todo (`packages/config/tsconfig.base.json`). Nada de `any`.
- Dinero siempre en enteros (`bigint` de unidades menores) con código ISO 4217. Nunca `number` de punto flotante para montos.
- Nunca pedir, registrar ni guardar números de tarjeta, CVV ni credenciales bancarias.
- Solo servicios con plan gratuito; todo proveedor externo va detrás de un puerto (interfaz) en el módulo que lo usa.
- Fijar versiones exactas de dependencias, con al menos dos semanas de publicadas.

## Comandos
- `pnpm install`
- `pnpm lint` · `pnpm typecheck` · `pnpm test` · `pnpm format`
