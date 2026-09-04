/**
 * Emit the T-SQL that clones the category-A configuration of one tenant into a
 * new tenant, from a ClonePlan produced by plan.ts.
 *
 * Strategy per table (already decided in the plan):
 *   • id-referenced tables  → MERGE … OUTPUT to capture old→new id into #map_<t>
 *   • everything else       → plain INSERT … SELECT (identity regenerates)
 *   • TenantID column       → overwritten with the new tenant id
 *   • inline remap columns  → translated via JOIN to a parent's #map during insert
 *   • deferred remap columns→ fixed in a final UPDATE pass (cycles / self refs)
 *
 * No FOREIGN KEY constraints need disabling: a deferred FK column temporarily
 * keeps the template's (still-existing) parent id, so the constraint stays
 * satisfied until the final UPDATE re-points it at the new id.
 */
import type { ClonePlan, CloneStep, TableMeta } from "./types.js";

const TEMPLATE_PARAM = "@TemplateTenantID";
const NEW_PARAM = "@NewTenantID";

function brk(id: string): string {
  return `[${id.replace(/]/g, "]]")}]`;
}

/** Fully-qualified table name `[db].[schema].[table]`. The clone runs over a pool
 *  that may default to `master`, so real tables MUST carry the database prefix —
 *  session temp tables (#map_*) are unaffected and stay unqualified. */
function qname(db: string, schema: string, table: string): string {
  return `${brk(db)}.${brk(schema)}.${brk(table)}`;
}

/** SQL type string for a #map id column, derived from the key column (identity
 *  or regenerated GUID PK). GUID-string keys are widened to NVARCHAR(450) so the
 *  old value always fits regardless of the source column's declared length. */
function keyColType(meta: TableMeta, keyCol: string | null): string {
  const c = meta.columns.find((x) => x.name === keyCol);
  const t = (c?.dtype ?? "bigint").toLowerCase();
  switch (t) {
    case "int": return "INT";
    case "smallint": return "SMALLINT";
    case "tinyint": return "TINYINT";
    case "uniqueidentifier": return "UNIQUEIDENTIFIER";
    case "nvarchar": case "nchar": return "NVARCHAR(450)";
    case "varchar": case "char": return "VARCHAR(900)";
    default: return "BIGINT";
  }
}

function remapAlias(col: string, parent: string): string {
  return `m_${col}__${parent}`;
}

function selectExpr(step: CloneStep, col: string): string {
  if (step.tenantCol && col === step.tenantCol) return `${NEW_PARAM} AS ${brk(col)}`;
  if (step.pkRegen && col === step.pkRegen.col) return `${step.pkRegen.expr} AS ${brk(col)}`;
  const remap = step.inlineRemap.find((r) => r.col === col);
  if (remap) {
    const alias = remapAlias(remap.col, remap.parent);
    return `ISNULL(${brk(alias)}.[newID], src.${brk(col)}) AS ${brk(col)}`;
  }
  return `src.${brk(col)} AS ${brk(col)}`;
}

function inlineJoins(step: CloneStep): string[] {
  return step.inlineRemap.map((r) => {
    const alias = remapAlias(r.col, r.parent);
    return `    LEFT JOIN #map_${r.parent} AS ${brk(alias)} ON ${brk(alias)}.[oldID] = src.${brk(r.col)}`;
  });
}

function emitStep(step: CloneStep, metas: Record<string, TableMeta>, db: string): string {
  const tbl = qname(db, step.schema, step.table);
  const cols = step.insertColumns;
  const colList = cols.map(brk).join(", ");
  const lines: string[] = [];
  lines.push(`PRINT N'-- cloning ${step.table} (${cols.length} cols)';`);

  if (step.idReferenced) {
    const meta = metas[step.table];
    const keyCol = step.keyCol ?? step.identityCol!;
    const mapType = keyColType(meta, keyCol);
    lines.push(`IF OBJECT_ID('tempdb..#map_${step.table}') IS NOT NULL DROP TABLE #map_${step.table};`);
    lines.push(`CREATE TABLE #map_${step.table} (oldID ${mapType} NOT NULL, newID ${mapType} NOT NULL);`);
    const sel = [
      ...cols.map((c) => "      " + selectExpr(step, c)),
      `      src.${brk(keyCol)} AS __oldid`,
    ].join(",\n");
    const joins = inlineJoins(step);
    lines.push(
      `MERGE INTO ${tbl} AS tgt`,
      `USING (`,
      `    SELECT`,
      sel,
      `    FROM ${tbl} AS src`,
      ...joins,
      `    WHERE src.${brk(step.tenantCol ?? "TenantID")} = ${TEMPLATE_PARAM}`,
      `) AS S`,
      `ON 1 = 0`,
      `WHEN NOT MATCHED THEN`,
      `  INSERT (${colList})`,
      `  VALUES (${cols.map((c) => `S.${brk(c)}`).join(", ")})`,
      `OUTPUT inserted.${brk(keyCol)}, S.[__oldid] INTO #map_${step.table}(newID, oldID);`,
    );
  } else {
    const sel = cols.map((c) => "    " + selectExpr(step, c)).join(",\n");
    const joins = inlineJoins(step);
    lines.push(
      `INSERT INTO ${tbl} (${colList})`,
      `SELECT`,
      sel,
      `FROM ${tbl} AS src`,
      ...joins,
      `WHERE src.${brk(step.tenantCol ?? "TenantID")} = ${TEMPLATE_PARAM};`,
    );
  }
  return lines.join("\n");
}

function emitDeferred(step: CloneStep, db: string): string | null {
  if (!step.deferredRemap.length || !step.tenantCol) return null;
  const tbl = qname(db, step.schema, step.table);
  const parts: string[] = [];
  for (const r of step.deferredRemap) {
    parts.push(
      `UPDATE c SET c.${brk(r.col)} = m.[newID]`,
      `FROM ${tbl} AS c`,
      `JOIN #map_${r.parent} AS m ON m.[oldID] = c.${brk(r.col)}`,
      `WHERE c.${brk(step.tenantCol)} = ${NEW_PARAM} AND c.${brk(r.col)} IS NOT NULL;`,
    );
  }
  return parts.join("\n");
}

export interface EmitOptions {
  /** when true, wrap the whole clone in a single transaction */
  transaction?: boolean;
  /** database that holds the real tables (default "core2"); the pool may default
   *  to `master`, so every real table is qualified with this. */
  database?: string;
}

export function emitCloneSql(
  plan: ClonePlan,
  metas: Record<string, TableMeta>,
  opts: EmitOptions = {},
): string {
  const db = opts.database ?? "core2";
  const out: string[] = [];
  out.push("/* ============================================================");
  out.push("   RM ONE tenant configuration clone");
  out.push("   Copies all category-A config from a template tenant into a new");
  out.push("   tenant, regenerating identities and re-pointing surrogate-id FKs.");
  out.push("   Set the two parameters below, then run inside core2.");
  out.push("   ============================================================ */");
  out.push(`DECLARE ${TEMPLATE_PARAM} NVARCHAR(256) = N'fcec991c-0b1c-4e41-8200-92c20ea3f536'; -- LiRo POC (LiRoDemo)`);
  out.push(`DECLARE ${NEW_PARAM}      NVARCHAR(256) = N'00000000-0000-0000-0000-000000000000'; -- <-- new tenant id`);
  out.push("SET NOCOUNT ON;");
  out.push("SET XACT_ABORT ON;");
  out.push("");
  if (opts.transaction) out.push("BEGIN TRANSACTION;");
  out.push("");

  out.push("-- ── phase 1/2: clone rows parent-before-child ───────────────────────");
  for (const step of plan.steps) {
    out.push(emitStep(step, metas, db));
    out.push("");
  }

  const deferred = plan.steps.map((s) => emitDeferred(s, db)).filter((s): s is string => !!s);
  if (deferred.length) {
    out.push("-- ── phase 3: re-point cyclic / self-referential foreign keys ────────");
    for (const d of deferred) { out.push(d); out.push(""); }
  }

  if (opts.transaction) { out.push("COMMIT TRANSACTION;"); out.push(""); }
  out.push("PRINT N'-- clone complete';");
  out.push("");
  return out.join("\n");
}
