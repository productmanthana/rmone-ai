#!/usr/bin/env node
/**
 * Reconcile the fixed, reviewed set of live-write drift tables from the source
 * SQL Server into the non-production AWS RDS target.
 *
 * Safety properties:
 * - source connection is expected to be a db_datareader-only login;
 * - all approved source tables are held with TABLOCK/HOLDLOCK in one
 *   SERIALIZABLE transaction: reads continue, while writes wait for the
 *   approved short reconciliation window to finish;
 * - all target replacements happen in one transaction and roll back together;
 * - rows are staged and inserted with native SQL Server types;
 * - every reconciled table is compared with SQL-side row/checksum evidence;
 * - all source/target table counts must match before target commit;
 * - only counts and hashes are written to the evidence file.
 */
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import {
  buildReplacementSql,
  buildStageSql,
} from "./lib/reconciliation-sql.mjs";

const requireFromApi = createRequire(
  new URL("../artifacts/api-server/package.json", import.meta.url),
);
const sql = requireFromApi("mssql");

const APPROVED_TABLES = [
  "CompanyDivisions",
  "Config_Module_ModuleStages",
  "Config_ModuleLifeCycles",
  "CRMCompany",
  "Department",
  "JobTitle",
  "Lead",
  "Opportunity",
  "PMM",
  "ResourceWorkItems",
  "RMOneStatusHistory",
  "Roles",
  // Additional live-write drift caught by the first post-reconciliation
  // full-count gate. No other tables are eligible for targeted replacement.
  "Config_ConfigurationVariable",
  "Config_Module_Priority",
  "PMMTasks",
  "ResourceAllocation",
];
const requestedTables = (process.env.MIGRATION_TABLES_CSV || "")
  .split(",")
  .map((value) => value.trim())
  .filter(Boolean);
const selectedTables = requestedTables.length
  ? requestedTables
  : APPROVED_TABLES;
for (const table of selectedTables) {
  if (!APPROVED_TABLES.includes(table)) {
    throw new Error(`table ${table} is not in the reviewed reconciliation set`);
  }
}
if (new Set(selectedTables).size !== selectedTables.length) {
  throw new Error("MIGRATION_TABLES_CSV contains duplicate table names");
}
const verifyOnly = process.env.MIGRATION_VERIFY_ONLY === "true";
const serverSideCopy =
  process.env.MIGRATION_SERVER_SIDE_COPY === "true" && !verifyOnly;
if (!verifyOnly && !serverSideCopy) {
  throw new Error(
    "reconciliation requires MIGRATION_SERVER_SIDE_COPY=true; " +
      "the lossy client-batched transfer path is disabled",
  );
}
const requireFullCounts =
  process.env.MIGRATION_REQUIRE_FULL_COUNTS !== "false";
const LINKED_SERVER = "RMONE_RECON_SOURCE";
const stageTableName = (table) =>
  `dbo.${id(`__rmone_reconcile_${table.tbl}`)}`;

const requiredEnv = [
  "MIGRATION_SOURCE_DB_URL",
  "MIGRATION_TARGET_HOST",
  "MIGRATION_TARGET_USER",
  "MIGRATION_TARGET_PASSWORD",
  "MIGRATION_SCHEMA_FILE",
  "MIGRATION_EVIDENCE_FILE",
];
for (const key of requiredEnv) {
  if (!process.env[key]) throw new Error(`${key} is required`);
}

if (
  !/^rmone-nonprod-standard\.[A-Za-z0-9.-]+\.rds\.amazonaws\.com$/i.test(
    process.env.MIGRATION_TARGET_HOST,
  )
) {
  throw new Error("target is not the managed rmone-nonprod-standard endpoint");
}

const sourceUrl = new URL(process.env.MIGRATION_SOURCE_DB_URL);
if (
  sourceUrl.hostname.toLowerCase() ===
  process.env.MIGRATION_TARGET_HOST.toLowerCase()
) {
  throw new Error("source and target hosts must differ");
}

const schema = JSON.parse(
  fs.readFileSync(process.env.MIGRATION_SCHEMA_FILE, "utf8"),
);
const schemaTables = new Map(schema.tables.map((table) => [table.tbl, table]));
for (const table of APPROVED_TABLES) {
  if (!schemaTables.has(table)) {
    throw new Error(`approved table ${table} is absent from the retained schema`);
  }
}

const connectionBase = {
  port: 1433,
  database: "core2",
  connectionTimeout: 30_000,
  requestTimeout: 300_000,
  pool: { min: 0, max: 2, idleTimeoutMillis: 30_000 },
  options: {
    encrypt: true,
    trustServerCertificate: true,
    enableArithAbort: true,
    packetSize: 32_768,
  },
};
const sourceConfig = {
  ...connectionBase,
  server: sourceUrl.hostname,
  port: sourceUrl.port ? Number(sourceUrl.port) : 1433,
  user: decodeURIComponent(sourceUrl.username),
  password: decodeURIComponent(sourceUrl.password),
};
const targetConfig = {
  ...connectionBase,
  server: process.env.MIGRATION_TARGET_HOST,
  user: process.env.MIGRATION_TARGET_USER,
  password: process.env.MIGRATION_TARGET_PASSWORD,
};

const id = (name) => `[${String(name).replaceAll("]", "]]")}]`;
const tableName = (table) => `${id(table.sch)}.${id(table.tbl)}`;
const sqlString = (value) => String(value).replaceAll("'", "''");

const isRowversion = (column) =>
  ["timestamp", "rowversion"].includes(column.typ.toLowerCase());
const isFloatish = (column) =>
  ["float", "real"].includes(column.typ.toLowerCase());

async function stageRowsFromLinkedServer(pool, table, columns) {
  const sourceTable =
    `${id(LINKED_SERVER)}.[core2].${id(table.sch)}.${id(table.tbl)}`;
  const stage = stageTableName(table);
  await pool.request().batch(buildStageSql({
    stage,
    sourceTable,
    columnNames: columns.map((column) => column.col),
    quoteId: id,
  }));
}

async function replaceRowsFromStaging(transaction, table, columns) {
  const qTable = tableName(table);
  const hasIdentity = table.cols.some((column) => column.isident);
  const stage = stageTableName(table);
  await new sql.Request(transaction).batch(buildReplacementSql({
    qTable,
    stage,
    columnNames: columns.map((column) => column.col),
    hasIdentity,
    quoteId: id,
  }));
  const constraintState = await new sql.Request(transaction).query(`
    SELECT COUNT_BIG(*) AS invalid
    FROM sys.foreign_keys
    WHERE parent_object_id = OBJECT_ID(N'${table.sch}.${table.tbl}')
      AND (is_disabled = 1 OR is_not_trusted = 1)
  `);
  if (Number(constraintState.recordset[0].invalid) !== 0) {
    throw new Error(
      `constraints are disabled or untrusted after replacing ${table.tbl}`,
    );
  }
}

function checksumColumns(table) {
  return table.cols.filter(
    (column) =>
      !isRowversion(column) &&
      column.maxlen !== -1 &&
      !["text", "ntext", "image", "xml"].includes(
        column.typ.toLowerCase(),
      ) &&
      !isFloatish(column),
  );
}

async function readSqlChecksum(transaction, table) {
  const columns = checksumColumns(table);
  if (!columns.length) return null;
  const result = await new sql.Request(transaction).query(
    `SELECT COUNT_BIG(*) AS rows, CHECKSUM_AGG(BINARY_CHECKSUM(${columns
      .map((column) => id(column.col))
      .join(",")})) AS checksum FROM ${tableName(table)}`,
  );
  return {
    rows: Number(result.recordset[0].rows),
    checksum: result.recordset[0].checksum,
  };
}

async function tableCounts(transaction) {
  const request = new sql.Request(transaction);
  const result = await request.query(`
    SELECT s.name AS sch, t.name AS tbl, SUM(p.rows) AS rows
    FROM sys.tables t
    JOIN sys.schemas s ON s.schema_id=t.schema_id
    JOIN sys.partitions p ON p.object_id=t.object_id AND p.index_id IN (0,1)
    WHERE t.is_ms_shipped=0
    GROUP BY s.name,t.name
  `);
  return new Map(
    result.recordset.map((row) => [
      `${row.sch}.${row.tbl}`,
      Number(row.rows),
    ]),
  );
}

function compareCounts(source, target) {
  const mismatches = [];
  for (const [table, rows] of source) {
    const targetRows = target.has(table) ? target.get(table) : -1;
    if (rows !== targetRows) {
      mismatches.push({ table, sourceRows: rows, targetRows });
    }
  }
  for (const [table, rows] of target) {
    if (!source.has(table)) {
      mismatches.push({ table, sourceRows: -1, targetRows: rows });
    }
  }
  return mismatches;
}

const evidence = {
  startedAt: new Date().toISOString(),
  database: "core2",
  targetClass: "nonproduction",
  approvedTables: APPROVED_TABLES,
  selectedTables,
  mode: verifyOnly ? "verify-only" : "reconcile",
  transfer: verifyOnly ? "verify-only-sql" : "linked-server-native",
  tables: [],
  fullCountMismatches: [],
  result: "FAIL",
};

let sourcePool;
let targetPool;
let sourceTransaction;
let targetTransaction;
let linkedServerCreated = false;
try {
  sourcePool = await new sql.ConnectionPool(sourceConfig).connect();
  console.log("SOURCE_CONNECTED");
  targetPool = await new sql.ConnectionPool(targetConfig).connect();
  console.log("TARGET_CONNECTED");
  if (serverSideCopy) {
    await targetPool.request().batch(`
      IF EXISTS (SELECT 1 FROM sys.servers WHERE name=N'${LINKED_SERVER}')
        EXEC master.dbo.sp_dropserver
          @server=N'${LINKED_SERVER}', @droplogins='droplogins';
      EXEC master.dbo.sp_addlinkedserver
        @server=N'${LINKED_SERVER}',
        @srvproduct=N'',
        @provider=N'MSOLEDBSQL',
        @datasrc=N'${sqlString(sourceUrl.hostname)}';
      EXEC master.dbo.sp_addlinkedsrvlogin
        @rmtsrvname=N'${LINKED_SERVER}',
        @useself='false',
        @locallogin=NULL,
        @rmtuser=N'${sqlString(decodeURIComponent(sourceUrl.username))}',
        @rmtpassword=N'${sqlString(decodeURIComponent(sourceUrl.password))}';
      EXEC master.dbo.sp_serveroption
        @server=N'${LINKED_SERVER}', @optname=N'data access', @optvalue=N'true';
    `);
    linkedServerCreated = true;
    console.log("TEMPORARY_LINKED_SERVER_CREATED");
  }
  sourceTransaction = new sql.Transaction(sourcePool);
  targetTransaction = new sql.Transaction(targetPool);
  await sourceTransaction.begin(sql.ISOLATION_LEVEL.SERIALIZABLE);
  await new sql.Request(sourceTransaction).query("SET LOCK_TIMEOUT 5000");

  // Acquire every approved source lock before reading any table so the
  // reconciliation is one consistent maintenance-window snapshot.
  for (const name of selectedTables) {
    const table = schemaTables.get(name);
    console.log(`ACQUIRING_SOURCE_WRITE_FREEZE dbo.${name}`);
    await new sql.Request(sourceTransaction).query(
      `SELECT COUNT_BIG(*) AS rows FROM ${tableName(table)} WITH (TABLOCK,HOLDLOCK)`,
    );
    console.log(`SOURCE_WRITE_FREEZE_TABLE_ACQUIRED dbo.${name}`);
  }
  console.log(`SOURCE_WRITE_FREEZE_ACQUIRED tables=${selectedTables.length}`);

  if (serverSideCopy) {
    for (const name of selectedTables) {
      const table = schemaTables.get(name);
      const columns = table.cols.filter((column) => !isRowversion(column));
      await stageRowsFromLinkedServer(targetPool, table, columns);
      console.log(`STAGED dbo.${name}`);
    }
  }

  await targetTransaction.begin(sql.ISOLATION_LEVEL.SERIALIZABLE);
  for (const name of selectedTables) {
    const table = schemaTables.get(name);
    const columns = table.cols.filter((column) => !isRowversion(column));
    const source = await readSqlChecksum(sourceTransaction, table);
    if (!verifyOnly) {
      await replaceRowsFromStaging(targetTransaction, table, columns);
    }
    const target = await readSqlChecksum(targetTransaction, table);
    if (
      source.rows !== target.rows ||
      source.checksum !== target.checksum
    ) {
      throw new Error(
        `SQL checksum mismatch after reconciling ${name}: source=${source.rows}/${source.checksum} target=${target.rows}/${target.checksum}`,
      );
    }
    evidence.tables.push({
      table: `dbo.${name}`,
      rows: source.rows,
      sqlChecksum: source.checksum,
    });
    console.log(
      `${verifyOnly ? "VERIFIED" : "RECONCILED"} dbo.${name} rows=${source.rows}`,
    );
  }

  if (requireFullCounts) {
    const sourceCounts = await tableCounts(sourceTransaction);
    const targetCounts = await tableCounts(targetTransaction);
    evidence.fullCountMismatches = compareCounts(sourceCounts, targetCounts);
    if (evidence.fullCountMismatches.length) {
      throw new Error(
        `full table-count verification found ${evidence.fullCountMismatches.length} mismatch(es)`,
      );
    }
  }

  await targetTransaction.commit();
  targetTransaction = null;
  evidence.result = "PASS";
  evidence.completedAt = new Date().toISOString();
  console.log(
    `${verifyOnly ? "VERIFICATION" : "RECONCILIATION"}_PASS tables=${selectedTables.length} fullCountGate=${requireFullCounts ? "pass" : "deferred"}`,
  );
} catch (error) {
  evidence.error = String(error?.message || error).slice(0, 500);
  evidence.completedAt = new Date().toISOString();
  if (targetTransaction) {
    try {
      await targetTransaction.rollback();
    } catch {}
  }
  throw error;
} finally {
  if (sourceTransaction) {
    try {
      await sourceTransaction.rollback();
    } catch {}
  }
  if (sourcePool) {
    try {
      await sourcePool.close();
    } catch {}
  }
  if (targetPool) {
    if (serverSideCopy) {
      for (const name of selectedTables) {
        try {
          const table = schemaTables.get(name);
          await targetPool
            .request()
            .query(`DROP TABLE IF EXISTS ${stageTableName(table)}`);
        } catch {}
      }
      console.log("RECONCILIATION_STAGING_REMOVED");
    }
    if (linkedServerCreated) {
      try {
        await targetPool.request().batch(`
          IF EXISTS (SELECT 1 FROM sys.servers WHERE name=N'${LINKED_SERVER}')
            EXEC master.dbo.sp_dropserver
              @server=N'${LINKED_SERVER}', @droplogins='droplogins';
        `);
        console.log("TEMPORARY_LINKED_SERVER_REMOVED");
      } catch {}
    }
    try {
      await targetPool.close();
    } catch {}
  }
  fs.mkdirSync(path.dirname(process.env.MIGRATION_EVIDENCE_FILE), {
    recursive: true,
    mode: 0o700,
  });
  fs.writeFileSync(
    process.env.MIGRATION_EVIDENCE_FILE,
    `${JSON.stringify(evidence, null, 2)}\n`,
    { mode: 0o600 },
  );
  console.log("SOURCE_WRITE_FREEZE_RELEASED");
}