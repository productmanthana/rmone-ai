import { getMssqlPool } from "@workspace/db";
import mssql from "mssql";
async function main() {
  const tid = "22897300-acd1-5876-bfba-ae8b794cedd0";
  const p = await getMssqlPool();
  const r = await new mssql.Request(p).input("tid", mssql.NVarChar, tid).query(`
    SELECT enabled, COUNT(*) AS n FROM dbo.rmone_users WHERE tenant_id=@tid AND deleted=0 GROUP BY enabled;
    SELECT name, email, enabled, role, access_level FROM dbo.rmone_users WHERE tenant_id=@tid AND deleted=0 AND enabled=0;
  `);
  console.log("by enabled:", JSON.stringify(r.recordsets[0]));
  console.log("disabled users:", JSON.stringify(r.recordsets[1], null, 1));
  process.exit(0);
}
main().catch((e) => { console.error(e?.message ?? e); process.exit(1); });
