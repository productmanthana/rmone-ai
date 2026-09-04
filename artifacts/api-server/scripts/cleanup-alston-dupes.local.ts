/**
 * One-time cleanup: remove duplicate staff rows left by repeated Alston AI uploads.
 *
 * Root cause — why re-uploads minted new GUIDs:
 *   insertUsersBatch matches existing app-DB rows ONLY by username (email/login,
 *   lowercased) and then by the row's GUID.  When the earlier upload used a
 *   different UserName spelling than the later upload (e.g. first-name-only vs
 *   full email address), the second pass finds no match by either key and treats
 *   the person as brand-new, minting a fresh uuidv4().  Two uploads → two
 *   rmone_users rows → two user GUIDs → the staff grid shows every person twice.
 *
 * Fix strategy (per person with more than one non-deleted rmone_users row):
 *   • Keep the "Cold Storage" row (newer upload, real city departments).
 *   • Stale row has RA or RWI history  → deactivate (enabled=0, deleted stays 0),
 *     so project history stays intact.
 *   • Stale row has NO history         → soft-delete (enabled=0, deleted=1).
 *   • Mirror every change to core2.dbo.AspNetUsers for legacy read paths.
 * After users are cleaned:
 *   • Prune the "Unassigned" department if no non-deleted user still references it.
 *   • Prune the "CS" division          if no non-deleted user still references it.
 *
 * Run:
 *   # dry-run (default):
 *   pnpm --filter @workspace/api-server exec tsx scripts/cleanup-alston-dupes.local.ts
 *   # commit:
 *   pnpm --filter @workspace/api-server exec tsx scripts/cleanup-alston-dupes.local.ts --apply
 */

import sql from "mssql";
import { getMssqlPool, getUsersByTenant, updateUser } from "@workspace/db";

const TID     = "22897300-acd1-5876-bfba-ae8b794cedd0";
const DRY_RUN = !process.argv.includes("--apply");

if (DRY_RUN) console.log("=== DRY RUN — pass --apply to commit changes ===\n");

// ── helpers ────────────────────────────────────────────────────────────────────

type Pool = Awaited<ReturnType<typeof getMssqlPool>>;
// Alias for readability — sql is the mssql driver, pool is the app-DB connection.
const { NVarChar, Bit } = sql;

async function hasHistory(pool: Pool, tid: string, userId: string): Promise<boolean> {
  const r = pool.request();
  r.input("tid", NVarChar, tid);
  r.input("id",  NVarChar, userId);
  // core2 is on the same SQL Server instance as the app DB — cross-DB refs work.
  const res = await r.query(`
    SELECT TOP 1 1 AS x
    FROM core2.dbo.ResourceAllocation WHERE TenantID=@tid AND ResourceUser=@id
    UNION ALL
    SELECT TOP 1 1
    FROM core2.dbo.ResourceWorkItems  WHERE TenantID=@tid AND ResourceUser=@id`);
  return (res.recordset?.length ?? 0) > 0;
}

async function deactivate(pool: Pool, tid: string, userId: string, dryRun: boolean): Promise<void> {
  console.log(`    [deactivate] ${userId}`);
  if (dryRun) return;
  await updateUser(tid, userId, { enabled: false });
  try {
    const r = pool.request();
    r.input("tid", NVarChar, tid);
    r.input("id",  NVarChar, userId);
    await r.query(`UPDATE core2.dbo.AspNetUsers SET Enabled=0 WHERE Id=@id AND TenantID=@tid`);
  } catch { /* legacy mirror best-effort */ }
}

async function softDelete(pool: Pool, tid: string, userId: string, dryRun: boolean): Promise<void> {
  console.log(`    [soft-delete] ${userId}`);
  if (dryRun) return;
  await updateUser(tid, userId, { enabled: false, deleted: true });
  try {
    const r = pool.request();
    r.input("tid", NVarChar, tid);
    r.input("id",  NVarChar, userId);
    await r.query(`UPDATE core2.dbo.AspNetUsers SET Enabled=0, Deleted=1 WHERE Id=@id AND TenantID=@tid`);
  } catch { /* legacy mirror best-effort */ }
}

async function pruneDiv(pool: Pool, tid: string, divTitle: string, dryRun: boolean): Promise<void> {
  // Is any non-deleted user still linked to this division?
  const chk = pool.request();
  chk.input("tid",   NVarChar, tid);
  chk.input("title", NVarChar, divTitle);
  const hit = await chk.query(`
    SELECT TOP 1 u.id AS userId
    FROM core2.dbo.CompanyDivisions d
    JOIN dbo.rmone_users u
      ON u.division_id = CAST(d.ID AS NVARCHAR(50)) AND u.tenant_id=@tid
    WHERE d.TenantID=@tid AND d.Title=@title AND (d.Deleted=0 OR d.Deleted IS NULL)
      AND (u.deleted=0 OR u.deleted IS NULL)`);
  if ((hit.recordset?.length ?? 0) > 0) {
    console.log(`  [skip-prune-div] "${divTitle}" still referenced by rmone_users ${hit.recordset[0].userId} — leaving intact`);
    return;
  }
  // Check core2.dbo.AspNetUsers too (legacy rows that may not be in app DB).
  const chk2 = pool.request();
  chk2.input("tid",   NVarChar, tid);
  chk2.input("title", NVarChar, divTitle);
  const hit2 = await chk2.query(`
    SELECT TOP 1 a.Id AS userId
    FROM core2.dbo.CompanyDivisions d
    JOIN core2.dbo.AspNetUsers a ON a.DivisionLookup = d.ID AND a.TenantID=@tid
    WHERE d.TenantID=@tid AND d.Title=@title AND (d.Deleted=0 OR d.Deleted IS NULL)
      AND (a.Deleted=0 OR a.Deleted IS NULL)`);
  if ((hit2.recordset?.length ?? 0) > 0) {
    console.log(`  [skip-prune-div] "${divTitle}" still referenced by AspNetUsers ${hit2.recordset[0].userId} — leaving intact`);
    return;
  }
  console.log(`  [prune-div] soft-deleting CompanyDivisions row for "${divTitle}"`);
  if (!dryRun) {
    const del = pool.request();
    del.input("tid",   NVarChar, tid);
    del.input("title", NVarChar, divTitle);
    await del.query(`
      UPDATE core2.dbo.CompanyDivisions SET Deleted=1
      WHERE TenantID=@tid AND Title=@title AND (Deleted=0 OR Deleted IS NULL)`);
  }
}

async function pruneDept(pool: Pool, tid: string, deptTitle: string, dryRun: boolean): Promise<void> {
  const chk = pool.request();
  chk.input("tid",   NVarChar, tid);
  chk.input("title", NVarChar, deptTitle);
  const hit = await chk.query(`
    SELECT TOP 1 u.id AS userId
    FROM core2.dbo.Department d
    JOIN dbo.rmone_users u
      ON u.department_id = CAST(d.ID AS NVARCHAR(50)) AND u.tenant_id=@tid
    WHERE d.TenantID=@tid AND d.Title=@title AND (d.Deleted=0 OR d.Deleted IS NULL)
      AND (u.deleted=0 OR u.deleted IS NULL)`);
  if ((hit.recordset?.length ?? 0) > 0) {
    console.log(`  [skip-prune-dept] "${deptTitle}" still referenced by rmone_users ${hit.recordset[0].userId} — leaving intact`);
    return;
  }
  const chk2 = pool.request();
  chk2.input("tid",   NVarChar, tid);
  chk2.input("title", NVarChar, deptTitle);
  const hit2 = await chk2.query(`
    SELECT TOP 1 a.Id AS userId
    FROM core2.dbo.Department d
    JOIN core2.dbo.AspNetUsers a ON a.DepartmentLookup = d.ID AND a.TenantID=@tid
    WHERE d.TenantID=@tid AND d.Title=@title AND (d.Deleted=0 OR d.Deleted IS NULL)
      AND (a.Deleted=0 OR a.Deleted IS NULL)`);
  if ((hit2.recordset?.length ?? 0) > 0) {
    console.log(`  [skip-prune-dept] "${deptTitle}" still referenced by AspNetUsers ${hit2.recordset[0].userId} — leaving intact`);
    return;
  }
  console.log(`  [prune-dept] soft-deleting Department row for "${deptTitle}"`);
  if (!dryRun) {
    const del = pool.request();
    del.input("tid",   NVarChar, tid);
    del.input("title", NVarChar, deptTitle);
    await del.query(`
      UPDATE core2.dbo.Department SET Deleted=1
      WHERE TenantID=@tid AND Title=@title AND (Deleted=0 OR Deleted IS NULL)`);
  }
}

// ── main ───────────────────────────────────────────────────────────────────────

async function main() {
  const pool = await getMssqlPool();

  // Load all users for the tenant (includes deleted so we don't double-process).
  const allUsers = await getUsersByTenant(TID);
  console.log(`Loaded ${allUsers.length} total user rows for Alston AI tenant\n`);

  // Enrich with division/dept names from core2 (cross-DB join from app DB pool).
  const enrichReq = pool.request();
  enrichReq.input("tid", NVarChar, TID);
  const enrichRes = await enrichReq.query(`
    SELECT
      u.id           AS userId,
      cd.Title       AS divTitle,
      dp.Title       AS deptTitle
    FROM dbo.rmone_users u
    LEFT JOIN core2.dbo.CompanyDivisions cd
      ON cd.ID = TRY_CAST(u.division_id AS INT) AND cd.TenantID=@tid
    LEFT JOIN core2.dbo.Department dp
      ON dp.ID = TRY_CAST(u.department_id AS INT) AND dp.TenantID=@tid
    WHERE u.tenant_id=@tid`);

  const orgMap = new Map<string, { divTitle: string | null; deptTitle: string | null }>();
  for (const row of enrichRes.recordset as Array<Record<string, unknown>>) {
    orgMap.set(String(row.userId).toLowerCase(), {
      divTitle:  row.divTitle  ? String(row.divTitle)  : null,
      deptTitle: row.deptTitle ? String(row.deptTitle) : null,
    });
  }

  // Group LIVE (non-deleted) users by normalised name.
  const live   = allUsers.filter(u => !u.deleted);
  const byName = new Map<string, typeof live>();
  for (const u of live) {
    const key = (u.name || "").toLowerCase().trim();
    if (!key) continue;
    if (!byName.has(key)) byName.set(key, []);
    byName.get(key)!.push(u);
  }

  // Score helper: higher = better candidate to keep.
  const score = (u: typeof live[0]) => {
    const org  = orgMap.get(u.id.toLowerCase());
    const div  = (org?.divTitle  ?? "").toLowerCase();
    const dept = (org?.deptTitle ?? "").toLowerCase();
    if (div === "cold storage") return 3;
    // NewCo Construction with a real city dept = valid, but lower priority
    if (div === "newco construction" && dept !== "unassigned" && dept !== "") return 2;
    if (div !== "cs" && dept !== "unassigned" && dept !== "") return 1;
    return 0; // stale: CS/Unassigned or unknown
  };

  let totalDeact = 0, totalDel = 0;

  for (const [nameKey, group] of byName) {
    if (group.length < 2) continue;

    console.log(`\nDuplicate "${nameKey}" — ${group.length} rows:`);
    for (const u of group) {
      const o = orgMap.get(u.id.toLowerCase());
      console.log(`  id=${u.id}  div="${o?.divTitle ?? "(none)"}"  dept="${o?.deptTitle ?? "(none)"}"  enabled=${u.enabled}  score=${score(u)}`);
    }

    const sorted = [...group].sort(
      (a, b) => score(b) - score(a) || (b.updatedAt?.getTime() ?? 0) - (a.updatedAt?.getTime() ?? 0),
    );
    const keeper = sorted[0];
    const stale  = sorted.slice(1);
    const kOrg   = orgMap.get(keeper.id.toLowerCase());
    console.log(`  → KEEP  id=${keeper.id}  div="${kOrg?.divTitle ?? "(none)"}"  dept="${kOrg?.deptTitle ?? "(none)"}"  enabled=${keeper.enabled}`);

    // Re-enable the keeper if it is currently disabled — the stale CS row was
    // left active while the correct Cold Storage row was deactivated, so we
    // must flip both together in the same operation.
    if (!keeper.enabled) {
      console.log(`    [re-enable] ${keeper.id} (keeper was disabled)`);
      if (!DRY_RUN) {
        await updateUser(TID, keeper.id, { enabled: true });
        try {
          const r = pool.request();
          r.input("tid", NVarChar, TID);
          r.input("id",  NVarChar, keeper.id);
          await r.query(`UPDATE core2.dbo.AspNetUsers SET Enabled=1 WHERE Id=@id AND TenantID=@tid`);
        } catch { /* legacy mirror best-effort */ }
      }
    }

    for (const s of stale) {
      const sOrg = orgMap.get(s.id.toLowerCase());
      const hist = await hasHistory(pool, TID, s.id);
      console.log(`  → STALE id=${s.id}  div="${sOrg?.divTitle ?? "(none)"}"  dept="${sOrg?.deptTitle ?? "(none)"}"  history=${hist}`);
      if (hist) {
        await deactivate(pool, TID, s.id, DRY_RUN);
        totalDeact++;
      } else {
        await softDelete(pool, TID, s.id, DRY_RUN);
        totalDel++;
      }
    }
  }

  console.log(`\n── User cleanup summary ──────────────────────────────────────────`);
  console.log(`  Deactivated (has history) : ${totalDeact}`);
  console.log(`  Soft-deleted (no history) : ${totalDel}`);
  console.log(`  Total stale rows resolved : ${totalDeact + totalDel}`);

  console.log(`\n── Org row cleanup ───────────────────────────────────────────────`);
  await pruneDept(pool, TID, "Unassigned", DRY_RUN);
  await pruneDiv (pool, TID, "CS",         DRY_RUN);

  if (DRY_RUN) {
    console.log("\n=== DRY RUN complete — re-run with --apply to commit ===");
  } else {
    console.log("\n=== Done. Run verify-staff-org.local.ts to confirm. ===");
  }
  process.exit(0);
}

main().catch(e => { console.error("cleanup failed:", e); process.exit(1); });
