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
4. Un release de `@lukas/mobile` dispara el workflow **EAS**, que compila el APK firmado y lo adjunta al GitHub Release. La API y la web pasan a producción a mano (ver Entornos).

## PRs de bots (auto-merge)

El workflow **Auto-merge** (`.github/workflows/auto-merge.yml`, FIN-409) fusiona solo, con merge normal:

- **Dependabot:** cada vez que termina un workflow de su PR revisa todo el CI de ese commit. Si todo
  pasó, lo fusiona y borra la rama. Si algo falla, el PR queda abierto con un aviso.
- **Versiones (changesets):** una vez al día, a las 03:00 hora Colombia, fusiona el PR
  `chore(release): versionar paquetes` si está abierto. Así un día de PRs da un solo release y un
  solo build de EAS, en vez de uno por PR. También se puede correr a mano (Actions → Auto-merge →
  Run workflow).

Los merges con el `GITHUB_TOKEN` no disparan los workflows de `push`, así que Auto-merge dispara a
mano **Deploy** (staging) y **Release** después de cada merge. Producción sigue siendo manual.

## Previews por PR

El workflow `preview.yml` crea, para cada PR del propio repo:

- una rama de Neon `preview/pr-<N>` con las migraciones aplicadas (compute de 0.25 CU que se
  suspende a los 5 minutos);
- un Worker `lukas-api-pr-<N>` en workers.dev con esa base, un `BETTER_AUTH_SECRET` propio y
  `ENVIRONMENT=preview`;
- la web (Expo para web) en Cloudflare Pages, rama `pr-<N>` del proyecto `lukas-web`, compilada
  contra la API de la preview y con su origen agregado a `CORS_ORIGINS`;
- un comentario en el PR con los enlaces, que se actualiza en cada push.

Al cerrar o fusionar el PR se borran el Worker, los despliegues web de esa rama y la rama de Neon. Necesita los secretos
`CLOUDFLARE_API_TOKEN`, `CLOUDFLARE_ACCOUNT_ID` y `NEON_API_KEY`; sin ellos el workflow se salta
sin fallar. El QR de EAS Update se suma en un PR aparte.

## Entornos

| Entorno    | Cuándo se despliega                                    | Web                            | API                 | Base de datos         |
| ---------- | ------------------------------------------------------ | ------------------------------ | ------------------- | --------------------- |
| Preview    | Cada PR (`preview.yml`)                                | `pr-<N>.<proyecto>.pages.dev`  | `lukas-api-pr-<N>`  | Rama `preview/pr-<N>` |
| Staging    | Cada push a `main` (`deploy.yml`)                      | `staging.<proyecto>.pages.dev` | `lukas-api-staging` | Rama `staging`        |
| Producción | Manual: Actions → Deploy → Run workflow → `production` | `<proyecto>.pages.dev`         | `lukas-api`         | Rama `main` de Neon   |

Producción solo se despliega con aprobación explícita del dueño. El plan gratuito de GitHub no
permite revisores obligatorios en repos privados, así que la aprobación es el disparo manual.
`BETTER_AUTH_SECRET` se genera una sola vez por entorno y se conserva entre despliegues.
Las cuotas de cada servicio están en [cuotas-gratuitas.md](cuotas-gratuitas.md).

## App móvil

- `version` de `apps/mobile/package.json` es la versión visible (`versionName` en Android, `CFBundleShortVersionString` en iOS).
- El número de build (`versionCode` / `buildNumber`) lo incrementa EAS de forma remota en cada build de producción.
- El APK se compila en EAS Build (perfil `production` de `apps/mobile/eas.json`, apuntando a la API de producción).
  El keystore lo genera y guarda EAS en la cuenta de Expo; nunca está en el repo. Para un APK suelto:
  **Actions → EAS → Run workflow** (queda como artefacto del run por 14 días). El plan gratuito de EAS
  da 15 builds de Android al mes.
- `eas-cli` no va en el lockfile: los workflows lo ejecutan con `pnpm dlx eas-cli@<versión fija>`, porque
  arrastra dependencias viejas con avisos de seguridad y solo se usa en CI.
- `runtimeVersion` usa la política `fingerprint`: una actualización OTA solo llega a binarios con el mismo código nativo.
- La API publica la versión mínima soportada; la app pide actualizar si está por debajo.

## Requisito del repositorio

En **Settings → Actions → General → Workflow permissions**, activar _Allow GitHub Actions to create and approve pull requests_ para que el workflow pueda abrir el PR de versiones.
