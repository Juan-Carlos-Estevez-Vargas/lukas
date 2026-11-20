#!/usr/bin/env bash
# ZAP baseline (FIN-405): escaneo pasivo, sin ataques, de cada URL. Falla si alguna alerta es de
# riesgo alto (riskcode 3). Deja los reportes JSON y HTML en $1.
# Uso: scripts/security/zap-baseline.sh <carpeta-de-reportes> <url> [<url>...]
set -euo pipefail

OUT="$1"
shift
IMAGE="zaproxy/zap-stable:2.17.0@sha256:9624669db72f54d86c4b46a7064518bd9bf79d8c61a4c31befa9923489f328af"
mkdir -p "$OUT"
chmod 777 "$OUT"

high_total=0
summary="### ZAP baseline"$'\n'
i=0
for url in "$@"; do
  i=$((i + 1))
  # -I: las advertencias no cambian el código de salida; el umbral lo decide el JSON de abajo.
  docker run --rm -v "$OUT:/zap/wrk:rw" "$IMAGE" \
    zap-baseline.py -t "$url" -J "zap-$i.json" -r "zap-$i.html" -I -m 2 || true
  report="$OUT/zap-$i.json"
  if [ ! -s "$report" ]; then
    echo "::error::ZAP no generó reporte para $url"
    exit 1
  fi
  high="$(jq '[.site[].alerts[] | select(.riskcode == "3")] | length' "$report")"
  medium="$(jq '[.site[].alerts[] | select(.riskcode == "2")] | length' "$report")"
  low="$(jq '[.site[].alerts[] | select(.riskcode == "1")] | length' "$report")"
  high_total=$((high_total + high))
  summary+="- $url: altos $high · medios $medium · bajos $low"$'\n'
  summary+="$(jq -r '.site[].alerts[] | select(.riskcode == "3" or .riskcode == "2") | "  - \(if .riskcode == "3" then "🔴" else "🟡" end) \(.name)"' "$report")"$'\n'
done

echo "$summary" | tee -a "${GITHUB_STEP_SUMMARY:-/dev/stdout}"
if [ "$high_total" -gt 0 ]; then
  echo "::error::ZAP encontró $high_total alertas de riesgo alto"
  exit 1
fi
