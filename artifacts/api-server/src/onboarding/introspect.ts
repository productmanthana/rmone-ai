/**
 * Live SQL Server introspection → TableMeta[] for the clone engine.
 *
 * Reads real column / identity / computed / primary-key / foreign-key metadata
 * from the core2 catalog views, so the clone plan always matches the actual
 * target database (no baked-in guesses). Catalog views are queried with the
 * database name prefixed (default "core2") because the pool may default to the
 * `master` database.
 *
 * PERFORMANCE: the RDS link is high-latency, so streaming the full schema's
 * ~16k columns is slow (tens of seconds) even with large TDS packets. The
 * column/PK scans are therefore SCOPED to the tables the caller actually needs
 * (the clone-config set) — a ~75-table scope returns a few thousand rows and
 * finishes in a few seconds. The FK scan is left global because it returns only
 * a few hundred rows regardless. Pass `tables` to scope; omit it to read all.
 */
import type { ConnectionPool } from "mssql";
import type { TableMeta, FkMeta, ColumnMeta } from "./types.js";

const CORE_DB = process.env.CLIENT_DB_NAME ?? "core2";

/** Build a SQL IN (...) literal list from bare table names. Names come from the
 *  trusted roles.ts constants; single quotes are escaped defensively anyway. */
function inList(names: readonly string[]): string {
  return names.map((n) => `'${n.replace(/'/g, "''")}'`).join(", ");
}

export interface IntrospectOptions {
  /** restrict the column + primary-key scans to these bare table names.
   *  Omit to introspect every table (slow on large schemas). */
  tables?: readonly string[];
}

export async function introspectSchema(
  pool: ConnectionPool,
  opts: IntrospectOptions = {},
): Promise<{
  metas: Record<string, TableMeta>;
  allFks: FkMeta[];
}> {
  const db = `[${CORE_DB}]`;
  const scope = opts.tables && opts.tables.length
    ? `AND t.name IN (${inList(opts.tables)})`
    : "";

  const colsRes = await pool.request().query(`
    SELECT s.name AS sch, t.name AS tbl, c.name AS col, ty.name AS dtype,
           c.max_length AS maxLen, c.precision AS prec, c.scale AS scale,
           c.is_nullable AS isNullable, c.is_identity AS isIdentity,
           c.is_computed AS isComputed,
           CASE WHEN c.default_object_id <> 0 THEN 1 ELSE 0 END AS hasDefault,
           c.column_id AS ordinal
    FROM ${db}.sys.columns c
    JOIN ${db}.sys.tables t  ON t.object_id = c.object_id
    JOIN ${db}.sys.schemas s ON s.schema_id = t.schema_id
    JOIN ${db}.sys.types ty  ON ty.user_type_id = c.user_type_id
    WHERE 1 = 1 ${scope}
  `);

  // Sort in JS (by table, then column ordinal) — an ORDER BY on the catalog scan
  // is disproportionately expensive over the RDS link.
  const colRows = (colsRes.recordset as any[]).slice().sort((a, b) =>
    a.tbl === b.tbl ? a.ordinal - b.ordinal : a.tbl < b.tbl ? -1 : 1,
  );

  const metas: Record<string, TableMeta> = {};
  for (const r of colRows) {
    const meta = (metas[r.tbl] ??= {
      name: r.tbl, schema: r.sch, identityCol: null, columns: [], pk: [], fks: [],
    });
    const col: ColumnMeta = {
      name: r.col,
      dtype: r.dtype,
      maxLen: r.maxLen,
      precision: r.prec,
      scale: r.scale,
      isNullable: !!r.isNullable,
      isIdentity: !!r.isIdentity,
      isComputed: !!r.isComputed,
      hasDefault: !!r.hasDefault,
    };
    meta.columns.push(col);
    if (col.isIdentity) meta.identityCol = col.name;
  }

  const pkRes = await pool.request().query(`
    SELECT t.name AS tbl, col.name AS col
    FROM ${db}.sys.indexes i
    JOIN ${db}.sys.tables t ON t.object_id = i.object_id
    JOIN ${db}.sys.index_columns ic ON ic.object_id = i.object_id AND ic.index_id = i.index_id
    JOIN ${db}.sys.columns col ON col.object_id = ic.object_id AND col.column_id = ic.column_id
    WHERE i.is_primary_key = 1 ${scope}
  `);
  for (const r of pkRes.recordset as any[]) metas[r.tbl]?.pk.push(r.col);

  const fkRes = await pool.request().query(`
    SELECT t.name AS child, cpa.name AS col, rt.name AS refTable, cref.name AS refCol
    FROM ${db}.sys.foreign_keys fk
    JOIN ${db}.sys.tables t ON t.object_id = fk.parent_object_id
    JOIN ${db}.sys.foreign_key_columns fkc ON fkc.constraint_object_id = fk.object_id
    JOIN ${db}.sys.columns cpa ON cpa.object_id = fkc.parent_object_id AND cpa.column_id = fkc.parent_column_id
    JOIN ${db}.sys.tables rt ON rt.object_id = fk.referenced_object_id
    JOIN ${db}.sys.columns cref ON cref.object_id = fkc.referenced_object_id AND cref.column_id = fkc.referenced_column_id
  `);
  const allFks: FkMeta[] = [];
  for (const r of fkRes.recordset as any[]) {
    const fk: FkMeta = { child: r.child, col: r.col, refTable: r.refTable, refCol: r.refCol };
    allFks.push(fk);
    metas[r.child]?.fks.push(fk);
  }

  return { metas, allFks };
}
