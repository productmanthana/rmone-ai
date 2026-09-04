// Pure classification helpers for import run steps (#390) — kept free of any
// React/DOM imports so the api-server's check:config-steps script can assert
// against the exact classifier the UI uses.

export interface ImportStepLike {
  table: string;
  rowsInserted: number;
  /** Rows that matched an existing record and were updated in place (upsert).
   *  Update-mode runs can legitimately have 0 inserts but many updates — those
   *  are real uploaded-data work, never a "no data" run. */
  rowsUpdated?: number;
  /** Set by the server pipeline on configuration/seed steps. */
  isConfig?: boolean;
}

// Legacy-only fallback for jobs persisted BEFORE the server stamped isConfig.
// Deliberately an EXACT allowlist of the seed-only step names — never a broad
// "Config_*" prefix match: Config_ConfigurationVariable is also a legitimate
// uploaded data table (it's in the pipeline's INSERT_ORDER), and a prefix rule
// misread an import of real configuration-sheet rows as "setup only". The
// OPM seed step's " (OPM)" suffix keeps it distinct from any uploaded table.
// Ambiguous legacy Config_ConfigurationVariable steps therefore classify as
// DATA (the safe direction — never hide real user rows behind a setup label).
const LEGACY_CONFIG_STEP_TABLES = new Set([
  "Tenant",
  "AdminSeed",
  "PortalConfig",
  "Config_ModuleLifeCycles",
  "Config_Module_ModuleStages (OPM)",
]);

/** True when a step is a configuration/seed write rather than data rows from
 *  the uploaded file. Trusts the server's explicit isConfig flag first. */
export const isConfigStep = (s: ImportStepLike): boolean =>
  s.isConfig === true || LEGACY_CONFIG_STEP_TABLES.has(s.table);

/** Sum of data rows across steps (non-config). */
export const sumDataRows = (steps: ImportStepLike[]): number =>
  steps.filter(s => !isConfigStep(s)).reduce((n, s) => n + (s.rowsInserted || 0), 0);

/** Sum of setup/seed rows across steps (config). */
export const sumSetupRows = (steps: ImportStepLike[]): number =>
  steps.filter(isConfigStep).reduce((n, s) => n + (s.rowsInserted || 0), 0);

/** Sum of in-place updates to existing records across data steps. */
export const sumUpdatedRows = (steps: ImportStepLike[]): number =>
  steps.filter(s => !isConfigStep(s)).reduce((n, s) => n + (s.rowsUpdated || 0), 0);
