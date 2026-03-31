#!/usr/bin/env bash

set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

K6_IMAGE="${K6_IMAGE:-grafana/k6:0.49.0}"
BASE_URL="${BASE_URL:-https://www.corgi4ever.com}"
LOGIN_EMAIL="${LOGIN_EMAIL:-admin@gmail.com}"
LOGIN_PASSWORD="${LOGIN_PASSWORD:-password}"

OUTPUT_DIR="${OUTPUT_DIR:-$ROOT_DIR/dist/perf}"
TIMESTAMP="$(date +%Y%m%d-%H%M%S)"
SUMMARY_FILE="$OUTPUT_DIR/capacity-ramp-$TIMESTAMP.json"

mkdir -p "$OUTPUT_DIR"

echo "==> Running capacity ramp test"
echo "    Base URL: $BASE_URL"
echo "    Summary: $SUMMARY_FILE"

docker run --rm -i \
  -v "$ROOT_DIR:/work" \
  -w /work \
  -e BASE_URL="$BASE_URL" \
  -e LOGIN_EMAIL="$LOGIN_EMAIL" \
  -e LOGIN_PASSWORD="$LOGIN_PASSWORD" \
  -e STAGE1_RATE="${STAGE1_RATE:-10}" \
  -e STAGE2_RATE="${STAGE2_RATE:-25}" \
  -e STAGE3_RATE="${STAGE3_RATE:-50}" \
  -e STAGE4_RATE="${STAGE4_RATE:-75}" \
  -e STAGE5_RATE="${STAGE5_RATE:-100}" \
  -e STAGE1_DURATION="${STAGE1_DURATION:-30s}" \
  -e STAGE2_DURATION="${STAGE2_DURATION:-1m}" \
  -e STAGE3_DURATION="${STAGE3_DURATION:-1m}" \
  -e STAGE4_DURATION="${STAGE4_DURATION:-1m}" \
  -e STAGE5_DURATION="${STAGE5_DURATION:-1m}" \
  -e COOLDOWN_DURATION="${COOLDOWN_DURATION:-30s}" \
  -e PRE_ALLOCATED_VUS="${PRE_ALLOCATED_VUS:-50}" \
  -e MAX_VUS="${MAX_VUS:-500}" \
  "$K6_IMAGE" run \
  --summary-export "/work/dist/perf/$(basename "$SUMMARY_FILE")" \
  /work/scripts/perf/capacity_ramp.js

echo "==> Done. Summary written to $SUMMARY_FILE"
