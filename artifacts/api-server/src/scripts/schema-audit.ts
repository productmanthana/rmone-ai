/**
 * READ-ONLY core2 schema audit. Run with:
 *   pnpm --filter @workspace/api-server exec tsx src/scripts/schema-audit.ts
 * Emits row counts, existing indexes, missing-index DMV suggestions, and index
 * usage stats for the hot tables. Performs NO writes/DDL.
 */
import { getPool, sql } from "../lib/db.js";

const HOT_TABLES = [
  "AspNetUsers", "CRMCompany", "CRMContact", "Department", "Roles", "Jobtitle",
  "CompanyDivisions", "PMM", "Opportunity", "ResourceAllocation", "ResourceWorkItems",
  "Config_ConfigurationVariable", "ModuleTasks", "TicketHours",
];

async function main() {
  const pool = await getPool();
  const out: Record<string, unknown> = {};

  // 1) Row counts (cheap, from partition stats)
  const counts = await pool.request().query(`
    SELECT t.name AS TableName, SUM(p.rows) AS [Rows]
    FROM core2.sys.tables t
    JOIN core2.sys.partitions p ON p.object_id = t.object_id AND p.index_id IN (0,1)
    WHERE t.name IN (${HOT_TABLES.map((n) => `'${n}'`).join(",")})
    GROUP BY t.name ORDER BY SUM(p.rows) DESC;`);
  out.rowCounts = counts.recordset;

  // 2) Existing indexes on hot tables
  const idx = await pool.request().query(`
    SELECT t.name AS TableName, i.name AS IndexName, i.type_desc AS Kind,
           i.is_primary_key AS PK, i.is_unique AS Uniq,
           STUFF((SELECT ', ' + c.name FROM core2.sys.index_columns ic
                  JOIN core2.sys.columns c ON c.object_id=ic.object_id AND c.column_id=ic.column_id
                  WHERE ic.object_id=i.object_id AND ic.index_id=i.index_id AND ic.is_included_column=0
                  ORDER BY ic.key_ordinal FOR XML PATH('')),1,2,'') AS KeyCols
    FROM core2.sys.indexes i
    JOIN core2.sys.tables t ON t.object_id=i.object_id
    WHERE t.name IN (${HOT_TABLES.map((n) => `'${n}'`).join(",")}) AND i.type>0
    ORDER BY t.name, i.index_id;`);
  out.existingIndexes = idx.recordset;

  // 3) Missing-index DMV suggestions for core2 (read-only advisory)
  const missing = await pool.request().query(`
    SELECT TOP 40 DB_NAME(mid.database_id) AS DBName,
           OBJECT_NAME(mid.object_id, mid.database_id) AS TableName,
           migs.user_seeks + migs.user_scans AS Uses,
           CONVERT(int, migs.avg_total_user_cost * migs.avg_user_impact * (migs.user_seeks + migs.user_scans)) AS ImpactScore,
           mid.equality_columns AS EqCols, mid.inequality_columns AS IneqCols, mid.included_columns AS IncCols
    FROM core2.sys.dm_db_missing_index_group_stats migs
    JOIN core2.sys.dm_db_missing_index_groups mig ON migs.group_handle = mig.index_group_handle
    JOIN core2.sys.dm_db_missing_index_details mid ON mig.index_handle = mid.index_handle
    WHERE mid.database_id = DB_ID('core2')
    ORDER BY ImpactScore DESC;`);
  out.missingIndexes = missing.recordset;

  // 4) Index usage (seeks/scans/lookups vs updates) for hot tables
  const usage = await pool.request().query(`
    SELECT OBJECT_NAME(s.object_id, DB_ID('core2')) AS TableName, i.name AS IndexName,
           s.user_seeks AS Seeks, s.user_scans AS Scans, s.user_lookups AS Lookups, s.user_updates AS Updates
    FROM core2.sys.dm_db_index_usage_stats s
    JOIN core2.sys.indexes i ON i.object_id=s.object_id AND i.index_id=s.index_id
    WHERE s.database_id = DB_ID('core2')
      AND OBJECT_NAME(s.object_id, DB_ID('core2')) IN (${HOT_TABLES.map((n) => `'${n}'`).join(",")})
    ORDER BY (s.user_seeks + s.user_scans + s.user_lookups) DESC;`);
  out.indexUsage = usage.recordset;

  console.log(JSON.stringify(out, null, 2));
  process.exit(0);
}

main().catch((e) => { console.error("AUDIT_ERROR", e?.message || e); process.exit(1); });
