#!/usr/bin/env bash
set -euo pipefail
url="${1:?usage: check-health.sh <health-url>}"
attempts="${HEALTHCHECK_MAX_ATTEMPTS:-30}"
for ((attempt=1; attempt<=attempts; attempt++)); do
  if curl --fail --silent --show-error --max-time 15 "$url" >/dev/null; then
    echo "Health check passed"; exit 0
  fi
  echo "Health check failed (attempt $attempt/$attempts)" >&2
  sleep "${HEALTHCHECK_POLL_SECONDS:-10}"
done
echo "Health check never passed" >&2
exit 1