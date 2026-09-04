#!/usr/bin/env bash
set -euo pipefail

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
tmp_dir="$(mktemp -d)"
trap 'rm -rf "$tmp_dir"' EXIT

cat >"$tmp_dir/aws" <<'AWS'
#!/usr/bin/env bash
set -euo pipefail

query=""
while (($#)); do
  if [[ "$1" == "--query" ]]; then
    query="${2:?missing query value}"
    break
  fi
  shift
done

retired_database_option="NEW_CLIENT_DB""_URL"
if [[ "$query" == *"OptionName=='${retired_database_option}'"* ]]; then
  printf '%s\n' "${MOCK_RETIRED_ALIAS:-None}"
  exit 0
fi
for retired_anthropic_option in AI_INTEGRATIONS_ANTHROPIC_API_KEY AI_INTEGRATIONS_ANTHROPIC_BASE_URL ANTHROPIC_BASE_URL; do
  if [[ "$query" == *"OptionName=='${retired_anthropic_option}'"* ]]; then
    if [[ "${MOCK_RETIRED_ANTHROPIC_OPTION:-}" == "$retired_anthropic_option" ]]; then
      printf '%s\n' "$retired_anthropic_option"
    else
      printf 'None\n'
    fi
    exit 0
  fi
done

option="${query#*OptionName==\'}"
option="${option%%\'*}"
if [[ "$option" == "${MOCK_MISSING_OPTION:-}" ]]; then
  printf 'None\n'
elif [[ "$option" == "APP_DATABASE_URL" && "$query" == *"Namespace=='aws:elasticbeanstalk:application:environment'"* ]]; then
  host="${MOCK_DATABASE_HOST:-rmoneqa}"
  printf 'mssql://managed:managed@%s.c4f40eea0sit.us-east-1.rds.amazonaws.com:1433/core2\n' "$host"
else
  printf 'arn:aws:secretsmanager:us-east-1:123456789012:secret:rmone/nonprod/%s-test\n' \
    "$(
      case "$option" in
        APP_DATABASE_URL) echo database-url ;;
        OPENAI_API_KEY) echo openai-api-key ;;
        ANTHROPIC_API_KEY) echo anthropic-api-key ;;
        OPENAI_API_KEY_OVERFLOW) echo openai-api-key-overflow ;;
        AI_INTEGRATIONS_OPENAI_API_KEY) echo openai-integrations-api-key ;;
        AI_INTEGRATIONS_OPENAI_BASE_URL) echo openai-integrations-base-url ;;
        AGENTMAIL_API_KEY) echo agentmail-api-key ;;
        APNS_KEY_P8) echo apns-key-p8 ;;
        *) exit 2 ;;
      esac
    )"
fi
AWS
chmod +x "$tmp_dir/aws"

run_check() {
  PATH="$tmp_dir:$PATH" AWS_REGION=us-east-1 \
    "$repo_root/scripts/check-eb-ai-config.sh" dev rmone rmone-dev
}

run_check >/dev/null

if MOCK_MISSING_OPTION=APP_DATABASE_URL run_check >"$tmp_dir/missing.out" 2>&1; then
  echo "Expected a missing APP_DATABASE_URL reference to fail." >&2
  exit 1
fi
grep -Fq "Missing or invalid APP_DATABASE_URL topology" "$tmp_dir/missing.out"

if MOCK_DATABASE_HOST=rmone-pilot run_check >"$tmp_dir/wrong-host.out" 2>&1; then
  echo "Expected the wrong Dev/QA RDS host to fail." >&2
  exit 1
fi
grep -Fq "expected RDS rmoneqa" "$tmp_dir/wrong-host.out"

retired_database_option="NEW_CLIENT_DB""_URL"
if MOCK_RETIRED_ALIAS="$retired_database_option" run_check >"$tmp_dir/retired.out" 2>&1; then
  echo "Expected the retired database option to fail." >&2
  exit 1
fi
grep -Fq "Retired ${retired_database_option} setting" "$tmp_dir/retired.out"

if MOCK_RETIRED_ANTHROPIC_OPTION=AI_INTEGRATIONS_ANTHROPIC_BASE_URL run_check >"$tmp_dir/retired-anthropic.out" 2>&1; then
  echo "Expected a retired managed Anthropic setting to fail." >&2
  exit 1
fi
grep -Fq "Retired AI_INTEGRATIONS_ANTHROPIC_BASE_URL setting" "$tmp_dir/retired-anthropic.out"

echo "EB application secret gate regression checks passed."