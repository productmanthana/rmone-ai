#!/usr/bin/env bash
# Reconcile the reviewed live-write drift tables into non-production AWS RDS.
set -euo pipefail
umask 077

: "${APP_DATABASE_URL:?APP_DATABASE_URL is required}"
export APP_DATABASE_URL

root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
state_dir="$root/.migration-state/task716-reconcile"
prior_state_dir="$root/.migration-state/task715-live"
reader_file="/tmp/rmone-reconcile-source-url"
target_secret_file="/tmp/rmone-reconcile-target-secret.json"
reader_login="rmone_reconcile_reader"
run_label="${MIGRATION_RUN_LABEL:-full}"
[[ "$run_label" =~ ^[a-zA-Z0-9_-]+$ ]] || {
  echo "MIGRATION_RUN_LABEL contains unsafe characters" >&2
  exit 64
}
mkdir -p "$state_dir"
chmod 700 "$state_dir"

exec 9>/tmp/rmone-aws-reconciliation.lock
flock -n 9 || {
  echo "Another AWS reconciliation is already running" >&2
  exit 75
}

cleanup() {
  cd "$root/artifacts/api-server"
  node --input-type=module <<'NODE' || true
import sql from "mssql";
const source = new URL(process.env.APP_DATABASE_URL);
const login = "rmone_reconcile_reader";
const pool = await new sql.ConnectionPool({
  server: source.hostname,
  port: source.port ? Number(source.port) : 1433,
  database: "master",
  user: decodeURIComponent(source.username),
  password: decodeURIComponent(source.password),
  connectionTimeout: 30_000,
  requestTimeout: 120_000,
  options: { encrypt: true, trustServerCertificate: true },
}).connect();
try {
  await pool.request().batch(`
    USE [core2];
    IF USER_ID(N'${login}') IS NOT NULL DROP USER [${login}];
    USE [master];
    IF SUSER_ID(N'${login}') IS NOT NULL DROP LOGIN [${login}];
  `);
  console.log("Temporary reconciliation reader removed.");
} finally {
  await pool.close();
}
NODE
  rm -f "$reader_file" "$target_secret_file" /tmp/target_aws.json
}
trap cleanup EXIT
trap 'exit 130' INT
trap 'exit 143' TERM

cleanup

cd "$root/artifacts/api-server"
node --input-type=module <<'NODE'
import crypto from "node:crypto";
import fs from "node:fs/promises";
import sql from "mssql";
const source = new URL(process.env.APP_DATABASE_URL);
const login = "rmone_reconcile_reader";
const password = crypto.randomBytes(32).toString("base64url");
const escaped = password.replaceAll("'", "''");
const pool = await new sql.ConnectionPool({
  server: source.hostname,
  port: source.port ? Number(source.port) : 1433,
  database: "master",
  user: decodeURIComponent(source.username),
  password: decodeURIComponent(source.password),
  connectionTimeout: 30_000,
  requestTimeout: 120_000,
  options: { encrypt: true, trustServerCertificate: true },
}).connect();
try {
  await pool.request().batch(`
    CREATE LOGIN [${login}]
      WITH PASSWORD=N'${escaped}', CHECK_POLICY=OFF, CHECK_EXPIRATION=OFF;
    USE [core2];
    CREATE USER [${login}] FOR LOGIN [${login}];
    ALTER ROLE [db_datareader] ADD MEMBER [${login}];
  `);
} finally {
  await pool.close();
}
const url =
  `mssql://${encodeURIComponent(login)}:${encodeURIComponent(password)}` +
  `@${source.hostname}:${source.port || 1433}/master` +
  "?encrypt=true&trustServerCertificate=true";
await fs.writeFile("/tmp/rmone-reconcile-source-url", url, { mode: 0o600 });
console.log("Temporary read-only reconciliation login created.");
NODE

secret_arn="$(
  aws rds describe-db-instances \
    --cli-connect-timeout 10 \
    --cli-read-timeout 30 \
    --region us-east-1 \
    --db-instance-identifier rmone-nonprod-standard \
    --query 'DBInstances[0].MasterUserSecret.SecretArn' \
    --output text
)"
echo "Target secret reference resolved."
target_host="$(
  aws rds describe-db-instances \
    --cli-connect-timeout 10 \
    --cli-read-timeout 30 \
    --region us-east-1 \
    --db-instance-identifier rmone-nonprod-standard \
    --query 'DBInstances[0].Endpoint.Address' \
    --output text
)"
echo "Target host resolved."
aws secretsmanager get-secret-value \
  --cli-connect-timeout 10 \
  --cli-read-timeout 30 \
  --region us-east-1 \
  --secret-id "$secret_arn" \
  --query SecretString \
  --output text >"$target_secret_file"
chmod 600 "$target_secret_file"
echo "Target credential material staged securely."

target_password="$(
  node -e '
    const fs = require("fs");
    process.stdout.write(
      JSON.parse(fs.readFileSync(process.argv[1], "utf8")).password
    );
  ' "$target_secret_file"
)"
echo "Target credential parsed."

schema_file="$prior_state_dir/aws-migrate-schema-core2.json"
test -s "$schema_file" || {
  echo "Retained core2 schema file is missing" >&2
  exit 66
}
echo "Retained schema verified."

echo "Starting transactional reconciliation."
MIGRATION_SOURCE_DB_URL="$(cat "$reader_file")" \
MIGRATION_TARGET_HOST="$target_host" \
MIGRATION_TARGET_USER="rmoneadmin" \
MIGRATION_TARGET_PASSWORD="$target_password" \
MIGRATION_SCHEMA_FILE="$schema_file" \
MIGRATION_EVIDENCE_FILE="$state_dir/reconciliation-evidence-${run_label}.json" \
MIGRATION_SERVER_SIDE_COPY="${MIGRATION_SERVER_SIDE_COPY:-true}" \
node "$root/scripts/reconcile-aws-drift.mjs" \
  2>&1 | sed -u -E \
    -e 's#(mssql://)[^[:space:]"]+#\1[REDACTED]#gI' \
    -e 's#("(pw|password)"[[:space:]]*:[[:space:]]*")[^"]*#\1[REDACTED]#gI' \
  | tee "$state_dir/reconciliation-${run_label}.log"