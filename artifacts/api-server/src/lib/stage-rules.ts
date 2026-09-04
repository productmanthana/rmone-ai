/**
 * Company stage rules — admin-configured, tenant-wide:
 *
 *  1. FIELD LOCKS: "once a record reaches stage X, these fields can no longer
 *     be edited" (direction "from"), or "these fields can't be edited UNTIL the
 *     record reaches stage X" (direction "until"). Enforced server-side on
 *     every field-update path (fail closed) and mirrored in the web UI as
 *     read-only cells with an explanation.
 *
 *  2. STAGE SKIPS: "records where <field> = <value> skip these stages" —
 *     a display/advance rule only (the lifecycle bar hides the stages and
 *     Advance jumps over them). Never blocks a direct write of a stage value.
 *
 * Stored per tenant in the onboarding settings table under scope
 * "stagerules:<tenant>" (same pattern as display defaults). The web mirrors
 * the evaluation logic in rmone-web/src/lib/stageRules.ts — keep the two in
 * sync when changing semantics.
 *
 * Position semantics for lock evaluation, against the tenant's stage order:
 *   pos(blank/empty stage)          = -Infinity  (before everything)
 *   pos(known stage)                = index in the tenant stage order
 *   pos(unknown, non-blank stage)   = +Infinity  (terminal-ish: "Closed – Won",
 *                                     tenant one-offs — treated as PAST the end)
 * A lock applies iff:
 *   direction "from":  pos(current) >= pos(anchor)
 *   direction "until": pos(current) <  pos(anchor)
 * If the anchor stage no longer exists in the tenant's stage order the rule is
 * INACTIVE (skipped) — a renamed/removed stage must not silently lock fields
 * at +Infinity. The settings UI warns about such stale rules.
 */

export type StageRuleModule = "PMM" | "OPM" | "LEM";
export const STAGE_RULE_MODULES: StageRuleModule[] = ["PMM", "OPM", "LEM"];

export interface FieldLockRule {
  module: StageRuleModule;
  /** Anchor stage name (matched case-insensitively against the tenant stage order). */
  stage: string;
  /** "from" = locked once the record reaches the stage; "until" = locked before it. */
  direction: "from" | "until";
  /** FieldNames to lock (as sent by the record-detail save paths). */
  fields: string[];
  /**
   * User groups EXEMPT from this lock (#122) — members may edit the fields as
   * if this rule didn't exist. Stored lowercase; absent/empty = nobody exempt
   * (pre-#122 shape stays canonical). Evaluated PER-RULE: a second non-exempt
   * rule locking the same field still locks it for everyone.
   */
  exemptGroupIds?: string[];
  /**
   * "Only specific groups" mode: when non-empty, the lock applies ONLY to
   * members of these groups (everyone else edits freely). Wins over
   * exemptGroupIds — the sanitizer never stores both.
   */
  appliesToGroupIds?: string[];
}

export interface StageSkipRule {
  module: StageRuleModule;
  /** Condition field on the record (e.g. SectorChoice, RequestCategory). */
  field: string;
  /** Condition value — case-insensitive, trimmed equality. */
  value: string;
  /** Stage names hidden/skipped for matching records. */
  skipStages: string[];
  /**
   * User groups EXEMPT from this skip (#122) — members still SEE the skipped
   * stages. Skips are display/advance rules, so the exemption is display too.
   * Stored lowercase; absent/empty = skip applies to everyone.
   */
  exemptGroupIds?: string[];
  /**
   * "Only specific groups": when non-empty the skip applies ONLY to members.
   * Unlike locks/layout, WorkflowTypeName rules may store BOTH lists: the
   * type's audience is stamped into exemptGroupIds by the settings UI and the
   * web's skippedStagesFor gives it precedence, so people who can USE a type
   * always SEE its skipped stages even under an "only these groups" scope.
   */
  appliesToGroupIds?: string[];
}

export interface FormLayoutRule {
  module: StageRuleModule;
  /** Anchor stage name (case-insensitive against the tenant stage order). */
  stage: string;
  /**
   * When the rule applies relative to the anchor stage. Canonical stored form
   * OMITS the key for "at" (exact-stage — the original behavior, so docs
   * untouched by the scope feature never change shape). "from" = at the anchor
   * and every later stage; "until" = every stage before the anchor. from/until
   * position stages on the same tenant order as fieldLocks — an anchor missing
   * from the order deactivates the rule (same stance as lockApplies).
   */
  direction?: "at" | "from" | "until";
  /** FieldNames hidden while the rule applies (implies not editable). */
  hidden: string[];
  /** FieldNames visible but read-only while the rule applies. */
  readOnly: string[];
  /**
   * User groups EXEMPT from this layout rule (#123) — members see and edit the
   * fields as if this rule didn't exist. Stored lowercase; absent/empty =
   * applies to everyone. Per-rule, like #122's lock/skip exemptions.
   */
  exemptGroupIds?: string[];
  /** "Only specific groups": when non-empty the layout rule applies ONLY to members. */
  appliesToGroupIds?: string[];
}

/**
 * REQUIRED FIELDS to ENTER a stage (#137): "a record can only be moved to
 * stage X once these fields are filled in". EXACT-target semantics (the
 * HubSpot/Pipedrive model): the rule fires only when a write sets the
 * status/stage field TO this stage — jumping past it doesn't trigger
 * (stage skips and per-type stage lists legitimately jump stages), moving
 * backward never does, and re-saving the record's current stage is not a
 * move. Payload values win over stored values, so "fill it in and advance
 * in one save" passes. Enforced server-side on every field-update path
 * (fail closed), mirrored on the web record pages.
 */
export interface RequiredFieldsRule {
  module: StageRuleModule;
  /** Target stage name (matched case-insensitively, exact — not positional). */
  stage: string;
  /** FieldNames that must be non-empty before a record may enter the stage. */
  fields: string[];
  /** Groups EXEMPT from this rule — members move records freely. */
  exemptGroupIds?: string[];
  /** "Only specific groups": when non-empty the rule applies ONLY to members. */
  appliesToGroupIds?: string[];
}

/**
 * One workflow type entry as STORED (#121): a bare string (unrestricted — the
 * pre-#121 shape, kept canonical so untouched docs never change shape) or an
 * object whose allowedGroupIds lists the user groups allowed to SET the type
 * on records. Empty/absent allowedGroupIds = everyone may set it.
 */
export type WorkflowTypeEntry = string | {
  name: string;
  allowedGroupIds?: string[];
  /**
   * Specific USERS allowed to use this workflow (#131) — lowercase rmone_users
   * ids, same membership stance as allowedGroupIds (either list grants).
   * Both absent/empty = tenant-wide (everyone may use it).
   */
  allowedUserIds?: string[];
  /**
   * This workflow's OWN ordered stage list (#131). When present (≥2 stages)
   * records carrying this WorkflowTypeName use THESE stages — for the
   * lifecycle bar, Advance, dropdowns AND lock/layout evaluation — instead of
   * the module's stageOrder. Absent = inherit the module order (the pre-#131
   * behavior, where a type only skips stages via stageSkips rules).
   */
  stages?: string[];
};
/** Normalized in-memory form — empty arrays = unrestricted / inherit. */
export interface WorkflowTypeDef { name: string; allowedGroupIds: string[]; allowedUserIds: string[]; stages: string[] }

export interface StageRules {
  fieldLocks: FieldLockRule[];
  stageSkips: StageSkipRule[];
  /**
   * WORKFLOW TYPES (per module): admin-named workflow variants ("Standard",
   * "Federal", …). Stored on records in the WorkflowType column (PMM /
   * Opportunity / Lead — ensured lazily like RequestCategory). They drive
   * stage skips (stageSkips rules with field "WorkflowTypeName") and the record
   * pages' Workflow Type dropdown. Absent key = feature unused for module.
   * Entries may carry group restrictions (#121) — see WorkflowTypeEntry.
   */
  workflowTypes?: Partial<Record<StageRuleModule, WorkflowTypeEntry[]>>;
  /**
   * FORM LAYOUT (per module + anchor stage): fields hidden or read-only while
   * a record sits in the rule's stage range — "at" the stage (default),
   * "from" it on, or "until" it (see FormLayoutRule.direction). hidden
   * implies not editable; both are enforced server-side on every field-update
   * path (fail closed) and mirrored on the web detail pages (hidden cells
   * disappear, read-only cells grey out with an explanation).
   */
  formLayout?: FormLayoutRule[];
  /**
   * REQUIRED FIELDS to enter a stage (#137) — see RequiredFieldsRule.
   * Absent key = feature unused (docs untouched by it keep their shape).
   */
  requiredFields?: RequiredFieldsRule[];
  /**
   * ADMIN-DEFINED WORKFLOW: ordered stage names per module (Workflow Stages
   * card in Settings → Stage Rules). When set (≥2 stages) it OVERRIDES the
   * derived order (Config_Module_ModuleStages / built-ins) for lock
   * evaluation and the lifecycle bars. Absent module key = no override.
   */
  stageOrder?: Partial<Record<StageRuleModule, string[]>>;
  /**
   * DISPLAY-ONLY workflow styling (Workflow Stages card):
   *  - stageColors: stage name (lowercased key) → hex color, used by the
   *    numbered steppers and the grid stage-flow indicators.
   *  - buttonLabels: per-module custom names for the lifecycle action
   *    buttons (old portal's Approve/Return/Reject button names).
   * Neither affects enforcement — sanitized here only so the one shared
   * settings doc stays schema-clean.
   */
  stageColors?: Partial<Record<StageRuleModule, Record<string, string>>>;
  buttonLabels?: Partial<Record<StageRuleModule, { advance?: string; back?: string; lost?: string; cancel?: string }>>;
  /**
   * PER-STAGE AUDIENCE (Workflow Stages card → per-row "Applies to" button):
   * LOWERCASED stage name → who that single stage applies to. Entries exist
   * only for scoped stages ("everyone" is stored as absence, so untouched
   * docs keep their shape). groupIds may hold group ids, "user:<id>" and
   * "org:bu/div/dept:<id>" sentinels — same audience vocabulary as workflow
   * templates. DISPLAY/SELECTION scoping only: viewers outside the audience
   * don't get the stage in their stage bar, Advance path or status dropdowns
   * (/stage-rules stageOrder + /field-options are filtered server-side), but
   * lock/layout evaluation keeps the FULL order — a lock anchored on a stage
   * the actor can't see must never silently deactivate. "Who can act" stays
   * the enforcement tool (stage perms), exactly like viewer-scoped sets.
   */
  stageAudiences?: Partial<Record<StageRuleModule, Record<string, StageAudience>>>;
  /**
   * STAGE GUIDANCE (#137): LOWERCASED stage name → one short tip shown on the
   * record pages while a record sits at that stage ("Confirm budget and
   * client contact"). DISPLAY-ONLY — never touches enforcement. Renames
   * orphan the entry (same accepted convention as stageColors).
   */
  stageGuidance?: Partial<Record<StageRuleModule, Record<string, string>>>;
}

/** Audience of ONE stage: "groups" = only members see it, "except" = everyone
 *  BUT members. ("everyone" is never stored — the entry is removed instead.) */
export interface StageAudience {
  applyMode: "groups" | "except";
  /** Group ids / "user:" / "org:" sentinels, stored lowercase. */
  groupIds: string[];
}

export const EMPTY_STAGE_RULES: StageRules = { fieldLocks: [], stageSkips: [] };

/** Normalize a module's workflow types to full defs (#121/#131). */
export function workflowTypeDefsFor(rules: StageRules, mod: StageRuleModule): WorkflowTypeDef[] {
  return (rules.workflowTypes?.[mod] ?? []).map((e) =>
    typeof e === "string"
      ? { name: e, allowedGroupIds: [], allowedUserIds: [], stages: [] }
      : { name: e.name, allowedGroupIds: e.allowedGroupIds ?? [], allowedUserIds: e.allowedUserIds ?? [], stages: e.stages ?? [] });
}

/** Workflow type NAMES for a module — what dropdowns and skip rules key on. */
export function workflowTypeNamesFor(rules: StageRules, mod: StageRuleModule): string[] {
  return workflowTypeDefsFor(rules, mod).map((d) => d.name);
}

// ── Per-stage audiences (#136) ───────────────────────────────────────────────

/** True when ANY module carries a per-stage audience — lets routes skip the
 *  (cached) membership reads entirely for the vast majority of tenants. */
export function hasAnyStageAudiences(rules: StageRules): boolean {
  const sa = rules.stageAudiences;
  if (!sa) return false;
  for (const mod of STAGE_RULE_MODULES) {
    if (Object.keys(sa[mod] ?? {}).length > 0) return true;
  }
  return false;
}

/** Viewer membership for audience checks: group ids + the viewer's own
 *  "user:" sentinel + live "org:" sentinels, all lowercase. orgUnknown=true
 *  means the org lookup failed (outage) — org-scoped audiences must then stay
 *  UNEVALUATED rather than treat the viewer as a non-member. */
export interface AudienceMembership { ids: Set<string>; orgUnknown: boolean }

// Sentinel test kept inline (string-prefix contract from lib/access-control's
// live audience ids: org units AND roles) — this module stays dependency-light
// on purpose. Both families resolve through the same live resolver, so when
// that lookup fails (orgUnknown) role membership is exactly as unknown as org
// membership and must get the same fail-visible stance.
const isLiveSentinelId = (id: string) => id.startsWith("org:") || id.startsWith("role:");

/**
 * Drop the stages `membership` doesn't get from a viewer-facing stage list.
 * DISPLAY scoping only (stage bar, Advance, status dropdowns) — never feed
 * the result into lock/layout evaluation (see StageRules.stageAudiences).
 * Fail stances, mirroring viewer-scoped template resolution:
 *  - membership null (no acting user / lookup failed) → unfiltered;
 *  - org membership unknown + audience names an org unit → that stage stays
 *    VISIBLE (we can't prove exclusion, and hiding a stage mid-outage strands
 *    workflows);
 *  - every stage filtered out → the ORIGINAL list (a viewer with zero stages
 *    breaks record pages; an admin who scoped every stage away almost
 *    certainly didn't mean "nobody sees any workflow").
 */
export function filterStagesByAudience(
  stages: string[],
  audiences: Record<string, StageAudience> | undefined,
  membership: AudienceMembership | null,
): string[] {
  if (!audiences || !membership || stages.length === 0) return stages;
  const keys = Object.keys(audiences);
  if (keys.length === 0) return stages;
  const out = stages.filter((s) => {
    const aud = audiences[s.trim().toLowerCase()];
    if (!aud || (aud.groupIds?.length ?? 0) === 0) return true;
    if (membership.orgUnknown && aud.groupIds.some(isLiveSentinelId)) return true;
    const inAny = aud.groupIds.some((id) => membership.ids.has(id.trim().toLowerCase()));
    return aud.applyMode === "groups" ? inAny : !inAny;
  });
  return out.length > 0 ? out : stages;
}

const MAX_RULES = 50;
const MAX_LIST = 100;
const MAX_STR = 200;

function cleanStr(v: unknown): string {
  return typeof v === "string" ? v.trim().slice(0, MAX_STR) : "";
}

function cleanList(v: unknown): string[] {
  if (!Array.isArray(v)) return [];
  const seen = new Set<string>();
  const out: string[] = [];
  for (const item of v) {
    const s = cleanStr(item);
    if (!s) continue;
    const k = s.toLowerCase();
    if (seen.has(k)) continue;
    seen.add(k);
    out.push(s);
    if (out.length >= MAX_LIST) break;
  }
  return out;
}

function cleanModule(v: unknown): StageRuleModule | null {
  const s = cleanStr(v).toUpperCase();
  return (STAGE_RULE_MODULES as string[]).includes(s) ? (s as StageRuleModule) : null;
}

/** Shape-guard raw settings (from DB or a PUT body) into valid StageRules. */
export function sanitizeStageRules(raw: unknown): StageRules {
  const o = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  const fieldLocks: FieldLockRule[] = [];
  if (Array.isArray(o.fieldLocks)) {
    for (const r of o.fieldLocks) {
      if (!r || typeof r !== "object") continue;
      const rr = r as Record<string, unknown>;
      const module = cleanModule(rr.module);
      const stage = cleanStr(rr.stage);
      const direction = rr.direction === "until" ? "until" : rr.direction === "from" ? "from" : null;
      const fields = cleanList(rr.fields);
      if (!module || !stage || !direction || fields.length === 0) continue;
      // Exempt groups (#122): stored lowercase (group ids are lowercase slugs;
      // membership checks compare lowercased) and attached only when non-empty
      // so untouched docs keep their pre-#122 shape.
      const lockExempt = cleanList(rr.exemptGroupIds).slice(0, 50).map((s) => s.toLowerCase());
      const lockOnly = cleanList(rr.appliesToGroupIds).slice(0, 50).map((s) => s.toLowerCase());
      const lockRule: FieldLockRule = { module, stage, direction, fields };
      // "Only" mode wins — a rule is either scoped-to or scoped-except, never both.
      if (lockOnly.length > 0) lockRule.appliesToGroupIds = lockOnly;
      else if (lockExempt.length > 0) lockRule.exemptGroupIds = lockExempt;
      fieldLocks.push(lockRule);
      if (fieldLocks.length >= MAX_RULES) break;
    }
  }
  const stageSkips: StageSkipRule[] = [];
  if (Array.isArray(o.stageSkips)) {
    for (const r of o.stageSkips) {
      if (!r || typeof r !== "object") continue;
      const rr = r as Record<string, unknown>;
      const module = cleanModule(rr.module);
      const field = cleanStr(rr.field);
      const value = cleanStr(rr.value);
      const skipStages = cleanList(rr.skipStages);
      if (!module || !field || !value || skipStages.length === 0) continue;
      const skipExempt = cleanList(rr.exemptGroupIds).slice(0, 50).map((s) => s.toLowerCase());
      const skipOnly = cleanList(rr.appliesToGroupIds).slice(0, 50).map((s) => s.toLowerCase());
      const skipRule: StageSkipRule = { module, field, value, skipStages };
      if (skipOnly.length > 0) skipRule.appliesToGroupIds = skipOnly;
      // Workflow-type rules keep BOTH lists: the settings UI stamps the
      // type's audience into exemptGroupIds, and it must survive an
      // "only these groups" scope (exempt-first in skip evaluation) so
      // audience members keep seeing the skipped stages. All other rules
      // keep the appliesTo-wins canon (never store both).
      if (skipExempt.length > 0 && (skipOnly.length === 0 || field === "WorkflowTypeName")) {
        skipRule.exemptGroupIds = skipExempt;
      }
      stageSkips.push(skipRule);
      if (stageSkips.length >= MAX_RULES) break;
    }
  }
  let stageOrder: StageRules["stageOrder"];
  if (o.stageOrder && typeof o.stageOrder === "object") {
    const so = o.stageOrder as Record<string, unknown>;
    for (const mod of STAGE_RULE_MODULES) {
      const list = cleanList(so[mod]).slice(0, 30);
      if (list.length >= 2) {
        if (!stageOrder) stageOrder = {};
        stageOrder[mod] = list;
      }
    }
  }
  // Display-only styling — validated strictly (colors must be #RGB/#RRGGBB
  // hex so they can be inlined into style attributes safely).
  const HEX_RE = /^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/;
  // Store 6-digit hex ONLY — consumers append alpha suffixes ("...55"),
  // which silently break on 3-digit shorthand.
  const expandHex = (c: string) =>
    c.length === 4 ? `#${c[1]}${c[1]}${c[2]}${c[2]}${c[3]}${c[3]}` : c;
  let stageColors: StageRules["stageColors"];
  if (o.stageColors && typeof o.stageColors === "object") {
    const sc = o.stageColors as Record<string, unknown>;
    for (const mod of STAGE_RULE_MODULES) {
      const m = sc[mod];
      if (!m || typeof m !== "object") continue;
      const entries: Record<string, string> = {};
      let n = 0;
      for (const [k, v] of Object.entries(m as Record<string, unknown>)) {
        const stage = cleanStr(k).toLowerCase();
        const color = cleanStr(v);
        if (!stage || !HEX_RE.test(color)) continue;
        entries[stage] = expandHex(color);
        if (++n >= 30) break;
      }
      if (n > 0) {
        if (!stageColors) stageColors = {};
        stageColors[mod] = entries;
      }
    }
  }
  const MAX_LABEL = 24;
  let buttonLabels: StageRules["buttonLabels"];
  if (o.buttonLabels && typeof o.buttonLabels === "object") {
    const bl = o.buttonLabels as Record<string, unknown>;
    for (const mod of STAGE_RULE_MODULES) {
      const m = (bl[mod] && typeof bl[mod] === "object" ? bl[mod] : null) as Record<string, unknown> | null;
      if (!m) continue;
      const entry: { advance?: string; back?: string; lost?: string; cancel?: string } = {};
      for (const key of ["advance", "back", "lost", "cancel"] as const) {
        const v = cleanStr(m[key]).slice(0, MAX_LABEL);
        if (v) entry[key] = v;
      }
      if (Object.keys(entry).length > 0) {
        if (!buttonLabels) buttonLabels = {};
        buttonLabels[mod] = entry;
      }
    }
  }
  // Per-stage audiences: keyed by LOWERCASED stage name; only real scopes are
  // stored ("everyone" and empty groupIds → entry dropped, so ScopePicker's
  // transient groups+[] mid-edit shape never persists a nobody-sees-it stage).
  let stageAudiences: StageRules["stageAudiences"];
  if (o.stageAudiences && typeof o.stageAudiences === "object") {
    const sa = o.stageAudiences as Record<string, unknown>;
    for (const mod of STAGE_RULE_MODULES) {
      const mm = sa[mod];
      if (!mm || typeof mm !== "object") continue;
      const entries: Record<string, StageAudience> = {};
      let n = 0;
      for (const [k, v] of Object.entries(mm as Record<string, unknown>)) {
        const stage = cleanStr(k).toLowerCase();
        if (!stage || !v || typeof v !== "object") continue;
        const modeRaw = cleanStr((v as { applyMode?: unknown }).applyMode).toLowerCase();
        if (modeRaw !== "groups" && modeRaw !== "except") continue;
        const ids = cleanList((v as { groupIds?: unknown }).groupIds).slice(0, 50).map((s) => s.toLowerCase());
        if (ids.length === 0) continue;
        entries[stage] = { applyMode: modeRaw, groupIds: ids };
        if (++n >= 30) break;
      }
      if (n > 0) {
        if (!stageAudiences) stageAudiences = {};
        stageAudiences[mod] = entries;
      }
    }
  }
  let workflowTypes: StageRules["workflowTypes"];
  if (o.workflowTypes && typeof o.workflowTypes === "object") {
    const wt = o.workflowTypes as Record<string, unknown>;
    for (const mod of STAGE_RULE_MODULES) {
      const raw = Array.isArray(wt[mod]) ? (wt[mod] as unknown[]) : [];
      const list: WorkflowTypeEntry[] = [];
      const seen = new Set<string>();
      for (const item of raw) {
        // Accept BOTH shapes (#121): bare string (unrestricted) and
        // { name, allowedGroupIds }. Canonical stored form: string when
        // unrestricted, object only when group-restricted — docs untouched
        // by the feature keep their pre-#121 shape.
        const rawName = typeof item === "string" ? item
          : item && typeof item === "object" ? (item as { name?: unknown }).name : "";
        const name = cleanStr(rawName).slice(0, 60);
        if (!name) continue;
        const key = name.toLowerCase();
        if (seen.has(key)) continue;
        seen.add(key);
        const gids = item && typeof item === "object"
          ? cleanList((item as { allowedGroupIds?: unknown }).allowedGroupIds).slice(0, 50)
          : [];
        // Per-workflow user assignment + own stage list (#131). User ids are
        // stored lowercase (membership compares lowercased, like groups). A
        // stage list needs ≥2 entries to be meaningful — a 1-stage list is
        // dropped (= inherit), and the settings UI pre-save gate blocks it.
        const uids = item && typeof item === "object"
          ? cleanList((item as { allowedUserIds?: unknown }).allowedUserIds).slice(0, 200).map((s) => s.toLowerCase())
          : [];
        const typeStages = item && typeof item === "object"
          ? cleanList((item as { stages?: unknown }).stages).slice(0, 30)
          : [];
        // Canonical stored form: bare string when the entry carries NOTHING
        // extra — docs untouched by #121/#131 keep their original shape.
        if (gids.length > 0 || uids.length > 0 || typeStages.length >= 2) {
          const obj: Exclude<WorkflowTypeEntry, string> = { name };
          if (gids.length > 0) obj.allowedGroupIds = gids;
          if (uids.length > 0) obj.allowedUserIds = uids;
          if (typeStages.length >= 2) obj.stages = typeStages;
          list.push(obj);
        } else {
          list.push(name);
        }
        if (list.length >= 24) break;
      }
      if (list.length > 0) {
        if (!workflowTypes) workflowTypes = {};
        workflowTypes[mod] = list;
      }
    }
  }
  const formLayout: FormLayoutRule[] = [];
  if (Array.isArray(o.formLayout)) {
    for (const r of o.formLayout) {
      if (!r || typeof r !== "object") continue;
      const rr = r as Record<string, unknown>;
      const module = cleanModule(rr.module);
      const stage = cleanStr(rr.stage);
      const hidden = cleanList(rr.hidden);
      const readOnly = cleanList(rr.readOnly);
      if (!module || !stage || (hidden.length === 0 && readOnly.length === 0)) continue;
      // Scope: "at" (default, exact stage) / "from" / "until". Unknown values
      // fall back to "at" — never wider than the admin asked for.
      const dirRaw = cleanStr(rr.direction).toLowerCase();
      const direction: "at" | "from" | "until" = dirRaw === "from" || dirRaw === "until" ? dirRaw : "at";
      const layoutExempt = cleanList(rr.exemptGroupIds).slice(0, 50).map((s) => s.toLowerCase());
      const layoutOnly = cleanList(rr.appliesToGroupIds).slice(0, 50).map((s) => s.toLowerCase());
      // Duplicate rows UNION their field lists ONLY when module+stage+scope
      // AND audience all match (pure dedupe — dropping the second row would
      // silently discard admin config). Rows differing in ANY of those stay
      // separate: fusing different scopes mixes ranges, and fusing different
      // audiences cross-contaminates — one row's exemption would suddenly
      // cover another row's fields (the drawer keeps such rows separate; the
      // save path must too, like fieldLocks which never merges at all).
      const audSig = (only: string[], exempt: string[]): string =>
        only.length > 0 ? `only:${[...only].sort().join(",")}`
          : exempt.length > 0 ? `except:${[...exempt].sort().join(",")}`
            : "all";
      const sig = audSig(layoutOnly, layoutExempt);
      const prev = formLayout.find((x) =>
        x.module === module
        && x.stage.trim().toLowerCase() === stage.trim().toLowerCase()
        && (x.direction ?? "at") === direction
        && audSig(x.appliesToGroupIds ?? [], x.exemptGroupIds ?? []) === sig);
      if (prev) {
        for (const f of hidden) if (!prev.hidden.some((p) => p.toLowerCase() === f.toLowerCase())) prev.hidden.push(f);
        for (const f of readOnly) if (!prev.readOnly.some((p) => p.toLowerCase() === f.toLowerCase())) prev.readOnly.push(f);
        continue;
      }
      const layoutRule: FormLayoutRule = { module, stage, hidden, readOnly };
      if (direction !== "at") layoutRule.direction = direction;
      if (layoutOnly.length > 0) layoutRule.appliesToGroupIds = layoutOnly;
      else if (layoutExempt.length > 0) layoutRule.exemptGroupIds = layoutExempt;
      formLayout.push(layoutRule);
      if (formLayout.length >= MAX_RULES) break;
    }
  }
  // Required fields to enter a stage (#137) — mirrors the fieldLocks shape
  // minus direction (exact-target semantics need no anchor positioning).
  const requiredFields: RequiredFieldsRule[] = [];
  if (Array.isArray(o.requiredFields)) {
    for (const r of o.requiredFields) {
      if (!r || typeof r !== "object") continue;
      const rr = r as Record<string, unknown>;
      const module = cleanModule(rr.module);
      const stage = cleanStr(rr.stage);
      const fields = cleanList(rr.fields);
      if (!module || !stage || fields.length === 0) continue;
      const reqExempt = cleanList(rr.exemptGroupIds).slice(0, 50).map((s) => s.toLowerCase());
      const reqOnly = cleanList(rr.appliesToGroupIds).slice(0, 50).map((s) => s.toLowerCase());
      const reqRule: RequiredFieldsRule = { module, stage, fields };
      if (reqOnly.length > 0) reqRule.appliesToGroupIds = reqOnly;
      else if (reqExempt.length > 0) reqRule.exemptGroupIds = reqExempt;
      requiredFields.push(reqRule);
      if (requiredFields.length >= MAX_RULES) break;
    }
  }
  // Stage guidance (#137): LOWERCASED stage → short tip, display-only. Own
  // length cap (tips read better a touch longer than rule strings).
  const MAX_TIP = 240;
  let stageGuidance: StageRules["stageGuidance"];
  if (o.stageGuidance && typeof o.stageGuidance === "object") {
    const sg = o.stageGuidance as Record<string, unknown>;
    for (const mod of STAGE_RULE_MODULES) {
      const m = sg[mod];
      if (!m || typeof m !== "object") continue;
      const entries: Record<string, string> = {};
      let n = 0;
      for (const [k, v] of Object.entries(m as Record<string, unknown>)) {
        const stage = cleanStr(k).toLowerCase();
        const tip = typeof v === "string" ? v.trim().slice(0, MAX_TIP) : "";
        if (!stage || !tip) continue;
        entries[stage] = tip;
        if (++n >= 30) break;
      }
      if (n > 0) {
        if (!stageGuidance) stageGuidance = {};
        stageGuidance[mod] = entries;
      }
    }
  }
  const out: StageRules = { fieldLocks, stageSkips };
  if (workflowTypes) out.workflowTypes = workflowTypes;
  if (formLayout.length > 0) out.formLayout = formLayout;
  if (requiredFields.length > 0) out.requiredFields = requiredFields;
  if (stageOrder) out.stageOrder = stageOrder;
  if (stageColors) out.stageColors = stageColors;
  if (buttonLabels) out.buttonLabels = buttonLabels;
  if (stageAudiences) out.stageAudiences = stageAudiences;
  if (stageGuidance) out.stageGuidance = stageGuidance;
  return out;
}

/* ── Workflow TEMPLATES (#131) ────────────────────────────────────────────────
   Reusable named stage-list templates in a STANDARD format, stored per tenant
   in their own settings row (scope "stagetemplates:<tenant>") so the
   enforcement-critical stage-rules doc stays lean. A template is display/config
   data only — applying one copies its stages into a module's workflow. */

export interface WorkflowTemplate {
  /** Stable id (slug) so renames don't orphan references. */
  id: string;
  name: string;
  /** Optional module hint (where it was saved from) — templates apply anywhere. */
  module?: StageRuleModule;
  /** Ordered stage names (2–30). */
  stages: string[];
  /** Optional display colors: LOWERCASED stage name → #RRGGBB. */
  stageColors?: Record<string, string>;
  /** Who this stage set is for (Save As scope). Absent = "everyone". */
  applyMode?: "everyone" | "except" | "groups";
  /** Group ids for "except"/"groups" modes. */
  groupIds?: string[];
}

export interface WorkflowTemplatesDoc { templates: WorkflowTemplate[] }

const MAX_TEMPLATES = 40;
const TEMPLATE_HEX_RE = /^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/;

export function sanitizeWorkflowTemplates(raw: unknown): WorkflowTemplatesDoc {
  const o = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  const templates: WorkflowTemplate[] = [];
  const seenIds = new Set<string>();
  const expandHex = (c: string) =>
    c.length === 4 ? `#${c[1]}${c[1]}${c[2]}${c[2]}${c[3]}${c[3]}` : c;
  if (Array.isArray(o.templates)) {
    for (const t of o.templates) {
      if (!t || typeof t !== "object") continue;
      const tt = t as Record<string, unknown>;
      const name = cleanStr(tt.name).slice(0, 60);
      const stages = cleanList(tt.stages).slice(0, 30);
      if (!name || stages.length < 2) continue; // a 1-stage template is meaningless
      let id = cleanStr(tt.id).slice(0, 40).toLowerCase().replace(/[^a-z0-9_-]+/g, "-").replace(/^-+|-+$/g, "");
      if (!id) id = name.toLowerCase().replace(/[^a-z0-9_-]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 40) || `tpl-${templates.length + 1}`;
      if (seenIds.has(id)) continue;
      seenIds.add(id);
      const module = cleanModule(tt.module) ?? undefined;
      const tpl: WorkflowTemplate = { id, name, stages };
      if (module) tpl.module = module;
      if (tt.stageColors && typeof tt.stageColors === "object") {
        const colors: Record<string, string> = {};
        let n = 0;
        for (const [k, v] of Object.entries(tt.stageColors as Record<string, unknown>)) {
          const stage = cleanStr(k).toLowerCase();
          const color = cleanStr(v);
          if (!stage || !TEMPLATE_HEX_RE.test(color)) continue;
          colors[stage] = expandHex(color);
          if (++n >= 30) break;
        }
        if (n > 0) tpl.stageColors = colors;
      }
      // Scope (Save As "for whom"): keep only coherent combinations — a
      // group-scoped mode with no groups collapses back to "everyone".
      const mode = tt.applyMode === "except" || tt.applyMode === "groups" ? tt.applyMode : undefined;
      const gids = cleanList(tt.groupIds).slice(0, 50);
      if (mode && gids.length > 0) { tpl.applyMode = mode; tpl.groupIds = gids; }
      templates.push(tpl);
      if (templates.length >= MAX_TEMPLATES) break;
    }
  }
  return { templates };
}

export function hasAnyStageRules(rules: StageRules): boolean {
  return rules.fieldLocks.length > 0 || rules.stageSkips.length > 0 || !!rules.stageOrder || !!rules.stageColors || !!rules.buttonLabels
    || !!rules.workflowTypes || (rules.formLayout?.length ?? 0) > 0
    || (rules.requiredFields?.length ?? 0) > 0 || !!rules.stageGuidance;
}

const norm = (s: string) => s.trim().toLowerCase();

/**
 * The workflow's OWN stage list for a record's WorkflowTypeName (#131), or
 * null when the record should use the module stage order (blank/unknown type,
 * or a type without a custom list). Mirrored in the web lib — keep in sync.
 */
export function workflowStagesFor(
  rules: StageRules,
  mod: StageRuleModule,
  workflowTypeName: string | null | undefined,
): string[] | null {
  const n = norm(String(workflowTypeName ?? ""));
  if (!n) return null;
  for (const e of rules.workflowTypes?.[mod] ?? []) {
    const name = typeof e === "string" ? e : e.name;
    if (norm(name) !== n) continue;
    const stages = typeof e === "string" ? undefined : e.stages;
    return stages && stages.length >= 2 ? stages : null;
  }
  return null;
}

/** Position of a stage in the tenant order (see semantics at the top). */
export function stagePos(stage: string | null | undefined, order: string[]): number {
  const s = norm(String(stage ?? ""));
  if (!s) return -Infinity;
  const idx = order.findIndex((o) => norm(o) === s);
  return idx >= 0 ? idx : Infinity;
}

/** Whether a single lock rule applies at the record's current stage. */
export function lockApplies(rule: FieldLockRule, currentStage: string | null | undefined, order: string[]): boolean {
  const anchorIdx = order.findIndex((o) => norm(o) === norm(rule.stage));
  if (anchorIdx < 0) {
    // Anchor stage missing from the evaluated order. Rules can legitimately
    // anchor on stages outside the tenant workflow — a record's own schedule
    // phase, or an "in-use" status materialized by the stage editor — so
    // this is NOT always a stale rule. Ordering is unknowable here, but a
    // record SITTING ON the anchor stage is unambiguous: "from" (locked at
    // and after the stage) applies there; "until" (locked before reaching
    // it) does not. Any other stage keeps the stale-rule stance (inactive).
    const cur = norm(String(currentStage ?? ""));
    return rule.direction === "from" && cur !== "" && cur === norm(rule.stage);
  }
  const cur = stagePos(currentStage, order);
  return rule.direction === "from" ? cur >= anchorIdx : cur < anchorIdx;
}

/**
 * Whether the acting user's group memberships exempt them from a rule (#122).
 * memberGroupIds = the group ids the user belongs to, LOWERCASED; undefined /
 * empty set (or a rule without exemptGroupIds) = not exempt. Both sides are
 * compared lowercased so stored-case drift can never widen or narrow a rule.
 */
export function ruleExempts(
  rule: { exemptGroupIds?: string[]; appliesToGroupIds?: string[] },
  memberGroupIds?: ReadonlySet<string> | null,
): boolean {
  // "Only specific groups" mode: the rule applies ONLY to members of the
  // listed groups. Membership UNKNOWN (undefined) fails closed — the rule
  // applies; a loaded-but-empty set means the user is in no groups → exempt.
  const only = rule.appliesToGroupIds ?? [];
  if (only.length > 0) {
    if (!memberGroupIds) return false;
    return !only.some((id) => memberGroupIds.has(id.trim().toLowerCase()));
  }
  if (!memberGroupIds || memberGroupIds.size === 0) return false;
  return (rule.exemptGroupIds ?? []).some((id) => memberGroupIds.has(id.trim().toLowerCase()));
}

/**
 * All locked field names (lowercased) for a record, mapped to the rule that
 * locks them (first matching rule wins for the message).
 */
export function computeLockedFields(
  rules: StageRules,
  module: StageRuleModule,
  currentStage: string | null | undefined,
  order: string[],
  /** Acting user's group ids (lowercased) — rules exempting one of them are dropped PER-RULE (#122). */
  memberGroupIds?: ReadonlySet<string> | null,
): Map<string, FieldLockRule> {
  const out = new Map<string, FieldLockRule>();
  for (const rule of rules.fieldLocks) {
    if (rule.module !== module) continue;
    if (ruleExempts(rule, memberGroupIds)) continue;
    if (!lockApplies(rule, currentStage, order)) continue;
    for (const f of rule.fields) {
      const k = norm(f);
      if (!out.has(k)) out.set(k, rule);
    }
  }
  return out;
}

/** Human message for a blocked write — shown in the web UI, chat and API errors. */
export function lockMessage(rule: FieldLockRule, fieldLabel: string): string {
  return rule.direction === "from"
    ? `"${fieldLabel}" is locked by your company's stage rules once a record reaches "${rule.stage}".`
    : `"${fieldLabel}" is locked by your company's stage rules until the record reaches "${rule.stage}".`;
}

/**
 * Whether a single form-layout rule applies at the record's current stage.
 * "at" (default) = exact, case-insensitive stage match (blank current stage
 * never matches). "from"/"until" mirror lockApplies exactly: stages position
 * on the tenant order, a missing anchor deactivates the rule, and a record
 * with NO stage yet counts as before every stage (so "until" applies to it).
 */
export function layoutApplies(rule: FormLayoutRule, currentStage: string | null | undefined, order: string[]): boolean {
  const dir = rule.direction ?? "at";
  if (dir === "at") {
    const cur = norm(String(currentStage ?? ""));
    return cur !== "" && norm(rule.stage) === cur;
  }
  const anchorIdx = order.findIndex((o) => norm(o) === norm(rule.stage));
  if (anchorIdx < 0) {
    // Same anchor-off-the-order fallback as lockApplies: a record sitting ON
    // the rule's stage is unambiguously "at & after" it — "from" applies,
    // "until" does not. Elsewhere the rule stays inactive (stale-rule stance).
    const cur = norm(String(currentStage ?? ""));
    return dir === "from" && cur !== "" && cur === norm(rule.stage);
  }
  const cur = stagePos(currentStage, order);
  return dir === "from" ? cur >= anchorIdx : cur < anchorIdx;
}

/**
 * Form-layout field states for a record at its current stage. Lowercased
 * FieldName → rule + state for every field hidden or read-only there. Rules
 * default to exact-stage ("at"); "from"/"until" scopes evaluate against the
 * SAME stage order as field locks (pass the order lock evaluation resolved).
 */
export function computeLayoutFields(
  rules: StageRules,
  module: StageRuleModule,
  currentStage: string | null | undefined,
  order: string[],
  /** Acting user's group ids (lowercased) — rules exempting one of them are dropped PER-RULE (#123). */
  memberGroupIds?: ReadonlySet<string> | null,
): Map<string, { rule: FormLayoutRule; state: "hidden" | "readOnly" }> {
  const out = new Map<string, { rule: FormLayoutRule; state: "hidden" | "readOnly" }>();
  for (const rule of rules.formLayout ?? []) {
    if (rule.module !== module) continue;
    if (!layoutApplies(rule, currentStage, order)) continue;
    if (ruleExempts(rule, memberGroupIds)) continue;
    for (const f of rule.hidden) { const k = norm(f); if (!out.has(k)) out.set(k, { rule, state: "hidden" }); }
    for (const f of rule.readOnly) { const k = norm(f); if (!out.has(k)) out.set(k, { rule, state: "readOnly" }); }
  }
  return out;
}

/** Human message for a form-layout-blocked write. */
export function layoutMessage(rule: FormLayoutRule, fieldLabel: string, state: "hidden" | "readOnly"): string {
  const dir = rule.direction ?? "at";
  const when = dir === "from"
    ? `once the record reaches "${rule.stage}"`
    : dir === "until"
      ? `until the record reaches "${rule.stage}"`
      : `while the record is at "${rule.stage}"`;
  return state === "hidden"
    ? `"${fieldLabel}" is hidden by your company's form layout ${when}.`
    : `"${fieldLabel}" is read-only by your company's form layout ${when}.`;
}

/**
 * Required-field rules that fire when a record is moved TO `targetStage`
 * (#137). Exact, case-insensitive target match — see RequiredFieldsRule for
 * why this is deliberately not positional. Rules the actor's memberships
 * exempt are dropped per-rule, same as locks.
 */
export function requiredFieldsForTarget(
  rules: StageRules,
  module: StageRuleModule,
  targetStage: string | null | undefined,
  memberGroupIds?: ReadonlySet<string> | null,
): RequiredFieldsRule[] {
  const t = norm(String(targetStage ?? ""));
  if (!t) return [];
  const out: RequiredFieldsRule[] = [];
  for (const rule of rules.requiredFields ?? []) {
    if (rule.module !== module) continue;
    if (norm(rule.stage) !== t) continue;
    if (ruleExempts(rule, memberGroupIds)) continue;
    out.push(rule);
  }
  return out;
}

/** Human message for a blocked stage move — lists exactly what to fill in. */
export function requiredMessage(stageDisplay: string, missingLabels: string[]): string {
  return `To move this record to "${stageDisplay}", please fill in first: ${missingLabels.join(", ")}.`;
}

/** Display-only stage tip for a record's current stage, or null. */
export function guidanceForStage(rules: StageRules, module: StageRuleModule, stage: string | null | undefined): string | null {
  const s = norm(String(stage ?? ""));
  if (!s) return null;
  return rules.stageGuidance?.[module]?.[s] ?? null;
}

/** Case-insensitive trimmed equality for skip-rule conditions. */
export function skipConditionMatches(rule: StageSkipRule, fieldValue: string | null | undefined): boolean {
  return norm(String(fieldValue ?? "")) === norm(rule.value);
}

/**
 * Stages (lowercased set) hidden for a record, given a reader for the record's
 * condition-field values. Used by the web lifecycle bar; never blocks writes.
 */
export function skippedStagesFor(
  rules: StageRules,
  module: StageRuleModule,
  getFieldValue: (field: string) => string | null | undefined,
  /** Acting user's group ids (lowercased) — exempt members still SEE the stages (#122). */
  memberGroupIds?: ReadonlySet<string> | null,
): Set<string> {
  const out = new Set<string>();
  for (const rule of rules.stageSkips) {
    if (rule.module !== module) continue;
    // Workflow-type rules (#121): the type's audience (stamped into
    // exemptGroupIds) BEATS an "only these groups" scope — people who can
    // USE the type must always SEE its skipped stages. Lockstep with the
    // web's skippedStagesFor; generic rules keep appliesTo-wins.
    if (
      rule.field === "WorkflowTypeName" &&
      memberGroupIds &&
      (rule.exemptGroupIds ?? []).some((id) => memberGroupIds.has(id.trim().toLowerCase()))
    ) continue;
    if (ruleExempts(rule, memberGroupIds)) continue;
    if (!skipConditionMatches(rule, getFieldValue(rule.field))) continue;
    for (const s of rule.skipStages) out.add(norm(s));
  }
  return out;
}

// ─────────────────────────────────────────────────────────────────────────────
// Skip-rule ENFORCEMENT (server write path) — where should the record land?
//
// skippedStagesFor above answers the display question ("which stages does
// this viewer's lifecycle bar hide"); this answers the write-path question:
// the record is entering / resting in a stage its own field values say to
// skip — which stage should it actually sit in? Differences are deliberate:
//   • Only AUDIENCE-FREE rules enforce. A skip scoped to groups
//     (appliesToGroupIds) or carrying exemptions (exemptGroupIds — which
//     includes every workflow-type skip whose type audience is stamped
//     there) means different people legitimately see different lifecycles,
//     so the record's STORED stage must stay viewer-neutral: those rules
//     remain display-only (stage-audience-display-scope doctrine). A
//     workflow-type skip with NO audience applies to everyone and enforces.
//   • OUTCOME stages are never entered or crossed: auto-advancing must never
//     close / lose / convert a record, and an outcome the record reached is
//     a result, not a resting stage to hop out of.
//   • Forward first, then backward: the target is the next non-skipped
//     working stage AHEAD; when nothing ahead can hold the record (last
//     stage, everything forward skipped, or an outcome next), it backs out
//     to the nearest EARLIER working stage instead — a record never rests
//     in a skipped stage. No candidate anywhere (stage off the path, or
//     every other stage skipped/outcome) → null: the record stays put.
// ─────────────────────────────────────────────────────────────────────────────
export function skipAdvanceTarget(
  rules: StageRules,
  module: StageRuleModule,
  stage: string,
  orderedStages: readonly string[],
  getFieldValue: (field: string) => string | null | undefined,
): string | null {
  const enforceable = rules.stageSkips.filter(
    (r) => r.module === module
      && (r.appliesToGroupIds?.length ?? 0) === 0
      && (r.exemptGroupIds?.length ?? 0) === 0,
  );
  if (enforceable.length === 0) return null;
  const skipped = skippedStagesFor({ ...rules, stageSkips: enforceable }, module, getFieldValue);
  const s = norm(stage);
  if (!s || !skipped.has(s)) return null;
  if (isOutcomeStageName(stage)) return null; // outcomes are results, never redirected
  const idx = orderedStages.findIndex((o) => norm(o) === s);
  if (idx < 0) return null; // stage not on this record's path — leave it alone
  for (let i = idx + 1; i < orderedStages.length; i++) {
    const cand = orderedStages[i];
    if (skipped.has(norm(cand))) continue;
    if (isOutcomeStageName(cand)) break; // never auto-close/lose/convert — try backing out instead
    return cand;
  }
  // Nothing AHEAD can hold the record — it sits in the LAST stage, or
  // everything forward is skipped, or the next real stage is an outcome.
  // Back out to the nearest EARLIER working stage instead: a record must
  // never rest in a skipped stage, and forward motion has nowhere safe to
  // land. Only when every other stage is also skipped or an outcome does the
  // record stay put (degenerate config — there is no valid resting stage).
  for (let i = idx - 1; i >= 0; i--) {
    const cand = orderedStages[i];
    if (skipped.has(norm(cand)) || isOutcomeStageName(cand)) continue;
    return cand;
  }
  return null;
}

// ─────────────────────────────────────────────────────────────────────────────
// Outcome-stage detection (schedule seeding).
//
// Terminal OUTCOME stages (Lost, Declined, Converted, Closed – …) are
// results a record ENDS in, not steps that occupy time on a schedule. When a
// new opportunity seeds its schedule phases from the opportunity stage list
// (/new-record auto-lifecycle), outcome stages are excluded — a Gantt with a
// scheduled "Lost" band is meaningless. "Awarded" is deliberately NOT an
// outcome here: clients treat it as a real working phase (contract award →
// kickoff), so when it appears in the tenant's stage list it seeds onto the
// schedule like any other step. This matches the web stage editor's
// display-only isTerminalish (StageRulesSettings.tsx) — keep the two in
// lockstep. En/em dashes normalize to "-" so "Closed – Won" matches.
// ─────────────────────────────────────────────────────────────────────────────
export function isOutcomeStageName(name: string): boolean {
  const k = String(name ?? "").trim().toLowerCase().replace(/[\u2013\u2014]/g, "-");
  return k === "converted" || k === "lost" || k === "won"
    || k === "cancelled" || k === "canceled" || k === "declined"
    || k.startsWith("closed");
}
