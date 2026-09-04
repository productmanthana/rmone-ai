/**
 * Onboarding "missing-data" default settings.
 *
 * When a client's file leaves a field blank, the wizard fills a sensible default
 * and flags it as "Assumed Data". These settings let an admin change those
 * defaults. Resolution is layered:
 *
 *   built-in  →  global overrides  →  per-client overrides
 *
 * Each client starts from the global defaults and can be tuned later. Only the
 * keys an admin actually changes are stored at each level; everything else falls
 * through to the layer below.
 */

export type StartRule = "monday-of-week" | "month-back";
export type EmailDomainMode = "from-company" | "fixed";
export type ProjectDisplayMode = "full" | "no-schedule" | "no-schedule-no-hours" | "no-schedule-no-grid" | "schedule-no-grid";

export interface OnboardingDefaults {
  // ── Org structure ──────────────────────────────────────────────────────────
  unassignedLabel:         string;   // blank Division/Department/Office/Company/Manager
  defaultJobTitle:         string;   // blank Job Title
  roleMirrorsTitle:        boolean;  // blank Role → copy the Job Title

  // ── Projects & opportunities ───────────────────────────────────────────────
  defaultProjectStatus:    string;   // blank project Status
  defaultOpportunityStage: string;   // blank opportunity Stage
  defaultOpportunityStages: string;  // full pipeline stage set (comma-separated)
  defaultProjectType:      string;   // blank Project Type
  defaultPhases:           string;   // comma-separated default lifecycle phases
  // Additional named schedule-phase sets scoped to user groups (#projects
  // settings). JSON string: Array<{id,name,phases:string[],groupIds:string[]}>.
  // When a member of a listed group creates a project/opportunity, their set's
  // phases are used instead of defaultPhases (first matching set wins).
  // "" = none. Stored as a string so the settings doc stays flat key/value.
  projectPhaseSets:        string;
  // Named opportunity stage sets — same shape/semantics as projectPhaseSets
  // but for the pipeline stages list (opp-defaults section). "" = none.
  oppStageSets:            string;
  durationMonths:          number;   // assumed project length when no end date
  oppDurationMonths:       number;   // assumed opportunity length when no end date
  durationMonthsBack:      number;   // months prior to "now" when no start AND end
  startRule:               StartRule;// how to pick a missing project start date
  forecastHorizonDays:     number;   // default forecast window when no finish date
  projectDisplayMode:      ProjectDisplayMode; // which sections to show on the project detail page
  // Opportunity-side display mode (OPM records) — same options; projects and
  // opps can be configured independently on the Settings page.
  oppDisplayMode:          ProjectDisplayMode;
  // How the display mode was last set: "" = never touched, "auto" = chosen by
  // the import pipeline from the uploaded file's team-assignment shape,
  // "manual" = an admin saved the field from the Settings page. SERVER-managed
  // (never accepted from the client body); "manual" permanently stops the
  // import auto-select from overriding the admin's choice.
  projectDisplayModeSource: "" | "auto" | "manual";
  oppDisplayModeSource:     "" | "auto" | "manual";
  // Who the project-side schedule display/past-editing settings apply to.
  // Users OUTSIDE the audience get the built-in defaults (full view, past
  // edits allowed). "everyone" | "except" | "groups"; group ids comma-joined.
  // Legacy shared key (batch 11) — kept for backward compat; individual keys below take precedence.
  projSchedApplyMode:      string;
  projSchedGroupIds:       string;
  oppSchedApplyMode:       string;
  oppSchedGroupIds:        string;
  // Per-setting audience keys — each setting can now target a different audience.
  projDurationApplyMode:   string; // who the "assumed project length" applies to
  projDurationGroupIds:    string;
  projDisplayApplyMode:    string; // who the project display-mode setting applies to
  projDisplayGroupIds:     string;
  projPastEditApplyMode:   string; // who the project past-week editing rules apply to
  projPastEditGroupIds:    string;
  oppDisplayApplyMode:     string; // opp-side display mode audience
  oppDisplayGroupIds:      string;
  oppPastEditApplyMode:    string; // opp-side past-week editing audience
  oppPastEditGroupIds:     string;
  // Per-audience EXCEPTION rules (settings redesign): each setting keeps its
  // base value (the "Everyone" row) in the existing key, plus an ORDERED JSON
  // list of exception rows — [{ids:[groupId | org:bu/div/dept sentinel, …], …value}].
  // The FIRST row whose ids intersect the viewer's memberships wins; no match
  // → the base value applies. Matching is POSITIVE-ONLY (no "except" mode), so
  // unknown membership safely falls back to the base value. When a rules key
  // is non-empty the legacy ApplyMode/GroupIds pair for that setting is
  // ignored (the new UI writes applyMode "everyone"). "" = no exceptions.
  projDisplayRules:        string; // [{ids,value:ProjectDisplayMode}]
  oppDisplayRules:         string;
  projPastEditRules:       string; // [{ids,allow:boolean,limitWeeks:number|null}]
  oppPastEditRules:        string;
  // Assumed-length exceptions are applied at RECORD CREATION by the CREATOR's
  // membership (the assumed end date is stamped into shared data, so it can't
  // vary per viewer). Imports/reconciles use the base value.
  projDurationRules:       string; // [{ids,months:number}]
  // Who the working-week + holiday calendar applies to.
  // Legacy shared key — kept for backward compat; per-setting keys below take precedence.
  workCalendarApplyMode:   string;
  workCalendarGroupIds:    string;
  // Per-setting audience keys for the calendar section.
  nonWorkingDaysApplyMode: string; // who the non-working-days setting applies to
  nonWorkingDaysGroupIds:  string;
  workWeekHoursApplyMode:  string; // who the hours-per-week setting applies to
  workWeekHoursGroupIds:   string;
  holidaysApplyMode:       string; // who the company holidays list applies to
  holidaysGroupIds:        string;

  // ── People / login ─────────────────────────────────────────────────────────
  emailDomainMode:         EmailDomainMode; // build login domain from company, or fixed
  emailFixedDomain:        string;          // used when emailDomainMode === "fixed"

  // ── Governance / analytics presentation ────────────────────────────────────
  // Comma-separated source ranking used to resolve a value when more than one
  // source could supply it: ERP > Timesheet > Scheduling > Manual > AI > Defaults.
  dataSourcePriority:      string;
  // When timesheets/actuals are unavailable, optionally treat historical
  // allocations (planned hours) as "Estimated Actuals" — a proxy, never validated.
  // Off by default so utilization stays honestly "not yet measurable".
  useHistoricalProxyActuals: boolean;
  // Divide-by-zero rule: when off, ratios with a zero denominator show "N/A".
  // When an admin turns this on, a fallback denominator is allowed but every
  // such value is flagged (asterisk + hover) as an admin-fallback estimate.
  fallbackDenominatorEnabled: boolean;
  // ── Actuals vs Forecast ────────────────────────────────────────────────
  // When true (default), Actual figures come ONLY from imported actual-hours
  // files; weeks with no import show zero — never a silent substitute.
  // Takes precedence over usePlannedAsActualFallback.
  useImportedActuals: boolean;
  // When true AND useImportedActuals is false, completed weeks with no
  // imported actuals for a person+project substitute that week's PLANNED
  // hours as estimated actuals. Every substituted value is flagged in the
  // snapshots and disclosed in the UI — never presented as a real timesheet.
  usePlannedAsActualFallback: boolean;

  // ── Security defaults ──────────────────────────────────────────────────────
  apiAccessEnabled:               boolean; // external API access off until enabled
  restrictFinancialEditsToAdmin:  boolean; // only admins may edit financial fields

// ── Organization structure grouping ─────────────────────────────────────────
  // Controls whether billing-rate overrides and team pickers group by
  // "department" (default) or "division" (for firms that use BU/division).
  orgGrouping: "department" | "division";

  // ── Rates (kept safe) ──────────────────────────────────────────────────────
  // Rates are NEVER fabricated unless an admin deliberately turns this on. Off by
  // default so rate-dependent analytics stay "unavailable" rather than wrong.
  enableDefaultRate:       boolean;
  defaultRate:             number | null;

  // ── Business rules & live-analytics thresholds ─────────────────────────────
  // Unlike the keys above (which fill blanks during an Excel import), these tune
  // the math the RUNNING app applies to LIVE RM ONE data — utilization alerts,
  // hours↔% conversions, forecasting, pipeline benchmarks. The live dashboards
  // and the alert engine read these from the GLOBAL layer.
  workWeekHours:           number;  // hours that equal 100% allocation
  targetUtilizationPct:    number;  // healthy "sweet spot" utilization
  overCapacityPct:         number;  // above this a person is over-allocated (red)
  underAllocatedPct:       number;  // at/below this (and > 0) is under-allocated (amber)
  concentrationPct:        number;  // single project carrying more than this = risk
  forecastWeeks:           number;  // rolling demand-vs-capacity look-ahead window
  demandUrgencyDays:       number;  // an unfilled role starting within this = urgent
  proposalCoveragePct:     number;  // pipeline benchmark = this % of the portfolio

  // ── Hours grid behaviour ────────────────────────────────────────────────────
  // When false (default), editing hours in past weeks is blocked in the project
  // team grid so accidental back-dated changes are prevented.
  allowPastDateEdit:       boolean;
  // When allowPastDateEdit is true, cap retroactive edits to this many weeks back.
  // null = unlimited (any past week is editable).
  pastEditLimitWeeks:      number | null;
  // Opportunity-side past-week editing rules (OPM records).
  oppAllowPastDateEdit:    boolean;
  oppPastEditLimitWeeks:   number | null;
  // Day-of-week indices (0=Sun … 6=Sat) that are non-working company-wide.
  // Default [0,6] = Saturday + Sunday. Shown as dimmed dots in each week column
  // header so the team grid makes it visually clear which days aren't counted.
  nonWorkingDays:          number[];
  // Company holiday calendar: specific dates that count as non-working days.
  // Each entry is "YYYY-MM-DD" or "YYYY-MM-DD|Label" (label optional, ≤80 chars).
  holidayDates:            string[];

// ── Organization hierarchy visibility ────────────────────────────────────────
  // When false the Business Unit tier is hidden from all forms, filter pills,
  // and card displays across the app.
  showBusinessUnit:        boolean;
  // When false the Division tier is hidden from all forms; the FK chain is
  // preserved behind the scenes via auto-created "bridge" divisions (mirror-named
  // after their Business Unit, or the tenant-wide unassigned label when no BU).
  showDivision:            boolean;
  // When false the Department tier is hidden from all forms, filter pills, and
  // card displays across the app.
  showDepartment:          boolean;

  // ── Employment-type name colors ─────────────────────────────────────────────
  // Hex color ("#rrggbb") used to tint a person's NAME wherever it appears,
  // keyed by their Employee Type. Empty string = no color (name renders
  // normally). Admin-tunable per tenant on the Settings page.
  empColorPartTime:        string;
  empColorAsNeeded:        string;
  empColorScaContingency:  string;
  empColorTemporary:       string;
  empColorFullTime:        string;
}

export const BUILTIN_ONBOARDING_DEFAULTS: OnboardingDefaults = {
  unassignedLabel:         "Unassigned",
  defaultJobTitle:         "Staff",
  roleMirrorsTitle:        true,
  defaultProjectStatus:    "Active",
  defaultOpportunityStage: "Pending Assignment",
  defaultOpportunityStages: "Pending Assignment, Proposal Development, Contract Negotiations, Awarded, Lost",
  defaultProjectType:      "General",
  defaultPhases:           "Preconstruction, Construction, Closeout",
  projectPhaseSets:        "",
  oppStageSets:            "",
  durationMonths:          3,
  oppDurationMonths:       3,
  durationMonthsBack:      1,
  startRule:               "monday-of-week",
  forecastHorizonDays:     90,
  projectDisplayMode:      "full",
  oppDisplayMode:          "full",
  projectDisplayModeSource: "",
  oppDisplayModeSource:     "",
  projSchedApplyMode:      "everyone",
  projSchedGroupIds:       "",
  oppSchedApplyMode:       "everyone",
  oppSchedGroupIds:        "",
  projDurationApplyMode:   "everyone",
  projDurationGroupIds:    "",
  projDisplayApplyMode:    "everyone",
  projDisplayGroupIds:     "",
  projPastEditApplyMode:   "everyone",
  projPastEditGroupIds:    "",
  oppDisplayApplyMode:     "everyone",
  oppDisplayGroupIds:      "",
  oppPastEditApplyMode:    "everyone",
  projDisplayRules:        "",
  oppDisplayRules:         "",
  projPastEditRules:       "",
  oppPastEditRules:        "",
  projDurationRules:       "",
  oppPastEditGroupIds:     "",
  workCalendarApplyMode:   "everyone",
  workCalendarGroupIds:    "",
  nonWorkingDaysApplyMode: "everyone",
  nonWorkingDaysGroupIds:  "",
  workWeekHoursApplyMode:  "everyone",
  workWeekHoursGroupIds:   "",
  holidaysApplyMode:       "everyone",
  holidaysGroupIds:        "",
  emailDomainMode:         "from-company",
  emailFixedDomain:        "",
  dataSourcePriority:      "ERP, Timesheet, Scheduling, Manual, AI, Defaults",
  useHistoricalProxyActuals: false,
  fallbackDenominatorEnabled: false,
  useImportedActuals:         true,
  usePlannedAsActualFallback: false,
  apiAccessEnabled:               false,
  restrictFinancialEditsToAdmin:  true,
  orgGrouping:             "department",
  enableDefaultRate:       false,
  defaultRate:             null,
  workWeekHours:           40,
  targetUtilizationPct:    80,
  overCapacityPct:         110,
  underAllocatedPct:       60,
  concentrationPct:        80,
  forecastWeeks:           8,
  demandUrgencyDays:       14,
  proposalCoveragePct:     25,
  allowPastDateEdit:       true,
  pastEditLimitWeeks:      null,
  oppAllowPastDateEdit:    true,
  oppPastEditLimitWeeks:   null,
  nonWorkingDays:          [0, 6],
  holidayDates:            [],
  showBusinessUnit:        true,
  showDivision:            true,
  showDepartment:          true,
  empColorPartTime:        "#3B82F6",
  empColorAsNeeded:        "#A855F7",
  empColorScaContingency:  "#F97316",
  empColorTemporary:       "",
  empColorFullTime:        "",
};

/** One named schedule-phase set scoped to user groups (projectPhaseSets). */
export interface ProjectPhaseSet {
  id: string;
  name: string;
  phases: string[];
  groupIds: string[];
  /** Who the set applies to: "groups" (creator in a listed group — default),
   *  "except" (creator NOT in any listed group), "everyone". */
  applyMode?: "everyone" | "except" | "groups";
  /** Optional per-phase display colors keyed by phase name (hex like "#22c55e").
   *  MUST survive the parse round trip — the save path re-serializes through
   *  parseProjectPhaseSets, so any field the parser drops is silently deleted
   *  on the next save/load (that bug shipped once: colors vanished on refresh). */
  phaseColors?: Record<string, string>;
}

/** Hex color like #abc or #a1b2c3 (case-insensitive). */
const HEX_COLOR_RE = /^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/;

/** Strict parse of the projectPhaseSets JSON string. Malformed input → [].
 *  Caps: 20 sets, 30 phases each, 80-char names — mirrors workflow templates. */
export function parseProjectPhaseSets(raw: string | null | undefined): ProjectPhaseSet[] {
  if (!raw || typeof raw !== "string") return [];
  let parsed: unknown;
  try { parsed = JSON.parse(raw); } catch { return []; }
  if (!Array.isArray(parsed)) return [];
  const out: ProjectPhaseSet[] = [];
  const seenIds = new Set<string>();
  for (const s of parsed.slice(0, 20)) {
    if (!s || typeof s !== "object") continue;
    const ss = s as Record<string, unknown>;
    const id = typeof ss.id === "string" ? ss.id.trim().slice(0, 40) : "";
    const name = typeof ss.name === "string" ? ss.name.trim().slice(0, 80) : "";
    if (!id || !name || seenIds.has(id)) continue;
    const phases = Array.isArray(ss.phases)
      ? ss.phases.filter((p): p is string => typeof p === "string").map((p) => p.trim().slice(0, 80)).filter(Boolean).slice(0, 30)
      : [];
    const groupIds = Array.isArray(ss.groupIds)
      ? ss.groupIds.filter((g): g is string => typeof g === "string").map((g) => g.trim()).filter(Boolean).slice(0, 50)
      : [];
    seenIds.add(id);
    const set: ProjectPhaseSet = { id, name, phases, groupIds };
    // Scope: "everyone" needs no groups; "except"/"groups" without any groups
    // are incoherent — collapse to the default group-scoped mode (no match).
    // "groups" is kept EXPLICITLY rather than dropped as the implicit
    // default: the save round-trip re-serializes through this parser, and
    // stripping the mode made a saved people/group audience reload in the
    // settings UI looking like "Everyone" while the ids were still stored.
    // An explicit "groups"/"except" mode with NO ids is kept too: that is the
    // "assigned to nobody yet" state, and it is how a list stops being the
    // everyone default. Dropping it made the entry reload as "everyone"
    // (mode absent + no ids derives to everyone), so demoting a list never
    // stuck and two lists could both look like the default.
    if (ss.applyMode === "everyone") set.applyMode = "everyone";
    else if (ss.applyMode === "except") set.applyMode = "except";
    else if (ss.applyMode === "groups") set.applyMode = "groups";
    // Per-phase colors: keep valid hex values keyed by any non-empty phase
    // name. Do NOT require the key to exist in this set's phases — the hidden
    // "__default_scope__" entry stores the DEFAULT list's colors with an
    // empty phases array, so a membership filter would wipe exactly the most
    // common case (default-list colors vanishing on refresh).
    if (ss.phaseColors && typeof ss.phaseColors === "object" && !Array.isArray(ss.phaseColors)) {
      const colors: Record<string, string> = {};
      for (const [k, v] of Object.entries(ss.phaseColors as Record<string, unknown>).slice(0, 60)) {
        const key = typeof k === "string" ? k.trim().slice(0, 80) : "";
        if (!key) continue;
        if (typeof v === "string" && HEX_COLOR_RE.test(v.trim())) colors[key] = v.trim();
      }
      if (Object.keys(colors).length > 0) set.phaseColors = colors;
    }
    out.push(set);
  }
  return out;
}

/** True when at least one set could ever apply (has phases AND a coherent
 *  audience) — callers use this to skip the group-membership lookup entirely. */
export function phaseSetsHaveCandidates(sets: ProjectPhaseSet[]): boolean {
  return sets.some((s) => s.phases.length > 0 && (s.groupIds.length > 0 || s.applyMode === "everyone"));
}

// ── Per-audience exception rules (settings redesign) ───────────────────────
// Ordered exception rows for a setting: the FIRST row whose ids intersect the
// viewer's memberships (user-group ids + org:bu/div/dept sentinels) wins; no
// match → the setting's base ("Everyone") value. Matching is POSITIVE-ONLY,
// so unknown membership safely falls back to the base value.
export interface DisplayRule { ids: string[]; value: ProjectDisplayMode }
export interface PastEditRule { ids: string[]; allow: boolean; limitWeeks: number | null }
export interface DurationRule { ids: string[]; months: number }

const DISPLAY_MODES: ProjectDisplayMode[] =
  ["full", "no-schedule", "no-schedule-no-hours", "no-schedule-no-grid", "schedule-no-grid"];

/** Shared strict-parse scaffold: JSON array, ≤20 rows, each row needs ≥1 id
 *  (trimmed, lowercased, ≤50) and a valid value or the row is dropped. */
function parseRuleRows<T>(raw: string | null | undefined, coerce: (row: Record<string, unknown>, ids: string[]) => T | null): T[] {
  if (!raw || typeof raw !== "string") return [];
  let parsed: unknown;
  try { parsed = JSON.parse(raw); } catch { return []; }
  if (!Array.isArray(parsed)) return [];
  const out: T[] = [];
  for (const r of parsed.slice(0, 20)) {
    if (!r || typeof r !== "object") continue;
    const rr = r as Record<string, unknown>;
    const ids = Array.isArray(rr.ids)
      ? rr.ids.filter((x): x is string => typeof x === "string")
          .map((s) => s.trim().toLowerCase().slice(0, 80)).filter(Boolean).slice(0, 50)
      : [];
    if (ids.length === 0) continue; // an exception with no audience is incoherent
    const row = coerce(rr, ids);
    if (row) out.push(row);
  }
  return out;
}

export function parseDisplayRules(raw: string | null | undefined): DisplayRule[] {
  return parseRuleRows<DisplayRule>(raw, (r, ids) =>
    DISPLAY_MODES.includes(r.value as ProjectDisplayMode) ? { ids, value: r.value as ProjectDisplayMode } : null);
}

export function parsePastEditRules(raw: string | null | undefined): PastEditRule[] {
  return parseRuleRows<PastEditRule>(raw, (r, ids) => {
    if (typeof r.allow !== "boolean") return null;
    let limitWeeks: number | null = null;
    if (typeof r.limitWeeks === "number" && Number.isFinite(r.limitWeeks)) {
      limitWeeks = Math.min(520, Math.max(1, Math.round(r.limitWeeks)));
    } else if (r.limitWeeks !== null && r.limitWeeks !== undefined) return null;
    return { ids, allow: r.allow, limitWeeks: r.allow ? limitWeeks : null };
  });
}

export function parseDurationRules(raw: string | null | undefined): DurationRule[] {
  return parseRuleRows<DurationRule>(raw, (r, ids) => {
    const m = typeof r.months === "number" && Number.isFinite(r.months) ? Math.min(120, Math.max(1, Math.round(r.months))) : null;
    return m === null ? null : { ids, months: m };
  });
}

/** First rule (in saved order) whose audience contains the user. `myGroups`
 *  null/unknown → null (base value applies — positive-match-only semantics). */
export function firstMatchingRule<T extends { ids: string[] }>(rules: T[], myGroups: Set<string> | null): T | null {
  if (!myGroups) return null;
  return rules.find((r) => r.ids.some((id) => myGroups.has(id))) ?? null;
}

export interface ViewerDisplayModes {
  projectDisplayMode: ProjectDisplayMode;
  oppDisplayMode: ProjectDisplayMode;
}

/** Resolve the project/opportunity display modes a SPECIFIC VIEWER actually
 *  gets — the server-side mirror of the web's client-side audience resolution
 *  (rmone-web lib/businessRules.ts computeRules, display-mode slice) so
 *  clients that cannot resolve audiences locally (the mobile schedule-window
 *  write gate) can ask for the answer instead of trusting the tenant base:
 *  - New ordered exception rows (projDisplayRules/oppDisplayRules) win when
 *    non-empty: the FIRST row whose ids intersect the viewer's memberships
 *    supplies the value (positive-only); no match → tenant base value — and
 *    the legacy ApplyMode/GroupIds pair is IGNORED entirely.
 *  - With no exception rows, the legacy audience pair applies: a viewer
 *    OUTSIDE a "groups" audience (or inside an "except" one) falls back to
 *    the BUILT-IN default, not the tenant value.
 *  - memberships null = unknown → tenant base values (web parity).
 *  Membership ids match case-insensitively: group GUIDs and org/user
 *  sentinels arrive in mixed case while rule ids are stored lowercase. */
export function resolveViewerDisplayModes(
  effective: OnboardingDefaults,
  memberships: string[] | null,
): ViewerDisplayModes {
  const mine = memberships === null
    ? null
    : new Set(memberships.map((s) => String(s).trim().toLowerCase()).filter(Boolean));
  const pickMode = (v: unknown, dflt: ProjectDisplayMode): ProjectDisplayMode =>
    DISPLAY_MODES.includes(v as ProjectDisplayMode) ? (v as ProjectDisplayMode) : dflt;
  const audienceApplies = (mode: unknown, idsCsv: unknown): boolean => {
    if (mode !== "except" && mode !== "groups") return true;
    const ids = String(idsCsv ?? "").split(",").map((s) => s.trim().toLowerCase()).filter(Boolean);
    if (ids.length === 0) return true;
    if (mine === null) return true; // unknown memberships → tenant values (web parity)
    const hit = ids.some((id) => mine.has(id));
    return mode === "groups" ? hit : !hit;
  };
  const resolve = (
    base: ProjectDisplayMode,
    builtIn: ProjectDisplayMode,
    rulesRaw: string | null | undefined,
    legacyMode: unknown,
    legacyIds: unknown,
  ): ProjectDisplayMode => {
    const rules = parseDisplayRules(rulesRaw);
    if (rules.length > 0) {
      const m = firstMatchingRule(rules, mine);
      return m ? m.value : base;
    }
    return audienceApplies(legacyMode, legacyIds) ? base : builtIn;
  };
  return {
    projectDisplayMode: resolve(
      pickMode(effective.projectDisplayMode, BUILTIN_ONBOARDING_DEFAULTS.projectDisplayMode),
      BUILTIN_ONBOARDING_DEFAULTS.projectDisplayMode,
      effective.projDisplayRules,
      effective.projDisplayApplyMode ?? effective.projSchedApplyMode,
      effective.projDisplayGroupIds ?? effective.projSchedGroupIds,
    ),
    oppDisplayMode: resolve(
      pickMode(effective.oppDisplayMode, BUILTIN_ONBOARDING_DEFAULTS.oppDisplayMode),
      BUILTIN_ONBOARDING_DEFAULTS.oppDisplayMode,
      effective.oppDisplayRules,
      effective.oppDisplayApplyMode ?? effective.oppSchedApplyMode,
      effective.oppDisplayGroupIds ?? effective.oppSchedGroupIds,
    ),
  };
}

/** Assemble a viewer's membership id list for display-mode resolution.
 *  Org membership is TRI-STATE: callers must pass null when the org chain
 *  could not be resolved, and this THROWS on it — flattening "unresolved"
 *  to an empty set would silently resolve the WRONG mode for except/
 *  org-sentinel rules, and write gates treat the answer as authoritative.
 *  Unknown viewer (empty uid) ⇒ null memberships (base values apply). */
export function buildViewerMemberships(
  uid: string,
  groupIds: string[],
  userSentinel: string,
  orgIds: Iterable<string> | null,
): string[] | null {
  if (!uid) return null;
  if (orgIds === null) throw new Error("viewer org memberships unresolved");
  return [...groupIds, userSentinel, ...orgIds];
}

export interface CreatorMembershipLookups {
  /** User-group ids the creator belongs to. May throw. */
  getGroupIds: () => Promise<string[]>;
  /** Live org-audience sentinels (org:bu/div/dept). May throw or return null
   *  (= org chain unreachable; group matches still count). */
  getOrgAudienceIds: () => Promise<Iterable<string> | null>;
}
export function sanitizeDefaults(
  input: unknown,
): Partial<OnboardingDefaults> {
  const out: Partial<OnboardingDefaults> = {};
  if (!input || typeof input !== "object") return out;
  const o = input as Record<string, unknown>;

  const str = (v: unknown) => (typeof v === "string" ? v.trim() : undefined);
  const bool = (v: unknown) => (typeof v === "boolean" ? v : undefined);
  const num = (v: unknown) => {
    const n = typeof v === "number" ? v : typeof v === "string" ? Number(v) : NaN;
    return Number.isFinite(n) ? n : undefined;
  };

  const assignStr = (k: keyof OnboardingDefaults) => {
    const v = str(o[k]);
    if (v !== undefined && v !== "") (out as any)[k] = v;
  };

  assignStr("unassignedLabel");
  assignStr("defaultJobTitle");
  assignStr("defaultProjectStatus");
  assignStr("defaultOpportunityStage");
  assignStr("defaultOpportunityStages");
  assignStr("defaultProjectType");
  assignStr("defaultPhases");
  assignStr("dataSourcePriority");

  // projectPhaseSets: JSON string — parse + re-serialize through the strict
  // validator so a malformed blob can never reach consumers. "" (explicitly
  // clearing all sets) is preserved, unlike assignStr which drops empties.
  if (typeof o.projectPhaseSets === "string") {
    const sets = parseProjectPhaseSets(o.projectPhaseSets);
    out.projectPhaseSets = sets.length ? JSON.stringify(sets) : "";
  }
  // oppStageSets: same strict parse/re-serialize contract as projectPhaseSets.
  if (typeof o.oppStageSets === "string") {
    const sets = parseProjectPhaseSets(o.oppStageSets);
    out.oppStageSets = sets.length ? JSON.stringify(sets) : "";
  }

  const rmt = bool(o.roleMirrorsTitle); if (rmt !== undefined) out.roleMirrorsTitle = rmt;
  const fde = bool(o.fallbackDenominatorEnabled); if (fde !== undefined) out.fallbackDenominatorEnabled = fde;
  const hpa = bool(o.useHistoricalProxyActuals); if (hpa !== undefined) out.useHistoricalProxyActuals = hpa;
  const uia = bool(o.useImportedActuals); if (uia !== undefined) out.useImportedActuals = uia;
  const paf = bool(o.usePlannedAsActualFallback); if (paf !== undefined) out.usePlannedAsActualFallback = paf;
  const apa = bool(o.apiAccessEnabled); if (apa !== undefined) out.apiAccessEnabled = apa;
  const rfe = bool(o.restrictFinancialEditsToAdmin); if (rfe !== undefined) out.restrictFinancialEditsToAdmin = rfe;

  const dm = num(o.durationMonths);
  if (dm !== undefined) out.durationMonths = Math.min(120, Math.max(1, Math.round(dm)));
  const odm = num(o.oppDurationMonths);
  if (odm !== undefined) out.oppDurationMonths = Math.min(120, Math.max(1, Math.round(odm)));
  const dmb = num(o.durationMonthsBack);
  if (dmb !== undefined) out.durationMonthsBack = Math.min(60, Math.max(0, Math.round(dmb)));
  const fh = num(o.forecastHorizonDays);
  if (fh !== undefined) out.forecastHorizonDays = Math.min(3650, Math.max(1, Math.round(fh)));

  if (o.startRule === "monday-of-week" || o.startRule === "month-back") out.startRule = o.startRule;
  if (o.emailDomainMode === "from-company" || o.emailDomainMode === "fixed") out.emailDomainMode = o.emailDomainMode;
  if (o.orgGrouping === "department" || o.orgGrouping === "division") out.orgGrouping = o.orgGrouping;
  if (o.projectDisplayMode === "full" || o.projectDisplayMode === "no-schedule" || o.projectDisplayMode === "no-schedule-no-hours"
    || o.projectDisplayMode === "no-schedule-no-grid" || o.projectDisplayMode === "schedule-no-grid") out.projectDisplayMode = o.projectDisplayMode;
  if (o.oppDisplayMode === "full" || o.oppDisplayMode === "no-schedule" || o.oppDisplayMode === "no-schedule-no-hours"
    || o.oppDisplayMode === "no-schedule-no-grid" || o.oppDisplayMode === "schedule-no-grid") out.oppDisplayMode = o.oppDisplayMode;
  if (o.projectDisplayModeSource === "auto" || o.projectDisplayModeSource === "manual") out.projectDisplayModeSource = o.projectDisplayModeSource;
  if (o.oppDisplayModeSource === "auto" || o.oppDisplayModeSource === "manual") out.oppDisplayModeSource = o.oppDisplayModeSource;

  // Audience ("applies to") settings: 3-way mode + comma-joined group-id list.
  // Ids are lowercased and capped; a non-everyone mode with NO groups is
  // collapsed back to "everyone" (an empty pick means nothing coherent).
  const audience = (modeKey: keyof OnboardingDefaults, idsKey: keyof OnboardingDefaults) => {
    const rawMode = (o as any)[modeKey];
    const rawIds  = (o as any)[idsKey];
    let ids: string[] | undefined;
    if (typeof rawIds === "string") {
      ids = rawIds.split(",").map((s: string) => s.trim().toLowerCase()).filter(Boolean).slice(0, 50);
    }
    if (rawMode === "everyone" || rawMode === "except" || rawMode === "groups") {
      const effIds = ids ?? String((out as any)[idsKey] ?? "").split(",").filter(Boolean);
      (out as any)[modeKey] = rawMode !== "everyone" && effIds.length === 0 ? "everyone" : rawMode;
    }
    if (ids !== undefined) (out as any)[idsKey] = ((out as any)[modeKey] === "everyone" ? [] : ids).join(",");
  };
  audience("projSchedApplyMode", "projSchedGroupIds");
  audience("oppSchedApplyMode", "oppSchedGroupIds");
  audience("projDurationApplyMode", "projDurationGroupIds");
  audience("projDisplayApplyMode", "projDisplayGroupIds");
  audience("projPastEditApplyMode", "projPastEditGroupIds");
  audience("oppDisplayApplyMode", "oppDisplayGroupIds");
  audience("oppPastEditApplyMode", "oppPastEditGroupIds");
  // Work-calendar audience scoping RETIRED (Aug 2026): the "Who does this
  // apply to?" pickers were removed from the Working Week & Holiday Calendar
  // settings — non-working days, hours per week, and company holidays are
  // always tenant-wide. Sanitize forces these pairs to "everyone"/"" so any
  // legacy stored audience collapses on the next save; the web resolver
  // (lib/businessRules.ts) ignores stored values regardless, mirroring the
  // phase/stage-set audience retirement (opp-stage-sets.ts).
  for (const [modeKey, idsKey] of [
    ["workCalendarApplyMode", "workCalendarGroupIds"],
    ["nonWorkingDaysApplyMode", "nonWorkingDaysGroupIds"],
    ["workWeekHoursApplyMode", "workWeekHoursGroupIds"],
    ["holidaysApplyMode", "holidaysGroupIds"],
  ] as const) {
    // Only touch keys the blob actually carries — sanitize output is a DIFF
    // blob (absent key = inherit), and absent already resolves to the
    // "everyone" built-in default.
    if (o[modeKey] !== undefined) (out as any)[modeKey] = "everyone";
    if (o[idsKey] !== undefined) (out as any)[idsKey] = "";
  }

  // Per-audience exception-rule lists: strict parse + re-serialize so only
  // well-formed rows are ever stored (malformed input → dropped, [] → "").
  const ruleList = (key: keyof OnboardingDefaults, parse: (raw: string) => unknown[]) => {
    const raw = (o as Record<string, unknown>)[key];
    if (typeof raw !== "string") return;
    const rows = parse(raw);
    (out as Record<string, unknown>)[key] = rows.length ? JSON.stringify(rows) : "";
  };
  ruleList("projDisplayRules", parseDisplayRules);
  ruleList("oppDisplayRules", parseDisplayRules);
  ruleList("projPastEditRules", parsePastEditRules);
  ruleList("oppPastEditRules", parsePastEditRules);
  ruleList("projDurationRules", parseDurationRules);

  // Allow clearing the fixed domain back to "" (so accept empty string here).
  if (typeof o.emailFixedDomain === "string") {
    out.emailFixedDomain = o.emailFixedDomain.trim().toLowerCase().replace(/^@+/, "");
  }

  const edr = bool(o.enableDefaultRate); if (edr !== undefined) out.enableDefaultRate = edr;
  if (o.defaultRate === null) out.defaultRate = null;
  else {
    const dr = num(o.defaultRate);
    if (dr !== undefined) out.defaultRate = Math.max(0, dr);
  }

  // Business rules & live-analytics thresholds (clamped to sane ranges).
  const clampInt = (k: keyof OnboardingDefaults, lo: number, hi: number) => {
    const n = num(o[k]);
    if (n !== undefined) (out as any)[k] = Math.min(hi, Math.max(lo, Math.round(n)));
  };
  clampInt("workWeekHours", 1, 168);
  clampInt("targetUtilizationPct", 1, 100);
  clampInt("overCapacityPct", 100, 300);
  clampInt("underAllocatedPct", 1, 99);
  clampInt("concentrationPct", 1, 100);
  clampInt("forecastWeeks", 1, 52);
  clampInt("demandUrgencyDays", 1, 3650);
  clampInt("proposalCoveragePct", 1, 500);

  const ape = bool(o.allowPastDateEdit); if (ape !== undefined) out.allowPastDateEdit = ape;
  if (o.pastEditLimitWeeks === null || o.pastEditLimitWeeks === undefined) {
    if ("pastEditLimitWeeks" in o) out.pastEditLimitWeeks = null;
  } else {
    const lw = Math.round(Number(o.pastEditLimitWeeks));
    if (Number.isFinite(lw) && lw >= 1 && lw <= 520) out.pastEditLimitWeeks = lw;
  }
  const oape = bool(o.oppAllowPastDateEdit); if (oape !== undefined) out.oppAllowPastDateEdit = oape;
  if (o.oppPastEditLimitWeeks === null || o.oppPastEditLimitWeeks === undefined) {
    if ("oppPastEditLimitWeeks" in o) out.oppPastEditLimitWeeks = null;
  } else {
    const olw = Math.round(Number(o.oppPastEditLimitWeeks));
    if (Number.isFinite(olw) && olw >= 1 && olw <= 520) out.oppPastEditLimitWeeks = olw;
  }
  if (Array.isArray(o.nonWorkingDays)) {
    const days = (o.nonWorkingDays as unknown[])
      .map(d => typeof d === "number" ? d : typeof d === "string" ? Number(d) : NaN)
      .filter(d => Number.isFinite(d) && d >= 0 && d <= 6)
      .map(d => Math.round(d));
    out.nonWorkingDays = [...new Set(days)].sort((a, b) => a - b);
  }
  // Holiday calendar: "YYYY-MM-DD" or "YYYY-MM-DD|Label". Dedupe by DATE
  // (last label wins), sort chronologically, cap at 500 entries.
  if (Array.isArray(o.holidayDates)) {
    const byDate = new Map<string, string>();
    for (const raw of o.holidayDates as unknown[]) {
      if (typeof raw !== "string") continue;
      const [date, ...rest] = raw.split("|");
      const d = date.trim();
      if (!/^\d{4}-\d{2}-\d{2}$/.test(d)) continue;
      // Reject impossible dates (e.g. 2026-02-30) via a local round-trip.
      const [y, m, day] = d.split("-").map(Number);
      const chk = new Date(y, m - 1, day);
      if (chk.getFullYear() !== y || chk.getMonth() !== m - 1 || chk.getDate() !== day) continue;
      const label = rest.join("|").trim().slice(0, 80);
      byDate.set(d, label ? `${d}|${label}` : d);
      if (byDate.size >= 500) break;
    }
    out.holidayDates = [...byDate.values()].sort();
  }

  const sbu = bool(o.showBusinessUnit); if (sbu !== undefined) out.showBusinessUnit = sbu;
  const sdiv = bool(o.showDivision); if (sdiv !== undefined) out.showDivision = sdiv;
  const sdept = bool(o.showDepartment); if (sdept !== undefined) out.showDepartment = sdept;

  // Employment-type name colors: a hex color, or "" to explicitly clear
  // ("no color"). Anything else is dropped so junk can't reach the UI.
  const hexColor = (k: keyof OnboardingDefaults) => {
    const v = o[k as string];
    if (typeof v !== "string") return;
    const s = v.trim();
    if (s === "" || /^#[0-9a-fA-F]{6}$/.test(s)) (out as any)[k] = s === "" ? "" : s.toUpperCase();
  };
  hexColor("empColorPartTime");
  hexColor("empColorAsNeeded");
  hexColor("empColorScaContingency");
  hexColor("empColorTemporary");
  hexColor("empColorFullTime");

  return out;
}

// Layer the partials on top of the built-ins (later wins). Each partial has
// already been sanitized, so this is a plain merge.
export function mergeDefaults(
  ...layers: (Partial<OnboardingDefaults> | null | undefined)[]
): OnboardingDefaults {
  let merged: OnboardingDefaults = { ...BUILTIN_ONBOARDING_DEFAULTS };
  for (const layer of layers) {
    if (layer) merged = { ...merged, ...layer };
  }
  return merged;
}

// ── Schedule-date derivation (shared by the import pipeline AND the live
// settings-reconcile) ────────────────────────────────────────────────────────
// When a project/opportunity row has no start and/or no finish date, these
// admin-configurable rules decide the assumed window. Centralised here (a
// dependency-free module) so the import-time fill (pipeline.ts) and the
// reconcile-on-edit path (rds-provider.ts) can NEVER drift apart.
function odIsoDate(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}
function odMondayOfCurrentWeek(d = new Date()): string {
  const day = d.getDay();                  // 0=Sun … 6=Sat
  const diff = (day === 0 ? -6 : 1) - day;  // shift back to Monday
  return odIsoDate(new Date(d.getFullYear(), d.getMonth(), d.getDate() + diff));
}
function odAddMonthsISO(iso: string, months: number): string {
  const [y, m, d] = iso.split("-").map(Number);
  return odIsoDate(new Date(y, (m - 1) + months, d));
}
function odAddDaysISO(iso: string, days: number): string {
  const [y, m, d] = iso.split("-").map(Number);
  return odIsoDate(new Date(y, m - 1, d + days));
}

// Where to place a project whose start date is missing (but it HAS a finish
// date, or is otherwise not a both-missing case): admin's "When a start date is
// missing" rule.
export function defaultProjectStart(d: OnboardingDefaults): string {
  if (d.startRule === "month-back") return odAddMonthsISO(odIsoDate(new Date()), -1);
  return odMondayOfCurrentWeek();
}

// Derive the assumed {start, end} (YYYY-MM-DD) for a record, given whatever real
// dates it already has. `rawStart`/`rawEnd` are the CLIENT-PROVIDED values (pass
// undefined for a missing/assumed side). `isPipeline` = opportunity or lead
// (they use a forecast horizon, not a project length).
export function deriveScheduleDates(
  d: OnboardingDefaults,
  opts: { rawStart?: string | null; rawEnd?: string | null; isPipeline?: boolean; isLead?: boolean },
): { start: string; end: string } {
  const rawStart = (opts.rawStart ?? "").trim() || undefined;
  const rawEnd = (opts.rawEnd ?? "").trim() || undefined;
  const isPipeline = !!opts.isPipeline;
  const isLead = !!opts.isLead;
  // How far ahead of the start a pipeline record's missing end lands:
  //  - opportunities use the admin's "Assumed opportunity length (months)"
  //  - leads keep the day-based forecast horizon (they have no length setting)
  const pipelineEnd = (start: string) =>
    isLead ? odAddDaysISO(start, d.forecastHorizonDays)
           : odAddMonthsISO(start, d.oppDurationMonths);
  let start: string;
  let end: string;
  if (isPipeline && !rawStart && !rawEnd) {
    // Opportunities/leads with no dates open "now" and stay open for the
    // assumed window (opp length / lead forecast horizon).
    start = odIsoDate(new Date());
    end = pipelineEnd(start);
  } else {
    // A missing start ALWAYS follows the admin's visible "When a start date is
    // missing" rule (startRule → defaultProjectStart). There is deliberately no
    // hidden "centred window" that can override that setting — whatever the admin
    // configures on the settings page is what a new record gets.
    start = rawStart ?? defaultProjectStart(d);
    end = rawEnd ?? (isPipeline
      ? pipelineEnd(start)                            // opp length / lead horizon
      : odAddMonthsISO(start, d.durationMonths));     // project length ahead of start
  }
  return { start, end };
}

/**
 * First set (in saved order) whose audience matches a user with the given
 * group memberships, or null. Shared by projectPhaseSets (record-creation
 * schedule) and oppStageSets (viewer-scoped pipeline stages) so the two
 * features can never drift apart.
 *   - "everyone": always matches.
 *   - "groups" (default): matches when the user is in ANY listed group.
 *   - "except": matches when the user is in NONE of the listed groups.
 * `myGroups` may be null when memberships are unknown/not loaded — group-scoped
 * modes then treat the user as belonging to no groups.
 */
export function pickMatchingPhaseSet(
  sets: ProjectPhaseSet[],
  myGroups: Set<string> | null,
): ProjectPhaseSet | null {
  return sets.find((s) => {
    if (s.phases.length === 0) return false;
    if (s.applyMode === "everyone") return true;
    if (s.groupIds.length === 0) return false;
    const inOne = s.groupIds.some((id) => myGroups?.has(id));
    return s.applyMode === "except" ? !inOne : inOne;
  }) ?? null;
}

/** True when resolving requires the viewer's group memberships (any candidate
 *  set is group-scoped rather than "everyone"). */
export function phaseSetsNeedGroupLookup(sets: ProjectPhaseSet[]): boolean {
  return sets.some((s) => s.phases.length > 0 && s.applyMode !== "everyone" && s.groupIds.length > 0);
}

/** Hidden entry id that stores the DEFAULT phase list's own audience (the
 *  "Everyone" card's scope) inside projectPhaseSets / oppStageSets. It never
 *  carries phases of its own — the phases live in defaultPhases — so
 *  pickMatchingPhaseSet can never select it (phases.length === 0 guard). */
export const DEFAULT_PHASESET_SCOPE_ID = "__default_scope__";

/** Split the hidden default-scope entry from the real (visible) sets. */
export function splitDefaultScopeEntry(all: ProjectPhaseSet[]): { scope: ProjectPhaseSet | null; sets: ProjectPhaseSet[] } {
  return {
    scope: all.find((s) => s.id === DEFAULT_PHASESET_SCOPE_ID) ?? null,
    sets: all.filter((s) => s.id !== DEFAULT_PHASESET_SCOPE_ID),
  };
}

/** True when an audience entry covers a user with the given memberships —
 *  the per-set audience check from pickMatchingPhaseSet, without the phases
 *  gate. Explicit "everyone" covers everyone; so does a LEGACY entry with no
 *  mode and no ids (pre-applyMode data was unscoped). An explicit
 *  "groups"/"except" with no ids is the deliberate "nobody yet" state and
 *  covers no one. */
export function audienceCoversUser(
  entry: Pick<ProjectPhaseSet, "applyMode" | "groupIds">,
  myGroups: Set<string> | null,
): boolean {
  if (entry.applyMode === "everyone") return true;
  if (entry.groupIds.length === 0) return !entry.applyMode;
  const inOne = entry.groupIds.some((id) => myGroups?.has(id));
  return entry.applyMode === "except" ? !inOne : inOne;
}

export async function resolveAssumedDurationMonths(
  d: OnboardingDefaults,
  moduleName: string | null | undefined,
  userId: string | null | undefined,
  lookups: CreatorMembershipLookups,
): Promise<{ months: number; matched: boolean; note?: string }> {
  const base = { months: d.durationMonths, matched: false };
  try {
    if (String(moduleName ?? "").toUpperCase() === "LEM") return base;
    const rules = parseDurationRules(d.projDurationRules);
    if (rules.length === 0) return base;
    const uid = String(userId ?? "").trim().toLowerCase();
    if (!uid) return base;
    const mine = new Set((await lookups.getGroupIds()).map((g) => g.toLowerCase()));
    // Org-audience failure is non-fatal on its own — group matches still count.
    let orgNote: string | undefined;
    try {
      const orgIds = await lookups.getOrgAudienceIds();
      if (orgIds) for (const oid of orgIds) mine.add(String(oid).toLowerCase());
    } catch (e) {
      orgNote = `org-audience lookup failed: ${String(e)}`;
    }
    const match = firstMatchingRule(rules, mine);
    if (match) return { months: match.months, matched: true, note: orgNote };
    return { ...base, note: orgNote };
  } catch (e) {
    return { ...base, note: `membership lookup failed — using base length: ${String(e)}` };
  }
}
