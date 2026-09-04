// Diagnostic: why is Mike Murry (team_data.xlsx row 3, fake10@rmone.com)
// missing from the Alston AI tenant after the onboarding upload?
import { getPool, sql } from "../src/lib/db.js";
import { getMssqlPool } from "@workspace/db";
import mssql from "mssql";
import { v5 as uuidv5 } from "uuid";

const NS = "5d8f1e6a-2c3b-4d7e-9a1f-0b2c3d4e5f6a";
const label = "alston ai";
const tid = uuidv5(label, NS);
const uploadId = "cf285589-42f1-4e9e-9043-a35fc7fbaf74";

async function run() {
  const appPool = await getMssqlPool();
  const corePool = await getPool();
  console.log(`Tenant label "${label}" → ${tid}`);

  // 1) App user store (rmone_users) — the Staff list source.
  const u = await new mssql.Request(appPool).input("tid", mssql.NVarChar, tid).query(`
    SELECT id, username, name, email, enabled, deleted, role, access_level
    FROM dbo.rmone_users
    WHERE tenant_id=@tid AND (name LIKE '%murr%' OR email LIKE 'fake10%' OR username LIKE 'fake10%')
  `);
  console.log(`\n[rmone_users] Murry/fake10 (this tenant): ${u.recordset.length}`);
  for (const r of u.recordset) console.log("  " + JSON.stringify(r));

  const uAny = await new mssql.Request(appPool).query(`
    SELECT id, name, email, tenant_id, enabled, deleted
    FROM dbo.rmone_users WHERE name LIKE '%murr%' OR email LIKE 'fake10@%'
  `);
  console.log(`[rmone_users] Murry/fake10 (ALL tenants): ${uAny.recordset.length}`);
  for (const r of uAny.recordset) console.log("  " + JSON.stringify(r));

  const cnt = await new mssql.Request(appPool).input("tid", mssql.NVarChar, tid).query(`
    SELECT COUNT(*) AS total,
      SUM(CASE WHEN (deleted IS NULL OR deleted=0) THEN 1 ELSE 0 END) AS live,
      SUM(CASE WHEN deleted=1 THEN 1 ELSE 0 END) AS softDeleted
    FROM dbo.rmone_users WHERE tenant_id=@tid
  `);
  console.log(`[rmone_users] tenant counts: ${JSON.stringify(cnt.recordset[0])}`);

  // 2) core2 AspNetUsers — the import pipeline's Team-sheet target.
  const a = await corePool.request().input("tid", sql.NVarChar, tid).query(`
    SELECT Id, UserName, Email, Name, TenantID, Enabled, Deleted
    FROM core2.dbo.AspNetUsers
    WHERE TenantID=@tid AND (Name LIKE '%murr%' OR Email LIKE 'fake10%' OR UserName LIKE 'fake10%')
  `);
  console.log(`\n[core2 AspNetUsers] Murry/fake10 (this tenant): ${a.recordset.length}`);
  for (const r of a.recordset) console.log("  " + JSON.stringify(r));
  const acnt = await corePool.request().input("tid", sql.NVarChar, tid).query(`
    SELECT COUNT(*) AS total, SUM(CASE WHEN (Deleted=0 OR Deleted IS NULL) THEN 1 ELSE 0 END) AS live
    FROM core2.dbo.AspNetUsers WHERE TenantID=@tid
  `);
  console.log(`[core2 AspNetUsers] tenant counts: ${JSON.stringify(acnt.recordset[0])}`);

  // 3) The onboarding job row — status + warnings (skip blob columns).
  const tbl = await new mssql.Request(appPool).query(`SELECT name FROM sys.tables WHERE name LIKE '%job%'`);
  console.log(`\n[app-db job tables] ${tbl.recordset.map((t: any) => t.name).join(", ") || "(none)"}`);
  for (const t of tbl.recordset as { name: string }[]) {
    const cols = await new mssql.Request(appPool).input("t", mssql.NVarChar, t.name).query(`
      SELECT c.name FROM sys.columns c JOIN sys.tables tb ON tb.object_id=c.object_id WHERE tb.name=@t
    `);
    const colNames = cols.recordset.map((c: any) => c.name as string);
    const idCol = colNames.find((c) => /^upload_?id$/i.test(c));
    if (!idCol) continue;
    const pick = colNames.filter((c) => !/file_data|blob/i.test(c));
    const j = await new mssql.Request(appPool).input("uid", mssql.NVarChar, uploadId).query(`
      SELECT ${pick.map((c) => `[${c}]`).join(",")} FROM dbo.[${t.name}] WHERE [${idCol}]=@uid
    `);
    console.log(`[${t.name}] job row(s): ${j.recordset.length}`);
    for (const r of j.recordset) {
      for (const [k, v] of Object.entries(r)) {
        const s = typeof v === "string" && v.length > 3000 ? v.slice(0, 3000) + "…[truncated]" : v;
        console.log(`  ${k}: ${JSON.stringify(s)}`);
      }
    }
  }
}
run().then(() => process.exit(0)).catch((e) => { console.error("FAILED:", e?.message ?? e); process.exit(1); });
