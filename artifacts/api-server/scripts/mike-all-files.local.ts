// Search EVERY stored Alston AI upload for Mike Murry.
import { getMssqlPool } from "@workspace/db";
import * as XLSX from "xlsx";
async function main() {
  const pool = await getMssqlPool();
  const jobs = await pool.request().query(`
    SELECT file_name, import_mode, created_at, CAST(file_data AS NVARCHAR(MAX)) AS fd
    FROM dbo.rmone_onboarding_jobs
    WHERE LOWER(tenant_id) LIKE '%alston%' AND status='success'
    ORDER BY created_at ASC`);
  for (const j of jobs.recordset) {
    if (!j.fd) { console.log(`${String(j.created_at).slice(0,24)}  ${j.import_mode}  ${j.file_name} — no file stored`); continue; }
    const buf = Buffer.from(j.fd, "base64");
    let hits = 0; let sample = "";
    try {
      const wb = XLSX.read(buf, { type: "buffer" });
      for (const sn of wb.SheetNames) {
        const rows: any[][] = XLSX.utils.sheet_to_json(wb.Sheets[sn], { header: 1, raw: false }) as any[][];
        for (const row of rows) for (const cell of row ?? []) {
          const s = String(cell ?? "").toLowerCase();
          if (s.includes("murry") || s.includes("fake10@")) { hits++; if (!sample) sample = `[${sn}] ${String(cell).slice(0,50)}`; }
        }
      }
    } catch { console.log(`${j.file_name}: parse failed`); continue; }
    console.log(`${String(j.created_at).slice(0,24)}  ${j.import_mode}  ${j.file_name}: mike-hits=${hits}  ${sample}`);
  }
  process.exit(0);
}
main().catch(e => { console.error("FATAL", e.message); process.exit(1); });
