/**
 * Per-project team-layout override.
 *
 * Settings → Projects & Opportunities → "Visible sections" picks the
 * company-wide display mode (and the import pipeline may auto-detect it from
 * the uploaded assignment shape). This store lets a user override that layout
 * for ONE project at a time from the team card's "Schedule View" dropdown.
 *
 * - The choice is saved in tenant-scoped localStorage (same pattern as other
 *   per-tenant UI preferences, e.g. custom stage ordering), so it never leaks
 *   across companies on a shared browser and survives reloads on this device.
 * - "Default" (null) clears the override — the project then follows the
 *   company setting again, INCLUDING future auto-detect changes from imports.
 * - ADMIN WINS AFTER THE FACT: each override remembers the company setting it
 *   was chosen AGAINST (its "base"). When an admin later changes the Settings
 *   display mode for that module, the base no longer matches and the override
 *   is dropped — the record snaps to the new company setting on every surface
 *   (record detail + Quick Actions popup). A user can re-pick a view after
 *   that, which stamps the new base and again holds until the NEXT admin
 *   change. Entries saved before this rule existed carry no base and are
 *   dropped once the real settings load (one-time migration).
 * - Leads (LEM) ignore display modes entirely (they always render the no-grid
 *   table), so callers must not offer the picker on lead records.
 */
import { useSyncExternalStore } from "react";
import { tenantScopedKey } from "@/lib/api";
import {
  getDisplayModeFor, hasBusinessRulesLoaded, subscribeBusinessRules,
  type BusinessRules,
} from "@/lib/businessRules";

export type ProjViewMode = BusinessRules["projectDisplayMode"];

const ALL_MODES: ProjViewMode[] = [
  "full", "no-schedule", "schedule-no-grid", "no-schedule-no-grid", "no-schedule-no-hours",
];

/** Display names/descriptions — kept in step with the Settings page dropdown. */
export const MODE_LABELS: Record<ProjViewMode, { name: string; desc: string }> = {
  "full":                 { name: "Full View",       desc: "schedule phases + weekly hours grid" },
  "no-schedule":          { name: "Hours Grid Only", desc: "weekly hours grid, no schedule" },
  "schedule-no-grid":     { name: "Schedule + Table", desc: "phases shown, table/Gantt view" },
  "no-schedule-no-grid":  { name: "Table / Gantt",   desc: "no schedule, no weekly grid" },
  "no-schedule-no-hours": { name: "Summary Only",    desc: "names & roles only" },
};

/** Which layouts include the phase schedule. Drives the colored
 *  "Schedule / No schedule" badge in the per-project picker AND the Settings
 *  dropdown, so users can tell at a glance which layouts enforce the
 *  schedule-window date rules (member dates are only bounded when the
 *  schedule is part of the layout). */
export const MODE_HAS_SCHEDULE: Record<ProjViewMode, boolean> = {
  "full":                 true,
  "no-schedule":          false,
  "schedule-no-grid":     true,
  "no-schedule-no-grid":  false,
  "no-schedule-no-hours": false,
};

export const MODE_GROUPS: { label: string; modes: ProjViewMode[] }[] = [
  { label: "With weekly hours grid",    modes: ["full", "no-schedule"] },
  { label: "Without weekly hours grid", modes: ["schedule-no-grid", "no-schedule-no-grid", "no-schedule-no-hours"] },
];

const BASE_KEY = "rmone:projViewMode:v1";

/** One saved override:
 *  - `m`   the picked mode;
 *  - `b`   the company setting it was picked AGAINST (its base);
 *  - `mod` the record's module ("PMM"/"OPM"…), so the sweep can resolve the
 *          right company setting without a caller;
 *  - `p`   pending: picked BEFORE the real settings loaded — the base is
 *          stamped from the first successful fetch instead of the built-in
 *          defaults (a pre-existing server setting is NOT an "admin change
 *          made after the pick").
 *  A missing `b` without `p` marks a pre-migration entry — dropped once the
 *  real settings load, because we can't tell whether the admin changed the
 *  setting since it was saved (admin-wins policy fails closed). */
interface OverrideEntry { m: ProjViewMode; b?: ProjViewMode; mod?: string; p?: 1 }

let cache: Record<string, OverrideEntry> | null = null;
let cacheKey = "";
let ver = 0;
const listeners = new Set<() => void>();

function storageKey(): string {
  return tenantScopedKey(BASE_KEY);
}

/** Lazy-load the per-tenant map; re-loads automatically after a tenant switch
 *  because the storage key (and therefore `cacheKey`) changes. */
function load(): Record<string, OverrideEntry> {
  const k = storageKey();
  if (cache && cacheKey === k) return cache;
  cacheKey = k;
  cache = {};
  try {
    const raw = localStorage.getItem(k);
    if (raw) {
      const obj: unknown = JSON.parse(raw);
      if (obj && typeof obj === "object") {
        for (const [id, v] of Object.entries(obj as Record<string, unknown>)) {
          // Legacy shape: bare mode string (no base recorded).
          if (typeof v === "string" && (ALL_MODES as string[]).includes(v)) {
            cache[id] = { m: v as ProjViewMode };
            continue;
          }
          // Current shape: { m, b?, mod?, p? }.
          if (v && typeof v === "object") {
            const m = (v as { m?: unknown }).m;
            const b = (v as { b?: unknown }).b;
            const mod = (v as { mod?: unknown }).mod;
            const p = (v as { p?: unknown }).p;
            if (typeof m === "string" && (ALL_MODES as string[]).includes(m)) {
              cache[id] = {
                m: m as ProjViewMode,
                ...(typeof b === "string" && (ALL_MODES as string[]).includes(b)
                  ? { b: b as ProjViewMode }
                  : {}),
                ...(typeof mod === "string" && mod ? { mod } : {}),
                ...(p ? { p: 1 as const } : {}),
              };
            }
          }
        }
      }
    }
  } catch { /* corrupted entry — start clean */ }
  return cache;
}

function persist(): void {
  try {
    const k = storageKey();
    if (cache && Object.keys(cache).length > 0) localStorage.setItem(k, JSON.stringify(cache));
    else localStorage.removeItem(k);
  } catch { /* storage full/blocked — the in-memory value still applies */ }
}

function bump(): void {
  ver++;
  listeners.forEach(fn => { try { fn(); } catch { /* listener gone */ } });
}

const norm = (id: string) => id.trim().toLowerCase();

/**
 * The saved override for a record, or null when it follows the company default.
 *
 * Admin-wins staleness check (READ-ONLY — no mutation during render): once the
 * REAL settings have loaded (hasBusinessRulesLoaded), an override whose
 * recorded base no longer matches the current company setting for this module
 * — or a pre-migration entry with no base — reads as null. The actual storage
 * cleanup happens in sweepStale(), which runs on every business-rules change
 * (including the readiness flip itself), outside render.
 */
export function getProjectViewOverride(recordId: string | null | undefined, module?: string | null): ProjViewMode | null {
  if (!recordId || !recordId.trim()) return null;
  const entry = load()[norm(recordId)];
  if (!entry) return null;
  if (!hasBusinessRulesLoaded()) return entry.m; // defaults are not "the setting"
  if (entry.p) return entry.m;                   // base pending — stamped by the sweep
  if (entry.b === undefined) return null;        // pre-migration entry: admin-wins fails closed
  return entry.b === getDisplayModeFor(module) ? entry.m : null;
}

/** Save (or with null: clear) the layout override for one record. Stamps the
 *  CURRENT company setting for the record's module as the override's base, so
 *  a later admin settings change invalidates it (admin wins). A pick made
 *  before the settings fetch resolves is stored base-PENDING and stamped from
 *  the first successful fetch instead (see OverrideEntry.p). */
export function setProjectViewOverride(recordId: string, mode: ProjViewMode | null, module?: string | null): void {
  if (!recordId || !recordId.trim()) return;
  const map = load();
  const key = norm(recordId);
  const mod = String(module ?? "").toUpperCase();
  if (mode === null) {
    if (!(key in map)) return;
    delete map[key];
  } else {
    const next: OverrideEntry = hasBusinessRulesLoaded()
      ? { m: mode, b: getDisplayModeFor(module), ...(mod ? { mod } : {}) }
      : { m: mode, p: 1, ...(mod ? { mod } : {}) };
    const cur = map[key];
    if (cur && cur.m === next.m && cur.b === next.b && cur.mod === next.mod && cur.p === next.p) return;
    map[key] = next;
  }
  persist();
  bump();
}

/**
 * Drop overrides outranked by an admin settings change, and stamp bases onto
 * picks that were made before the settings loaded. Runs outside render, from
 * the business-rules subscription below (every load/save/tenant re-resolve).
 */
function sweepStale(): void {
  if (!hasBusinessRulesLoaded()) return;
  const map = load();
  let changed = false;
  for (const [key, entry] of Object.entries(map)) {
    const tenantNow = getDisplayModeFor(entry.mod);
    if (entry.p) {
      // First real settings since the pick — THIS is the base it was picked
      // against; only a change made after this point outranks it.
      delete entry.p;
      entry.b = tenantNow;
      changed = true;
    } else if (entry.b === undefined || entry.b !== tenantNow) {
      delete map[key];
      changed = true;
    }
  }
  if (changed) persist();
}

/** Effective display mode for a record: per-project override first, then the
 *  module-aware company setting (getDisplayModeFor). */
export function getDisplayModeForRecord(recordId: string | null | undefined, module?: string | null): ProjViewMode {
  return getProjectViewOverride(recordId, module) ?? getDisplayModeFor(module);
}

const subscribe = (fn: () => void) => {
  listeners.add(fn);
  return () => { listeners.delete(fn); };
};

/** Re-render subscription: bumps whenever any per-project override changes. */
export function useProjectViewModeVersion(): number {
  return useSyncExternalStore(subscribe, () => ver, () => 0);
}

// A business-rules change (first load, admin save, tenant switch) can make
// saved overrides stale — sweep the store and bump so every surface subscribed
// via useProjectViewModeVersion re-resolves its display mode immediately, even
// if it doesn't also subscribe to the business-rules version.
subscribeBusinessRules(() => { sweepStale(); bump(); });
