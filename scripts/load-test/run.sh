#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────────────────
# RM ONE staged load-test harness (autocannon via pnpm dlx — no dependencies).
#
# Usage:
#   bash scripts/load-test/run.sh <base-url> [stage] [paths]
#
#   base-url  e.g. http://rmone-pilot-193501891377.us-east-1.elasticbeanstalk.com
#   stage     smoke | s250 | s500 | s1000        (default: smoke)
#   paths     comma-separated request paths       (default: /health)
#
# Authenticated runs: export RMONE_TOKEN=<bearer token> first and add API
# paths, e.g.:
#   RMONE_TOKEN=eyJ... bash scripts/load-test/run.sh https://... smoke "/health,/api/auth/me"
#
# Stages (concurrent connections / duration):
#   smoke  —   25 / 30s   safe from anywhere, sanity check only
#   s250   —  250 / 120s  run from an EC2 box in us-east-1, see README
#   s500   —  500 / 180s  "
#   s1000  — 1000 / 300s  "
#
# GUARDRAILS — read scripts/load-test/README.md before any non-smoke stage:
#   • pilot/qa/dev share ONE non-prod SQL Server (db.m5.large). A big stage
#     pointed at API paths hammers that shared DB. Coordinate a window.
#   • Non-smoke stages require LOADTEST_CONFIRM=yes in the environment.
#   • Results from a laptop/container far from us-east-1 measure YOUR link,
#     not the fleet — run big stages from an EC2 instance in the same region.
# ─────────────────────────────────────────────────────────────────────────────
set -euo pipefail

BASE_URL="${1:?usage: run.sh <base-url> [smoke|s250|s500|s1000] [comma-separated-paths]}"
STAGE="${2:-smoke}"
PATHS="${3:-/health}"
TOKEN="${RMONE_TOKEN:-}"

case "$STAGE" in
  smoke)  CONNS=25;   DURATION=30  ;;
  s250)   CONNS=250;  DURATION=120 ;;
  s500)   CONNS=500;  DURATION=180 ;;
  s1000)  CONNS=1000; DURATION=300 ;;
  *) echo "unknown stage: $STAGE (want smoke|s250|s500|s1000)" >&2; exit 1 ;;
esac

if [ "$STAGE" != "smoke" ] && [ "${LOADTEST_CONFIRM:-}" != "yes" ]; then
  echo "Refusing to run stage '$STAGE' without LOADTEST_CONFIRM=yes." >&2
  echo "This stage can saturate the shared non-prod database — see scripts/load-test/README.md." >&2
  exit 1
fi

STAMP="$(date -u +%Y%m%dT%H%M%SZ)"
OUT_DIR="$(dirname "$0")/results"
mkdir -p "$OUT_DIR"

echo "── RM ONE load test ─ stage=$STAGE conns=$CONNS duration=${DURATION}s"
echo "   target: $BASE_URL   paths: $PATHS   auth: $([ -n "$TOKEN" ] && echo bearer || echo none)"

IFS=',' read -ra PATH_LIST <<< "$PATHS"
for p in "${PATH_LIST[@]}"; do
  SAFE_NAME="$(echo "$p" | tr -c 'A-Za-z0-9' '_')"
  OUT_FILE="$OUT_DIR/${STAMP}-${STAGE}${SAFE_NAME}.txt"
  echo ""
  echo "── $p → $OUT_FILE"
  if [ -n "$TOKEN" ]; then
    pnpm dlx autocannon@8 -c "$CONNS" -d "$DURATION" --renderStatusCodes \
      -H "Authorization: Bearer $TOKEN" "$BASE_URL$p" 2>&1 | tee "$OUT_FILE"
  else
    pnpm dlx autocannon@8 -c "$CONNS" -d "$DURATION" --renderStatusCodes \
      "$BASE_URL$p" 2>&1 | tee "$OUT_FILE"
  fi
done

echo ""
echo "Done. Watch the fleet side in CloudWatch while stages run:"
echo "  • EB environment health + CPU (should trigger scale-out >60% for 3 min)"
echo "  • RDS CPU / connections on the target database"
echo "  • Non-2xx counts above: anything >0.1% at p99 <2s needs investigation"
