// Definitive root cause: was Mike Murry named in the replace-mode files that
// pruned him? Decode the stored uploads and search every cell.
import { getMssqlPool } from "@workspace/db";
import * as XLSX from "xlsx";
import mssql from "mssql";

const TID = "22897300-acd1-5876-bfba-ae8b794cedd0";
const MIKE = "9ddf763e-ccc6-4631-8570-16f4b87da6a9";

async function main() {
  const pool = await getMssqlPool();

  // The replace-mode jobs that ran between Mike's creation (Aug 6 11:21) and
  // his half-resurrect (Aug 10): projects replace Aug 6 11:53 + assignments
  // replaces Aug 7. Grab each file and search for him.
  const jobs = await pool.request().query(`
    SELECT upload_id, file_name, import_mode, created_at, CAST(file_data AS NVARCHAR(MAX)) AS fd
    FROM dbo.rmone_onboarding_jobs
    WHERE LOWER(tenant_id) LIKE '%alston%' AND import_mode='replace' AND status='success'
    ORDER BY created_at ASC`);
  for (const j of jobs.recordset) {
    if (!j.fd) { console.log(`${j.file_name} ${String(j.created_at).slice(0,24)} — NO file_data stored`); continue; }
    const buf = Buffer.from(j.fd, "base64");
    let hits: string[] = []; let fakeEmails = 0; let names = new Set<string>();
    try {
      const wb = XLSX.read(buf, { type: "buffer" });
      for (const sn of wb.SheetNames) {
        const rows: any[][] = XLSX.utils.sheet_to_json(wb.Sheets[sn], { header: 1, raw: false }) as any[][];
        for (const row of rows) for (const cell of row ?? []) {
          const s = String(cell ?? "").toLowerCase();
          if (!s) continue;
          if (s.includes("murry") || s.includes("murray") || /\bmike\b/.test(s)) hits.push(`[${sn}] ${String(cell).slice(0,60)}`);
          if (s.includes("@rmone.com")) fakeEmails++;
          }
      }
    } catch (e: any) { console.log(`${j.file_name}: parse failed ${e.message}`); continue; }
    console.log(`${String(j.created_at).slice(0,24)}  ${j.file_name} (${buf.length}b): mike/murry hits=${hits.length} fake-email cells=${fakeEmails}`);
    for (const h of [...new Set(hits)].slice(0, 10)) console.log(`    ${h}`);
  }

  // Did Mike have ANY core2 allocation/work-item rows (even deleted) vs a peer?
  for (const [label, guid] of [["Mike", MIKE], ["MatthewJohnson", "00254060-b3fa-447c-bb2b-969857b3a8dd"]] as const) {
    const r = await pool.request().input("tid", mssql.NVarChar, TID).input("id", mssql.NVarChar, guid).query(`
      SELECT (SELECT COUNT(*) FROM core2.dbo.ResourceAllocation WHERE TenantID=@tid AND LOWER(ResourceUser)=LOWER(@id)) AS ra,
             (SELECT COUNT(*) FROM core2.dbo.ResourceWorkItems  WHERE TenantID=@tid AND LOWER(ResourceUser)=LOWER(@id)) AS rwi,
             (SELECT COUNT(*) FROM core2.dbo.AspNetUsers WHERE TenantID=@tid AND (LOWER(Email)='fake10@rmone.com' OR LOWER(UserName)='fake10@rmone.com')) AS core2u`);
    console.log(`${label}: RA=${r.recordset[0].ra} RWI=${r.recordset[0].rwi} (core2 fake10 rows=${r.recordset[0].core2u})`);
  }
  process.exit(0);
}
main().catch(e => { console.error("FATAL", e.message); process.exit(1); });
