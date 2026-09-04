#!/usr/bin/env bash
# Verify that EB has the application's secret references (database, AI
# providers, email, mobile push), without printing the referenced values.
# Provider calls belong to the application and must never run in CI logs.
set -euo pipefail

environment="${1:?usage: check-eb-ai-config.sh <dev|qa|pilot|prod> <application> <eb-environment>}"
application="${2:?usage: check-eb-ai-config.sh <dev|qa|pilot|prod> <application> <eb-environment>}"
eb_environment="${3:?usage: check-eb-ai-config.sh <dev|qa|pilot|prod> <application> <eb-environment>}"

case "$environment" in
  dev) secret_scope="nonprod"; rds_instance="rmoneqa"; expected_eb_environment="rmone-dev" ;;
  qa) secret_scope="nonprod"; rds_instance="rmoneqa"; expected_eb_environment="rmone-qa" ;;
  pilot) secret_scope="nonprod"; rds_instance="rmone-pilot"; expected_eb_environment="rmone-pilot2" ;;
  prod) secret_scope="prod"; rds_instance="rmone-prod"; expected_eb_environment="rmone-production" ;;
  *) echo "Unknown environment: $environment" >&2; exit 64 ;;
esac
: "${AWS_REGION:?AWS_REGION is required}"
if [[ "$eb_environment" != "$expected_eb_environment" ]]; then
  echo "Environment mapping mismatch: ${environment} must use EB ${expected_eb_environment} (RDS ${rds_instance}), got ${eb_environment}." >&2
  exit 65
fi

if [[ "$environment" == "dev" || "$environment" == "qa" ]]; then
  database_url="$(
    aws elasticbeanstalk describe-configuration-settings \
      --region "$AWS_REGION" \
      --application-name "$application" \
      --environment-name "$eb_environment" \
      --query "ConfigurationSettings[0].OptionSettings[?Namespace=='aws:elasticbeanstalk:application:environment' && OptionName=='APP_DATABASE_URL'].Value | [0]" \
      --output text
  )"
  if [[ ! "$database_url" =~ ^mssql://[^:/@]+:[^/@]+@${rds_instance}\.[^/:]+\.rds\.amazonaws\.com:1433/core2$ ]]; then
    echo "Missing or invalid APP_DATABASE_URL topology in ${environment} (expected RDS ${rds_instance}; credentials withheld)." >&2
    exit 1
  fi
else
  database_url_secret="$(
    aws elasticbeanstalk describe-configuration-settings \
      --region "$AWS_REGION" \
      --application-name "$application" \
      --environment-name "$eb_environment" \
      --query "ConfigurationSettings[0].OptionSettings[?Namespace=='aws:elasticbeanstalk:application:environmentsecrets' && OptionName=='APP_DATABASE_URL'].Value | [0]" \
      --output text
  )"
  expected_database_secret=":secret:${application}/${secret_scope}/database-url-"
  if [[ -z "$database_url_secret" || "$database_url_secret" == "None" || "$database_url_secret" != arn:aws:secretsmanager:*"$expected_database_secret"* ]]; then
    echo "Missing or invalid APP_DATABASE_URL Secrets Manager reference in ${environment} (RDS ${rds_instance})." >&2
    exit 1
  fi
fi

while read -r option secret_name; do
  value="$(
    aws elasticbeanstalk describe-configuration-settings \
      --region "$AWS_REGION" \
      --application-name "$application" \
      --environment-name "$eb_environment" \
      --query "ConfigurationSettings[0].OptionSettings[?Namespace=='aws:elasticbeanstalk:application:environmentsecrets' && OptionName=='${option}'].Value | [0]" \
      --output text
  )"

  expected=":secret:${application}/${secret_scope}/${secret_name}-"
  if [[ -z "$value" || "$value" == "None" || "$value" != arn:aws:secretsmanager:*"$expected"* ]]; then
    echo "Missing or invalid ${option} Secrets Manager reference in ${environment} (RDS ${rds_instance})." >&2
    exit 1
  fi
done <<'OPTIONS'
OPENAI_API_KEY openai-api-key
ANTHROPIC_API_KEY anthropic-api-key
OPENAI_API_KEY_OVERFLOW openai-api-key-overflow
AI_INTEGRATIONS_OPENAI_API_KEY openai-integrations-api-key
AI_INTEGRATIONS_OPENAI_BASE_URL openai-integrations-base-url
AGENTMAIL_API_KEY agentmail-api-key
APNS_KEY_P8 apns-key-p8
OPTIONS

for retired_anthropic_option in \
  AI_INTEGRATIONS_ANTHROPIC_API_KEY \
  AI_INTEGRATIONS_ANTHROPIC_BASE_URL \
  ANTHROPIC_BASE_URL
do
  retired_anthropic_setting="$(
    aws elasticbeanstalk describe-configuration-settings \
      --region "$AWS_REGION" \
      --application-name "$application" \
      --environment-name "$eb_environment" \
      --query "ConfigurationSettings[0].OptionSettings[?OptionName=='${retired_anthropic_option}'].OptionName | [0]" \
      --output text
  )"
  if [[ -n "$retired_anthropic_setting" && "$retired_anthropic_setting" != "None" ]]; then
    echo "Retired ${retired_anthropic_option} setting is still configured in ${environment}." >&2
    exit 1
  fi
done

retired_database_option="NEW_CLIENT_DB""_URL"
retired_database_alias="$(
  aws elasticbeanstalk describe-configuration-settings \
    --region "$AWS_REGION" \
    --application-name "$application" \
    --environment-name "$eb_environment" \
    --query "ConfigurationSettings[0].OptionSettings[?OptionName=='${retired_database_option}'].OptionName | [0]" \
    --output text
)"
if [[ -n "$retired_database_alias" && "$retired_database_alias" != "None" ]]; then
  echo "Retired ${retired_database_option} setting is still configured in ${environment} (RDS ${rds_instance})." >&2
  exit 1
fi

echo "Application secret references are configured for ${environment} (EB ${eb_environment} → RDS ${rds_instance}); retired database alias absent; secret values withheld."
