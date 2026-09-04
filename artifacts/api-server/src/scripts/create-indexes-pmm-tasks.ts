/**
 * One-shot: build the PMMTasks index only (small table, should be fast).
 */
import { getDdlPool, sql } from "../lib/db.js";

async function colsOf(pool: sql.ConnectionPool, table: string): Promise<Set<string>> {
  try {
    const r = await pool.request()
      .input("t", sql.NVarChar, table)
      .query(`SELECT LOWER(c.name) AS n
              FROM core2.sys.columns c
              JOIN core2.sys.objects o ON o.object_id = c.object_id
              WHERE o.name = @t AND o.type = 'U'`);
    return new Set((r.recordset ?? []).map((x: Record<string, unknown>) => x.n as string));
  } catch {
    return new Set();
  }
}

async function indexExists(pool: sql.ConnectionPool, table: string, indexName: string): Promise<boolean> {
  const r = await pool.request()
    .input("tbl", sql.NVarChar, table)
    .input("idx", sql.NVarChar, indexName)
    .query(`SELECT 1 AS found
            FROM core2.sys.indexes i
            JOIN core2.sys.objects o ON o.object_id = i.object_id
            WHERE o.name = @tbl AND i.name = @idx`);
  return (r.recordset ?? []).length > 0;
}

async function main() {
  console.log("[create-indexes-pmm-tasks] Connecting …");
  const pool = await getDdlPool();
  console.log("[create-indexes-pmm-tasks] Connected.");

  const table = "PMMTasks";
  const indexName = "IX_PMMTasks_TicketId_Tid";

  if (await indexExists(pool, table, indexName)) {
    console.log(`  [skip]  ${table}.${indexName}`);
    process.exit(0);
  }

  const cols = await colsOf(pool, table);
  if (cols.size === 0) {
    console.log(`  [skip]  ${table} not found`);
    process.exit(0);
  }

  const inc = ([] as string[])
    .concat(cols.has("duedate")       ? ["DueDate"]       : [])
    .concat(cols.has("stagename")     ? ["StageName"]     : [])
    .concat(cols.has("pmmidfklookup") ? ["PMMIdFKLookup"] : []);
  const includeSql = inc.length ? ` INCLUDE (${inc.map(c => `[${c}]`).join(", ")})` : "";
  const ddl = `CREATE NONCLUSTERED INDEX [${indexName}]
               ON core2.dbo.[${table}] ([TicketId], [TenantID])${includeSql}`;

  try {
    await pool.request().batch(ddl);
    console.log(`  [ok]    ${table}.${indexName}`);
  } catch (e) {
    console.error(`  [FAIL]  ${table}.${indexName}:`, e instanceof Error ? e.message : String(e));
  }

  process.exit(0);
}

main().catch((e) => { console.error(e); process.exit(1); });
