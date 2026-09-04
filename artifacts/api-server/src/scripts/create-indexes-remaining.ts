/**
 * Targeted script: creates only the 4 indexes that were too slow with SORT_IN_TEMPDB=ON.
 * Uses minimal DDL (no WITH hints) so SQL Server can build them in the default fast path.
 * Safe to re-run — each index is checked for existence first.
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

const INDEX_DEADLINE_MS = 100_000; // 100 s — SQL Server keeps building after client moves on

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
    const buildPromise = pool.request().batch(ddl);
    const timeoutPromise = new Promise<"timeout">((res) =>
      setTimeout(() => res("timeout"), INDEX_DEADLINE_MS),
    );
    const result = await Promise.race([buildPromise, timeoutPromise]);
    if (result === "timeout") {
      console.log(`  [slow]  ${tag} — still building on server; re-run script to confirm`);
    } else {
      console.log(`  [ok]    ${tag}`);
    }
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    if (/already exists/i.test(msg)) {
      console.log(`  [skip]  ${tag} (already exists)`);
    } else {
      console.error(`  [FAIL]  ${tag}:`, msg);
    }
  }
}

async function main() {
  console.log("[create-indexes-remaining] Connecting …");
  const pool = await getDdlPool();
  console.log("[create-indexes-remaining] Connected.\n");

  // ── Opportunity ──────────────────────────────────────────────────────────────
  {
    const cols = await colsOf(pool, "Opportunity");
    if (cols.size > 0) {
      const inc = ["Title"]
        .concat(cols.has("crmopportunitystatuschoice") ? ["CRMOpportunityStatusChoice"] : [])
        .concat(cols.has("divisionlookup")             ? ["DivisionLookup"]             : [])
        .concat(cols.has("closedate")                  ? ["CloseDate"]                  : []);
      await createIndex(pool, "Opportunity", "IX_Opp_Tid_TicketId_Del",
        "[TenantID], [TicketId], [Deleted]",
        inc.map(c => `[${c}]`).join(", "),
      );
    }
  }

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

  // ── Lead ─────────────────────────────────────────────────────────────────────
  {
    const cols = await colsOf(pool, "Lead");
    if (cols.size > 0) {
      const incTid = ([] as string[])
        .concat(cols.has("title")    ? ["Title"]    : [])
        .concat(cols.has("ticketid") ? ["TicketId"] : [])
        .concat(cols.has("islead")   ? ["IsLead"]   : []);
      await createIndex(pool, "Lead", "IX_Lead_Tid_Del",
        "[TenantID], [Deleted]",
        incTid.length ? incTid.map(c => `[${c}]`).join(", ") : undefined,
      );
      if (cols.has("ticketid")) {
        await createIndex(pool, "Lead", "IX_Lead_Tid_TicketId",
          "[TenantID], [TicketId]",
          cols.has("title") ? "[Title]" : undefined,
        );
      }
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
      // Covering index: TenantID first (always the equality filter), then
      // TicketId, with every column getTaskDataRds SELECTs in INCLUDE so SQL
      // Server satisfies the full query from the index — no bookmark lookup.
      const covInc = ([] as string[])
        .concat(cols.has("title")           ? ["Title"]           : [])
        .concat(cols.has("startdate")       ? ["StartDate"]       : [])
        .concat(cols.has("duedate")         ? ["DueDate"]         : [])
        .concat(cols.has("status")          ? ["Status"]          : [])
        .concat(cols.has("percentcomplete") ? ["PercentComplete"] : [])
        .concat(cols.has("itemorder")       ? ["ItemOrder"]       : [])
        .concat(cols.has("stagestep")       ? ["StageStep"]       : [])
        .concat(cols.has("deleted")         ? ["Deleted"]         : []);
      if (covInc.length) {
        await createIndex(pool, "PMMTasks", "IX_PMMTasks_Tid_TicketId_Cov",
          "[TenantID], [TicketId]",
          covInc.map(c => `[${c}]`).join(", "),
        );
      }
    }
  }

  // ── ResourceAllocation (weekly hours) ────────────────────────────────────────
  // getWeeklyAllocationsRds filters on TenantID + TicketId. A covering index
  // including all fetched columns eliminates the clustered-index bookmark lookup
  // that makes this query slow under concurrent load.
  {
    const cols = await colsOf(pool, "ResourceAllocation");
    if (cols.size > 0 && cols.has("ticketid")) {
      const inc = ([] as string[])
        .concat(cols.has("resourceuser")           ? ["ResourceUser"]           : [])
        .concat(cols.has("resourceworkitemlookup") ? ["ResourceWorkItemLookup"] : [])
        .concat(cols.has("allocationstartdate")    ? ["AllocationStartDate"]    : [])
        .concat(cols.has("allocationenddate")      ? ["AllocationEndDate"]      : [])
        .concat(cols.has("pctallocation")          ? ["PctAllocation"]          : [])
        .concat(cols.has("allocationhour")         ? ["AllocationHour"]         : [])
        .concat(cols.has("deleted")                ? ["Deleted"]                : []);
      if (inc.length) {
        await createIndex(pool, "ResourceAllocation", "IX_RA_Tid_TicketId_Cov",
          "[TenantID], [TicketId]",
          inc.map(c => `[${c}]`).join(", "),
        );
      }
    }
  }

  // ── ResourceWorkItems (team join) ─────────────────────────────────────────────
  // The same weekly-hours query joins RWI on WorkItem=@pid. A covering index on
  // (TenantID, WorkItem) including all fetched columns avoids the secondary
  // lookup on the clustered index for each matched member row.
  {
    const cols = await colsOf(pool, "ResourceWorkItems");
    if (cols.size > 0 && cols.has("workitem")) {
      const inc = ([] as string[])
        .concat(cols.has("resourceuser")   ? ["ResourceUser"]   : [])
        .concat(cols.has("jobtitlelookup") ? ["JobTitleLookup"] : [])
        .concat(cols.has("divisionlookup") ? ["DivisionLookup"] : [])
        .concat(cols.has("title")          ? ["Title"]          : [])
        .concat(cols.has("deleted")        ? ["Deleted"]        : []);
      if (inc.length) {
        await createIndex(pool, "ResourceWorkItems", "IX_RWI_Tid_WorkItem_Cov",
          "[TenantID], [WorkItem]",
          inc.map(c => `[${c}]`).join(", "),
        );
      }
    }
  }

  console.log("\n[create-indexes-remaining] Done.");
  process.exit(0);
}

main().catch((e) => {
  console.error("[create-indexes-remaining] Fatal:", e);
  process.exit(1);
});
