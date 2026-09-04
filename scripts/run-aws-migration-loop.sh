#!/usr/bin/env bash
# Long-running non-production migration orchestrator for a managed workflow.
set -euo pipefail
umask 077

: "${APP_DATABASE_URL:?APP_DATABASE_URL is required}"
export APP_DATABASE_URL

root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
api_dir="$root/artifacts/api-server"
state_dir="$root/.migration-state/task715-live"
reader_url_file="/tmp/rmone-migration-source-url"
target_secret_file="/tmp/rmone-target-secret.json"
reader_login="rmone_migration_reader"

cleanup_reader() {
  cd "$api_dir"
  node --input-type=module <<'NODE' || true
import sql from "mssql";
const source = new URL(process.env.APP_DATABASE_URL);
const login = "rmone_migration_reader";
const cfg = {
  server: source.hostname,
  port: source.port ? Number(source.port) : 1433,
  database: "master",
  user: decodeURIComponent(source.username),
  password: decodeURIComponent(source.password),
  connectionTimeout: 30_000,
  requestTimeout: 120_000,
  options: { encrypt: true, trustServerCertificate: true },
};
const pool = await new sql.ConnectionPool(cfg).connect();
try {
  await pool.request().batch(`
    USE [core2];
    IF USER_ID(N'${login}') IS NOT NULL DROP USER [${login}];
    USE [rmoneapp];
    IF USER_ID(N'${login}') IS NOT NULL DROP USER [${login}];
    USE [master];
    IF SUSER_ID(N'${login}') IS NOT NULL DROP LOGIN [${login}];
  `);
  console.log("Temporary source migration login removed.");
} finally {
  await pool.close();
}
NODE
  rm -f "$reader_url_file" "$target_secret_file" /tmp/target_aws.json
}
trap cleanup_reader EXIT
trap 'exit 130' INT
trap 'exit 143' TERM

mkdir -p "$state_dir"
chmod 700 "$state_dir"
cleanup_reader

cd "$api_dir"
node --input-type=module <<'NODE'
import crypto from "node:crypto";
import fs from "node:fs/promises";
import sql from "mssql";
const source = new URL(process.env.APP_DATABASE_URL);
const login = "rmone_migration_reader";
const password = crypto.randomBytes(32).toString("base64url");
const cfg = {
  server: source.hostname,
  port: source.port ? Number(source.port) : 1433,
  database: "master",
  user: decodeURIComponent(source.username),
  password: decodeURIComponent(source.password),
  connectionTimeout: 30_000,
  requestTimeout: 120_000,
  options: { encrypt: true, trustServerCertificate: true },
};
const pool = await new sql.ConnectionPool(cfg).connect();
const escaped = password.replaceAll("'", "''");
try {
  await pool.request().batch(`
    CREATE LOGIN [${login}]
      WITH PASSWORD=N'${escaped}', CHECK_POLICY=OFF, CHECK_EXPIRATION=OFF;
  `);
  for (const database of ["core2", "rmoneapp"]) {
    await pool.request().batch(`
      USE [${database}];
      CREATE USER [${login}] FOR LOGIN [${login}];
      ALTER ROLE [db_datareader] ADD MEMBER [${login}];
    `);
  }
} finally {
  await pool.close();
}
const url =
  `mssql://${encodeURIComponent(login)}:${encodeURIComponent(password)}` +
  `@${source.hostname}:${source.port || 1433}/master` +
  "?encrypt=true&trustServerCertificate=true";
await fs.writeFile("/tmp/rmone-migration-source-url", url, { mode: 0o600 });
console.log("Temporary read-only source login created.");
NODE

secret_arn="$(
  aws rds describe-db-instances \
    --region us-east-1 \
    --db-instance-identifier rmone-nonprod-standard \
    --query 'DBInstances[0].MasterUserSecret.SecretArn' \
    --output text
)"
target_host="$(
  aws rds describe-db-instances \
    --region us-east-1 \
    --db-instance-identifier rmone-nonprod-standard \
    --query 'DBInstances[0].Endpoint.Address' \
    --output text
)"
aws secretsmanager get-secret-value \
  --region us-east-1 \
  --secret-id "$secret_arn" \
  --query SecretString \
  --output text >"$target_secret_file"
chmod 600 "$target_secret_file"

target_password="$(
  node -e '
    const fs = require("fs");
    process.stdout.write(
      JSON.parse(fs.readFileSync(process.argv[1], "utf8")).password
    );
  ' "$target_secret_file"
)"
source_url="$(cat "$reader_url_file")"

run_resumable_phase() {
  local phase="$1"
  while true; do
    set +e
    env \
      MIGRATE_PAGE_ROWS=50000 \
      MIGRATION_SOURCE_DB_URL="$source_url" \
      MIGRATION_TARGET_HOST="$target_host" \
      MIGRATION_TARGET_USER=rmoneadmin \
      MIGRATION_TARGET_PASSWORD="$target_password" \
      MIGRATION_TARGET_ENV=dev \
      MIGRATION_STATE_DIR="$state_dir" \
      "$root/scripts/migrate-to-aws.sh" "$phase"
    local rc=$?
    set -e
    case "$rc" in
      0) return 0 ;;
      2)
        echo "Phase $phase checkpoint retained; continuing."
        sleep 2
        ;;
      *) return "$rc" ;;
    esac
  done
}

run_resumable_phase load
run_resumable_phase fk

TARGET_HOST="$target_host" TARGET_PASSWORD="$target_password" \
  node --input-type=module --eval '
    import sql from "mssql";
    const cfg = {
      server: process.env.TARGET_HOST,
      user: "rmoneadmin",
      password: process.env.TARGET_PASSWORD,
      database: "master",
      connectionTimeout: 30_000,
      requestTimeout: 120_000,
      options: { encrypt: true, trustServerCertificate: true },
    };
    for (const database of ["core2", "rmoneapp"]) {
      const pool = await new sql.ConnectionPool({ ...cfg, database }).connect();
      try {
        const tables = (await pool.request().query(
          "SELECT QUOTENAME(SCHEMA_NAME(schema_id)) + ''.'' + QUOTENAME(name) q " +
          "FROM sys.tables WHERE is_ms_shipped=0"
        )).recordset;
        for (const table of tables) {
          await pool.request().query(`ALTER TABLE ${table.q} WITH CHECK CHECK CONSTRAINT ALL`);
        }
      } finally {
        await pool.close();
      }
    }
    console.log("All target constraints enabled and validated.");
  '

set +e
env \
  MIGRATION_SOURCE_DB_URL="$source_url" \
  MIGRATION_TARGET_HOST="$target_host" \
  MIGRATION_TARGET_USER=rmoneadmin \
  MIGRATION_TARGET_PASSWORD="$target_password" \
  MIGRATION_TARGET_ENV=dev \
  MIGRATION_STATE_DIR="$state_dir" \
  "$root/scripts/migrate-to-aws.sh" verify
verify_rc=$?
set -e
if [[ "$verify_rc" -ne 0 ]]; then
  echo "Verification failed; stopping without cutover." >&2
  exit "$verify_rc"
fi

env \
  MIGRATION_SOURCE_DB_URL="$source_url" \
  MIGRATION_TARGET_HOST="$target_host" \
  MIGRATION_TARGET_USER=rmoneadmin \
  MIGRATION_TARGET_PASSWORD="$target_password" \
  MIGRATION_TARGET_ENV=dev \
  MIGRATION_STATE_DIR="$state_dir" \
  "$root/scripts/migrate-to-aws.sh" status

echo "AWS migration load, foreign keys, and verification completed."