/**
 * Tenant configuration clone — runtime entry point.
 *
 * Clones every category-A (configured-portal) table from a template tenant into
 * a new tenant inside the same core2 database, regenerating identities and
 * re-pointing surrogate-id foreign keys. Org (B) and transactional (C) data are
 * layered on afterwards by the main pipeline from the client's Excel.
 *
 *   await cloneTenantConfig(pool, { newTenantId });            // run it
 *   const sql = await previewCloneSql(pool, { newTenantId });  // dry-run, no writes
 */
import type { ConnectionPool } from "mssql";
import sql from "mssql";
import { introspectSchema } from "./introspect.js";
import { buildClonePlan } from "./plan.js";
import { emitCloneSql } from "./sql.js";
import { CLONE_CONFIG_TABLES, ONBOARD_TABLES, TEMPLATE_TENANT_ID } from "./roles.js";

export interface CloneOptions {
  /** tenant id (GUID string) to create the configuration under */
  newTenantId: string;
  /** template tenant to clone FROM (defaults to LiRo POC / LiRoDemo) */
  templateTenantId?: string;
  /** wrap the clone in a single transaction (default true) */
  transaction?: boolean;
}

async function planAndEmit(pool: ConnectionPool, opts: CloneOptions) {
  // Scope the (slow) column/PK introspection to just the clone-config tables —
  // the planner only needs metadata for those. FKs are read globally (cheap).
  const { metas, allFks } = await introspectSchema(pool, { tables: CLONE_CONFIG_TABLES });
  // only clone tables that actually exist in the live schema
  const cloneTables = CLONE_CONFIG_TABLES.filter((t) => metas[t]);
  const missing = CLONE_CONFIG_TABLES.filter((t) => !metas[t]);
  const plan = buildClonePlan({
    cloneTables,
    metas,
    allFks,
    onboardTables: new Set(ONBOARD_TABLES),
  });
  const text = emitCloneSql(plan, metas, {
    transaction: opts.transaction ?? true,
    database: process.env.CLIENT_DB_NAME ?? "core2",
  });
  return { plan, text, missing };
}

/** Build the clone SQL without executing it (for review / debugging). */
export async function previewCloneSql(
  pool: ConnectionPool,
  opts: CloneOptions,
): Promise<{ sql: string; cloneTables: number; missing: string[]; cycleTables: string[] }> {
  const { plan, text, missing } = await planAndEmit(pool, opts);
  return {
    sql: text,
    cloneTables: plan.steps.length,
    missing,
    cycleTables: plan.cycleTables,
  };
}

export interface CloneResult {
  cloneTables: number;
  missing: string[];
  cycleTables: string[];
  ok: boolean;
}

/** Execute the configuration clone against the live database. */
export async function cloneTenantConfig(
  pool: ConnectionPool,
  opts: CloneOptions,
): Promise<CloneResult> {
  if (!opts.newTenantId || !/^[0-9a-fA-F-]{36}$/.test(opts.newTenantId)) {
    throw new Error("cloneTenantConfig: newTenantId must be a 36-char GUID");
  }
  const template = opts.templateTenantId ?? TEMPLATE_TENANT_ID;
  if (opts.newTenantId.toLowerCase() === template.toLowerCase()) {
    throw new Error("cloneTenantConfig: newTenantId must differ from the template tenant");
  }

  const { plan, text, missing } = await planAndEmit(pool, opts);

  // The emitted script DECLAREs its own parameters at the top; replace those
  // placeholder DECLAREs with the real values via request parameters instead.
  const body = text
    .replace(/DECLARE @TemplateTenantID[^\n]*\n/, "")
    .replace(/DECLARE @NewTenantID[^\n]*\n/, "");
  const header =
    `DECLARE @TemplateTenantID NVARCHAR(256) = @p_template;\n` +
    `DECLARE @NewTenantID NVARCHAR(256) = @p_new;\n`;

  await pool
    .request()
    .input("p_template", sql.NVarChar(256), template)
    .input("p_new", sql.NVarChar(256), opts.newTenantId)
    .batch(header + body);

  return {
    cloneTables: plan.steps.length,
    missing,
    cycleTables: plan.cycleTables,
    ok: true,
  };
}
