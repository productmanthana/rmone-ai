/**
 * One-off repair: fix stale Jobtitle.DepartmentId links left over from older
 * imports that used first-occurrence-wins linking (including "Unassigned"
 * fillers). For each tenant:
 *
 *   1. Collect every Jobtitle with a DepartmentId set.
 *   2. Look at per-user DepartmentLookup values for people holding that title.
 *   3. If the JT's link points at an "Unassigned"-titled dept, void it (NULL).
 *   4. If the JT's link conflicts with the majority of per-user dept links,
 *      re-link to the majority or void if there is no clear majority.
 *   5. If the JT has NO link but there is a unanimous per-user dept, optionally
 *      seed it (--seed-missing flag required, off by default).
 *
 * Usage:
 *   pnpm --filter @workspace/api-server exec tsx scripts/repair-jobtitle-dept-links.local.ts
 *   pnpm --filter @workspace/api-server exec tsx scripts/repair-jobtitle-dept-links.local.ts --apply
 *   pnpm --filter @workspace/api-server exec tsx scripts/repair-jobtitle-dept-links.local.ts --apply --tenant=mycompany
 *   pnpm --filter @workspace/api-server exec tsx scripts/repair-jobtitle-dept-links.local.ts --apply --seed-missing
 */
import sql from "mssql";
import { getPool } from "../src/lib/db.js";
import { tableColumns, ensureJobtitleDeptColumn } from "../src/lib/rds-provider.js";

const APPLY       = process.argv.includes("--apply");
const SEED_MISSING = process.argv.includes("--seed-missing");
const TENANT_FILTER = process.argv.find((a) => a.startsWith("--tenant="))?.slice(9) ?? null;
const DB = "core2";

// Any department whose title (lowercased) matches this is treated as a filler
// placeholder and must never pin a job title.
const UNASSIGNED_RE = /unassign/i;

const pool = await getPool();

// Ensure the DepartmentId column exists on every tenant's Jobtitle table
// before we try to read/write it.
await ensureJobtitleDeptColumn();

// ── Discover all tenants that have at least one Jobtitle row ──────────────
const jtCols   = await tableColumns("Jobtitle");
const uCols    = await tableColumns("AspNetUsers");
const deptCols = await tableColumns("Department");

if (!jtCols.has("TenantID") || !jtCols.has("ID") || !jtCols.has("Title")) {
  console.error("Jobtitle table missing expected columns — aborting.");
  process.exit(1);
}

const hasDeptId   = jtCols.has("DepartmentId");
const hasUserDept = uCols.has("DepartmentLookup") || uCols.has("DepartmentIDLookup");
const hasUserJtLookup = uCols.has("JobTitleLookup");
const hasDeptTitle = deptCols.has("Title") && deptCols.has("ID");

console.log(`Jobtitle.DepartmentId column present: ${hasDeptId}`);
console.log(`AspNetUsers has per-user dept column: ${hasUserDept}`);
console.log(`AspNetUsers has JobTitleLookup:        ${hasUserJtLookup}`);
console.log(`Department has Title+ID columns:       ${hasDeptTitle}`);
if (!hasDeptId) { console.error("No DepartmentId column — nothing to repair."); process.exit(0); }

const userDeptCol = uCols.has("DepartmentLookup") ? "DepartmentLookup" : "DepartmentIDLookup";
const jtDelGuard  = jtCols.has("Deleted")   ? " AND (jt.Deleted = 0   OR jt.Deleted   IS NULL)" : "";
const uDelGuard   = uCols.has("Deleted")    ? " AND (u.Deleted  = 0   OR u.Deleted    IS NULL)" : "";
const dDelGuard   = deptCols.has("Deleted") ? " AND (dep.Deleted = 0  OR dep.Deleted  IS NULL)" : "";
const jtTenGuard  = jtCols.has("TenantID")  ? " AND jt.TenantID = @tid"  : "";
const uTenGuard   = uCols.has("TenantID")   ? " AND u.TenantID  = @tid"  : "";
const dTenGuard   = deptCols.has("TenantID")? " AND dep.TenantID = @tid" : "";

const tenantsRes = await pool.request().query(
  `SELECT DISTINCT TenantID FROM ${DB}.dbo.Jobtitle WHERE TenantID IS NOT NULL AND TenantID <> ''`
);
const allTenants = (tenantsRes.recordset as { TenantID: string }[])
  .map((r) => r.TenantID.trim())
  .filter(Boolean)
  .filter((t) => !TENANT_FILTER || t === TENANT_FILTER);

console.log(`\nFound ${allTenants.length} tenant(s) to inspect${TENANT_FILTER ? ` (filtered to "${TENANT_FILTER}")` : ""}.`);
if (!APPLY) console.log("DRY RUN — pass --apply to write changes.\n");

let grandTotal = 0;

for (const tid of allTenants) {
  const req = () => pool.request().input("tid", sql.NVarChar, tid);

  // ── 1. Load all Jobtitle rows for this tenant ──────────────────────────
  const jtRows = (await req().query(`
    SELECT jt.ID, jt.Title,
           CAST(jt.DepartmentId AS NVARCHAR(50)) AS DepartmentId
    FROM ${DB}.dbo.Jobtitle jt
    WHERE jt.TenantID = @tid${jtDelGuard}
  `)).recordset as { ID: number | string; Title: string; DepartmentId: string | null }[];

  if (jtRows.length === 0) continue;

  // ── 2. Load Department table (id → title) for filler detection ─────────
  const deptMap = new Map<string, string>(); // deptId.lc → title
  if (hasDeptTitle) {
    const deptRows = (await req().query(`
      SELECT CAST(dep.ID AS NVARCHAR(50)) AS ID, dep.Title
      FROM ${DB}.dbo.Department dep
      WHERE dep.TenantID = @tid${dDelGuard}
    `)).recordset as { ID: string; Title: string }[];
    for (const d of deptRows) {
      if (d.ID && d.Title) deptMap.set(String(d.ID).trim().toLowerCase(), d.Title.trim());
    }
  }

  // ── 3. Load per-user dept links for this tenant ─────────────────────────
  // Map: jtId.lc → array of per-user deptId.lc (non-empty)
  const userDeptsByJt = new Map<string, string[]>();
  if (hasUserDept && hasUserJtLookup) {
    const userRows = (await req().query(`
      SELECT CAST(u.JobTitleLookup    AS NVARCHAR(50)) AS JobTitleLookup,
             CAST(u.[${userDeptCol}] AS NVARCHAR(50)) AS DeptLookup
      FROM ${DB}.dbo.AspNetUsers u
      WHERE u.TenantID = @tid${uDelGuard}
        AND u.JobTitleLookup IS NOT NULL AND u.JobTitleLookup <> ''
    `)).recordset as { JobTitleLookup: string; DeptLookup: string | null }[];
    for (const u of userRows) {
      const jtIdLc = String(u.JobTitleLookup ?? "").trim().toLowerCase();
      const dptLc  = String(u.DeptLookup    ?? "").trim().toLowerCase();
      if (!jtIdLc) continue;
      if (!userDeptsByJt.has(jtIdLc)) userDeptsByJt.set(jtIdLc, []);
      if (dptLc) userDeptsByJt.get(jtIdLc)!.push(dptLc);
    }
  }

  // ── 4. Decide repairs ───────────────────────────────────────────────────
  const changes: { id: number | string; title: string; oldDeptId: string | null; newDeptId: string | null; reason: string }[] = [];

  for (const jt of jtRows) {
    const jtId      = String(jt.ID).trim();
    const jtIdLc    = jtId.toLowerCase();
    const curDeptId = jt.DepartmentId ? String(jt.DepartmentId).trim().toLowerCase() : null;
    const userDepts = userDeptsByJt.get(jtIdLc) ?? [];

    // Tally per-user dept votes (only users WITH a dept link vote)
    const votes = new Map<string, number>();
    for (const d of userDepts) { votes.set(d, (votes.get(d) ?? 0) + 1); }
    const totalVoters = userDepts.length;

    // Find the majority dept (>50% of voters)
    let majorityDeptId: string | null = null;
    for (const [d, cnt] of votes) {
      if (cnt > totalVoters / 2) { majorityDeptId = d; break; }
    }

    // --- Decision ---

    // A. Current link points at an "Unassigned" filler → always void
    const curDeptTitle = curDeptId ? (deptMap.get(curDeptId) ?? "") : "";
    const isFiller = curDeptId != null && UNASSIGNED_RE.test(curDeptTitle);
    if (isFiller) {
      changes.push({ id: jt.ID, title: jt.Title, oldDeptId: curDeptId, newDeptId: null,
        reason: `points at filler dept "${curDeptTitle}"` });
      continue;
    }

    if (curDeptId != null) {
      // B. Current link differs from the majority → re-link or void
      if (majorityDeptId && majorityDeptId !== curDeptId) {
        const majTitle = deptMap.get(majorityDeptId) ?? majorityDeptId;
        changes.push({ id: jt.ID, title: jt.Title, oldDeptId: curDeptId, newDeptId: majorityDeptId,
          reason: `conflicts with majority dept "${majTitle}" (${votes.get(majorityDeptId)}/${totalVoters} users)` });
      } else if (!majorityDeptId && votes.size > 1 && curDeptId) {
        // No majority (split across ≥2 depts) → honest blank
        const voteStr = [...votes.entries()].map(([d, n]) => `${deptMap.get(d) ?? d}×${n}`).join(", ");
        changes.push({ id: jt.ID, title: jt.Title, oldDeptId: curDeptId, newDeptId: null,
          reason: `split across multiple depts (${voteStr}) — no majority` });
      }
      // If curDeptId matches majority or no voters → leave alone (correct or unknowable)
    } else if (SEED_MISSING && majorityDeptId && votes.size === 1) {
      // C. No current link + unanimous per-user dept → optionally seed
      const majTitle = deptMap.get(majorityDeptId) ?? majorityDeptId;
      changes.push({ id: jt.ID, title: jt.Title, oldDeptId: null, newDeptId: majorityDeptId,
        reason: `seeding unanimous dept "${majTitle}" (${totalVoters} users, --seed-missing)` });
    }
  }

  if (changes.length === 0) {
    console.log(`  ${tid}: no repairs needed (${jtRows.length} job titles checked)`);
    continue;
  }

  console.log(`\n  ${tid}: ${changes.length} job title(s) to repair:`);
  for (const c of changes) {
    const oldName = c.oldDeptId ? (deptMap.get(c.oldDeptId) ?? c.oldDeptId) : "NULL";
    const newName = c.newDeptId ? (deptMap.get(c.newDeptId) ?? c.newDeptId) : "NULL";
    console.log(`    [${c.id}] "${c.title}": ${oldName} → ${newName}  (${c.reason})`);
  }

  if (!APPLY) continue;

  // ── 5. Apply changes ────────────────────────────────────────────────────
  let applied = 0;
  for (const c of changes) {
    try {
      const idNum = typeof c.id === "number" ? c.id : Number(c.id);
      if (c.newDeptId) {
        await pool.request()
          .input("tid",    sql.NVarChar, tid)
          .input("id",     sql.BigInt,   idNum)
          .input("deptId", sql.BigInt,   Number(c.newDeptId))
          .query(`UPDATE ${DB}.dbo.Jobtitle SET DepartmentId=@deptId WHERE TenantID=@tid AND ID=@id`);
      } else {
        await pool.request()
          .input("tid", sql.NVarChar, tid)
          .input("id",  sql.BigInt,   idNum)
          .query(`UPDATE ${DB}.dbo.Jobtitle SET DepartmentId=NULL WHERE TenantID=@tid AND ID=@id`);
      }
      applied++;
    } catch (e) {
      console.error(`    ERROR updating [${c.id}] "${c.title}": ${e instanceof Error ? e.message : String(e)}`);
    }
  }
  console.log(`    Applied ${applied}/${changes.length} updates for tenant ${tid}.`);
  grandTotal += applied;
}

console.log(`\nDone. Grand total rows changed: ${grandTotal}${APPLY ? "" : " (dry run)"}`);
process.exit(0);
