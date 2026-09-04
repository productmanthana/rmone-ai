import { getPool } from "../src/lib/db.js";
async function main() {
  const pool = await getPool();
  const r = await pool.request().query(`
    SELECT r.session_id, r.status, r.wait_type, r.wait_time/1000 AS wait_s,
           r.total_elapsed_time/1000 AS elapsed_s, r.cpu_time/1000 AS cpu_s,
           r.logical_reads/1000 AS lreads_k, r.blocking_session_id AS blk,
           LEFT(t.text, 220) AS sql_head
    FROM sys.dm_exec_requests r
    CROSS APPLY sys.dm_exec_sql_text(r.sql_handle) t
    WHERE r.session_id <> @@SPID AND t.text NOT LIKE '%dm_exec_requests%'
    ORDER BY r.total_elapsed_time DESC`);
  if (!r.recordset.length) { console.log("no active requests"); }
  for (const row of r.recordset) {
    console.log(`sid=${row.session_id} ${row.status} wait=${row.wait_type ?? "-"} waited=${row.wait_s}s elapsed=${row.elapsed_s}s cpu=${row.cpu_s}s reads=${row.lreads_k}k blk=${row.blk}`);
    console.log(`   ${String(row.sql_head).replace(/\s+/g, " ").slice(0, 200)}`);
  }
  process.exit(0);
}
main().catch(e => { console.error("FATAL", String(e?.message || e).slice(0,300)); process.exit(1); });
