/**
 * Shared types for the RM ONE tenant-config clone engine.
 *
 * A "TableMeta" is a normalised description of one core2 table — its columns,
 * which column (if any) is the auto-numbered identity, its primary key, and its
 * foreign keys. These come either from live SQL Server introspection
 * (see introspect.ts) or from the metadata CSV snapshot (see
 * scripts/gen-clone-sql.ts) so the exact same planning + SQL code is exercised
 * both in production and in offline tests.
 */

export interface ColumnMeta {
  name: string;
  dtype: string; // e.g. "bigint", "nvarchar", "datetime"
  maxLen: number; // -1 for MAX
  precision: number;
  scale: number;
  isNullable: boolean;
  isIdentity: boolean;
  isComputed: boolean;
  hasDefault: boolean;
}

export interface FkMeta {
  /** child table (bare name, no schema) */
  child: string;
  /** child column holding the reference */
  col: string;
  /** referenced parent table (bare name) */
  refTable: string;
  /** referenced parent column */
  refCol: string;
}

export interface TableMeta {
  name: string; // bare table name (no schema prefix)
  schema: string; // usually "dbo"
  identityCol: string | null;
  columns: ColumnMeta[];
  pk: string[];
  /** foreign keys declared ON this table */
  fks: FkMeta[];
}

/** A single FK column on a clone-target table that must be re-pointed to the
 *  newly-generated parent id. */
export interface RemapRef {
  col: string;
  parent: string; // parent table whose #map_<parent> translates old→new id
}

/** One table's clone instructions, already ordered + resolved. */
export interface CloneStep {
  table: string;
  schema: string;
  identityCol: string | null;
  /** non-identity primary key that must be regenerated on clone (e.g. a GUID
   *  PK with no identity, like LandingPages.Id), and the SQL expression that
   *  produces the new value. null when the key is an identity or none needed. */
  pkRegen: { col: string; expr: string } | null;
  /** the key column captured into #map_<table> — identity col or regenerated
   *  PK col. Other clone tables remap their FKs against this. */
  keyCol: string | null;
  /** true → other onboarded tables reference this table's key, so we must
   *  capture an old→new id map (via MERGE … OUTPUT) while cloning it. */
  idReferenced: boolean;
  /** columns inserted (identity + computed columns excluded) */
  insertColumns: string[];
  /** the tenant column to overwrite with the new tenant id (usually TenantID) */
  tenantCol: string | null;
  /** FK columns remapped inline during the insert (parent map already built) */
  inlineRemap: RemapRef[];
  /** FK columns fixed up after all inserts (cycles / self-refs / forward refs) */
  deferredRemap: RemapRef[];
}

export interface ClonePlan {
  steps: CloneStep[];
  /** tables that need an old→new id map captured (#map_<table>) */
  mapTables: string[];
  /** tables in the clone set that were part of an FK cycle (informational) */
  cycleTables: string[];
}
