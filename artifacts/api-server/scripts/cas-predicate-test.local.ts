// Read-only sanity check for the CAS predicate used by schedule auto-advance.
// Replicates the exact WHERE shape updateRecordFieldsRds builds when
// opts.casStatus is set, and proves: (1) it MATCHES with the raw values just
// read (happy path — no false-negative wedge), (2) it MISSES with stale
// values (race protection). No writes.
import sql from "mssql";
import { getPool } from "../src/lib/db.js";

const TICKETS = ["PMM-26-000692", "PMM-26-000537"];

async function main() {
  const pool = await getPool();
  const todayDay = new Date().toISOString().slice(0, 10);
  const manualBefore = new Date(`${todayDay}T00:00:00Z`);

  // Mirror the real builder: only columns that exist on the LIVE table.
  const colsRes = await pool.request().query(
    `SELECT c.name FROM core2.sys.columns c
     JOIN core2.sys.tables t ON t.object_id = c.object_id
     WHERE t.name = 'PMM'`,
  );
  const live = new Set<string>(colsRes.recordset.map((r: { name: string }) => String(r.name)));
  const statusCols = ["CRMProjectStatusChoice", "Status"].filter((c) => live.has(c));
  const hasManual = live.has("StatusManualDate");
  console.log(`live status cols on PMM: [${statusCols.join(", ")}], StatusManualDate: ${hasManual}`);
  if (statusCols.length === 0) { console.error("no status cols — abort"); process.exit(1); }

  for (const ticket of TICKETS) {
    const read = await pool.request()
      .input("ticket", sql.VarChar, ticket.toUpperCase())
      .query(`SELECT TenantID, ${statusCols.map((c) => `[${c}]`).join(", ")}${hasManual ? ", [StatusManualDate]" : ""}
              FROM core2.dbo.PMM
              WHERE UPPER(TicketId) = @ticket AND ([Deleted] IS NULL OR [Deleted] = 0)`);
    for (const row of read.recordset as Record<string, unknown>[]) {
      const tid = String(row.TenantID);
      const raw: Record<string, string | null> = {};
      for (const c of statusCols) raw[c] = row[c] == null ? null : String(row[c]);
      const manual = row.StatusManualDate ? new Date(row.StatusManualDate as string).toISOString() : null;
      console.log(`\n${ticket} @ tid=${tid.slice(0, 8)}… raw=${JSON.stringify(raw)} manual=${manual}`);

      const casSelect = async (vals: Record<string, string | null>) => {
        const req = pool.request()
          .input("tid", sql.NVarChar, tid)
          .input("id", sql.NVarChar, ticket);
        let clause = "";
        let j = 0;
        for (const c of statusCols) {
          const v = vals[c];
          if (v === null) clause += ` AND [${c}] IS NULL`;
          else { const p = `casS${j++}`; req.input(p, sql.NVarChar, v); clause += ` AND [${c}] = @${p}`; }
        }
        if (hasManual) {
          req.input("casManualBefore", sql.DateTime, manualBefore);
          clause += " AND ([StatusManualDate] IS NULL OR [StatusManualDate] < @casManualBefore)";
        }
        const r = await req.query(
          `SELECT COUNT(*) AS n FROM core2.dbo.PMM
           WHERE [TenantID] = @tid AND [TicketId] = @id AND ([Deleted] = 0 OR [Deleted] IS NULL)${clause}`,
        );
        return Number(r.recordset[0]?.n ?? 0);
      };

      const happy = await casSelect(raw);
      const staleVals = { ...raw, [statusCols[0]]: "___STALE_VALUE___" };
      const stale = await casSelect(staleVals);
      console.log(`  happy-path match: ${happy === 1 ? "OK (1 row)" : `FAIL (${happy} rows)`}`);
      console.log(`  stale-value miss: ${stale === 0 ? "OK (0 rows)" : `FAIL (${stale} rows)`}`);
    }
  }
  process.exit(0);
}

main().catch((e) => { console.error("test failed:", e); process.exit(1); });
