# Versiones y releases

## Reglas

- **SemVer por app y paquete.** `apps/api` y `apps/mobile` llevan versiones independientes (`api@1.2.0`, `mobile@0.4.1`).
- **Una nota por cambio.** Todo PR que cambia el comportamiento de una app incluye un changeset (`pnpm changeset`). Los PRs de solo documentación o CI no lo necesitan.
- **Tipo de cambio:**
  - `patch`: corrección sin cambios visibles en la API ni en la app.
  - `minor`: funcionalidad nueva compatible.
  - `major`: cambio incompatible (API `/v2`, migración que rompe clientes viejos, protocolo de sync nuevo). Mientras la versión sea `0.x`, los cambios incompatibles suben el `minor`.

## Flujo automático

1. Los PRs se fusionan a `main` con sus changesets.
2. El workflow **Release** abre o actualiza un PR `chore(release): versionar paquetes` que sube versiones y escribe los `CHANGELOG.md`.
3. Al fusionar ese PR se crean los tags `<paquete>@<versión>` y un GitHub Release por cada uno, con su changelog.
4. Desde FIN-012, un tag `api@*` despliega la API a producción y un tag `mobile@*` construye el APK firmado y lo adjunta al release. Los despliegues a producción esperan aprobación manual en el entorno `production`.

## App móvil

- `version` de `apps/mobile/package.json` es la versión visible (`versionName` en Android, `CFBundleShortVersionString` en iOS).
- El número de build (`versionCode` / `buildNumber`) lo incrementa EAS de forma remota en cada build de producción.
- `runtimeVersion` usa la política `fingerprint`: una actualización OTA solo llega a binarios con el mismo código nativo.
- La API publica la versión mínima soportada; la app pide actualizar si está por debajo.

## Requisito del repositorio

En **Settings → Actions → General → Workflow permissions**, activar *Allow GitHub Actions to create and approve pull requests* para que el workflow pueda abrir el PR de versiones.
