import { Router, type IRouter } from "express";
import { getPool, getDdlPool } from "../lib/db.js";
import healthRouter from "./health";
import rmoneProxyRouter from "./rmone-proxy";
import chatRouter from "./chat";
import transcribeRouter from "./transcribe";
import cardInsightsRouter from "./card-insights";
import decisionRouter from "./decision";
import alertsRouter from "./alerts";
import onboardingRouter from "./onboarding";
import synonymsRouter from "./synonyms";
import resourcesRouter from "./resources";
import storageRouter from "./storage";
import cfoRouter from "./cfo";
import codebaseGraphRouter from "./codebase-graph";
import superadminRouter from "./superadmin.js";
import dataCleaningRouter from "./data-cleaning.js";
import chatSessionsRouter from "./chat-sessions.js";
import allocationTemplatesRouter from "./allocation-templates.js";
import workflowDocumentRouter from "./workflow-document.js";
import stageCfgRouter from "./stage-cfg.js";
import analyticsRouter from "./analytics.js";
import usageAnalyticsRouter from "./usage-analytics.js";
import actualsForecastRouter from "./actuals-forecast.js";
import { getUptimeHistory } from "../lib/uptime-monitor.js";

const router: IRouter = Router();

router.use(healthRouter);
// Per-service ping endpoints used by the System Health page so it can
// distinguish "API up" from "RM ONE proxy reachable" / "Chat service
// reachable". Mounted BEFORE the matching routers so they answer fast
// without falling through to the heavier handlers.
router.get("/rmone/healthz", (_req, res) => res.json({ status: "ok", service: "rmone-proxy" }));
router.get("/chat/healthz",  (_req, res) => res.json({ status: "ok", service: "chat" }));
// 7-day rolling uptime history collected by the in-process uptime monitor.
// Returns 168 hourly buckets (one week) per service plus recent failures.
router.get("/system/uptime-history", (_req, res) => {
  try {
    res.json(getUptimeHistory());
  } catch (e) {
    res.status(500).json({ error: String(e) });
  }
});
// Usage telemetry (#482): beacon + admin analytics. Mounted BEFORE the main
// proxy router so these paths never fall through to the upstream proxy.
router.use("/rmone", usageAnalyticsRouter);
router.use("/rmone", rmoneProxyRouter);
router.use("/chat", chatRouter);
router.use("/transcribe", transcribeRouter);
router.use("/insights", cardInsightsRouter);
router.use("/decision", decisionRouter);
router.use("/alerts", alertsRouter);
router.use("/cfo", cfoRouter);
router.use("/superadmin", superadminRouter);
router.use("/chat", chatSessionsRouter);
router.use("/onboarding", onboardingRouter);
router.use("/data-cleaning", dataCleaningRouter);
router.use("/synonyms", synonymsRouter);
router.use("/resources", resourcesRouter);
router.use("/allocation-templates", allocationTemplatesRouter);
router.use(workflowDocumentRouter);
router.use(storageRouter);
router.use("/codebase-graph", codebaseGraphRouter);
router.use("/stage-cfg", stageCfgRouter);
router.use("/analytics", analyticsRouter);
// Actuals vs Forecast (#AF): stored weekly snapshots, per-project graph data,
// executive rollup and the actual-hours import.
router.use("/actuals-forecast", actualsForecastRouter);

// ── TEMPORARY: DB optimisation endpoints ──────────────────────────────────────
// Fire-and-forget (returns 200 immediately). Each step is wrapped in Promise.race
// with a hard per-step timeout. Poll GET /admin/db-optimize-status for progress.
//
// Usage sequence for the 6 remaining hot-table indexes:
//   1. Restart the API server
//   2. Within 10 s of "Server listening" hit POST /api/admin/db-optimize-hot
//      (before the uptime-monitor's first 60 s cycle fires any queries)
//   3. Then hit POST /api/admin/db-optimize for the rest (stats run, etc.)
//   4. Remove all these endpoints once GET /admin/db-optimize-status shows all ok.
// ──────────────────────────────────────────────────────────────────────────────

type OptResult = { step: string; status: "ok" | "warn" | "timeout"; msg?: string };
const _dbOptState: { running: boolean; done: boolean; results: OptResult[] } = {
  running: false, done: false, results: [],
};

async function dbOptStep(
  pool: import("mssql").ConnectionPool,
  label: string,
  q: string,
  timeoutMs = 60_000,
) {
  const query = pool.request().query(q);
  const timer = new Promise<never>((_, rej) =>
    setTimeout(() => rej(new Error(`timed out after ${timeoutMs / 1000}s`)), timeoutMs));
  try {
    await Promise.race([query, timer]);
    _dbOptState.results.push({ step: label, status: "ok" });
    console.log(`[db-opt] ✓ ${label}`);
  } catch (e: any) {
    const status = e.message.startsWith("timed out") ? "timeout" : "warn";
    _dbOptState.results.push({ step: label, status, msg: e.message });
    console.log(`[db-opt] ${status === "timeout" ? "⏱" : "⚠"} ${label}: ${e.message}`);
  }
}

function dbOptIdx(name: string, tbl: string, cols: string, inc?: string, opts: { maxdop?: number; sortInTempdb?: boolean } = {}) {
  const { maxdop = 0, sortInTempdb = true } = opts;
  const withs: string[] = [];
  if (sortInTempdb) withs.push("SORT_IN_TEMPDB=ON");
  if (maxdop > 0)   withs.push(`MAXDOP=${maxdop}`);
  return (
    `IF NOT EXISTS(SELECT 1 FROM core2.sys.indexes WHERE name='${name}' AND object_id=OBJECT_ID('core2.dbo.${tbl}'))` +
    ` CREATE INDEX ${name} ON core2.dbo.${tbl}(${cols})` +
    (inc ? ` INCLUDE(${inc})` : ``) +
    (withs.length ? ` WITH(${withs.join(",")})` : ``)
  );
}

// ── Hot-table endpoint: ONLY the 6 indexes on always-queried tables ────────────
// Uses SINGLE_USER mode + a dedicated max:1 DDL pool (same physical connection)
// so the Sch-M lock is guaranteed immediately (no waiting for concurrent Sch-S).
// requestTimeout:0 on the DDL pool means the driver never times out mid-build.
// SINGLE_USER kicks all active sessions; MULTI_USER is always restored in finally.
// Causes a ~5-10 s interruption to active queries while indexes build.
router.post("/admin/db-optimize-hot", (_req, res) => {
  if (_dbOptState.running) {
    res.json({ started: false, msg: "already running", state: _dbOptState }); return;
  }
  _dbOptState.running = true; _dbOptState.done = false; _dbOptState.results = [];
  res.json({ started: true, msg: "hot-table indexes running — poll GET /api/admin/db-optimize-status" });

  (async () => {
    // Dedicated single-connection DDL pool — max:1 ensures SINGLE_USER works correctly
    const ddl = await getDdlPool();
    const req = () => ddl.request(); // always same physical connection via max:1

    const step = async (label: string, sql: string) => {
      try {
        await req().query(sql);
        _dbOptState.results.push({ step: label, status: "ok" });
        console.log(`[db-opt-hot] ✓ ${label}`);
      } catch (e: any) {
        _dbOptState.results.push({ step: label, status: "warn", msg: e.message });
        console.log(`[db-opt-hot] ⚠ ${label}: ${e.message}`);
      }
    };

    try {
      // Acquire exclusive access — kicks all other sessions immediately
      await req().query(`ALTER DATABASE core2 SET SINGLE_USER WITH ROLLBACK IMMEDIATE`);
      console.log("[db-opt-hot] ✓ SINGLE_USER acquired");

      // Free server plan-cache + buffer pool to relieve RESOURCE_SEMAPHORE pressure
      // before index builds. These require ALTER SERVER STATE; if the DB user lacks
      // that permission they will throw but we ignore the error and continue.
      try { await req().query(`DBCC FREEPROCCACHE`);    console.log("[db-opt-hot] ✓ FREEPROCCACHE"); } catch (e: any) { console.warn("[db-opt-hot] FREEPROCCACHE skipped:", e.message); }
      try { await req().query(`DBCC DROPCLEANBUFFERS`); console.log("[db-opt-hot] ✓ DROPCLEANBUFFERS"); } catch (e: any) { console.warn("[db-opt-hot] DROPCLEANBUFFERS skipped:", e.message); }
      // Lower the minimum workspace memory grant — allows small CREATE INDEX ops
      // to proceed even under memory pressure. Requires ALTER SETTINGS permission.
      try { await req().query(`EXEC sp_configure 'min memory per query', 512; RECONFIGURE`); console.log("[db-opt-hot] ✓ min memory per query → 512 KB"); } catch (e: any) { console.warn("[db-opt-hot] sp_configure skipped:", e.message); }

      // MAXDOP=1, sortInTempdb=false — single-threaded, sorts in user-db buffer pool.
      const idx = (n: string, t: string, c: string, i?: string) =>
        dbOptIdx(n, t, c, i, { maxdop: 1, sortInTempdb: false });
      // Opportunity first (25 k rows, key=TenantID+tiny fields → ~17 bytes/row → tiny grant)
      await step("IX_Opp_Tenant",  idx("IX_Opp_Tenant", "Opportunity","TenantID,Deleted",                            "TicketId,Title"));
      await step("IX_Opp_Ticket",  idx("IX_Opp_Ticket", "Opportunity","TenantID,TicketId,Deleted"));
      await step("IX_Opp_Status",  idx("IX_Opp_Status", "Opportunity","TenantID,CRMOpportunityStatusChoice,Deleted", "TicketId,Title"));
      await step("IX_Opp_Sector",  idx("IX_Opp_Sector", "Opportunity","TenantID,SectorChoice,Deleted",               "TicketId,Title"));
      // CRMContact: both indexes use TenantID+Deleted as sort key (17 bytes) — Title
      // moved to INCLUDE so the sort never touches the wide nvarchar column.
      // IX_Contact_Tenant covers "list contacts by tenant".
      // IX_Contact_Title covers "lookup by TenantID+Deleted, return Title" (equality seek).
      await step("IX_Contact_Tenant", idx("IX_Contact_Tenant","CRMContact","TenantID,Deleted","Title,CRMCompanyLookup"));
      await step("IX_Contact_Title",  idx("IX_Contact_Title", "CRMContact","TenantID,Deleted,Title","CRMCompanyLookup"));

    } finally {
      // Always restore multi-user access, even if a step failed
      try {
        await req().query(`ALTER DATABASE core2 SET MULTI_USER`);
        console.log("[db-opt-hot] ✓ MULTI_USER restored");
      } catch (e: any) {
        console.error("[db-opt-hot] !! failed to restore MULTI_USER:", e.message);
      }
      try { await ddl.close(); } catch {}
    }

    _dbOptState.running = false; _dbOptState.done = true;
    const warns = _dbOptState.results.filter(x => x.status !== "ok").length;
    console.log(`[db-opt-hot] ✅ complete. ${_dbOptState.results.length} steps, ${warns} non-ok.`);
  })().catch(e => { _dbOptState.running = false; console.error("[db-opt-hot] Fatal:", e.message); });
});

// ── Main endpoint: all other indexes + rebuilds + stats ────────────────────────
// Already-created indexes are skipped via IF NOT EXISTS. Safe to re-run anytime.
router.post("/admin/db-optimize", (_req, res) => {
  if (_dbOptState.running) {
    res.json({ started: false, msg: "already running", state: _dbOptState }); return;
  }
  _dbOptState.running = true; _dbOptState.done = false; _dbOptState.results = [];
  res.json({ started: true, msg: "running in background — poll GET /api/admin/db-optimize-status" });

  (async () => {
    const pool = await getPool();
    const r = (l: string, q: string, ms = 60_000) => dbOptStep(pool, l, q, ms);
    const idx = dbOptIdx;

    await r("Query Store", `ALTER DATABASE core2 SET QUERY_STORE = ON (OPERATION_MODE=READ_WRITE,CLEANUP_POLICY=(STALE_QUERY_THRESHOLD_DAYS=30),DATA_FLUSH_INTERVAL_SECONDS=900,MAX_STORAGE_SIZE_MB=500,QUERY_CAPTURE_MODE=AUTO)`);

    await r("IX_PMM_Tenant", idx("IX_PMM_Tenant","PMM","TenantID,Deleted","TicketId,Title,Status,SectorChoice,DivisionLookup,ApproxContractValue,TargetStartDate,TargetCompletionDate"));
    await r("IX_PMM_Ticket", idx("IX_PMM_Ticket","PMM","TicketId,TenantID,Deleted"));
    await r("IX_PMM_Status", idx("IX_PMM_Status","PMM","TenantID,Status,Deleted","TicketId,Title,ApproxContractValue"));
    await r("IX_PMM_Sector", idx("IX_PMM_Sector","PMM","TenantID,SectorChoice,Deleted","TicketId,Title"));

    await r("IX_AspNet_Tenant",   idx("IX_AspNet_Tenant",  "AspNetUsers","TenantID,Enabled,Deleted","UserName,Name,DepartmentLookup,UserRoleIdLookup,JobTitleLookup,GlobalRoleID,IsDefaultAdmin,Title,IsSiteAdmin"));
    await r("IX_AspNet_UserName", idx("IX_AspNet_UserName","AspNetUsers","UserName,TenantID,Deleted"));

    await r("IX_RWI_WorkItem", idx("IX_RWI_WorkItem","ResourceWorkItems","WorkItem,TenantID,Deleted","ResourceUser,Title"));
    await r("IX_RWI_Resource", idx("IX_RWI_Resource","ResourceWorkItems","ResourceUser,TenantID,Deleted","WorkItem"));
    await r("IX_RA_RWILookup", idx("IX_RA_RWILookup","ResourceAllocation","ResourceWorkItemLookup,TenantID,Deleted","AllocationHour,PctAllocation,AllocationStartDate,AllocationEndDate"));

    await r("IX_CRMCompany_Tenant", idx("IX_CRMCompany_Tenant","CRMCompany","TenantID,Deleted","Title"));
    await r("IX_Contact_Title",     idx("IX_Contact_Title","CRMContact","Title,TenantID,Deleted","CRMCompanyLookup"));
    await r("IX_Contact_Tenant",    idx("IX_Contact_Tenant","CRMContact","TenantID,Deleted","Title,CRMCompanyLookup"));

    await r("IX_Division_Tenant", idx("IX_Division_Tenant","CompanyDivisions","TenantID,Deleted","Title,ShortName,BusinessUnitIdLookup"));
    await r("IX_Dept_Tenant",     idx("IX_Dept_Tenant","Department","TenantID,Deleted","Title,DivisionIDLookup"));
    await r("IX_Roles_Tenant",    idx("IX_Roles_Tenant","Roles","TenantID","Name,BillingRate"));
    await r("IX_BU_Tenant",       idx("IX_BU_Tenant","BusinessUnit","TenantID","Title"));

    await r("IX_Opp_Tenant",  idx("IX_Opp_Tenant", "Opportunity","TenantID,Deleted",                            "TicketId,Title"));
    await r("IX_Opp_Ticket",  idx("IX_Opp_Ticket", "Opportunity","TenantID,TicketId,Deleted"));
    await r("IX_Opp_Status",  idx("IX_Opp_Status", "Opportunity","TenantID,CRMOpportunityStatusChoice,Deleted", "TicketId,Title"));
    await r("IX_Opp_Sector",  idx("IX_Opp_Sector", "Opportunity","TenantID,SectorChoice,Deleted",               "TicketId,Title"));

    await r("REBUILD PK_PMM",        `ALTER INDEX PK_PMM ON core2.dbo.PMM REBUILD WITH(SORT_IN_TEMPDB=ON)`);
    await r("REBUILD PK_AspNetUsers",`ALTER INDEX PK_AspNetUsers ON core2.dbo.AspNetUsers REBUILD WITH(SORT_IN_TEMPDB=ON)`);
    await r("REBUILD PK_CRMCompany", `ALTER INDEX PK_CRMCompany ON core2.dbo.CRMCompany REBUILD WITH(SORT_IN_TEMPDB=ON)`);

    await r("Drop stats proc",   `USE core2; IF OBJECT_ID('dbo.sp_rmone_updatestats','P') IS NOT NULL DROP PROCEDURE dbo.sp_rmone_updatestats`);
    await r("Create stats proc", `USE core2; EXEC('CREATE PROCEDURE dbo.sp_rmone_updatestats WITH EXECUTE AS OWNER AS BEGIN UPDATE STATISTICS dbo.PMM; UPDATE STATISTICS dbo.Opportunity; UPDATE STATISTICS dbo.AspNetUsers; UPDATE STATISTICS dbo.ResourceWorkItems; UPDATE STATISTICS dbo.ResourceAllocation; UPDATE STATISTICS dbo.CompanyDivisions; UPDATE STATISTICS dbo.Department; UPDATE STATISTICS dbo.BusinessUnit; UPDATE STATISTICS dbo.Roles; UPDATE STATISTICS dbo.CRMCompany; UPDATE STATISTICS dbo.CRMContact; UPDATE STATISTICS dbo.Lead; END')`);
    await r("Run statistics now", `USE core2; EXEC dbo.sp_rmone_updatestats`, 180_000);

    _dbOptState.running = false; _dbOptState.done = true;
    const warns = _dbOptState.results.filter(x => x.status !== "ok").length;
    console.log(`[db-opt] ✅ complete. ${_dbOptState.results.length} steps, ${warns} non-ok.`);
  })().catch(e => { _dbOptState.running = false; console.error("[db-opt] Fatal:", e.message); });
});

router.get("/admin/db-optimize-status", (_req, res) => {
  res.json(_dbOptState);
});

// Diagnostic: what sessions are currently blocking CREATE INDEX / holding Sch-S
router.get("/admin/db-blocking", async (_req, res) => {
  try {
    const pool = await getPool();
    const result = await pool.request().query(`
      SELECT
        r.session_id,
        r.blocking_session_id,
        r.wait_type,
        r.wait_time / 1000 AS wait_sec,
        r.status,
        LEFT(r.command, 60)  AS command,
        LEFT(st.text, 200)   AS sql_text
      FROM   core2.sys.dm_exec_requests AS r
      CROSS APPLY core2.sys.dm_exec_sql_text(r.sql_handle) AS st
      WHERE  r.database_id = DB_ID('core2')
      ORDER  BY r.wait_time DESC;
    `);
    res.json({ rows: result.recordset });
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});
// ── END TEMPORARY ─────────────────────────────────────────────────────────────

export default router;
