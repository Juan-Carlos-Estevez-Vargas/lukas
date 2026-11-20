#!/usr/bin/env bash
# Análisis estático del APK con MobSF (FIN-405). Levanta MobSF en Docker, sube el APK, espera el
# análisis y falla si el scorecard trae hallazgos de severidad alta. Deja el reporte JSON en $2.
# Uso: scripts/security/mobsf-scan.sh <apk> <carpeta-de-reportes>
set -euo pipefail

APK="$1"
OUT="$2"
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

score="$(jq -r '.security_score // "?"' "$OUT/mobsf-scorecard.json")"
high="$(jq '.high // [] | length' "$OUT/mobsf-scorecard.json")"
warning="$(jq '.warning // [] | length' "$OUT/mobsf-scorecard.json")"
{
  echo "### MobSF"
  echo "- Puntaje de seguridad: $score/100"
  echo "- Altos: $high · Advertencias: $warning"
  jq -r '.high // [] | .[] | "  - 🔴 \(.title)"' "$OUT/mobsf-scorecard.json"
  jq -r '.warning // [] | .[] | "  - 🟡 \(.title)"' "$OUT/mobsf-scorecard.json"
} | tee -a "${GITHUB_STEP_SUMMARY:-/dev/stdout}"

if [ "$high" -gt 0 ]; then
  echo "::error::MobSF encontró $high hallazgos altos en el APK"
  exit 1
fi
