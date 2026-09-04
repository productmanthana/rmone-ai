/** One-off repair: migrate stranded OPM default-lifecycle templates to the tenant's CURRENT default. */
import sql from "mssql";
import { getPool } from "../src/lib/db.js";
import { resolveTenantId } from "../src/lib/pipeline.js";
import { loadEffectiveDefaults } from "../src/lib/onboarding-settings-store.js";
import { isOutcomeStageName } from "../src/lib/stage-rules.js";
import { reconcileDefaultLifecyclesBySigRds, getTaskDataRds } from "../src/lib/rds-provider.js";

const DB = process.env.CLIENT_DB_NAME ?? "core2";
const APPLY = process.argv.includes("--apply");

// Signatures read from the live DB by probe-opp-default-templates.local.ts.
// Any template whose CURRENT ordered stages equal one of these is an old
// generation of the tenant default; templates already on the current default
// are auto-excluded by the reconcile function.
const TENANTS: { label: string; prevVariants: string[][] }[] = [
  {
    label: "test20",
    prevVariants: [
      ["Pending Assignment","Proposal Development","Contract Negotiations"],
      ["Pending Assignment","Proposal Development","Contract Negotiations","On Hold"],
      ["Pending Assignment","Proposal Development","Contract Negotiations","On Hold","New Opportinity","Qualification","Proposal Submitted"],
      ["Pending Assignment","Proposal Development","Contract Negotiations","On Hold","New Opportinity","Qualification","Proposal Submitted","Pending Opportunity"],
      ["Pending Assignment","Proposal Development","Contract Negotiations","On Hold","New Opportinity","Qualification","Proposal Submitted","Pending Opportunity","Management Approval"],
      ["Pending Assignment","Proposal Development","Contract Negotiations","On Hold","New Opportinity","Qualification","Proposal Submitted","Pending Opportunity","Management Approval","Requirement Analysis","Prospect Identified"],
      ["Pending Assignment","Proposal Development","Contract Negotiations","On Hold","New Opportinity","Qualification","Proposal Submitted","Pending Opportunity","Management Approval","Requirement Analysis","Prospect Identified","Performance Calculated"],
      ["Pending Assignment","Proposal Development","Contract Negotiations","On Hold","New Opportinity","Qualification","Proposal Submitted","Pending Opportunity","Management Approval","Requirement Analysis","Prospect Identified","Performance Calculated","Assigned Opportunity"],
    ],
  },
  {
    label: "test21",
    prevVariants: [
      ["Pending Assignment","Proposal Development","Contract Negotiations"],
      ["Pending Assignment","Proposal Development","Contract Negotiations","Awarded"],
      ["Pending Assignment","Proposal Development","Contract Negotiations","Awarded","setasf"],
    ],
  },
];

const pool = await getPool();
for (const t of TENANTS) {
  const tid = resolveTenantId(t.label);
  const eff = await loadEffectiveDefaults(t.label);
  const raw = String(eff.defaultOpportunityStages ?? "").split(",").map((s) => s.trim()).filter(Boolean);
  const newList = raw.filter((s) => !isOutcomeStageName(s));
  console.log(`\n=== ${t.label} (${tid})`);
  console.log(`  saved default:   [${raw.join(" | ")}]`);
  console.log(`  target schedule: [${newList.join(" | ")}]`);
  if (newList.length === 0) { console.log("  EMPTY target — skipping (never wipe)"); continue; }
  if (!APPLY) { console.log("  DRY RUN — pass --apply to write"); continue; }
  const res = await reconcileDefaultLifecyclesBySigRds(tid, t.prevVariants, newList, "OPM");
  console.log(`  reconciled: updated=${res.updated} templates=[${res.templateIds.join(",")}]`);
  if (res.updated > 0) {
    const ids = res.templateIds.map((n) => Number(n)).filter(Boolean).join(",");
    const smp = await pool.request().input("tid", sql.NVarChar, tid).query(
      `SELECT TOP 3 [TicketId] tk FROM ${DB}.dbo.Opportunity
       WHERE [TenantID]=@tid AND [ProjectLifeCycleLookup] IN (${ids}) AND ([Deleted]=0 OR [Deleted] IS NULL)
       ORDER BY [ID] DESC`);
    for (const r of smp.recordset as any[]) {
      const tk = String(r.tk ?? "").trim();
      if (!tk) continue;
      const td = await getTaskDataRds(tid, tk);
      const titles = (td as any[]).map((x) => String(x?.Title ?? x?.TaskName ?? "")).filter(Boolean);
      console.log(`  verify ${tk}: schedule now = [${titles.join(" | ")}]`);
    }
  }
}
process.exit(0);
