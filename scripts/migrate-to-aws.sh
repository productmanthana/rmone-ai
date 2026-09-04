#!/usr/bin/env bash
# Safe wrapper for the resumable migration implementation kept with api-server.
set -euo pipefail
umask 077

command="${1:?usage: migrate-to-aws.sh <preflight|ddl|load|fk|verify|status|sample>}"
case "$command" in preflight|ddl|load|fk|verify|status|sample) ;; *) exit 64;; esac
: "${MIGRATION_SOURCE_DB_URL:?MIGRATION_SOURCE_DB_URL is required}"
: "${MIGRATION_TARGET_HOST:?MIGRATION_TARGET_HOST is required}"
: "${MIGRATION_TARGET_USER:?MIGRATION_TARGET_USER is required}"
: "${MIGRATION_TARGET_PASSWORD:?MIGRATION_TARGET_PASSWORD is required}"
: "${MIGRATION_TARGET_ENV:?MIGRATION_TARGET_ENV is required}"
case "$MIGRATION_TARGET_ENV" in dev|qa|pilot) ;; *) echo "Production migration is intentionally unsupported" >&2; exit 65;; esac
[[ "$MIGRATION_TARGET_HOST" =~ ^rmone-nonprod-standard\.[A-Za-z0-9.-]+\.rds\.amazonaws\.com$ ]] || {
  echo "Target host is not the managed rmone-nonprod-standard RDS endpoint" >&2
  exit 65
}

root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
api_dir="$root/artifacts/api-server"
state_dir="${MIGRATION_STATE_DIR:-$root/.migration-state}"
mkdir -p "$state_dir"
chmod 700 "$state_dir"
log="$state_dir/migration-${command}-$(date -u +%Y%m%dT%H%M%SZ).log"

exec 9>/tmp/rmone-aws-migration.lock
flock -n 9 || { echo "Another migration is using the shared runner" >&2; exit 75; }

redact() {
  # Never retain URLs or common password-bearing JSON fields in the log artifact.
  sed -E \
    -e 's#(mssql://)[^[:space:]"]+#\1[REDACTED]#gI' \
    -e 's#("(pw|password)"[[:space:]]*:[[:space:]]*")[^"]*#\1[REDACTED]#gI' \
    -e 's#(Password=)[^;[:space:]]+#\1[REDACTED]#gI'
}
capture_state() {
  shopt -s nullglob
  for f in /tmp/aws-migrate-state.json /tmp/aws-migrate-schema-*.json; do
    cp "$f" "$state_dir/" 2>/dev/null || true
  done
  shopt -u nullglob
}
restore_state() {
  rm -f /tmp/aws-migrate-state.json /tmp/aws-migrate-schema-*.json /tmp/target_aws.json
  local manifest="$state_dir/migration-target.json"
  if [[ -f "$manifest" ]]; then
    node -e '
      const fs=require("fs");
      const m=JSON.parse(fs.readFileSync(process.argv[1],"utf8"));
      if (m.sourceHost !== process.argv[2] || m.targetHost !== process.argv[3]) {
        throw new Error("retained migration state belongs to a different source or target");
      }
    ' "$manifest" "$(node -e 'console.log(new URL(process.env.MIGRATION_SOURCE_DB_URL).hostname)')" "$MIGRATION_TARGET_HOST"
  else
    node -e '
      const fs=require("fs");
      fs.writeFileSync(process.argv[1], JSON.stringify({
        sourceHost:new URL(process.env.MIGRATION_SOURCE_DB_URL).hostname,
        targetHost:process.env.MIGRATION_TARGET_HOST
      }));
    ' "$manifest"
  fi
  if [[ -f "$state_dir/aws-migrate-state.json" ]]; then
    cp "$state_dir/aws-migrate-state.json" /tmp/
  fi
  shopt -s nullglob
  for f in "$state_dir"/aws-migrate-schema-*.json; do
    cp "$f" /tmp/
  done
  shopt -u nullglob
}
target_json="/tmp/target_aws.json"
cleanup() {
  capture_state
  rm -f "$target_json"
}
trap cleanup EXIT

preflight_js='
import sql from "mssql";
const source = new URL(process.env.MIGRATION_SOURCE_DB_URL);
const databases = (process.env.MIGRATE_DBS || "core2,rmoneapp").split(",").map(x => x.trim()).filter(Boolean);
if (!databases.length || databases.some(x => !["core2","rmoneapp"].includes(x))) throw new Error("MIGRATE_DBS contains an unapproved database");
if (source.hostname.toLowerCase() === process.env.MIGRATION_TARGET_HOST.toLowerCase()) throw new Error("source and target hosts must be different");
const sourceBase = { server: source.hostname, port: source.port ? Number(source.port) : 1433,
  user: decodeURIComponent(source.username), password: decodeURIComponent(source.password),
  connectionTimeout:20000, requestTimeout:120000,
  options: { encrypt:true, trustServerCertificate:true } };
const targetCfg = { server: process.env.MIGRATION_TARGET_HOST, user: process.env.MIGRATION_TARGET_USER,
  password: process.env.MIGRATION_TARGET_PASSWORD, database:"master",
  connectionTimeout:20000, requestTimeout:120000,
  options: { encrypt:true, trustServerCertificate:true } };
let sp, tp;
try {
  for (const database of databases) {
    sp = await new sql.ConnectionPool({ ...sourceBase, database }).connect();
    const s = (await sp.request().query("SELECT HAS_PERMS_BY_NAME(DB_NAME(), '\''DATABASE'\'', '\''SELECT'\'') AS can_select, HAS_PERMS_BY_NAME(DB_NAME(), '\''DATABASE'\'', '\''INSERT'\'') AS can_insert, HAS_PERMS_BY_NAME(DB_NAME(), '\''DATABASE'\'', '\''UPDATE'\'') AS can_update, HAS_PERMS_BY_NAME(DB_NAME(), '\''DATABASE'\'', '\''DELETE'\'') AS can_delete, HAS_PERMS_BY_NAME(DB_NAME(), '\''DATABASE'\'', '\''ALTER'\'') AS can_alter, HAS_PERMS_BY_NAME(DB_NAME(), '\''DATABASE'\'', '\''CONTROL'\'') AS can_control")).recordset[0];
    const objectWrites = (await sp.request().query("SELECT COUNT_BIG(*) AS n FROM sys.tables t JOIN sys.schemas s ON s.schema_id=t.schema_id WHERE HAS_PERMS_BY_NAME(QUOTENAME(s.name)+'\''.'\''+QUOTENAME(t.name), '\''OBJECT'\'', '\''INSERT'\'')=1 OR HAS_PERMS_BY_NAME(QUOTENAME(s.name)+'\''.'\''+QUOTENAME(t.name), '\''OBJECT'\'', '\''UPDATE'\'')=1 OR HAS_PERMS_BY_NAME(QUOTENAME(s.name)+'\''.'\''+QUOTENAME(t.name), '\''OBJECT'\'', '\''DELETE'\'')=1 OR HAS_PERMS_BY_NAME(QUOTENAME(s.name)+'\''.'\''+QUOTENAME(t.name), '\''OBJECT'\'', '\''ALTER'\'')=1 OR HAS_PERMS_BY_NAME(QUOTENAME(s.name)+'\''.'\''+QUOTENAME(t.name), '\''OBJECT'\'', '\''CONTROL'\'')=1")).recordset[0].n;
    if (!s.can_select || s.can_insert || s.can_update || s.can_delete || s.can_alter || s.can_control || Number(objectWrites) > 0) throw new Error(`source credential is not read-only for ${database}`);
    await sp.close(); sp = undefined;
  }
  tp = await new sql.ConnectionPool(targetCfg).connect();
  const t = (await tp.request().query("SELECT HAS_PERMS_BY_NAME(NULL, NULL, '\''CREATE ANY DATABASE'\'') AS can_create_db, CAST(SERVERPROPERTY('\''Edition'\'') AS nvarchar(128)) AS edition")).recordset[0];
  if (!t.can_create_db) throw new Error("target credential cannot create migration databases");
  if (/express/i.test(t.edition)) throw new Error("target SQL Server Express cannot hold the approved full database");
  console.log(`PREFLIGHT_PASS databases=${databases.join(",")} source=read-only target=write-capable edition=${t.edition}`);
} finally { await sp?.close(); await tp?.close(); }'

run_preflight() {
  (cd "$api_dir" && node --input-type=module -e "$preflight_js")
}
run_sample() {
  # SQL-only disposable capability validation; it neither calls nor assumes an
  # application deletion API.  The finally block and postcondition are required.
  local sample_js
  sample_js='import sql from "mssql";
const db = "migration_sample_" + Date.now() + "_" + process.pid;
const cfg = { server:process.env.MIGRATION_TARGET_HOST, user:process.env.MIGRATION_TARGET_USER, password:process.env.MIGRATION_TARGET_PASSWORD, database:"master", connectionTimeout:20000, requestTimeout:120000, options:{encrypt:true,trustServerCertificate:true} };
const p = await new sql.ConnectionPool(cfg).connect(); let samplePool, failure;
try {
  const stale = await p.request().query("SELECT COUNT(*) n FROM sys.databases WHERE name LIKE '\''migration[_]sample[_]%'\''");
  if (stale.recordset[0].n !== 0) throw new Error("a previous disposable sample database still exists");
  await p.request().batch(`CREATE DATABASE [${db}]`);
  let online = false;
  for (let i=0; i<60; i++) {
    const state = await p.request().input("db", sql.NVarChar, db).query("SELECT state_desc FROM sys.databases WHERE name=@db");
    if (state.recordset[0]?.state_desc === "ONLINE") { online = true; break; }
    await new Promise(resolve => setTimeout(resolve, 1000));
  }
  if (!online) throw new Error("disposable sample database did not become online");
  samplePool = await new sql.ConnectionPool({ ...cfg, database:db }).connect();
  await samplePool.request().batch("CREATE TABLE [migration_probe] ([id] int NOT NULL PRIMARY KEY); INSERT INTO [migration_probe] VALUES (1);");
  const probe = await samplePool.request().query("SELECT COUNT(*) n FROM [migration_probe]");
  if (probe.recordset[0].n !== 1) throw new Error("disposable sample probe verification failed");
}
catch (e) { failure = e; }
finally { try { await samplePool?.close(); await p.request().query(`IF DB_ID(N'\''${db}'\'') IS NOT NULL BEGIN ALTER DATABASE [${db}] SET SINGLE_USER WITH ROLLBACK IMMEDIATE; DROP DATABASE [${db}]; END`); } finally { const r = await p.request().query("SELECT COUNT(*) n FROM sys.databases WHERE name LIKE '\''migration[_]sample[_]%'\''"); await p.close(); if (r.recordset[0].n !== 0) throw new Error("disposable sample left a target database behind"); } }
if (failure) throw failure; console.log("DISPOSABLE_SAMPLE_PASS zero_leftovers=true");'
  (cd "$api_dir" && node --input-type=module -e "$sample_js")
}

restore_state
if [[ "$command" == preflight ]]; then
  run_preflight 2>&1 | redact | tee "$log"
elif [[ "$command" == sample ]]; then
  run_preflight
  run_sample 2>&1 | redact | tee "$log"
else
  run_preflight
  # The implementation receives only the source alias it already supports and
  # a temporary target JSON.  Neither credential is written to retained state.
  node -e 'process.stdout.write(JSON.stringify({host:process.env.MIGRATION_TARGET_HOST,user:process.env.MIGRATION_TARGET_USER,pw:process.env.MIGRATION_TARGET_PASSWORD}))' >"$target_json"
  chmod 600 "$target_json"
  CLIENT_DB_URL="$MIGRATION_SOURCE_DB_URL" node "$api_dir/scripts/migrate-to-aws.mjs" "$command" 2>&1 | redact | tee "$log"
fi