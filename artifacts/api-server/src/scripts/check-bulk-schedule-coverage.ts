import { v5 as uuidv5 } from "uuid";
import { getPool } from "../lib/db.js";

const TENANT_NAMESPACE = "5d8f1e6a-2c3b-4d7e-9a1f-0b2c3d4e5f6a";

async function main() {
  const candidates = ["liro_poc", "liro poc", "lirop", "liro-poc", "liropoc", "lirodemo", "liro"];
  const known = "5c03084c-7413-5a56-9fa2-bc401f8a5650";
  console.log("── label → tid candidates ──");
  for (const label of candidates) {
    const t = uuidv5(label, TENANT_NAMESPACE);
    console.log(`  ${label.padEnd(10)} → ${t}${t === known ? "   <== matches known busy tenant" : ""}`);
  }

  const pool = await getPool();

  // Which candidate tids actually have PMMTasks rows?
  console.log("\n── PMMTasks counts per candidate tid ──");
  let tid = "";
  for (const label of candidates) {
    const t = uuidv5(label, TENANT_NAMESPACE);
    const r = await pool.request().input("tid", t).query(
      `SELECT COUNT(*) AS n FROM core2.dbo.PMMTasks WITH (NOLOCK) WHERE TenantID = @tid`);
    const n = r.recordset[0].n;
    if (n > 0) { console.log(`  ${label}: ${n} rows  (tid ${t})`); if (!tid) tid = t; }
  }
  if (!tid) {
    // fall back: list tenants that have PMMTasks at all
    const r = await pool.request().query(
      `SELECT TOP 15 TenantID, COUNT(*) AS n FROM core2.dbo.PMMTasks WITH (NOLOCK)
       GROUP BY TenantID ORDER BY n DESC`);
    console.log("  none matched; top tenants by PMMTasks rows:");
    for (const row of r.recordset) console.log(`    ${row.TenantID}: ${row.n}`);
    tid = known;
    console.log(`  → using known tenant ${tid}`);
  }

  console.log(`\n── coverage check for tid ${tid} ──`);
  const q = async (label: string, sqlText: string) => {
    const r = await pool.request().input("tid", tid).query(sqlText);
    console.log(`  ${label}: ${JSON.stringify(r.recordset[0] ?? r.recordset)}`);
    return r.recordset;
  };

  await q("A. total PMMTasks rows (any)", `
    SELECT COUNT(*) AS n, COUNT(DISTINCT TicketId) AS tickets
    FROM core2.dbo.PMMTasks WITH (NOLOCK) WHERE TenantID = @tid`);

  await q("B. non-deleted PMMTasks rows", `
    SELECT COUNT(*) AS n, COUNT(DISTINCT TicketId) AS tickets
    FROM core2.dbo.PMMTasks t WITH (NOLOCK)
    WHERE t.TenantID = @tid AND (t.Deleted = 0 OR t.Deleted IS NULL)`);

  await q("C. rows RETURNED by /bulk-schedule query", `
    SELECT COUNT(*) AS n, COUNT(DISTINCT t.TicketId) AS tickets
    FROM core2.dbo.PMMTasks t WITH (NOLOCK)
    LEFT JOIN core2.dbo.PMM pmm WITH (NOLOCK) ON pmm.TicketId = t.TicketId AND pmm.TenantID = @tid
    LEFT JOIN core2.dbo.Opportunity opp WITH (NOLOCK) ON opp.TicketId = t.TicketId AND opp.TenantID = @tid
    WHERE t.TenantID = @tid AND (t.Deleted = 0 OR t.Deleted IS NULL)
      AND COALESCE(pmm.Title, opp.Title) IS NOT NULL`);

  const dropped = await pool.request().input("tid", tid).query(`
    SELECT TOP 20 t.TicketId, COUNT(*) AS phases
    FROM core2.dbo.PMMTasks t WITH (NOLOCK)
    LEFT JOIN core2.dbo.PMM pmm WITH (NOLOCK) ON pmm.TicketId = t.TicketId AND pmm.TenantID = @tid
    LEFT JOIN core2.dbo.Opportunity opp WITH (NOLOCK) ON opp.TicketId = t.TicketId AND opp.TenantID = @tid
    WHERE t.TenantID = @tid AND (t.Deleted = 0 OR t.Deleted IS NULL)
      AND COALESCE(pmm.Title, opp.Title) IS NULL
    GROUP BY t.TicketId ORDER BY phases DESC`);
  console.log(`  D. DROPPED tickets (no matching PMM/Opp title): ${dropped.recordset.length ? "" : "none"}`);
  for (const row of dropped.recordset) console.log(`     ${row.TicketId}: ${row.phases} phases`);

  // Are any dropped tickets actually Leads or deleted projects?
  if (dropped.recordset.length) {
    const ids = dropped.recordset.map((r: Record<string, unknown>) => `'${String(r.TicketId).replace(/'/g, "''")}'`).join(",");
    const cls = await pool.request().input("tid", tid).query(`
      SELECT t.TicketId,
        (SELECT COUNT(*) FROM core2.dbo.PMM p WITH (NOLOCK) WHERE p.TicketId = t.TicketId AND p.TenantID = @tid AND p.Deleted = 1) AS deletedPmm,
        (SELECT COUNT(*) FROM core2.dbo.Opportunity o WITH (NOLOCK) WHERE o.TicketId = t.TicketId AND o.TenantID = @tid AND o.Deleted = 1) AS deletedOpp,
        (SELECT COUNT(*) FROM core2.dbo.Lead l WITH (NOLOCK) WHERE l.TicketId = t.TicketId AND l.TenantID = @tid) AS leads
      FROM (SELECT DISTINCT TicketId FROM core2.dbo.PMMTasks WITH (NOLOCK)
            WHERE TenantID = @tid AND TicketId IN (${ids})) t`);
    console.log("  E. classification of dropped tickets:");
    for (const row of cls.recordset) console.log(`     ${row.TicketId}: deletedPMM=${row.deletedPmm} deletedOpp=${row.deletedOpp} lead=${row.leads}`);
  }

  // How many projects have NO schedule at all (these show "No Phase" tan — correct)
  await q("F. live PMM projects WITHOUT any schedule rows", `
    SELECT COUNT(*) AS n FROM core2.dbo.PMM p WITH (NOLOCK)
    WHERE p.TenantID = @tid AND (p.Deleted = 0 OR p.Deleted IS NULL)
      AND NOT EXISTS (SELECT 1 FROM core2.dbo.PMMTasks t WITH (NOLOCK)
                      WHERE t.TicketId = p.TicketId AND t.TenantID = @tid
                        AND (t.Deleted = 0 OR t.Deleted IS NULL))`);

  await q("G. live PMM projects total", `
    SELECT COUNT(*) AS n FROM core2.dbo.PMM p WITH (NOLOCK)
    WHERE p.TenantID = @tid AND (p.Deleted = 0 OR p.Deleted IS NULL)`);

  process.exit(0);
}

main().catch((e) => { console.error(e); process.exit(1); });
