import { getDdlPool } from "../lib/db.js";

async function main() {
  const pool = await getDdlPool();
  const r = await pool.request().query(`
    SELECT o.name AS tbl, i.name AS idx
    FROM core2.sys.indexes i
    JOIN core2.sys.objects o ON o.object_id = i.object_id
    WHERE i.name LIKE 'IX_%' AND o.type = 'U'
    ORDER BY o.name, i.name
  `);
  for (const row of r.recordset as { tbl: string; idx: string }[]) {
    console.log(row.tbl.padEnd(30), row.idx);
  }
  process.exit(0);
}
main().catch((e) => { console.error(e); process.exit(1); });
