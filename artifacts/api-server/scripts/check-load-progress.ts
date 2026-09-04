/**
 * Compares expected golden-config row counts (from the exported JSON files)
 * against what is actually committed in AWS RDS core2 for the golden tenant.
 * Prints which tables are complete, partial, or missing.
 */
import sql from "mssql";
import fs from "node:fs";
import path from "node:path";

const DIR = process.env.DIR!;
const TENANT = process.env.TENANT ?? "fcec991c-0b1c-4e41-8200-92c20ea3f536";

function expectedCount(file: string): number {
  const txt = fs.readFileSync(file).toString("utf16le").replace(/^\uFEFF/, "").trim();
  if (!txt) return 0;
  const a = JSON.parse(txt);
  return Array.isArray(a) ? a.length : 0;
}

const u = new URL(process.env.APP_DATABASE_URL!);
const pool = await new sql.ConnectionPool({
  server: u.hostname, port: u.port ? +u.port : 1433, database: "core2",
  user: decodeURIComponent(u.username), password: decodeURIComponent(u.password),
  options: { encrypt: true, trustServerCertificate: true, enableArithAbort: true, connectTimeout: 30_000, requestTimeout: 60_000 },
}).connect();

const files = fs.readdirSync(DIR).filter(f => f.endsWith(".json")).sort();
const missing: string[] = []; const partial: string[] = []; let done = 0, totExp = 0, totAct = 0;

for (const f of files) {
  const table = f.replace(/\.json$/, "");
  const exp = expectedCount(path.join(DIR, f));
  if (exp === 0) continue;
  totExp += exp;
  const r = await pool.request().query(`SELECT COUNT(*) c FROM core2.dbo.[${table}] WHERE TenantID='${TENANT}'`).catch(() => null);
  const act = r ? (r.recordset[0].c as number) : -1;
  totAct += Math.max(0, act);
  if (act === exp) done++;
  else if (act <= 0) missing.push(table);
  else partial.push(`${table} (${act}/${exp})`);
}

console.log(`complete: ${done} tables | expected rows ${totExp} | actual rows ${totAct}`);
if (partial.length) { console.log("\nPARTIAL (will be fixed by idempotent reload):"); partial.forEach(p => console.log("  " + p)); }
if (missing.length) { console.log(`\nMISSING (${missing.length}):`); console.log("  TABLES=" + missing.join(",")); }
if (!partial.length && !missing.length) console.log("\nALL GOLDEN CONFIG LOADED ✓");
await pool.close();
