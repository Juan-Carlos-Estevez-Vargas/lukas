#!/usr/bin/env bash
# Fusiona solos los PRs de bots (FIN-409). Corre en el workflow Auto-merge con el GITHUB_TOKEN y
# nunca ejecuta código del PR: solo consulta la API de GitHub.
#
#   auto-merge.sh deps <sha>   PR de Dependabot con ese commit: se fusiona si todo su CI pasó.
#   auto-merge.sh release      PR de versiones de changesets: se fusiona tal cual.
#
# Los merges hechos con el GITHUB_TOKEN no disparan workflows de `push`, así que después se
# disparan a mano (workflow_dispatch sí funciona con ese token): staging y releases.
set -euo pipefail

REPO="${GITHUB_REPOSITORY:?}"
api() { gh api "$@"; }

after_merge() {
  gh workflow run deploy.yml --repo "$REPO" -f environment=staging
  gh workflow run release.yml --repo "$REPO"
}

merge() {
  local number="$1" sha="$2" title="$3"
  # `sha` evita fusionar si alguien empujó otro commit mientras tanto.
  api -X PUT "repos/$REPO/pulls/$number/merge" -f merge_method=merge -f sha="$sha" >/dev/null
  echo "Fusionado #$number: $title" | tee -a "${GITHUB_STEP_SUMMARY:-/dev/null}"
  local branch
  branch="$(api "repos/$REPO/pulls/$number" --jq .head.ref)"
  api -X DELETE "repos/$REPO/git/refs/heads/$branch" >/dev/null 2>&1 || true
}

# Estado del CI de un commit: "ok", "pending" o "failed". Solo cuenta los workflows del repo.
ci_state() {
  api "repos/$REPO/commits/$1/check-suites?per_page=100" --jq '
    [.check_suites[] | select(.app.slug == "github-actions")] as $s
    | if ($s | length) == 0 then "pending"
      elif any($s[]; .status != "completed") then "pending"
      elif all($s[]; .conclusion == "success" or .conclusion == "neutral" or .conclusion == "skipped")
        then "ok"
      else "failed" end'
}

case "${1:-}" in
  deps)
    sha="${2:?falta el sha}"
    api "repos/$REPO/commits/$sha/pulls" \
      --jq '.[] | select(.state == "open" and .user.login == "dependabot[bot]" and .head.sha == "'"$sha"'") | "\(.number)\t\(.title)"' |
      while IFS=$'\t' read -r number title; do
        state="$(ci_state "$sha")"
        echo "#$number ($sha): CI $state"
        case "$state" in
          ok) merge "$number" "$sha" "$title" && after_merge ;;
          failed) echo "::warning::#$number tiene CI en rojo; queda abierto para revisarlo." ;;
          *) echo "Aún hay workflows corriendo; se reintenta cuando terminen." ;;
        esac
      done
    ;;
  release)
    pr="$(api "repos/$REPO/pulls?state=open&head=${REPO%%/*}:changeset-release/main" \
      --jq '.[] | select(.user.login == "github-actions[bot]") | "\(.number)\t\(.head.sha)\t\(.title)"' | head -1)"
    if [ -z "$pr" ]; then echo "No hay PR de versiones abierto."; exit 0; fi
    IFS=$'\t' read -r number sha title <<<"$pr"
    merge "$number" "$sha" "$title"
    # Solo releases: el PR de versiones no cambia código, staging ya tiene lo mismo.
    gh workflow run release.yml --repo "$REPO"
    ;;
  *)
    echo "Uso: $0 deps <sha> | release" >&2
    exit 2
    ;;
esac
