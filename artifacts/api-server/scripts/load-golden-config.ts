/**
 * Loads the golden LiRoDemo tenant config (exported as per-table JSON via bcp -w)
 * into AWS RDS core2.
 *
 * Source JSON: produced by scripts/export-golden-config.sh (UTF-16LE, one file
 * per table, each containing a single FOR JSON PATH array — or empty if no rows).
 *
 * Strategy (FK enforcement is disabled on core2, so insert order is irrelevant):
 *   - read live column metadata from core2.sys.columns
 *   - skip computed columns and rowversion/timestamp columns (can't be inserted)
 *   - enable IDENTITY_INSERT when an identity column is present in the data
 *   - idempotent: DELETE existing rows for the tenant, then chunked multi-row
 *     parameterized INSERT, all inside one transaction per table
 *
 * Usage:
 *   DIR=/path/to/json TENANT=<guid> [TABLES=a,b,c] [APPLY=1] \
 *     pnpm --filter @workspace/api-server exec tsx scripts/load-golden-config.ts
 *   (APPLY defaults to 1; set APPLY=0 for a dry run that only reports counts)
 */
import sql from "mssql";
import fs from "node:fs";
import path from "node:path";

const DIR = process.env.DIR;
const TENANT = process.env.TENANT ?? "fcec991c-0b1c-4e41-8200-92c20ea3f536";
const ONLY = (process.env.TABLES ?? "").split(",").map(s => s.trim()).filter(Boolean);
const APPLY = process.env.APPLY !== "0";

if (!DIR || !fs.existsSync(DIR)) { console.error(`DIR not found: ${DIR}`); process.exit(1); }

const BINARY = new Set(["binary", "varbinary", "image"]);

function readJsonFile(file: string): any[] {
  const buf = fs.readFileSync(file);
  const txt = buf.toString("utf16le").replace(/^\uFEFF/, "").trim();
  if (!txt) return [];
  const parsed = JSON.parse(txt);
  return Array.isArray(parsed) ? parsed : [];
}

type ColMeta = { name: string; systype: string; isIdentity: boolean; isComputed: boolean };

const url = process.env.APP_DATABASE_URL;
if (!url) { console.error("APP_DATABASE_URL not set"); process.exit(1); }
const u = new URL(url);
const cfg: sql.config = {
  server: u.hostname,
  port: u.port ? parseInt(u.port, 10) : 1433,
  database: "core2",
  user: decodeURIComponent(u.username),
  password: decodeURIComponent(u.password),
  options: { encrypt: true, trustServerCertificate: true, enableArithAbort: true, connectTimeout: 30_000, requestTimeout: 120_000 },
  pool: { max: 4, min: 0, idleTimeoutMillis: 30_000 },
};

const SKIP = parseInt(process.env.SKIP ?? "0", 10);
const TAKE = parseInt(process.env.TAKE ?? "1000000", 10);

const files = fs.readdirSync(DIR)
  .filter(f => f.endsWith(".json"))
  .map(f => ({ table: f.replace(/\.json$/, ""), file: path.join(DIR, f) }))
  .filter(({ table }) => ONLY.length === 0 || ONLY.includes(table))
  .sort((a, b) => a.table.localeCompare(b.table))
  .slice(SKIP, SKIP + TAKE);

const pool = await new sql.ConnectionPool(cfg).connect();
console.log(`[load] connected to core2 — ${files.length} table file(s), tenant ${TENANT}\n`);

async function getMeta(table: string): Promise<ColMeta[]> {
  const res = await pool.request().input("t", sql.NVarChar, `core2.dbo.[${table}]`).query(`
    SELECT c.name AS name, ty.name AS systype, c.is_identity AS isIdentity, c.is_computed AS isComputed
    FROM core2.sys.columns c
    JOIN core2.sys.types ty ON c.user_type_id = ty.user_type_id
    WHERE c.object_id = OBJECT_ID(@t)
    ORDER BY c.column_id
  `);
  return res.recordset.map((r: any) => ({
    name: r.name, systype: String(r.systype).toLowerCase(),
    isIdentity: !!r.isIdentity, isComputed: !!r.isComputed,
  }));
}

function literal(systype: string, val: any): string {
  if (val === null || val === undefined) return "NULL";
  if (BINARY.has(systype)) return "0x" + Buffer.from(String(val), "base64").toString("hex");
  if (systype === "bit") return (val === true || val === 1 || val === "1" || val === "true") ? "1" : "0";
  return "N'" + String(val).replace(/'/g, "''") + "'";   // numbers/dates/guids -> implicit convert on insert
}

let totalInserted = 0; const summary: string[] = []; const failures: string[] = [];

for (const { table, file } of files) {
  const rows = readJsonFile(file);
  if (rows.length === 0) continue;

  const meta = await getMeta(table);
  if (meta.length === 0) { failures.push(`${table}: not found in core2`); continue; }
  const byName = new Map(meta.map(m => [m.name.toLowerCase(), m]));

  // insertable = JSON keys that exist as real (non-computed, non-rowversion) columns
  const jsonKeys = Object.keys(rows[0]);
  const cols = jsonKeys.filter(k => {
    const m = byName.get(k.toLowerCase());
    return m && !m.isComputed && m.systype !== "timestamp";
  });
  if (cols.length === 0) { failures.push(`${table}: no insertable columns`); continue; }
  const hasIdentity = cols.some(c => byName.get(c.toLowerCase())!.isIdentity);

  if (!APPLY) { summary.push(`${String(rows.length).padStart(5)}  ${table} (dry, ${cols.length} cols${hasIdentity ? ", identity" : ""})`); continue; }

  const fq = `core2.dbo.[${table}]`;
  const colList = cols.map(c => `[${c}]`).join(",");
  const tenantLit = "N'" + TENANT.replace(/'/g, "''") + "'";

  // Build ONE batch per table (~1 round trip) — remote RDS latency makes
  // per-statement round trips prohibitively slow. SQL Server caps a VALUES
  // clause at 1000 rows, so split inserts accordingly.
  const inserts: string[] = [];
  for (let i = 0; i < rows.length; i += 1000) {
    const tuples = rows.slice(i, i + 1000).map(row =>
      "(" + cols.map(c => literal(byName.get(c.toLowerCase())!.systype, row[c])).join(",") + ")"
    );
    inserts.push(`INSERT INTO ${fq} (${colList}) VALUES\n${tuples.join(",\n")};`);
  }

  const batchSql = [
    "SET XACT_ABORT ON;",
    "BEGIN TRY",
    "BEGIN TRAN;",
    hasIdentity ? `SET IDENTITY_INSERT ${fq} ON;` : "",
    `DELETE FROM ${fq} WHERE TenantID = ${tenantLit};`,
    ...inserts,
    hasIdentity ? `SET IDENTITY_INSERT ${fq} OFF;` : "",
    "COMMIT TRAN;",
    "END TRY",
    "BEGIN CATCH",
    "IF @@TRANCOUNT > 0 ROLLBACK TRAN;",
    "THROW;",
    "END CATCH;",
  ].filter(Boolean).join("\n");

  try {
    await pool.request().batch(batchSql);
    totalInserted += rows.length;
    summary.push(`${String(rows.length).padStart(5)}  ${table}${hasIdentity ? "  (identity)" : ""}`);
  } catch (e: any) {
    failures.push(`${table}: ${e.message?.slice(0, 140)}`);
  }
}

console.log("--- loaded ---");
for (const s of summary) console.log(s);
if (failures.length) { console.log("\n--- FAILURES ---"); for (const f of failures) console.log("  " + f); }
console.log(`\n${APPLY ? "inserted" : "would insert"} ${APPLY ? totalInserted : summary.length + " tables"}; failures: ${failures.length}`);

await pool.close();
process.exit(failures.length ? 1 : 0);
