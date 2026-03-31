#!/usr/bin/env bash

set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

K6_IMAGE="${K6_IMAGE:-grafana/k6:0.49.0}"
BASE_URL="${BASE_URL:-https://www.corgi4ever.com}"
LOGIN_EMAIL="${LOGIN_EMAIL:-admin@gmail.com}"
LOGIN_PASSWORD="${LOGIN_PASSWORD:-password}"
RATE="${RATE:-20}"
DURATION="${DURATION:-5m}"
PRE_ALLOCATED_VUS="${PRE_ALLOCATED_VUS:-20}"
MAX_VUS="${MAX_VUS:-200}"

OUTPUT_DIR="${OUTPUT_DIR:-$ROOT_DIR/dist/perf}"
TIMESTAMP="$(date +%Y%m%d-%H%M%S)"
SUMMARY_FILE="$OUTPUT_DIR/read-only-mix-$TIMESTAMP.json"

mkdir -p "$OUTPUT_DIR"

echo "==> Running read-only mix performance test"
echo "    Base URL: $BASE_URL"
echo "    Rate: $RATE req/s"
echo "    Duration: $DURATION"
echo "    Summary: $SUMMARY_FILE"

docker run --rm -i \
  -v "$ROOT_DIR:/work" \
  -w /work \
  -e BASE_URL="$BASE_URL" \
  -e LOGIN_EMAIL="$LOGIN_EMAIL" \
  -e LOGIN_PASSWORD="$LOGIN_PASSWORD" \
  -e RATE="$RATE" \
  -e DURATION="$DURATION" \
  -e PRE_ALLOCATED_VUS="$PRE_ALLOCATED_VUS" \
  -e MAX_VUS="$MAX_VUS" \
  "$K6_IMAGE" run \
  --summary-export "/work/dist/perf/$(basename "$SUMMARY_FILE")" \
  /work/scripts/perf/read_only_mix.js

echo "==> Done. Summary written to $SUMMARY_FILE"
