/**
 * Generate the FULL core2 schema (all tables + PK + FK + defaults + identity)
 * from the captured CSV snapshot, and optionally apply it to the AWS RDS `core2`
 * database for a clean full-schema rebuild.
 *
 *   pnpm --filter @workspace/api-server exec tsx scripts/apply-full-schema.ts
 *        -> writes docs/core2_full_schema.sql only (no DB changes)
 *
 *   APPLY=1 pnpm --filter @workspace/api-server exec tsx scripts/apply-full-schema.ts
 *        -> writes the file AND applies it to AWS RDS core2 (DROPS existing tables)
 *
 * Source: docs/core2_columns_full.csv  (table|col|type|maxlen|prec|scale|nullable|identity|default|ordinal)
 *         docs/core2_keys.csv          (PK|tbl|col|| and FK|child|col|reftbl|refcol)
 *
 * Schema-aware: tables are keyed by their fully-qualified [schema].[name]
 * (the snapshot contains both `dbo` and `HangFire` schemas, which collide on
 * the bare name `State`).
 *
 * GAPS (snapshot has no flag for these — documented, not fatal):
 *   - computed columns are recreated as plain columns
 *   - indexes (non-PK), check constraints, triggers are NOT recreated
 *   - FK enforcement is left DISABLED on purpose (partial-data onboarding)
 */
import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import sql from "mssql";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "../../..");
const docs = (f: string) => path.join(ROOT, "docs", f);

function readLines(file: string): string[] {
  return readFileSync(file, "utf8")
    .split(/\r?\n/)
    .filter((l) => l.length && !l.startsWith("Changed database context"));
}
function split(q: string): { schema: string; name: string } {
  const i = q.indexOf(".");
  return i < 0 ? { schema: "dbo", name: q } : { schema: q.slice(0, i), name: q.slice(i + 1) };
}
const qn = (q: string) => { const { schema, name } = split(q); return `[${schema}].[${name}]`; };
const bareName = (q: string) => split(q).name;

// ── parse columns (keyed by fully-qualified name) ──────────────────────────
interface Col {
  name: string; dtype: string; maxLen: number; precision: number; scale: number;
  isNullable: boolean; isIdentity: boolean; def: string;
}
const tables = new Map<string, Col[]>();   // "schema.name" -> columns
for (const line of readLines(docs("core2_columns_full.csv"))) {
  const p = line.split("|");
  if (p.length < 10) continue;
  const t = p[0];
  if (!tables.has(t)) tables.set(t, []);
  tables.get(t)!.push({
    name: p[1], dtype: p[2].toLowerCase(),
    maxLen: Number(p[3]), precision: Number(p[4]), scale: Number(p[5]),
    isNullable: p[6] === "1", isIdentity: p[7] === "1", def: p[8] ?? "",
  });
}

// ── parse keys (keep qualified names) ──────────────────────────────────────
const pk = new Map<string, string[]>();          // "schema.name" -> [cols] in PK order
interface Fk { child: string; col: string; refTable: string; refCol: string; }
const fks: Fk[] = [];
for (const line of readLines(docs("core2_keys.csv"))) {
  const p = line.split("|");
  if (p[0] === "PK") {
    if (!pk.has(p[1])) pk.set(p[1], []);
    pk.get(p[1])!.push(p[2]);
  } else if (p[0] === "FK") {
    fks.push({ child: p[1], col: p[2], refTable: p[3], refCol: p[4] });
  }
}

// ── type rendering ─────────────────────────────────────────────────────────
function renderType(c: Col): string {
  const t = c.dtype;
  const n = (v: number) => (v === -1 ? "max" : String(v));
  switch (t) {
    case "nvarchar": return `nvarchar(${c.maxLen === -1 ? "max" : c.maxLen / 2})`;
    case "nchar":    return `nchar(${c.maxLen / 2})`;
    case "varchar":  return `varchar(${n(c.maxLen)})`;
    case "char":     return `char(${c.maxLen})`;
    case "varbinary":return `varbinary(${n(c.maxLen)})`;
    case "binary":   return `binary(${c.maxLen})`;
    case "decimal":
    case "numeric":  return `${t}(${c.precision},${c.scale})`;
    case "datetime2":      return `datetime2(${c.scale})`;
    case "time":           return `time(${c.scale})`;
    case "datetimeoffset": return `datetimeoffset(${c.scale})`;
    case "float":    return c.precision ? `float(${c.precision})` : "float";
    default:         return t; // int,bigint,bit,datetime,date,smalldatetime,money,tinyint,smallint,uniqueidentifier,sysname,...
  }
}
function renderColumn(c: Col): string {
  let s = `  [${c.name}] ${renderType(c)}`;
  if (c.isIdentity) s += " IDENTITY(1,1)";
  s += c.isNullable ? " NULL" : " NOT NULL";
  if (!c.isIdentity && c.def) s += ` DEFAULT ${c.def}`;
  return s;
}

// ── build statement lists ──────────────────────────────────────────────────
const schemas = [...new Set([...tables.keys()].map((t) => split(t).schema))].filter((s) => s !== "dbo");
const schemaStmts = schemas.map(
  (s) => `IF NOT EXISTS (SELECT 1 FROM sys.schemas WHERE name = '${s}') EXEC('CREATE SCHEMA [${s}]');`,
);

const createStmts: string[] = [];
const pkStmts: string[] = [];
const fkStmts: string[] = [];

const tableNames = [...tables.keys()].sort();
for (const t of tableNames) {
  const cols = tables.get(t)!;
  createStmts.push(`CREATE TABLE ${qn(t)} (\n${cols.map(renderColumn).join(",\n")}\n);`);
  const k = pk.get(t);
  if (k && k.length) {
    pkStmts.push(`ALTER TABLE ${qn(t)} ADD CONSTRAINT [PK_${bareName(t)}] PRIMARY KEY (${k.map((c) => `[${c}]`).join(", ")});`);
  }
}

// FKs: single-column normally; composite when the referenced table has a composite PK
let fkCount = 0;
const compositeRefTables = new Set([...pk].filter(([, c]) => c.length > 1).map(([t]) => t));
const compositeGroups = new Map<string, Fk[]>();     // `${child}=>${refTable}` -> rows
const skippedFks: string[] = [];
for (const fk of fks) {
  if (compositeRefTables.has(fk.refTable)) {
    const key = `${fk.child}=>${fk.refTable}`;
    if (!compositeGroups.has(key)) compositeGroups.set(key, []);
    compositeGroups.get(key)!.push(fk);
    continue;
  }
  if (!tables.has(fk.refTable) || !tables.has(fk.child)) { skippedFks.push(`${fk.child}.${fk.col}->${fk.refTable}`); continue; }
  fkCount++;
  fkStmts.push(
    `ALTER TABLE ${qn(fk.child)} WITH NOCHECK ADD CONSTRAINT [FK_${bareName(fk.child)}_${fk.col}_${fkCount}] ` +
    `FOREIGN KEY ([${fk.col}]) REFERENCES ${qn(fk.refTable)} ([${fk.refCol}]);`,
  );
}
for (const [key, rows] of compositeGroups) {
  const [child, refTable] = key.split("=>");
  if (!tables.has(child) || !tables.has(refTable)) { skippedFks.push(key); continue; }
  const order = pk.get(refTable)!;                  // PK column order on the referenced table
  const sorted = [...rows].sort((a, b) => order.indexOf(a.refCol) - order.indexOf(b.refCol));
  if (sorted.length !== order.length) { skippedFks.push(key + " (incomplete composite)"); continue; }
  fkCount++;
  fkStmts.push(
    `ALTER TABLE ${qn(child)} WITH NOCHECK ADD CONSTRAINT [FK_${bareName(child)}_${bareName(refTable)}_${fkCount}] ` +
    `FOREIGN KEY (${sorted.map((r) => `[${r.col}]`).join(", ")}) ` +
    `REFERENCES ${qn(refTable)} (${sorted.map((r) => `[${r.refCol}]`).join(", ")});`,
  );
}

// disable enforcement (constraints stay defined, but don't block partial-data loads)
const disableStmts = tableNames
  .filter((t) => fks.some((f) => f.child === t))
  .map((t) => `ALTER TABLE ${qn(t)} NOCHECK CONSTRAINT ALL;`);

// ── write the .sql file (for inspection / re-run) ──────────────────────────
const header = `/* FULL core2 schema — generated from CSV snapshot. Tables=${tableNames.length} PK=${pkStmts.length} FK=${fkStmts.length} Schemas=${["dbo", ...schemas].join(",")} */`;
const dropBlock = `
-- 1) drop existing FKs, then all base tables (clean slate)
DECLARE @sql NVARCHAR(MAX) = N'';
SELECT @sql += 'ALTER TABLE ' + QUOTENAME(s.name) + '.' + QUOTENAME(t.name) + ' DROP CONSTRAINT ' + QUOTENAME(f.name) + ';' + CHAR(10)
FROM sys.foreign_keys f
JOIN sys.tables t ON f.parent_object_id = t.object_id
JOIN sys.schemas s ON t.schema_id = s.schema_id;
IF LEN(@sql) > 0 EXEC sp_executesql @sql;
SET @sql = N'';
SELECT @sql += 'DROP TABLE ' + QUOTENAME(s.name) + '.' + QUOTENAME(t.name) + ';' + CHAR(10)
FROM sys.tables t JOIN sys.schemas s ON t.schema_id = s.schema_id;
IF LEN(@sql) > 0 EXEC sp_executesql @sql;
`.trim();

const fileText = [
  header, "USE core2;", "GO",
  dropBlock, "GO",
  "-- 2) schemas", ...schemaStmts, "GO",
  "-- 3) create tables", ...createStmts, "GO",
  "-- 4) primary keys", ...pkStmts, "GO",
  "-- 5) foreign keys", ...fkStmts, "GO",
  "-- 6) disable FK enforcement (partial-data onboarding)", ...disableStmts, "GO",
].join("\n");
const outFile = docs("core2_full_schema.sql");
writeFileSync(outFile, fileText, "utf8");

console.log(`tables:        ${tableNames.length}`);
console.log(`schemas:       dbo, ${schemas.join(", ") || "(none extra)"}`);
console.log(`create stmts:  ${createStmts.length}`);
console.log(`pk stmts:      ${pkStmts.length}`);
console.log(`fk stmts:      ${fkStmts.length} (composite groups: ${compositeGroups.size})`);
console.log(`disable stmts: ${disableStmts.length}`);
if (skippedFks.length) console.log(`skipped FKs:   ${skippedFks.length} -> ${skippedFks.slice(0, 10).join(", ")}${skippedFks.length > 10 ? " …" : ""}`);
console.log(`wrote ${path.relative(ROOT, outFile)} (${fileText.split("\n").length} lines)`);

// ── optionally apply to AWS RDS core2 ──────────────────────────────────────
if (process.env.APPLY !== "1") {
  console.log("\n(dry run — set APPLY=1 to apply to AWS RDS core2)");
  process.exit(0);
}

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

const pool = await new sql.ConnectionPool(cfg).connect();
console.log("\n[apply] connected to core2");

async function runMany(label: string, stmts: string[], chunkSize = 100) {
  let ok = 0; const errs: string[] = [];
  for (let i = 0; i < stmts.length; i += chunkSize) {
    const chunk = stmts.slice(i, i + chunkSize);
    try {
      await pool.request().batch(chunk.join("\n"));   // one round-trip for the whole chunk
      ok += chunk.length;
    } catch {
      // chunk failed — fall back to per-statement to isolate the culprit(s)
      for (const s of chunk) {
        try { await pool.request().batch(s); ok++; }
        catch (e: any) { errs.push(`${e.message} :: ${s.slice(0, 120)}`); }
      }
    }
  }
  console.log(`[apply] ${label}: ${ok}/${stmts.length} ok${errs.length ? `, ${errs.length} errors` : ""}`);
  for (const e of errs.slice(0, 15)) console.log("   ✗", e);
  return errs.length;
}

try {
  await pool.request().batch(dropBlock);
  console.log("[apply] dropped existing FKs + tables");
} catch (e: any) { console.error("[apply] drop failed:", e.message); }

let totalErr = 0;
totalErr += await runMany("schemas", schemaStmts);
totalErr += await runMany("create tables", createStmts);
totalErr += await runMany("primary keys", pkStmts);
totalErr += await runMany("foreign keys", fkStmts);
totalErr += await runMany("disable enforcement", disableStmts);

const cnt = await pool.request().query(`SELECT COUNT(*) n FROM core2.INFORMATION_SCHEMA.TABLES WHERE TABLE_TYPE='BASE TABLE'`);
console.log(`\n[apply] core2 base tables now: ${cnt.recordset[0].n}`);
console.log(totalErr === 0 ? "[apply] ✅ schema applied with no errors" : `[apply] ⚠ completed with ${totalErr} statement errors (see above)`);
await pool.close();
