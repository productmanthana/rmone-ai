/**
 * One-off data fix for task: stacked lump rows on PMM-25-000194.
 * Rows 19713710 (15h) and 19713711 (35h) were stacked by the old Step 1b
 * ≤30-day bug; 19713712 (62h) is the correct latest total. Zero the two
 * stale rows so the member's total reads 62h again.
 *
 * Usage:
 *   tsx scripts/fix-stacked-lump-rows.local.ts          # dry run (SELECT only)
 *   tsx scripts/fix-stacked-lump-rows.local.ts --apply  # zero the stale rows
 */
import { getPool, sql } from "../src/lib/db.js";

const TENANT = "5c03084c-7413-5a56-9fa2-bc401f8a5650";
const STALE_IDS = [19713710, 19713711];
const KEEP_ID = 19713712;
const RWI = 271923;
const apply = process.argv.includes("--apply");

const pool = await getPool();

async function show(label: string) {
  const res = await pool.request()
    .input("tid", sql.VarChar, TENANT)
    .input("rwi", sql.BigInt, RWI)
    .query(`
      SELECT ID, ResourceWorkItemLookup, CAST(AllocationHour AS FLOAT) AS Hour,
             CAST(PctAllocation AS FLOAT) AS Pct, AllocationStartDate, AllocationEndDate,
             Deleted, ModifiedByUser
      FROM core2.dbo.ResourceAllocation
      WHERE TenantID = @tid AND ResourceWorkItemLookup = @rwi
      ORDER BY ID
    `);
  console.log(`── ${label} ──`);
  let active = 0;
  for (const r of res.recordset) {
    if (!r.Deleted && (r.Hour ?? 0) > 0) active += Number(r.Hour);
    console.log(`  raId=${r.ID} hour=${r.Hour} pct=${r.Pct} ${r.AllocationStartDate?.toISOString?.()?.slice(0, 10)}..${r.AllocationEndDate?.toISOString?.()?.slice(0, 10)} deleted=${r.Deleted} modBy=${r.ModifiedByUser}`);
  }
  console.log(`  active total = ${active}h`);
  return res.recordset;
}

const before = await show("before");
const stale = before.filter((r) => STALE_IDS.includes(Number(r.ID)) && !r.Deleted && (Number(r.Hour) || 0) > 0);
const keep = before.find((r) => Number(r.ID) === KEEP_ID);
console.log(`stale rows still holding hours: ${stale.length}; keep row 19713712 hour=${keep ? keep.Hour : "MISSING"}`);

if (!apply) {
  console.log("dry run — pass --apply to zero the stale rows");
  process.exit(0);
}
if (stale.length === 0) {
  console.log("nothing to fix — stale rows already zeroed");
  process.exit(0);
}
if (!keep || Number(keep.Hour) !== 62 || keep.Deleted) {
  console.error("SAFETY ABORT: keep-row 19713712 is not the active 62h row — refusing to zero anything");
  process.exit(1);
}

const upd = await pool.request()
  .input("tid", sql.VarChar, TENANT)
  .input("a", sql.BigInt, STALE_IDS[0])
  .input("b", sql.BigInt, STALE_IDS[1])
  .input("mod", sql.DateTime, new Date())
  .query(`
    UPDATE core2.dbo.ResourceAllocation
    SET AllocationHour = 0, PctAllocation = 0, Modified = @mod,
        ModifiedByUser = 'agent-fix-stacked-lump-rows'
    WHERE TenantID = @tid AND ID IN (@a, @b)
      AND (Deleted = 0 OR Deleted IS NULL)
  `);
console.log(`zeroed rowsAffected=${upd.rowsAffected?.[0]}`);
await show("after");
process.exit(0);
