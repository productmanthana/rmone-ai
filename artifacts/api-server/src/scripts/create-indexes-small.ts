/**
 * Creates indexes on the smaller tables that couldn't be reached in earlier runs.
 * Opportunity is excluded — it's too large to build within the tooling window.
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

async function createIndex(
  pool: sql.ConnectionPool,
  table: string,
  indexName: string,
  keyColumns: string,
  includeColumns?: string,
): Promise<void> {
  const tag = `${table}.${indexName}`;
  try {
    if (await indexExists(pool, table, indexName)) {
      console.log(`  [skip]  ${tag}`);
      return;
    }
    const includeSql = includeColumns ? ` INCLUDE (${includeColumns})` : "";
    const ddl = `CREATE NONCLUSTERED INDEX [${indexName}]
                 ON core2.dbo.[${table}] (${keyColumns})${includeSql}`;
    await pool.request().batch(ddl);
    console.log(`  [ok]    ${tag}`);
  } catch (e) {
    console.error(`  [FAIL]  ${tag}:`, e instanceof Error ? e.message : String(e));
  }
}

async function main() {
  console.log("[create-indexes-small] Connecting …");
  const pool = await getDdlPool();
  console.log("[create-indexes-small] Connected.\n");

  // ── CRMCompany ───────────────────────────────────────────────────────────────
  {
    const cols = await colsOf(pool, "CRMCompany");
    if (cols.size > 0) {
      await createIndex(pool, "CRMCompany", "IX_CRMCo_Tid_ID",
        "[TenantID], [ID]",
        cols.has("title") ? "[Title]" : undefined,
      );
    }
  }

  // ── CRMContact ───────────────────────────────────────────────────────────────
  {
    const cols = await colsOf(pool, "CRMContact");
    if (cols.size > 0) {
      const inc = ([] as string[])
        .concat(cols.has("pointofcontact")   ? ["PointOfContact"]   : [])
        .concat(cols.has("crmcompanylookup") ? ["CRMCompanyLookup"] : [])
        .concat(cols.has("emailaddress")     ? ["EmailAddress"]     : cols.has("email") ? ["Email"] : []);
      await createIndex(pool, "CRMContact", "IX_CRMCt_Tid_Del",
        "[TenantID], [Deleted]",
        inc.length ? inc.map(c => `[${c}]`).join(", ") : undefined,
      );
    }
  }

  // ── PMMTasks (schedule) ───────────────────────────────────────────────────────
  {
    const cols = await colsOf(pool, "PMMTasks");
    if (cols.size > 0) {
      const inc = ([] as string[])
        .concat(cols.has("duedate")       ? ["DueDate"]       : [])
        .concat(cols.has("stagename")     ? ["StageName"]     : [])
        .concat(cols.has("pmmidfklookup") ? ["PMMIdFKLookup"] : []);
      await createIndex(pool, "PMMTasks", "IX_PMMTasks_TicketId_Tid",
        "[TicketId], [TenantID]",
        inc.length ? inc.map(c => `[${c}]`).join(", ") : undefined,
      );
    }
  }

  console.log("\n[create-indexes-small] Done.");
  process.exit(0);
}

main().catch((e) => {
  console.error("[create-indexes-small] Fatal:", e);
  process.exit(1);
});
