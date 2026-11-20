#!/usr/bin/env bash
# Análisis estático del APK con MobSF (FIN-405). Levanta MobSF en Docker, sube el APK, espera el
# análisis y falla si el scorecard trae hallazgos de severidad alta. Deja el reporte JSON en $2.
# Uso: scripts/security/mobsf-scan.sh <apk> <carpeta-de-reportes> [mapping.txt de R8]
set -euo pipefail

APK="$1"
OUT="$2"
MAPPING="${3:-}"
IMAGE="opensecurity/mobile-security-framework-mobsf:v4.6.4@sha256:cf1465a3cc0c95488b9a6cdb1c7799d4b576d391ee28232c221f6a196bf2f74c"
URL="http://127.0.0.1:8000"
mkdir -p "$OUT"

# Llave efímera: solo vive en este runner mientras corre el contenedor.
KEY="$(head -c 32 /dev/urandom | sha256sum | cut -d' ' -f1)"
docker run -d --rm --name mobsf -p 127.0.0.1:8000:8000 -e MOBSF_API_KEY="$KEY" "$IMAGE" >/dev/null
trap 'docker stop mobsf >/dev/null 2>&1 || true' EXIT

for _ in $(seq 1 60); do
  if curl -fsS -o /dev/null "$URL/api/v1/scans" -H "Authorization: $KEY"; then break; fi
  sleep 5
done

hash="$(curl -fsS -H "Authorization: $KEY" -F "file=@$APK" "$URL/api/v1/upload" | jq -r .hash)"
curl -fsS -H "Authorization: $KEY" --data-urlencode "hash=$hash" "$URL/api/v1/scan" -o "$OUT/mobsf-report.json"
curl -fsS -H "Authorization: $KEY" --data-urlencode "hash=$hash" "$URL/api/v1/scorecard" -o "$OUT/mobsf-scorecard.json"

ACCEPTED="$(dirname "$0")/mobsf-accepted.tsv"
accepted_json="$(grep -v '^#' "$ACCEPTED" | cut -f1 | jq -R . | jq -s .)"
score="$(jq -r '.security_score // "?"' "$OUT/mobsf-scorecard.json")"
# Altos que no están en la lista de aceptados (por el comienzo del título).
jq --argjson ok "$accepted_json" \
  '[.high // [] | .[] | select(.title as $t | ($ok | any(. as $p | $t | startswith($p))) | not)]' \
  "$OUT/mobsf-scorecard.json" > "$OUT/mobsf-high.json"
high="$(jq 'length' "$OUT/mobsf-high.json")"
warning="$(jq '.warning // [] | length' "$OUT/mobsf-scorecard.json")"
{
  echo "### MobSF"
  echo "- Puntaje de seguridad: $score/100"
  echo "- Altos sin aceptar: $high · Advertencias: $warning"
  jq -r '.[] | "  - 🔴 \(.title)"' "$OUT/mobsf-high.json"
  jq -r --argjson ok "$accepted_json" '.high // [] | .[] | select(.title as $t | ($ok | any(. as $p | $t | startswith($p)))) | "  - ⚪ \(.title) (aceptado, ver mobsf-accepted.tsv)"' "$OUT/mobsf-scorecard.json"
  # Dónde está cada hallazgo alto del código, para revisarlo.
  jq -r '.code_analysis.findings // {} | to_entries[] | select(.value.metadata.severity == "high") | .key as $k | (.value.files // {}) | keys | .[0:8][] | "\($k)\t\(.)"' "$OUT/mobsf-report.json" |
    while IFS=$'\t' read -r rule file; do
      # R8 ofusca los nombres: el mapping dice a qué clase original corresponde cada archivo.
      original=""
      if [ -n "$MAPPING" ] && [ -f "$MAPPING" ]; then
        obf="${file%.java}"; obf="${obf#defpackage/}"; obf="${obf//\//.}"
        original="$(grep -m1 -E "^[^ ].* -> ${obf//./\\.}:$" "$MAPPING" | cut -d' ' -f1 || true)"
      fi
      echo "  - 📄 $rule: $file${original:+ ($original)}"
    done
  jq -r '.warning // [] | .[] | "  - 🟡 \(.title)"' "$OUT/mobsf-scorecard.json"
} | tee -a "${GITHUB_STEP_SUMMARY:-/dev/stdout}"

if [ "$high" -gt 0 ]; then
  echo "::error::MobSF encontró $high hallazgos altos sin aceptar en el APK"
  exit 1
fi
