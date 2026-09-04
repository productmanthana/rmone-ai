// Schedule-window rule: does a record's team-member date window follow the
// phase schedule? Mirrors the web client's resolution so the API rejects
// out-of-schedule member dates even from callers that bypass the UI.
//
// SECURITY INVARIANT — client input can only TIGHTEN, never loosen:
// the server derives its own answer from trusted tenant settings and the
// record's module; a request-supplied boolean may switch enforcement ON
// (e.g. a record overridden INTO a schedule view on this device) but a
// client `false` can NEVER disable the server-derived gate. Per-record
// display-mode overrides are a per-device LAYOUT preference in client
// storage — a layout choice must not change which data the tenant accepts,
// and untrusted request input must never turn off server validation.
//
// Server-derived resolution: the tenant display mode for the record's
// MODULE decides — projects (PMM) follow projectDisplayMode, opportunities
// and leads (OPM/LEM) follow oppDisplayMode. Only the schedule-following
// modes ("full", "schedule-no-grid") bind member dates to the phase window;
// the no-schedule modes keep the free-form planner contract.
export type ScheduleWindowDisplayModes = {
  projectDisplayMode?: string | null;
  oppDisplayMode?: string | null;
};

/** True when a display mode binds member dates to the phase schedule. */
export function isScheduleFollowingMode(mode: string | null | undefined): boolean {
  return mode === "full" || mode === "schedule-no-grid";
}

/**
 * Should the schedule window be enforced for this save?
 *
 * @param clientResolved record-resolved answer from a record-aware client.
 *   `true` tightens (enforce even when tenant settings say free); `false`
 *   and absent are treated identically — the server-derived answer governs.
 * @param module resolved record module ("PMM" / "OPM" / "LEM"); unknown
 *   modules use the project rule, matching the legacy default.
 */
export function resolveScheduleWindowEnforced(
  clientResolved: boolean | undefined,
  module: string | null | undefined,
  rules: ScheduleWindowDisplayModes,
): boolean {
  const mode = module === "OPM" || module === "LEM"
    ? rules.oppDisplayMode
    : rules.projectDisplayMode;
  const serverResolved = isScheduleFollowingMode(mode);
  return serverResolved || clientResolved === true;
}

export type ScheduleWindowSaveDeps = {
  /** Record-resolved answer from a record-aware client (tighten-only). */
  clientResolved: boolean | undefined;
  /**
   * Refresh the tenant-scoped custom-ticket cache for THIS record id.
   * Custom (non-OPM/LEM-prefixed) opportunity and lead TicketIds resolve
   * through that cache — resolving the module against a cold or stale cache
   * mis-routes them to the PROJECT rule (wrong mode in either direction).
   */
  ensureCustomTickets: () => Promise<void>;
  /** Resolve the record's module — called only AFTER the ensure settles. */
  resolveModule: () => string | null | undefined;
  loadRules: () => Promise<ScheduleWindowDisplayModes>;
};

/**
 * Full save-path composition — the ONE place that owns ordering and failure
 * policy so every write path behaves identically:
 *   1. an explicit client `true` tightens without any lookup;
 *   2. the custom-ticket cache is ensured BEFORE module resolution;
 *   3. tenant rules are read and the tighten-only resolution applies;
 *   4. any lookup failure fails CLOSED (enforce) — a broken settings or
 *      cache read must never silently open the window.
 */
export async function enforcedForRecordSave(deps: ScheduleWindowSaveDeps): Promise<boolean> {
  if (deps.clientResolved === true) return true;
  try {
    await deps.ensureCustomTickets();
    const rules = await deps.loadRules();
    return resolveScheduleWindowEnforced(deps.clientResolved, deps.resolveModule(), rules);
  } catch {
    return true;
  }
}
