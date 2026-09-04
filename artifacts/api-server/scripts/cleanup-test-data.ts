import { getPool } from "../src/lib/db.js";
import { resolveTenantId } from "../src/lib/pipeline.js";

const DB = process.env.CLIENT_DB_NAME ?? "core2";
const NAMES = ["test1", "test2", "test3"];
const DRY = process.argv.includes("--dry-run");

function chunk<T>(a: T[], n: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < a.length; i += n) out.push(a.slice(i, i + n));
  return out;
}

(async () => {
  const pool = await getPool();
  const guids = NAMES.map((n) => resolveTenantId(n));
  const pred = guids.map((g) => `TenantID='${g}'`).join(" OR ");
  console.log("Test tenants:", NAMES.join(", "));
  console.log("GUIDs:", guids.join(", "));

  // Every base table that has a TenantID column.
  const cols = await pool.request().query(`
    SELECT c.TABLE_SCHEMA s, c.TABLE_NAME t
    FROM ${DB}.INFORMATION_SCHEMA.COLUMNS c
    JOIN ${DB}.INFORMATION_SCHEMA.TABLES tt
      ON tt.TABLE_SCHEMA = c.TABLE_SCHEMA AND tt.TABLE_NAME = c.TABLE_NAME
    WHERE LOWER(c.COLUMN_NAME) = 'tenantid' AND tt.TABLE_TYPE = 'BASE TABLE'`);
  const all = cols.recordset.map((r: any) => ({
    fq: `[${DB}].[${r.s}].[${r.t}]`,
    name: `${r.s}.${r.t}`,
  }));
  console.log(`Tables with a TenantID column: ${all.length}`);

  // Discovery: count rows for the test GUIDs (chunked to stay well under the
  // per-query table limit).
  const affected: { fq: string; name: string; n: number }[] = [];
  for (const grp of chunk(all, 80)) {
    const q = grp
      .map((a, i) => `SELECT ${i} idx, COUNT(*) n FROM ${a.fq} WHERE ${pred}`)
      .join("\nUNION ALL\n");
    const r = await pool.request().query(q);
    for (const row of r.recordset as any[]) {
      if (row.n > 0) affected.push({ fq: grp[row.idx].fq, name: grp[row.idx].name, n: row.n });
    }
  }
  affected.sort((a, b) => b.n - a.n);
  const total = affected.reduce((s, x) => s + x.n, 0);
  console.log(`\nAffected tables: ${affected.length}, total rows: ${total}`);
  for (const a of affected) console.log(`  ${a.name}: ${a.n}`);

  if (DRY) {
    console.log("\nDRY-RUN — nothing deleted.");
    process.exit(0);
  }
  if (total === 0) {
    console.log("\nNothing to delete.");
    process.exit(0);
  }

  // Delete in repeated passes so foreign-key child rows clear before parents,
  // without globally disabling constraints.
  const fqs = affected.map((a) => a.fq);
  let remaining = 1;
  let pass = 0;
  while (remaining > 0 && pass < 10) {
    pass++;
    let deleted = 0;
    let blocked = 0;
    for (const fq of fqs) {
      try {
        const r = await pool.request().query(`DELETE FROM ${fq} WHERE ${pred}`);
        deleted += r.rowsAffected[0] || 0;
      } catch {
        blocked++;
      }
    }
    const rc = await pool
      .request()
      .query(fqs.map((fq) => `SELECT COUNT(*) n FROM ${fq} WHERE ${pred}`).join("\nUNION ALL\n"));
    remaining = (rc.recordset as any[]).reduce((a, x) => a + x.n, 0);
    console.log(`pass ${pass}: deleted=${deleted} remaining=${remaining} fkBlocked=${blocked}`);
  }
  console.log(remaining === 0 ? "\nCLEAN — all test tenant rows removed." : `\nSTILL ${remaining} rows remain.`);
  process.exit(remaining === 0 ? 0 : 1);
})().catch((e) => {
  console.error("ERR:", e.message);
  process.exit(1);
});
