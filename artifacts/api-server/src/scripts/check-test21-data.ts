import { v5 as uuidv5 } from "uuid";
import { getPool } from "../lib/db.js";
import { getActiveUsersByTenant } from "@workspace/db";

const TENANT_NAMESPACE = "5d8f1e6a-2c3b-4d7e-9a1f-0b2c3d4e5f6a";
const label = process.argv[2] || "test21";
const tid = uuidv5(label.toLowerCase(), TENANT_NAMESPACE);

async function main() {
  console.log(`tenant label: ${label}`);
  console.log(`tenant id:    ${tid}`);

  try {
    const pgUsers = await getActiveUsersByTenant(tid);
    console.log(`app-db active users: ${pgUsers?.length ?? 0}`);
    for (const u of (pgUsers ?? []).slice(0, 10)) {
      console.log(`  - ${(u as any).username ?? (u as any).email ?? (u as any).id}`);
    }
  } catch (e: any) {
    console.log(`app-db users check failed: ${e?.message}`);
  }

  const pool = await getPool();
  const tables = [
    "PMM", "Opportunity", "Lead", "CRMCompany", "CRMContact",
    "ResourceWorkItems", "ResourceAllocation", "AspNetUsers",
    "Roles", "JobTitle", "CompanyDivisions", "BusinessUnit", "PMMTasks",
  ];
  for (const t of tables) {
    try {
      const colsR = await pool.request().query(
        `SELECT c.name FROM core2.sys.columns c
         JOIN core2.sys.tables tb ON tb.object_id = c.object_id
         WHERE tb.name = '${t}'`);
      const cols = new Set<string>(colsR.recordset.map((r: any) => r.name));
      if (!cols.has("TenantID")) { console.log(`${t}: (no TenantID col)`); continue; }
      const del = cols.has("Deleted") ? "AND ([Deleted] = 0 OR [Deleted] IS NULL)" : "";
      const r = await pool.request().input("tid", tid).query(
        `SELECT COUNT(*) AS n FROM core2.dbo.[${t}] WITH (NOLOCK) WHERE [TenantID] = @tid ${del}`);
      const rAll = await pool.request().input("tid", tid).query(
        `SELECT COUNT(*) AS n FROM core2.dbo.[${t}] WITH (NOLOCK) WHERE [TenantID] = @tid`);
      console.log(`${t}: active=${r.recordset[0].n}  total(incl deleted)=${rAll.recordset[0].n}`);
    } catch (e: any) {
      console.log(`${t}: query failed — ${e?.message}`);
    }
  }
  process.exit(0);
}
main().catch(e => { console.error("FATAL", e); process.exit(1); });
