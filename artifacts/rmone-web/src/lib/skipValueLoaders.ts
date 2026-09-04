/**
 * Skip-rule value loaders — the async data fetchers that back the "is <value>"
 * dropdown on Stage Rules skip conditions.
 *
 * Extracted from StageRulesSettings so they can be imported in pure-TS tests
 * without pulling in React or JSX.  The component imports from here; the test
 * suite imports from here too.
 *
 * SKIP_FIELD_SUGGESTIONS  — the curated set of field options shown first in
 *   the condition-field picker.  WorkflowTypeName is intentionally absent from
 *   SKIP_VALUE_LOADERS because its value options come from the admin's own
 *   workflow-type list (no data fetch needed).
 *
 * SKIP_VALUE_LOADERS — lazily loads the value options for each field so the
 *   "is …" cell becomes a <select>:
 *     · record-value fields (Sector, City, State, Office, …) scan the DISTINCT
 *       values actually in the tenant's data, scoped to the asking module's
 *       table when one is passed;
 *     · org fields (Business Unit, Division, Department) read the tenant's org
 *       catalogs and offer NAMES — skip conditions compare against the name
 *       the record page displays (its display chains), never a raw lookup id.
 *   Only fields that need a fetch appear here; WorkflowTypeName is absent on
 *   purpose.  Fields with no loader fall back to a free-text input.
 *
 * makeSkipValCache — pure factory that encapsulates the caching logic (the
 *   same logic the component runs via useRef + useState(version)) in a form
 *   that can be driven from tests with injected fake loaders.
 */

import { getFieldOptions, getBusinessUnits, getDivisions, getDepartments } from "./api";
import type { StageSkipRule, StageRuleModule } from "./stageRules";

export const SKIP_FIELD_SUGGESTIONS: { value: string; label: string }[] = [
  // Workflow Type — admin-named variants defined on the Workflow tab; value
  // options come straight from that list (no data fetch).
  { value: "WorkflowTypeName", label: "Workflow Type" },
  { value: "SectorChoice",     label: "Sector" },
  { value: "ProjectType",      label: "Project Type" },
  { value: "ServiceType",      label: "Service Type" },
  { value: "RequestCategory",  label: "Request Category" },
  { value: "CRMBusinessUnitChoice", label: "Business Unit" },
];

/** Loaders receive the module whose editor is asking (PMM/OPM/LEM) so
 *  record-value scans hit that module's table — a Leads rule needs City
 *  values from the Lead table, not from projects.  Org-catalog loaders
 *  (BU / Division / Department) ignore it: the org tree is tenant-wide. */
export type SkipValueLoader = (mod?: StageRuleModule) => Promise<string[]>;

async function loadDivisionNames(): Promise<string[]> {
  const rows = (await getDivisions()) as { Title?: string | null; ShortName?: string | null }[];
  // Title first — the record page's division display chain starts at the
  // CompanyDivisions Title, so that's the value skip conditions compare with.
  return [...new Set(rows.map(d => String(d?.Title || d?.ShortName || "").trim()).filter(Boolean))];
}

async function loadDepartmentNames(): Promise<string[]> {
  const rows = (await getDepartments()) as Record<string, unknown>[];
  // Name-only de-dupe is correct here: the same department name may exist
  // under different divisions, but as a VALUE the condition compares text.
  return [...new Set(rows.map(d => String((d?.Title as string) || (d?.Name as string) || "").trim()).filter(Boolean))];
}

export const SKIP_VALUE_LOADERS: Record<string, SkipValueLoader> = {
  SectorChoice:    (mod) => getFieldOptions("sector", mod),
  ProjectType:     (mod) => getFieldOptions("projecttype", mod),
  ServiceType:     (mod) => getFieldOptions("servicetype", mod),
  RequestCategory: (mod) => getFieldOptions("requestcategory", mod),
  // Location / office text columns — distinct values from the tenant's own
  // records (module-scoped). Empty result → free-text input stays.
  City:            (mod) => getFieldOptions("city", mod),
  State:           (mod) => getFieldOptions("state", mod),
  Office:          (mod) => getFieldOptions("office", mod),
  CRMBusinessUnitChoice: async () => {
    const bus = (await getBusinessUnits()) as any[];
    return [...new Set(
      bus.map(b => String(b?.ShortName || b?.Title || b?.Name || "").trim()).filter(Boolean),
    )];
  },
  // Division / Department — BOTH key variants registered: the curated PMM/OPM
  // catalog entries use the *Lookup FieldNames while the shared extra-field
  // catalog (and thus the Leads picker) uses the bare names.
  DivisionLookup:   loadDivisionNames,
  Division:         loadDivisionNames,
  DepartmentLookup: loadDepartmentNames,
  Department:       loadDepartmentNames,
};

/**
 * Pure caching factory — encapsulates the ensureSkipVals + skipValsFor pattern
 * used inside the component.  Pass a custom `loaders` map to inject fakes in
 * tests; omit it (or pass undefined) to use the real SKIP_VALUE_LOADERS.
 *
 * Returns:
 *   ensureSkipVals(field, onLoad?, mod?) — kicks off the load if not cached
 *     yet; calls onLoad() once the cache entry lands (mirrors the component's
 *     setSkipValVersion bump that triggers a re-render).  `mod` scopes the
 *     fetch AND the cache entry — PMM and LEM values for the same field are
 *     cached separately.
 *   skipValsFor(field, mod?) — returns the cached values, or [] when not yet
 *     loaded or when the field has no loader (free-text fallback).
 *   cache — the underlying Map (exposed for inspection in tests).
 */
export function makeSkipValCache(loaders: Record<string, SkipValueLoader> = SKIP_VALUE_LOADERS) {
  const cache = new Map<string, string[]>();
  // Module-less callers keep the bare-field key (existing tests rely on it).
  const keyOf = (field: string, mod?: StageRuleModule) => (mod ? `${mod}|${field}` : field);

  function ensureSkipVals(field: string, onLoad?: () => void, mod?: StageRuleModule): void {
    // No loader for this field — value options must come from another source
    // (e.g. WorkflowTypeName uses the admin's own type list).  Call onLoad
    // immediately so callers that await via Promise wrapping don't hang.
    if (!field || !loaders[field]) { onLoad?.(); return; }
    const key = keyOf(field, mod);
    // Already cached (loaded or in-flight placeholder set): nothing to do.
    if (cache.has(key)) { onLoad?.(); return; }
    // Mark as in-flight immediately (empty placeholder) so parallel calls for
    // the same field don't fire the loader twice — mirrors the component's
    // ref-has() check.
    cache.set(key, []);
    loaders[field](mod)
      .then(vals => {
        cache.set(key, vals.filter(v => v.trim().length > 0).sort());
        onLoad?.();
      })
      .catch(() => {
        // Keep the empty placeholder so we don't retry on every render.
        onLoad?.();
      });
  }

  function skipValsFor(field: string, mod?: StageRuleModule): string[] {
    return cache.get(keyOf(field, mod)) ?? [];
  }

  return { ensureSkipVals, skipValsFor, cache };
}

/**
 * loadSkipValueOpts — pure async helper that drives the outer SkipsCard's
 * skipValueOpts state in StageRulesSettings.  Extracted from the useEffect so
 * the decision logic (tenant guard, field iteration, loader invocation, prev
 * guard) can be unit-tested without mounting the React component.
 *
 * The component keeps the alive-flag cancellation wrapper around this call
 * (React unmount concern only); everything else lives here.
 *
 * tenantId semantics (same as the component):
 *   undefined — own-company admin: loaders run.
 *   string    — superadmin editing a specific company: returns currentOpts unchanged.
 *   null      — superadmin, no company selected: returns currentOpts unchanged.
 *
 * Returns a new opts map.  Existing entries in currentOpts are never
 * overwritten (mirrors the component's `prev[f] !== undefined` guard).
 * Fields with no loader stay absent so the free-text <input> fallback applies.
 * Loader failures are swallowed silently — the dropdown is a convenience;
 * free text always works.
 */
export async function loadSkipValueOpts(
  stageSkips: StageSkipRule[],
  tenantId: string | null | undefined,
  currentOpts: Record<string, string[]>,
  loaders: Record<string, SkipValueLoader> = SKIP_VALUE_LOADERS,
): Promise<Record<string, string[]>> {
  // Cross-tenant guard: superadmin editing another company (string) or no
  // company selected (null) must not fetch values from the wrong tenant.
  if (tenantId !== undefined) return currentOpts;

  const result: Record<string, string[]> = { ...currentOpts };
  const promises: Promise<void>[] = [];

  // First rule wins per field: that rule's module scopes the value fetch
  // (org-catalog loaders ignore it). The opts map stays keyed by field.
  const fieldMod = new Map<string, StageRuleModule | undefined>();
  for (const r of stageSkips) if (!fieldMod.has(r.field)) fieldMod.set(r.field, r.module);

  for (const [f, m] of fieldMod) {
    // No loader for this field (e.g. WorkflowTypeName uses the workflow-type
    // list directly), or the field is already populated — skip.
    if (!loaders[f] || result[f] !== undefined) continue;
    promises.push(
      loaders[f](m)
        .then(opts => {
          // Mirror the component's prev guard: don't overwrite if a parallel
          // call for the same field already landed.
          if (result[f] === undefined) result[f] = opts;
        })
        .catch(() => {
          // Dropdown is a convenience — free text still works.
        }),
    );
  }

  await Promise.all(promises);
  return result;
}
