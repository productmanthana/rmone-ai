#!/usr/bin/env bash
# Promote an already-uploaded, immutable EB source bundle.  Never builds here.
set -euo pipefail

environment="${1:?usage: deploy-eb-version.sh <dev|qa|pilot|prod> <version>}"
version="${2:?usage: deploy-eb-version.sh <dev|qa|pilot|prod> <version>}"
case "$environment" in
  dev) rds_instance="rmoneqa"; expected_eb_environment="rmone-dev" ;;
  qa) rds_instance="rmoneqa"; expected_eb_environment="rmone-qa" ;;
  pilot) rds_instance="rmone-pilot"; expected_eb_environment="rmone-pilot2" ;;
  prod) rds_instance="rmone-prod"; expected_eb_environment="rmone-production" ;;
  *) echo "Unknown environment: $environment" >&2; exit 64 ;;
esac
[[ "$version" =~ ^[0-9a-f]{40}$ ]] || { echo "Version must be a full Git commit SHA" >&2; exit 64; }
: "${AWS_REGION:?AWS_REGION is required}"
: "${EB_APPLICATION_NAME:?EB_APPLICATION_NAME is required}"
: "${EB_DEPLOY_BUCKET:?EB_DEPLOY_BUCKET is required}"
: "${EB_ENVIRONMENT_NAME:?EB_ENVIRONMENT_NAME is required}"
: "${IMPORT_DRAIN_URL:?IMPORT_DRAIN_URL is required}"
: "${HEALTHCHECK_URL:?HEALTHCHECK_URL is required}"
[[ "$EB_ENVIRONMENT_NAME" == "$expected_eb_environment" ]] || {
  echo "Environment mapping mismatch: ${environment} must deploy to EB ${expected_eb_environment} (RDS ${rds_instance}), got ${EB_ENVIRONMENT_NAME}." >&2
  exit 65
}

environment_status=""
environment_health=""
environment_health_status=""
environment_version=""

wait_for_environment_ready() {
  local phase="${1:?wait phase is required}"
  local attempts="${EB_ENVIRONMENT_MAX_ATTEMPTS:-120}"
  local poll_seconds="${EB_ENVIRONMENT_POLL_SECONDS:-15}"
  local state=""

  for ((attempt=1; attempt<=attempts; attempt++)); do
    state="$(aws elasticbeanstalk describe-environments \
      --region "$AWS_REGION" \
      --application-name "$EB_APPLICATION_NAME" \
      --environment-names "$EB_ENVIRONMENT_NAME" \
      --query 'join(`\t`, [Environments[0].Status, Environments[0].Health, Environments[0].HealthStatus, Environments[0].VersionLabel])' \
      --output text)"
    IFS=$'\t' read -r environment_status environment_health environment_health_status environment_version <<<"$state"

    if [[ -z "$environment_status" || "$environment_status" == "None" ]]; then
      echo "Elastic Beanstalk environment ${EB_ENVIRONMENT_NAME} was not found while ${phase}." >&2
      exit 67
    fi

    echo "EB ${EB_ENVIRONMENT_NAME} while ${phase}: status=${environment_status}, health=${environment_health}/${environment_health_status}, version=${environment_version} (attempt ${attempt}/${attempts})"
    case "$environment_status" in
      Ready)
        return 0
        ;;
      Aborting|Terminating|Terminated)
        echo "Elastic Beanstalk environment ${EB_ENVIRONMENT_NAME} entered terminal status ${environment_status} while ${phase} (health=${environment_health}/${environment_health_status}, version=${environment_version})." >&2
        exit 67
        ;;
      Launching|Updating|LinkingFrom|LinkingTo)
        sleep "$poll_seconds"
        ;;
      *)
        echo "Unexpected Elastic Beanstalk environment status ${environment_status} while ${phase} (health=${environment_health}/${environment_health_status}, version=${environment_version})." >&2
        exit 67
        ;;
    esac
  done

  echo "Timed out waiting for Elastic Beanstalk environment ${EB_ENVIRONMENT_NAME} to become Ready while ${phase} (last status=${environment_status}, health=${environment_health}/${environment_health_status}, version=${environment_version}). Rerun this release with the same immutable version ${version} to resume without rebuilding the bundle." >&2
  exit 68
}

key="eb/${version}.zip"
aws s3api head-object --region "$AWS_REGION" \
  --bucket "$EB_DEPLOY_BUCKET" --key "$key" >/dev/null

# An existing application version is acceptable only when it names exactly this
# source bundle; this prevents a mutable/reused version label.
existing="$(aws elasticbeanstalk describe-application-versions \
  --region "$AWS_REGION" \
  --application-name "$EB_APPLICATION_NAME" --version-labels "$version" \
  --query 'ApplicationVersions[0].SourceBundle.S3Bucket' --output text)"
if [[ "$existing" == "None" || -z "$existing" ]]; then
  aws elasticbeanstalk create-application-version --application-name "$EB_APPLICATION_NAME" \
    --region "$AWS_REGION" \
    --version-label "$version" --source-bundle S3Bucket="$EB_DEPLOY_BUCKET",S3Key="$key" \
    --process >/dev/null
else
  existing_key="$(aws elasticbeanstalk describe-application-versions \
    --region "$AWS_REGION" \
    --application-name "$EB_APPLICATION_NAME" --version-labels "$version" \
    --query 'ApplicationVersions[0].SourceBundle.S3Key' --output text)"
  [[ "$existing" == "$EB_DEPLOY_BUCKET" && "$existing_key" == "$key" ]] || {
    echo "Refusing version label with a different source bundle" >&2; exit 65; }
fi

# `--process` is asynchronous. Do not promote an application version until EB
# has finished validating/caching it, and never treat a terminal FAILED version
# as deployable.
version_status=""
for ((attempt=1; attempt<=60; attempt++)); do
  version_status="$(aws elasticbeanstalk describe-application-versions \
    --region "$AWS_REGION" \
    --application-name "$EB_APPLICATION_NAME" --version-labels "$version" \
    --query 'ApplicationVersions[0].Status' --output text)"
  case "$version_status" in
    PROCESSED) break ;;
    FAILED)
      echo "Application version processing failed" >&2
      exit 66
      ;;
    PROCESSING|BUILDING|UNPROCESSED|None|"")
      sleep "${EB_VERSION_POLL_SECONDS:-5}"
      ;;
    *)
      echo "Unexpected application version status: $version_status" >&2
      exit 66
      ;;
  esac
done
[[ "$version_status" == "PROCESSED" ]] || {
  echo "Timed out waiting for application version processing" >&2
  exit 66
}

wait_for_environment_ready "waiting for prior environment updates"

if [[ "$environment_version" == "$version" ]]; then
  echo "Requested immutable version ${version} is already active; resuming at health verification"
else
  if [[ "${ALLOW_BOOTSTRAP_DRAIN:-false}" == "true" && "$environment_version" == "rmone-bootstrap" ]]; then
    echo "Initial bootstrap environment has no application imports to drain"
  elif [[ "${ALLOW_UNHEALTHY_RECOVERY:-false}" == "true" ]]; then
    if [[ "$environment_health_status" =~ ^(Degraded|Severe)$ ]] &&
       ! curl --fail --silent --show-error --max-time 15 "$IMPORT_DRAIN_URL" >/dev/null 2>&1; then
      echo "Unhealthy dev recovery: drain endpoint unavailable, so no application imports can be running"
    else
      "$(dirname "$0")/wait-for-import-drain.sh" "$IMPORT_DRAIN_URL"
    fi
  else
    "$(dirname "$0")/wait-for-import-drain.sh" "$IMPORT_DRAIN_URL"
  fi
  aws elasticbeanstalk update-environment --environment-name "$EB_ENVIRONMENT_NAME" \
    --region "$AWS_REGION" \
    --version-label "$version" >/dev/null
  wait_for_environment_ready "deploying version ${version}"
fi
[[ "$environment_version" == "$version" ]] || {
  echo "Environment update finished without activating the requested version" >&2
  exit 67
}
"$(dirname "$0")/check-health.sh" "$HEALTHCHECK_URL"
echo "Promoted immutable version $version to $environment (EB ${EB_ENVIRONMENT_NAME} → RDS ${rds_instance})"