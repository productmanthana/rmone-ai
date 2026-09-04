/**
 * Client-side mirror of the admin-tuned "Business rules & thresholds" set on the
 * Onboarding → Settings page. The dashboards (home health score, forecast window)
 * read these so an admin can tune the live math without a code change.
 *
 * Loaded once at app startup into a module-level singleton; the analytics libs
 * read it synchronously via getBusinessRules(). Until the fetch resolves (and if
 * it ever fails) the built-in defaults are used, so behaviour matches the app as
 * it shipped before this feature existed.
 *
 * The SIGNED-IN company's effective layer is read: the global defaults overlaid
 * with that company's own overrides. So a company admin's saved thresholds drive
 * their own live dashboards, while fields they haven't customized fall back to
 * the global defaults. Signed out (or an upstream-RM ONE session the server can't
 * verify for a tenant-scoped read) falls back to the open global layer.
 */

import { useSyncExternalStore } from "react";
import { getStoredUser } from "./api";
import { parseDisplayRules, parsePastEditRules, firstMatchingRule } from "./audienceRules";

export interface BusinessRules {
  workWeekHours: number;
  targetUtilizationPct: number;
  overCapacityPct: number;
  underAllocatedPct: number;
  concentrationPct: number;
  forecastWeeks: number;
  demandUrgencyDays: number;
  proposalCoveragePct: number;
  /**
   * Display label shown wherever a team member's group, office, role, or
   * manager is blank (mirrors the "Label for blank groups" onboarding default).
   * This is a presentation choice, not fabricated data.
   */
  unassignedLabel: string;
  projectDisplayMode: "full" | "no-schedule" | "no-schedule-no-hours" | "no-schedule-no-grid" | "schedule-no-grid";
  /** Opportunity-side (OPM) display mode — configured separately from projects. */
  oppDisplayMode: "full" | "no-schedule" | "no-schedule-no-hours" | "no-schedule-no-grid" | "schedule-no-grid";
  /** When false (default) past-week cells are read-only in the hours grid. */
  allowPastDateEdit: boolean;
  /** When allowPastDateEdit is true, limit editing to this many weeks back. null = unlimited. */
  pastEditLimitWeeks: number | null;
  /** Opportunity-side (OPM) past-week editing rules. */
  oppAllowPastDateEdit: boolean;
  oppPastEditLimitWeeks: number | null;
  /** Day-of-week indices (0=Sun … 6=Sat) treated as non-working. Default [0,6]. */
  nonWorkingDays: number[];
  /** Company holidays: "YYYY-MM-DD" or "YYYY-MM-DD|Label" entries, sorted. */
  holidayDates: string[];
  /** When false, the Business Unit tier is hidden from all create/edit forms. */
  showBusinessUnit: boolean;
  /** When false, the Division tier is hidden from all create/edit forms; bridge divisions keep the FK chain intact. */
  showDivision: boolean;
  /** When false, the Department tier is hidden from all create/edit forms. */
  showDepartment: boolean;
  /**
   * Employment-type name colors: hex ("#rrggbb") used to tint a person's name
   * wherever it appears, keyed by Employee Type. "" = no color. Read through
   * lib/employmentColor.ts — never directly.
   */
  empColorPartTime: string;
  empColorAsNeeded: string;
  empColorScaContingency: string;
  empColorTemporary: string;
  empColorFullTime: string;
}

export const DEFAULT_BUSINESS_RULES: BusinessRules = {
  workWeekHours: 40,
  targetUtilizationPct: 80,
  overCapacityPct: 110,
  underAllocatedPct: 60,
  concentrationPct: 80,
  forecastWeeks: 8,
  demandUrgencyDays: 14,
  proposalCoveragePct: 25,
  unassignedLabel: "Unassigned",
  projectDisplayMode: "full",
  oppDisplayMode: "full",
  allowPastDateEdit: true,
  pastEditLimitWeeks: null,
  oppAllowPastDateEdit: true,
  oppPastEditLimitWeeks: null,
  nonWorkingDays: [0, 6],
  holidayDates: [],
  showBusinessUnit: true,
  showDivision: true,
  showDepartment: true,
  empColorPartTime: "#3B82F6",
  empColorAsNeeded: "#A855F7",
  empColorScaContingency: "#F97316",
  empColorTemporary: "",
  empColorFullTime: "",
};

let current: BusinessRules = { ...DEFAULT_BUSINESS_RULES };

// Bumped every time the rules actually change. React components subscribe to
// this so analytics that read getBusinessRules() inside a useMemo recompute
// once the async fetch resolves (avoiding a startup race) or after an admin
// saves new thresholds.
let version = 0;
const listeners = new Set<() => void>();

// Monotonic token for in-flight loads. App mount and a near-simultaneous
// login both call loadBusinessRules(); without sequencing a slow earlier
// (global) response could land after a newer (company-scoped) one and clobber
// it. Each load captures its token and only applies if still the latest.
let loadSeq = 0;

// The most recent in-flight load (null when idle). Lets consumers that need a
// STABLE rules fingerprint before doing work (the home overlay build embeds
// it in its cache key) wait for the pending load instead of blocking the
// sign-in button — see whenBusinessRulesSettled().
let inFlight: Promise<BusinessRules> | null = null;

// True once at least one settings fetch has SUCCEEDED this session — i.e.
// `current` reflects the server's effective rules rather than the built-in
// defaults used before the first load resolves. Consumers that compare a
// stored value against the tenant setting (the per-record layout-override
// staleness check in lib/projectViewMode.ts) must gate on this so the
// pre-load defaults are never mistaken for "the admin changed the setting".
let loadedFromServer = false;

/** Whether the current rules come from a successful settings fetch (vs the
 *  built-in defaults that apply before the first load / after a failure). */
export function hasBusinessRulesLoaded(): boolean {
  return loadedFromServer;
}

/**
 * Resolves when the latest in-flight business-rules load settles, capped at
 * `capMs` so a slow settings fetch can never stall the caller indefinitely.
 * Resolves immediately when no load is running. Never rejects.
 */
export function whenBusinessRulesSettled(capMs = 3000): Promise<void> {
  if (!inFlight) return Promise.resolve();
  return Promise.race([
    inFlight.then(() => undefined, () => undefined),
    new Promise<void>((resolve) => setTimeout(resolve, capMs)),
  ]);
}

function pickNum(v: unknown, fallback: number): number {
  const n = typeof v === "number" ? v : typeof v === "string" ? Number(v) : NaN;
  return Number.isFinite(n) ? n : fallback;
}

function pickStr(v: unknown, fallback: string): string {
  const s = typeof v === "string" ? v.trim() : "";
  return s.length ? s : fallback;
}

/** Hex color or "" (explicit "no color"); anything else falls back. */
function pickColor(v: unknown, fallback: string): string {
  if (typeof v !== "string") return fallback;
  const s = v.trim();
  if (s === "") return "";
  return /^#[0-9a-fA-F]{6}$/.test(s) ? s.toUpperCase() : fallback;
}

/** Synchronous accessor for the blank-field display label. */
export function getUnassignedLabel(): string {
  return current.unassignedLabel;
}

/** Synchronous accessor used by the analytics libs. */
export function getBusinessRules(): BusinessRules {
  return current;
}

/** Monotonically increasing token; changes only when the rules change. */
export function getBusinessRulesVersion(): number {
  return version;
}

/**
 * Deterministic short token derived from the CURRENT rules content.
 * Unlike the session-local `version` counter, identical rules produce the
 * same token across page reloads and sessions — so cache keys built from it
 * (e.g. the home-overlay cache) survive a reload instead of missing every
 * time. It still changes whenever any rule value changes (admin save or
 * tenant switch), preserving the "no stale thresholds" guarantee.
 */
export function getBusinessRulesFingerprint(): string {
  const s = JSON.stringify(current);
  let h = 5381;
  for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) | 0;
  return (h >>> 0).toString(36);
}

/** Subscribe to rule changes (for React's useSyncExternalStore). */
export function subscribeBusinessRules(cb: () => void): () => void {
  listeners.add(cb);
  return () => listeners.delete(cb);
}

/**
 * React hook returning a token that changes whenever the rules change. Add it
 * to a useMemo dependency list so analytics computed from getBusinessRules()
 * recompute once the async load resolves (avoids a startup race where a page
 * mounts before the fetch) or after an admin saves new thresholds.
 */
export function useBusinessRulesVersion(): number {
  return useSyncExternalStore(
    subscribeBusinessRules,
    getBusinessRulesVersion,
    getBusinessRulesVersion,
  );
}

/**
 * Fetch the effective business rules for the current session and update the
 * singleton. Safe to call repeatedly; failures leave the previous (or default)
 * values in place.
 */
async function fetchEffectiveSettings(): Promise<any | null> {
  const user = getStoredUser();
  // Prefer the signed-in company's effective rules (global defaults + that
  // company's own overrides). For upstream-RM ONE sessions the server can't
  // verify the token for a tenant-scoped read (401) — fall back to the open
  // global layer below so those users still get the global effective values.
  if (user?.token && user.tenant) {
    try {
      const r = await fetch(
        `/api/onboarding/settings?tenantId=${encodeURIComponent(user.tenant)}`,
        { headers: { Authorization: `Bearer ${user.token}` } },
      );
      if (r.ok) return await r.json();
    } catch {
      /* fall through to the global layer */
    }
  }
  try {
    const g = await fetch("/api/onboarding/settings");
    if (!g.ok) return null;
    return await g.json();
  } catch {
    return null;
  }
}

export function loadBusinessRules(): Promise<BusinessRules> {
  const p = doLoadBusinessRules();
  inFlight = p;
  void p.finally(() => {
    if (inFlight === p) inFlight = null;
  });
  return p;
}

// ── Audience ("applies to") resolution ─────────────────────────────────────
// The schedule display / past-editing rules and the working-week + holiday
// calendar each carry an audience (everyone | everyone-except | only-groups)
// set on the Settings page. A viewer OUTSIDE the audience gets the built-in
// defaults for that area instead of the tenant's values. Resolution happens
// HERE, once, so every consumer of getBusinessRules() sees already-resolved
// values. Viewer group memberships arrive from /my-capabilities (see
// setBusinessRulesViewerGroups, called by lib/permissions.ts); while they are
// UNKNOWN (null) the tenant values apply — matching pre-audience behaviour
// and avoiding a flash of defaults before capabilities load.
let viewerGroupIds: string[] | null = null;
// The raw effective settings from the last successful fetch — kept so a later
// group-membership change can re-resolve without refetching.
let lastEffective: Record<string, unknown> | null = null;

/** First exception row (in saved order) matching the viewer's memberships.
 *  Unknown memberships (null) → null: the base ("Everyone") value applies. */
function matchRule<T extends { ids: string[] }>(rules: T[]): T | null {
  if (viewerGroupIds === null) return null;
  const mine = new Set(viewerGroupIds.map(g => g.toLowerCase()));
  return firstMatchingRule(rules, mine);
}

function audienceApplies(mode: unknown, idsCsv: unknown): boolean {
  if (mode !== "except" && mode !== "groups") return true;
  const ids = String(idsCsv ?? "").split(",").map(s => s.trim().toLowerCase()).filter(Boolean);
  if (ids.length === 0) return true;
  if (viewerGroupIds === null) return true; // unknown memberships → tenant values
  const mine = new Set(viewerGroupIds.map(g => g.toLowerCase()));
  const hit = ids.some(id => mine.has(id));
  return mode === "groups" ? hit : !hit;
}

/**
 * Update the signed-in user's group memberships (from /my-capabilities) and
 * re-resolve audience-scoped rules. Pass null when memberships are unknown
 * (signed out / capabilities reset).
 */
export function setBusinessRulesViewerGroups(ids: string[] | null): void {
  const next = ids ? [...ids].map(s => s.toLowerCase()).sort() : null;
  const prev = viewerGroupIds ? [...viewerGroupIds].map(s => s.toLowerCase()).sort() : null;
  if (JSON.stringify(next) === JSON.stringify(prev)) { viewerGroupIds = ids; return; }
  viewerGroupIds = ids;
  if (lastEffective) commitRules(computeRules(lastEffective));
}

/** Display mode for a record, respecting the per-module setting: OPM/LEM
 *  records follow the opportunity-side mode, everything else the project mode. */
export function getDisplayModeFor(module?: string | null): BusinessRules["projectDisplayMode"] {
  const m = String(module ?? "").toUpperCase();
  return m === "OPM" || m === "LEM" ? current.oppDisplayMode : current.projectDisplayMode;
}

/** Past-week editing rules for a record's module (see getDisplayModeFor). */
export function getPastEditRulesFor(module?: string | null): { allowPastDateEdit: boolean; pastEditLimitWeeks: number | null } {
  const m = String(module ?? "").toUpperCase();
  // "LD" is the Lead ticket-ID prefix — several callers pass
  // projectId.split("-")[0]. Leads (LEM) follow the opportunity-side rules.
  return m === "OPM" || m === "LEM" || m === "LD"
    ? { allowPastDateEdit: current.oppAllowPastDateEdit, pastEditLimitWeeks: current.oppPastEditLimitWeeks }
    : { allowPastDateEdit: current.allowPastDateEdit, pastEditLimitWeeks: current.pastEditLimitWeeks };
}

export interface PastWeekEditState {
  isPast: boolean;
  ageWeeks: number;
  locked: boolean;
  reason: string | null;
}

export const PAST_WEEK_LOCKED_REASON =
  "Past week — locked (enable editing in Settings → Hours grid)";

/**
 * One canonical past-week decision for every weekly-hours editor.
 *
 * Week keys are parsed as LOCAL calendar dates rather than `new Date(iso)`,
 * because JavaScript treats YYYY-MM-DD as UTC and can shift the apparent day
 * in western time zones. The current-week boundary is the user's local Monday,
 * matching the Project Team grid.
 */
export function pastWeekEditState(
  weekKey: string,
  rules: { allowPastDateEdit: boolean; pastEditLimitWeeks: number | null },
  today = new Date(),
): PastWeekEditState {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(weekKey ?? "").trim());
  if (!match) return { isPast: false, ageWeeks: 0, locked: false, reason: null };

  const week = new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
  if (
    week.getFullYear() !== Number(match[1]) ||
    week.getMonth() !== Number(match[2]) - 1 ||
    week.getDate() !== Number(match[3])
  ) {
    return { isPast: false, ageWeeks: 0, locked: false, reason: null };
  }

  const day = new Date(today.getFullYear(), today.getMonth(), today.getDate());
  const dow = day.getDay();
  const currentMonday = new Date(
    day.getFullYear(),
    day.getMonth(),
    day.getDate() + (dow === 0 ? -6 : 1 - dow),
  );
  const ageWeeks = Math.round(
    (currentMonday.getTime() - week.getTime()) / (7 * 24 * 60 * 60 * 1000),
  );
  const isPast = ageWeeks > 0;
  const locked = isPast && (
    !rules.allowPastDateEdit ||
    (rules.pastEditLimitWeeks !== null && ageWeeks > rules.pastEditLimitWeeks)
  );
  return {
    isPast,
    ageWeeks,
    locked,
    reason: locked ? PAST_WEEK_LOCKED_REASON : null,
  };
}

/** Module-aware wrapper used by Project Team, Quick Actions and save guards. */
export function getPastWeekEditStateFor(
  weekKey: string,
  module?: string | null,
  today = new Date(),
): PastWeekEditState {
  return pastWeekEditState(weekKey, getPastEditRulesFor(module), today);
}

function commitRules(next: BusinessRules): void {
  // NOTE: some fields are arrays — compare by VALUE, not reference, so the
  // version only bumps when something actually changed.
  const changed = (Object.keys(next) as (keyof BusinessRules)[]).some(
    (k) =>
      Array.isArray(next[k]) || Array.isArray(current[k])
        ? JSON.stringify(next[k]) !== JSON.stringify(current[k])
        : next[k] !== current[k],
  );
  if (changed) {
    current = next;
    version += 1;
    listeners.forEach((cb) => cb());
  }
}

async function doLoadBusinessRules(): Promise<BusinessRules> {
  const seq = ++loadSeq;
  try {
    const d = await fetchEffectiveSettings();
    // A newer load started while this one was in flight — discard this result so
    // a stale response can't overwrite the latest session's rules.
    if (seq !== loadSeq) return current;
    if (!d) return current;
    const e = (d?.effective ?? {}) as Record<string, unknown>;
    lastEffective = e;
    const firstLoad = !loadedFromServer;
    loadedFromServer = true;
    const vBefore = version;
    commitRules(computeRules(e));
    // Readiness itself is an observable change: consumers gated on
    // hasBusinessRulesLoaded() (the override staleness sweep) must run even
    // when the fetched rules happen to EQUAL the built-in defaults — in that
    // case commitRules() saw no value change and stayed silent, so notify
    // here exactly once per readiness flip.
    if (firstLoad && version === vBefore) {
      version += 1;
      listeners.forEach((cb) => cb());
    }
  } catch {
    /* keep prior values */
  }
  return current;
}

function computeRules(e: Partial<Record<keyof BusinessRules, unknown>> & Record<string, unknown>): BusinessRules {
  {
    const next: BusinessRules = {
      workWeekHours: pickNum(e.workWeekHours, DEFAULT_BUSINESS_RULES.workWeekHours),
      targetUtilizationPct: pickNum(e.targetUtilizationPct, DEFAULT_BUSINESS_RULES.targetUtilizationPct),
      overCapacityPct: pickNum(e.overCapacityPct, DEFAULT_BUSINESS_RULES.overCapacityPct),
      underAllocatedPct: pickNum(e.underAllocatedPct, DEFAULT_BUSINESS_RULES.underAllocatedPct),
      concentrationPct: pickNum(e.concentrationPct, DEFAULT_BUSINESS_RULES.concentrationPct),
      forecastWeeks: pickNum(e.forecastWeeks, DEFAULT_BUSINESS_RULES.forecastWeeks),
      demandUrgencyDays: pickNum(e.demandUrgencyDays, DEFAULT_BUSINESS_RULES.demandUrgencyDays),
      proposalCoveragePct: pickNum(e.proposalCoveragePct, DEFAULT_BUSINESS_RULES.proposalCoveragePct),
      unassignedLabel: pickStr(e.unassignedLabel, DEFAULT_BUSINESS_RULES.unassignedLabel),
      projectDisplayMode: (e.projectDisplayMode === "no-schedule" || e.projectDisplayMode === "no-schedule-no-hours"
        || e.projectDisplayMode === "no-schedule-no-grid" || e.projectDisplayMode === "schedule-no-grid")
        ? e.projectDisplayMode
        : DEFAULT_BUSINESS_RULES.projectDisplayMode,
      allowPastDateEdit: typeof e.allowPastDateEdit === "boolean"
        ? e.allowPastDateEdit
        : DEFAULT_BUSINESS_RULES.allowPastDateEdit,
      pastEditLimitWeeks: e.pastEditLimitWeeks === null
        ? null
        : typeof e.pastEditLimitWeeks === "number" && e.pastEditLimitWeeks >= 1
          ? Math.round(e.pastEditLimitWeeks)
          : DEFAULT_BUSINESS_RULES.pastEditLimitWeeks,
      oppDisplayMode: (e.oppDisplayMode === "no-schedule" || e.oppDisplayMode === "no-schedule-no-hours"
        || e.oppDisplayMode === "no-schedule-no-grid" || e.oppDisplayMode === "schedule-no-grid" || e.oppDisplayMode === "full")
        ? e.oppDisplayMode
        : DEFAULT_BUSINESS_RULES.oppDisplayMode,
      oppAllowPastDateEdit: typeof e.oppAllowPastDateEdit === "boolean"
        ? e.oppAllowPastDateEdit
        : DEFAULT_BUSINESS_RULES.oppAllowPastDateEdit,
      oppPastEditLimitWeeks: e.oppPastEditLimitWeeks === null
        ? null
        : typeof e.oppPastEditLimitWeeks === "number" && e.oppPastEditLimitWeeks >= 1
          ? Math.round(e.oppPastEditLimitWeeks)
          : DEFAULT_BUSINESS_RULES.oppPastEditLimitWeeks,
      nonWorkingDays: Array.isArray(e.nonWorkingDays)
        ? (e.nonWorkingDays as unknown[]).filter(d => typeof d === "number" && d >= 0 && d <= 6) as number[]
        : DEFAULT_BUSINESS_RULES.nonWorkingDays,
      holidayDates: Array.isArray(e.holidayDates)
        ? (e.holidayDates as unknown[]).filter(d => typeof d === "string" && /^\d{4}-\d{2}-\d{2}(\||$)/.test(d)) as string[]
        : DEFAULT_BUSINESS_RULES.holidayDates,
      showBusinessUnit: typeof e.showBusinessUnit === "boolean"
        ? e.showBusinessUnit
        : DEFAULT_BUSINESS_RULES.showBusinessUnit,
      showDivision: typeof e.showDivision === "boolean"
        ? e.showDivision
        : DEFAULT_BUSINESS_RULES.showDivision,
      showDepartment: typeof e.showDepartment === "boolean"
        ? e.showDepartment
        : DEFAULT_BUSINESS_RULES.showDepartment,
      empColorPartTime: pickColor(e.empColorPartTime, DEFAULT_BUSINESS_RULES.empColorPartTime),
      empColorAsNeeded: pickColor(e.empColorAsNeeded, DEFAULT_BUSINESS_RULES.empColorAsNeeded),
      empColorScaContingency: pickColor(e.empColorScaContingency, DEFAULT_BUSINESS_RULES.empColorScaContingency),
      empColorTemporary: pickColor(e.empColorTemporary, DEFAULT_BUSINESS_RULES.empColorTemporary),
      empColorFullTime: pickColor(e.empColorFullTime, DEFAULT_BUSINESS_RULES.empColorFullTime),
    };
    // Audience resolution — viewers OUTSIDE an area's audience fall back to
    // the built-in defaults for that area (see audienceApplies above).
    // Each setting now has its OWN audience key; the old shared projSchedApplyMode /
    // oppSchedApplyMode keys are kept as fallbacks for tenants that haven't yet
    // migrated to the per-setting keys.
    const projDisplayMode  = e.projDisplayApplyMode ?? e.projSchedApplyMode;
    const projDisplayIds   = e.projDisplayGroupIds  ?? e.projSchedGroupIds;
    const projPastMode     = e.projPastEditApplyMode ?? e.projSchedApplyMode;
    const projPastIds      = e.projPastEditGroupIds  ?? e.projSchedGroupIds;
    const oppDisplayMode   = e.oppDisplayApplyMode  ?? e.oppSchedApplyMode;
    const oppDisplayIds    = e.oppDisplayGroupIds   ?? e.oppSchedGroupIds;
    const oppPastMode      = e.oppPastEditApplyMode ?? e.oppSchedApplyMode;
    const oppPastIds       = e.oppPastEditGroupIds  ?? e.oppSchedGroupIds;
    // NEW exception-rule model (settings redesign): when a setting has a
    // non-empty ordered exceptions list, the FIRST row matching the viewer's
    // memberships supplies that viewer's value and the legacy ApplyMode pair
    // is ignored; no match (or memberships unknown) → the base value stands.
    const projDispRules = parseDisplayRules(e.projDisplayRules);
    if (projDispRules.length > 0) {
      const m = matchRule(projDispRules);
      if (m) next.projectDisplayMode = m.value;
    } else if (!audienceApplies(projDisplayMode, projDisplayIds)) {
      next.projectDisplayMode = DEFAULT_BUSINESS_RULES.projectDisplayMode;
    }
    const projPastRules = parsePastEditRules(e.projPastEditRules);
    if (projPastRules.length > 0) {
      const m = matchRule(projPastRules);
      if (m) { next.allowPastDateEdit = m.allow; next.pastEditLimitWeeks = m.limitWeeks; }
    } else if (!audienceApplies(projPastMode, projPastIds)) {
      next.allowPastDateEdit = DEFAULT_BUSINESS_RULES.allowPastDateEdit;
      next.pastEditLimitWeeks = DEFAULT_BUSINESS_RULES.pastEditLimitWeeks;
    }
    const oppDispRules = parseDisplayRules(e.oppDisplayRules);
    if (oppDispRules.length > 0) {
      const m = matchRule(oppDispRules);
      if (m) next.oppDisplayMode = m.value;
    } else if (!audienceApplies(oppDisplayMode, oppDisplayIds)) {
      next.oppDisplayMode = DEFAULT_BUSINESS_RULES.oppDisplayMode;
    }
    const oppPastRules = parsePastEditRules(e.oppPastEditRules);
    if (oppPastRules.length > 0) {
      const m = matchRule(oppPastRules);
      if (m) { next.oppAllowPastDateEdit = m.allow; next.oppPastEditLimitWeeks = m.limitWeeks; }
    } else if (!audienceApplies(oppPastMode, oppPastIds)) {
      next.oppAllowPastDateEdit = DEFAULT_BUSINESS_RULES.oppAllowPastDateEdit;
      next.oppPastEditLimitWeeks = DEFAULT_BUSINESS_RULES.oppPastEditLimitWeeks;
    }
    // Calendar section — audience scoping RETIRED (Aug 2026): the "Who does
    // this apply to?" pickers were removed from the Working Week & Holiday
    // Calendar settings, so non-working days, hours per week, and company
    // holidays are ALWAYS tenant-wide. Stored legacy audience fields
    // (nonWorkingDays/workWeekHours/holidays/workCalendar ApplyMode+GroupIds)
    // are deliberately ignored here — otherwise a tenant that saved a
    // calendar audience earlier and never re-saved would keep invisible
    // per-group filtering (e.g. some viewers stuck on 40h/Sat–Sun defaults).
    // Mirrors the phase/stage-set audience retirement (server opp-stage-sets).
    return next;
  }
}

// Re-resolve the rules whenever the session changes: logging in switches to that
// company's effective thresholds; logging out reverts to the global defaults.
// Dispatched by login()/logout() in lib/api.ts.
if (typeof window !== "undefined") {
  window.addEventListener("rmone:authChanged", () => {
    // The rules in `current` belong to the PREVIOUS session/tenant until the
    // new fetch lands. Drop the "loaded" claim SYNCHRONOUSLY so nothing (e.g.
    // the per-record layout-override staleness check) compares the new
    // tenant's stored data against the old tenant's rules in the gap.
    loadedFromServer = false;
    void loadBusinessRules();
  });
}
