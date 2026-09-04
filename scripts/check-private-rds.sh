#!/usr/bin/env bash
# Authenticated SQL connectivity proof for the VPC-hosted migration runner.
set -euo pipefail

: "${AWS_REGION:?AWS_REGION is required}"

ca_bundle="$(mktemp)"
trap 'rm -f "$ca_bundle"' EXIT
curl --fail --silent --show-error --location \
  https://truststore.pki.rds.amazonaws.com/global/global-bundle.pem \
  --output "$ca_bundle"

database_url="$(
  aws secretsmanager get-secret-value \
    --region "$AWS_REGION" \
    --secret-id rmone/nonprod/database-url \
    --query SecretString \
    --output text
)"

NODE_EXTRA_CA_CERTS="$ca_bundle" DB_URL="$database_url" \
  pnpm --filter @workspace/api-server exec node --input-type=module -e '
  import sql from "mssql";
  const u = new URL(process.env.DB_URL);
  if (!/^rmone-nonprod-standard\.[A-Za-z0-9.-]+\.rds\.amazonaws\.com$/i.test(u.hostname)) {
    throw new Error("AWS database secret does not target rmone-nonprod-standard");
  }
  const pool = await new sql.ConnectionPool({
    server: u.hostname,
    port: u.port ? Number(u.port) : 1433,
    user: decodeURIComponent(u.username),
    password: decodeURIComponent(u.password),
    database: u.pathname.slice(1) || "master",
    connectionTimeout: 20000,
    requestTimeout: 30000,
    options: { encrypt: true, trustServerCertificate: false },
  }).connect();
  try {
    const result = await pool.request().query("SELECT 1 AS ok");
    if (result.recordset[0]?.ok !== 1) throw new Error("SQL connectivity probe returned an unexpected result");
    console.log("PRIVATE_RDS_CONNECTIVITY_PASS authenticated_query=true");
  } finally {
    await pool.close();
  }
'
unset database_url