// Throwaway dev test for owner-scoped crash reconcile. Modes: setup <realToken> | verify | cleanup
import { getPool } from "../src/lib/db.js";
import sql from "mssql";

const T = "rmoneapp.dbo.rmone_onboarding_jobs";

async function main() {
  const mode = process.argv[2];
  const pool = await getPool();

  if (mode === "setup") {
    const realToken = process.argv[3];
    if (!realToken) throw new Error("need real worker token as arg");
    const col = await pool.request().query(
      `SELECT 1 AS ok FROM rmoneapp.sys.columns WHERE object_id=OBJECT_ID('rmoneapp.dbo.rmone_onboarding_jobs') AND name='owner_token'`);
    console.log("owner_token column exists:", col.recordset.length > 0);
    if (col.recordset.length === 0) throw new Error("owner_token column missing — bootstrap DDL did not run");
    // Discover NOT NULL columns so the fake insert satisfies the live schema.
    const cols = await pool.request().query(
      `SELECT COLUMN_NAME AS name, DATA_TYPE AS type, IS_NULLABLE AS nullable
       FROM rmoneapp.INFORMATION_SCHEMA.COLUMNS WHERE TABLE_NAME='rmone_onboarding_jobs'`);
    const explicit = new Set(["upload_id", "tenant_id", "status", "owner_token", "created_at", "updated_at"]);
    const fillers: string[] = [];
    for (const c of cols.recordset as Array<{ name: string; type: string; nullable: string }>) {
      if (c.nullable === "YES" || explicit.has(c.name)) continue;
      const v = /char|text/.test(c.type) ? "'crashtest'" : /date|time/.test(c.type) ? "GETUTCDATE()" : /bit/.test(c.type) ? "0" : "0";
      fillers.push(`${c.name}`); explicit.add(c.name);
      (fillers as any).vals = [...((fillers as any).vals ?? []), v];
    }
    const extraCols = fillers.length ? "," + fillers.join(",") : "";
    const extraVals = fillers.length ? "," + ((fillers as any).vals as string[]).join(",") : "";
    for (const [uid, tok] of [["crashtest-bogus-1", "bogus-token-zzz"], ["crashtest-real-1", realToken]] as const) {
      const r = pool.request();
      r.input("uid", sql.NVarChar, uid);
      r.input("tok", sql.NVarChar, tok);
      await r.query(`DELETE FROM ${T} WHERE upload_id=@uid;
        INSERT INTO ${T} (upload_id, tenant_id, status, owner_token, created_at, updated_at${extraCols})
        VALUES (@uid, 'crashtest-fake-tenant', 'running', @tok, DATEADD(minute,-10,GETUTCDATE()), DATEADD(minute,-10,GETUTCDATE())${extraVals})`);
    }
    console.log("setup ok: 2 fake running jobs inserted (both 10 min stale)");
  } else if (mode === "verify") {
    const res = await pool.request().query(
      `SELECT upload_id, status, CAST(result AS NVARCHAR(200)) AS result FROM ${T} WHERE upload_id LIKE 'crashtest-%' ORDER BY upload_id`);
    for (const row of res.recordset) console.log(JSON.stringify(row));
    const bogus = res.recordset.find((r: any) => r.upload_id === "crashtest-bogus-1");
    const real = res.recordset.find((r: any) => r.upload_id === "crashtest-real-1");
    const pass = bogus?.status === "running" && real?.status === "failed";
    console.log(pass ? "PASS: bogus-token job untouched, dead worker's job failed" : "FAIL: unexpected statuses");
    process.exitCode = pass ? 0 : 1;
  } else if (mode === "cleanup") {
    const res = await pool.request().query(`DELETE FROM ${T} WHERE upload_id LIKE 'crashtest-%' OR tenant_id='crashtest-fake-tenant'`);
    console.log("cleanup: deleted", res.rowsAffected?.[0] ?? 0, "row(s)");
  }
  process.exit(process.exitCode ?? 0);
}
main().catch(e => { console.error(e); process.exit(1); });
