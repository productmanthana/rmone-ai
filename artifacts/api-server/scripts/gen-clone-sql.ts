/**
 * Offline generator: reads the core2 metadata SNAPSHOT (the CSVs the client
 * exported from their Docker core2) and produces a ready-to-run T-SQL clone
 * script at docs/clone_tenant_config.sql.
 *
 * This exercises the SAME pure planning + SQL code (plan.ts / sql.ts) used by
 * the live engine, so the generated script is a faithful, testable preview of
 * what the pipeline will do — runnable directly against the Docker core2.
 *
 *   pnpm --filter @workspace/api-server exec tsx scripts/gen-clone-sql.ts
 *
 * NOTE: the CSV snapshot has no "is_computed" flag, so this offline script
 * assumes no computed columns. The live engine (introspect.ts) detects and
 * excludes computed columns properly.
 */
import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { buildClonePlan } from "../src/onboarding/plan.js";
import { emitCloneSql } from "../src/onboarding/sql.js";
import type { TableMeta, FkMeta, ColumnMeta } from "../src/onboarding/types.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "../../..");
const docs = (f: string) => path.join(ROOT, "docs", f);

function readLines(file: string): string[] {
  return readFileSync(file, "utf8")
    .split(/\r?\n/)
    .filter((l) => l.length && !l.startsWith("Changed database context"));
}

function bare(qualified: string): string {
  return qualified.includes(".") ? qualified.split(".").slice(1).join(".") : qualified;
}
function schemaOf(qualified: string): string {
  return qualified.includes(".") ? qualified.split(".")[0] : "dbo";
}

// ── parse roles ───────────────────────────────────────────────────────────
const roleRows = readLines(docs("onboarding_table_roles.csv"));
const header = roleRows[0].split(",");
const tIdx = header.indexOf("table");
const aIdx = header.indexOf("action");
const action = new Map<string, string>();
for (const line of roleRows.slice(1)) {
  const c = line.split(",");
  action.set(c[tIdx], c[aIdx]);
}
const cloneTables = [...action].filter(([, a]) => a === "clone_from_template").map(([t]) => t);
const onboardTables = new Set(
  [...action].filter(([, a]) => ["clone_from_template", "from_excel_org", "from_excel_txn"].includes(a)).map(([t]) => t),
);

// ── parse columns ─────────────────────────────────────────────────────────
const metas: Record<string, TableMeta> = {};
function ensure(name: string, schema: string): TableMeta {
  return (metas[name] ??= { name, schema, identityCol: null, columns: [], pk: [], fks: [] });
}
for (const line of readLines(docs("core2_columns_full.csv"))) {
  const p = line.split("|");
  if (p.length < 10) continue;
  const name = bare(p[0]);
  const m = ensure(name, schemaOf(p[0]));
  const col: ColumnMeta = {
    name: p[1],
    dtype: p[2],
    maxLen: Number(p[3]),
    precision: Number(p[4]),
    scale: Number(p[5]),
    isNullable: p[6] === "1",
    isIdentity: p[7] === "1",
    isComputed: false,
    hasDefault: (p[8] ?? "").length > 0,
  };
  m.columns.push(col);
  if (col.isIdentity) m.identityCol = col.name;
}

// ── parse keys ────────────────────────────────────────────────────────────
const allFks: FkMeta[] = [];
for (const line of readLines(docs("core2_keys.csv"))) {
  const p = line.split("|");
  if (p[0] === "PK") {
    const t = bare(p[1]);
    if (metas[t]) metas[t].pk.push(p[2]);
  } else if (p[0] === "FK") {
    const child = bare(p[1]);
    const refTable = bare(p[3]);
    const fk: FkMeta = { child, col: p[2], refTable, refCol: p[4] };
    allFks.push(fk);
    if (metas[child]) metas[child].fks.push(fk);
  }
}

// ── build plan + emit ─────────────────────────────────────────────────────
const plan = buildClonePlan({ cloneTables, metas, allFks, onboardTables });
const sqlText = emitCloneSql(plan, metas, { transaction: true });
const outFile = docs("clone_tenant_config.sql");
writeFileSync(outFile, sqlText, "utf8");

const inline = plan.steps.reduce((n, s) => n + s.inlineRemap.length, 0);
const deferred = plan.steps.reduce((n, s) => n + s.deferredRemap.length, 0);
console.log(`clone tables:        ${plan.steps.length}`);
console.log(`id-maps captured:    ${plan.mapTables.length}`);
console.log(`inline FK remaps:    ${inline}`);
console.log(`deferred FK remaps:  ${deferred}`);
console.log(`cycle tables:        ${plan.cycleTables.length} -> ${plan.cycleTables.join(", ")}`);
console.log(`wrote ${path.relative(ROOT, outFile)} (${sqlText.split("\n").length} lines)`);
