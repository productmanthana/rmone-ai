import { getPool } from "../src/lib/db.js";

const HEADLINE: { label: string; table: string; deleted?: boolean }[] = [
  { label: "Team Members",         table: "AspNetUsers",       deleted: true },
  { label: "Divisions",            table: "CompanyDivisions",  deleted: true },
  { label: "Departments",          table: "Department",        deleted: true },
  { label: "Roles",                table: "Roles",             deleted: false },
  { label: "Job Titles",           table: "Jobtitle",          deleted: true },
  { label: "Client Companies",     table: "CRMCompany",        deleted: true },
  { label: "Client Contacts",      table: "CRMContact",        deleted: true },
  { label: "Projects (PMM)",       table: "PMM",               deleted: true },
  { label: "Opportunities",        table: "Opportunity",       deleted: true },
  { label: "Resource-Project",     table: "ResourceWorkItems", deleted: false },
  { label: "Allocations",          table: "ResourceAllocation",deleted: false },
];

async function main() {
  const pool = await getPool();

  const tenants = await pool.request().query(`
    SELECT TenantID, COUNT(*) AS n
    FROM core2.dbo.AspNetUsers
    WHERE Deleted = 0 AND TenantID IS NOT NULL
    GROUP BY TenantID
    ORDER BY n DESC
  `);
  console.log("=== Tenants with team members ===");
  console.table(tenants.recordset);

  for (const t of tenants.recordset) {
    const tid: string = t.TenantID;
    console.log(`\n=== Headline counts for tenant ${tid} ===`);
    const rows: { Table: string; Rows: number }[] = [];
    for (const h of HEADLINE) {
      const where = h.deleted ? "WHERE TenantID=@tid AND Deleted=0" : "WHERE TenantID=@tid";
      try {
        const r = await pool.request()
          .input("tid", tid)
          .query(`SELECT COUNT(*) AS n FROM core2.dbo.${h.table} ${where}`);
        rows.push({ Table: h.label, Rows: r.recordset[0].n });
      } catch (e: any) {
        rows.push({ Table: h.label, Rows: -1 });
      }
    }
    console.table(rows);

    const sample = await pool.request()
      .input("tid", tid)
      .query(`SELECT TOP 10 Name, UserName, Email FROM core2.dbo.AspNetUsers WHERE TenantID=@tid AND Deleted=0 ORDER BY Name`);
    console.log("Sample team members:");
    console.table(sample.recordset);
  }

  await pool.close();
}

main().catch(e => { console.error(e); process.exit(1); });
