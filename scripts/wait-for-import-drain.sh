#!/usr/bin/env bash
set -euo pipefail
url="${1:?usage: wait-for-import-drain.sh <import-drain-status-url>}"
attempts="${IMPORT_DRAIN_MAX_ATTEMPTS:-60}"
sleep_seconds="${IMPORT_DRAIN_POLL_SECONDS:-10}"
for ((attempt=1; attempt<=attempts; attempt++)); do
  body="$(curl --fail --silent --show-error --max-time 15 "$url")" || {
    echo "Import drain endpoint unavailable (attempt $attempt/$attempts)" >&2; sleep "$sleep_seconds"; continue; }
  if BODY="$body" node -e '
    const value = JSON.parse(process.env.BODY);
    if (value?.drainSafe !== true || !Number.isInteger(value?.running) || value.running !== 0) process.exit(1);
  '; then
    echo "Imports drained"; exit 0
  fi
  echo "Imports still active (attempt $attempt/$attempts)"
  sleep "$sleep_seconds"
done
echo "Timed out waiting for imports to drain; deployment not started" >&2
exit 1