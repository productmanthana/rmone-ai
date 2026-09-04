/**
 * Idempotent composite-index creation for core2 SQL Server tables.
 * Run once (or after schema changes) to warm up the optimizer:
 *   pnpm --filter @workspace/api-server exec tsx src/scripts/create-indexes.ts
 *
 * Each index is checked for existence before CREATE — safe to re-run.
 * Individual failures are logged and skipped; the script never aborts early.
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
                 ON core2.dbo.[${table}] (${keyColumns})${includeSql}
                 WITH (FILLFACTOR = 90, SORT_IN_TEMPDB = ON)`;
    await pool.request().batch(ddl);
    console.log(`  [ok]    ${tag}`);
  } catch (e) {
    console.error(`  [FAIL]  ${tag}:`, e instanceof Error ? e.stack ?? e.message : String(e));
  }
}

async function main() {
  console.log("[create-indexes] Connecting to core2 …");
  const pool = await getDdlPool();
  console.log("[create-indexes] Connected. Checking / creating indexes …\n");

  // ── ResourceAllocation ──────────────────────────────────────────────────────
  // Most-queried table: every allocation/team/weekly-hours path filters here.
  {
    const cols = await colsOf(pool, "ResourceAllocation");
    const inc = [
      "ResourceUser", "TicketId", "ResourceWorkItemLookup",
      "PctAllocation", "AllocationStartDate", "AllocationEndDate",
    ]
      .concat(cols.has("allocationhour") ? ["AllocationHour"] : [])
      .concat(cols.has("costrate")       ? ["CostRate"]       : []);
    await createIndex(pool, "ResourceAllocation", "IX_RA_Tid_Del_Include",
      "[TenantID], [Deleted]",
      inc.map(c => `[${c}]`).join(", "),
    );
    if (cols.has("resourceuser")) {
      await createIndex(pool, "ResourceAllocation", "IX_RA_Tid_ResUser",
        "[TenantID], [ResourceUser]",
        "[TicketId], [ResourceWorkItemLookup], [Deleted]",
      );
    }
  }

  // ── ResourceWorkItems ───────────────────────────────────────────────────────
  // Team/allocation hot path: joined by rwi.ID = ra.ResourceWorkItemLookup
  // and filtered by WorkItem (project TicketId).
  {
    const cols = await colsOf(pool, "ResourceWorkItems");
    const joinInc = [
      "ResourceUser", "Title", "WorkItem",
    ]
      .concat(cols.has("jobtitlelookup")  ? ["JobTitleLookup"]  : [])
      .concat(cols.has("divisionlookup")  ? ["DivisionLookup"]  : [])
      .concat(cols.has("allocationhour")  ? ["AllocationHour"]  : [])
      .concat(cols.has("pctallocation")   ? ["PctAllocation"]   : [])
      .concat(cols.has("startdate")       ? ["StartDate"]        : [])
      .concat(cols.has("enddate")         ? ["EndDate"]          : []);
    await createIndex(pool, "ResourceWorkItems", "IX_RWI_Tid_Del_ID_Include",
      "[TenantID], [Deleted], [ID]",
      joinInc.map(c => `[${c}]`).join(", "),
    );
    if (cols.has("workitem")) {
      await createIndex(pool, "ResourceWorkItems", "IX_RWI_Tid_WorkItem_Del",
        "[TenantID], [WorkItem], [Deleted]",
        "[ResourceUser], [ID]" + (cols.has("jobtitlelookup") ? ", [JobTitleLookup]" : "") + (cols.has("divisionlookup") ? ", [DivisionLookup]" : ""),
      );
    }
  }

  // ── AspNetUsers ─────────────────────────────────────────────────────────────
  // Staff / people queries: always filtered by TenantID + Deleted.
  {
    const cols = await colsOf(pool, "AspNetUsers");
    const inc = ["Id", "Email", "Name", "UserName"]
      .concat(cols.has("title")              ? ["Title"]              : [])
      .concat(cols.has("divisionlookup")     ? ["DivisionLookup"]     : [])
      .concat(cols.has("jobtitlelookup")     ? ["JobTitleLookup"]     : [])
      .concat(cols.has("globalroleid")       ? ["GlobalRoleID"]       : [])
      .concat(cols.has("departmentlookup")   ? ["DepartmentLookup"]   : [])
      .concat(cols.has("issiteadmin")        ? ["IsSiteAdmin"]        : []);
    await createIndex(pool, "AspNetUsers", "IX_Users_Tid_Del_Include",
      "[TenantID], [Deleted]",
      inc.map(c => `[${c}]`).join(", "),
    );
  }

  // ── JobTitle ─────────────────────────────────────────────────────────────────
  // Joined by jt.ID = rwi.JobTitleLookup; always scoped by TenantID.
  {
    const cols = await colsOf(pool, "JobTitle");
    const inc = ["Title"]
      .concat(cols.has("departmentid")   ? ["DepartmentId"]   : [])
      .concat(cols.has("roleid")         ? ["RoleId"]         : [])
      .concat(cols.has("shortname")      ? ["ShortName"]      : [])
      .concat(cols.has("empcostrate")    ? ["EmpCostRate"]    : []);
    await createIndex(pool, "JobTitle", "IX_JT_Tid_ID_Include",
      "[TenantID], [ID]",
      inc.map(c => `[${c}]`).join(", "),
    );
    if (cols.has("departmentid")) {
      await createIndex(pool, "JobTitle", "IX_JT_Tid_DeptId",
        "[TenantID], [DepartmentId]",
        "[ID], [Title]",
      );
    }
  }

  // ── CompanyDivisions ─────────────────────────────────────────────────────────
  // Joined by cd.ID = rwi.DivisionLookup; org hierarchy lookups.
  {
    const cols = await colsOf(pool, "CompanyDivisions");
    const inc = ["Title"]
      .concat(cols.has("shortname")           ? ["ShortName"]           : [])
      .concat(cols.has("businessunitidlookup") ? ["BusinessUnitIdLookup"] : []);
    await createIndex(pool, "CompanyDivisions", "IX_Div_Tid_ID_Include",
      "[TenantID], [ID]",
      inc.map(c => `[${c}]`).join(", "),
    );
  }

  // ── Department ───────────────────────────────────────────────────────────────
  // Joined by dep.ID = TRY_CAST(jt.DepartmentId AS BIGINT).
  {
    const cols = await colsOf(pool, "Department");
    const inc = ["Title"]
      .concat(cols.has("divisionidlookup") ? ["DivisionIdLookup"] : []);
    await createIndex(pool, "Department", "IX_Dept_Tid_ID_Include",
      "[TenantID], [ID]",
      inc.map(c => `[${c}]`).join(", "),
    );
  }

  // ── BusinessUnit ─────────────────────────────────────────────────────────────
  {
    const cols = await colsOf(pool, "BusinessUnit");
    const inc = ["Title"]
      .concat(cols.has("shortname") ? ["ShortName"] : []);
    await createIndex(pool, "BusinessUnit", "IX_BU_Tid_ID_Include",
      "[TenantID], [ID]",
      inc.map(c => `[${c}]`).join(", "),
    );
  }

  // ── Roles ────────────────────────────────────────────────────────────────────
  {
    const cols = await colsOf(pool, "Roles");
    const inc = ["Id", "Name"]
      .concat(cols.has("billingrate") ? ["BillingRate"] : [])
      .concat(cols.has("deleted")     ? ["Deleted"]     : []);
    await createIndex(pool, "Roles", "IX_Roles_Tid_Include",
      "[TenantID]",
      inc.map(c => `[${c}]`).join(", "),
    );
  }

  // ── RoleBillingRateByDept ────────────────────────────────────────────────────
  {
    const cols = await colsOf(pool, "RoleBillingRateByDept");
    if (cols.size > 0) {
      const roleCol = cols.has("rolelookup") ? "RoleLookup" : null;
      const deptCol = cols.has("departmentlookup") ? "DepartmentLookup" : null;
      const inc = ["BillingRate", "ID"]
        .concat(cols.has("emplaborrate") ? ["EmpLaborRate"] : [])
        .concat(cols.has("empcostrate")  ? ["EmpCostRate"]  : []);
      if (roleCol && deptCol) {
        await createIndex(pool, "RoleBillingRateByDept", "IX_RBD_Tid_Role_Dept",
          `[TenantID], [${roleCol}], [${deptCol}]`,
          inc.map(c => `[${c}]`).join(", "),
        );
      } else {
        await createIndex(pool, "RoleBillingRateByDept", "IX_RBD_Tid",
          "[TenantID]",
          inc.map(c => `[${c}]`).join(", "),
        );
      }
    }
  }

  // ── PMM ─────────────────────────────────────────────────────────────────────
  {
    const cols = await colsOf(pool, "PMM");
    if (cols.size > 0) {
      const inc = ["Title", "Status"]
        .concat(cols.has("divisionlookup")       ? ["DivisionLookup"]       : [])
        .concat(cols.has("crmcompanylookup")      ? ["CRMCompanyLookup"]     : [])
        .concat(cols.has("projectlifecyclelookup") ? ["ProjectLifeCycleLookup"] : [])
        .concat(cols.has("startdate")              ? ["StartDate"]            : [])
        .concat(cols.has("completiondate")         ? ["CompletionDate"]       : []);
      await createIndex(pool, "PMM", "IX_PMM_Tid_TicketId_Del",
        "[TenantID], [TicketId], [Deleted]",
        inc.map(c => `[${c}]`).join(", "),
      );
    }
  }

  // ── Opportunity ─────────────────────────────────────────────────────────────
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
        .concat(cols.has("pointofcontact")    ? ["PointOfContact"]   : [])
        .concat(cols.has("crmcompanylookup")  ? ["CRMCompanyLookup"] : [])
        .concat(cols.has("emailaddress")      ? ["EmailAddress"]     : cols.has("email") ? ["Email"] : []);
      await createIndex(pool, "CRMContact", "IX_CRMCt_Tid_Del",
        "[TenantID], [Deleted]",
        inc.length ? inc.map(c => `[${c}]`).join(", ") : undefined,
      );
    }
  }

  // ── PMMTasks (schedule) ──────────────────────────────────────────────────────
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

  console.log("\n[create-indexes] Done.");
  process.exit(0);
}

main().catch((e) => {
  console.error("[create-indexes] Fatal:", e);
  process.exit(1);
});
