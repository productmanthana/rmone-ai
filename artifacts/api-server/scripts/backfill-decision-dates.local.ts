/* backfill-decision-dates.local.ts — Task #556
 * ─────────────────────────────────────────────────────────────────────────────
 * For every opportunity that is won/lost but has no AwardedorLossDate recorded,
 * set AwardedorLossDate = COALESCE(Created, GETUTCDATE()) so the Reports
 * "decided this period" counts become meaningful for historical data.
 *
 * WON patterns  : "Awarded", "Won", "Win", "Closed – Won", etc.
 * LOST patterns : "Lost", "Cancelled", "Canceled", "Declined", "Dead",
 *                 "No Bid", "No-Bid", "Withdrawn", "Converted" (lead flow)
 *
 * Safe: only rows where AwardedorLossDate IS NULL AND Deleted = 0 are touched.
 * NEVER overwrites an existing date.
 *
 * Usage:
 *   cd artifacts/api-server
 *   npx tsx scripts/backfill-decision-dates.local.ts             # dry run
 *   npx tsx scripts/backfill-decision-dates.local.ts --apply     # write
 *   npx tsx scripts/backfill-decision-dates.local.ts --apply --tenant test21
 */
import { getMssqlPool } from "@workspace/db";
import sql from "mssql";

const DRY_RUN = !process.argv.includes("--apply");
const TENANT = (() => {
  const idx = process.argv.indexOf("--tenant");
  return idx >= 0 ? process.argv[idx + 1] : null;
})();

/* Won / lost classifiers — mirrors rds-provider.ts side-effects */
const WON_RE  = /award|won|win/i;
const LOST_RE = /\blost\b|cancel|declined|dead|no[ -]?bid|withdraw|convert|archiv/i;

function classify(status: string): "won" | "lost" | "other" {
  if (WON_RE.test(status))  return "won";
  if (LOST_RE.test(status)) return "lost";
  return "other";
}

async function main() {
  console.log(`[backfill-decision-dates] mode=${DRY_RUN ? "DRY RUN" : "APPLY"}  tenant=${TENANT ?? "ALL"}`);
  const pool = await getMssqlPool();

  /* 1 — Identify rows to backfill */
  const req = pool.request();
  let tenantClause = "";
  if (TENANT) {
    req.input("tenant", sql.NVarChar, TENANT);
    tenantClause = "AND [TenantID] = @tenant";
  }

  const { recordset } = await req.query<{
    TenantID: string; TicketId: string;
    Status: string | null; Created: Date | null;
  }>(`
    SELECT [TenantID], [TicketId],
           COALESCE([CRMOpportunityStatusChoice],[StatusChoice],[Status]) AS [Status],
           COALESCE([Created],[CreationDate]) AS [Created]
    FROM core2.dbo.Opportunity
    WHERE ([AwardedorLossDate] IS NULL)
      AND (Deleted = 0 OR Deleted IS NULL)
      ${tenantClause}
    ORDER BY [TenantID], [TicketId]
  `);

  const rows = recordset.filter(r => classify(r.Status ?? "") !== "other");
  const won  = rows.filter(r => classify(r.Status ?? "") === "won");
  const lost = rows.filter(r => classify(r.Status ?? "") === "lost");

  console.log(`\nFound ${rows.length} rows to backfill  (${won.length} won, ${lost.length} lost)`);
  console.log(`Rows that are not won/lost: ${recordset.length - rows.length} (skipped)\n`);

  if (rows.length === 0) { console.log("Nothing to do."); return; }

  /* 2 — Preview first 20 */
  for (const r of rows.slice(0, 20)) {
    const cl = classify(r.Status ?? "");
    const dateStr = r.Created ? r.Created.toISOString().slice(0, 10) : "(using GETUTCDATE())";
    console.log(`  [${cl.toUpperCase()}] ${r.TenantID}  ${r.TicketId}  status="${r.Status}"  backfillDate=${dateStr}`);
  }
  if (rows.length > 20) console.log(`  ... and ${rows.length - 20} more`);

  if (DRY_RUN) {
    console.log("\n[DRY RUN] No changes written. Re-run with --apply to commit.");
    return;
  }

  /* 3 — Apply in batches of 200 */
  let updated = 0;
  const BATCH = 200;
  for (let i = 0; i < rows.length; i += BATCH) {
    const slice = rows.slice(i, i + BATCH);
    for (const r of slice) {
      const backfillDate = r.Created ?? new Date();
      await pool.request()
        .input("tid",  sql.NVarChar, r.TenantID)
        .input("tid2", sql.VarChar,  r.TicketId)
        .input("dt",   sql.DateTime, backfillDate)
        .query(`
          UPDATE core2.dbo.Opportunity
          SET [AwardedorLossDate] = @dt
          WHERE [TenantID] = @tid
            AND [TicketId] = @tid2
            AND ([AwardedorLossDate] IS NULL)
            AND (Deleted = 0 OR Deleted IS NULL)
        `);
      updated++;
    }
    console.log(`  batch ${Math.floor(i / BATCH) + 1}: ${Math.min(i + BATCH, rows.length)}/${rows.length}`);
  }

  console.log(`\n[backfill-decision-dates] Done. ${updated} rows updated.`);
}

main().catch(e => { console.error("FAIL:", e?.message || e); process.exit(1); });
