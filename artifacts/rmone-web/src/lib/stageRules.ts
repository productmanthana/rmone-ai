/**
 * Company STAGE RULES — admin-configured, tenant-wide:
 *
 *  1. FIELD LOCKS: "once a record reaches stage X, these fields can no longer
 *     be edited" (direction "from"), or "locked UNTIL the record reaches stage
 *     X" (direction "until"). The SERVER enforces these on every write path
 *     (fail closed); this client copy exists so record pages can grey out
 *     locked cells and explain why before the user even tries.
 *
 *  2. STAGE SKIPS: "records where <field> = <value> skip these stages" — a
 *     display/advance rule only: the lifecycle bar hides those stages and
 *     Advance jumps over them. Never blocks a direct stage write.
 *
 * Evaluation semantics are DUPLICATED from the server
 * (api-server/src/lib/stage-rules.ts) — keep the two in lockstep:
 *   pos(blank stage)              = -Infinity   (before everything)
 *   pos(known stage)              = index in the tenant stage order
 *   pos(unknown non-blank stage)  = +Infinity   (terminals like "Closed – Won")
 *   "from":  locked when pos(current) >= pos(anchor)
 *   "until": locked when pos(current) <  pos(anchor)
 *   anchor missing from the order → rule INACTIVE (stale rule; settings warns).
 *
 * Singleton pattern mirrors lib/displayDefaults.ts: module-level value +
 * version counter + useSyncExternalStore hook, refreshed on consuming-page
 * mount (throttled to once a minute) and reset on auth change.
 */

import { useSyncExternalStore } from "react";
import { authHeaders, getStoredUser, bustCache } from "./api";
import { EXTRA_FIELD_CATALOG, type DisplayView } from "./displayDefaults";

const API = "/api/onboarding";

export const STAGE_RULE_MODULES = ["LEM", "OPM", "PMM"] as const;
export type StageRuleModule = (typeof STAGE_RULE_MODULES)[number];

/* ── Pickable field catalogs ─────────────────────────────────────────────────
   Curated per-module FieldNames (the exact names the record save paths send)
   FIRST, then EVERY field from the Display Defaults extra-column catalog —
   the same superset admins pick new list columns from — so lock/layout
   pickers always offer ALL fields, and a column an admin adds later shows up
   here automatically (both catalogs are the same client-side source). */
export const STAGE_FIELD_CATALOG: Record<StageRuleModule, { value: string; label: string }[]> = {
  PMM: [
    { value: "CRMProjectStatusChoice", label: "Status" },
    { value: "SectorChoice", label: "Sector" },
    { value: "ProjectType", label: "Project Type" },
    { value: "ServiceType", label: "Service Type" },
    { value: "ContractValue", label: "Contract Value" },
    { value: "LaborContractAmount", label: "Labor Contract" },
    { value: "ForecastedProjectCost", label: "Forecasted Project Cost" },
    { value: "NonOperatingCost", label: "Non-Operating Cost" },
    { value: "CRMBusinessUnitChoice", label: "Business Unit" },
    { value: "DivisionLookup", label: "Division" },
    { value: "DepartmentLookup", label: "Department" },
    { value: "CRMClientName", label: "Client Name" },
    { value: "TargetStartDate", label: "Target Start Date" },
    { value: "TargetCompletionDate", label: "Target Completion Date" },
  ],
  OPM: [
    { value: "CRMOpportunityStatusChoice", label: "Status / Stage" },
    { value: "SectorChoice", label: "Sector" },
    { value: "ProjectType", label: "Project Type" },
    { value: "ServiceType", label: "Service Type" },
    { value: "ApproxContractValue", label: "Approx Contract Value" },
    { value: "LaborContractAmount", label: "Labor Contract" },
    { value: "CRMBusinessUnitChoice", label: "Business Unit" },
    { value: "DivisionLookup", label: "Division" },
    { value: "DepartmentLookup", label: "Department" },
    { value: "CRMClientName", label: "Client Name" },
    // Client contact person — the web edit sends FieldName "OwnerName" for
    // Opp/PMM records (the server maps it to the live column), so locks and
    // required-fields rules stored under this name catch those saves.
    { value: "OwnerName", label: "Client Contact" },
    { value: "TargetStartDate", label: "Target Start Date" },
    { value: "TargetCompletionDate", label: "Target Completion Date" },
  ],
  LEM: [
    { value: "LeadStatus", label: "Status" },
    { value: "SectorChoice", label: "Sector" },
    { value: "ProjectType", label: "Project Type" },
    { value: "ServiceType", label: "Service Type" },
    { value: "ContractValue", label: "Estimated Value" },
    { value: "CRMBusinessUnitChoice", label: "Business Unit" },
    { value: "CRMClientName", label: "Client Name" },
    // Lead contact edits send FieldName "ContactName" (Lead's own column) —
    // keep the rule key aligned with what the save path sends.
    { value: "ContactName", label: "Client Contact" },
    { value: "TargetCompletionDate", label: "Due Date" },
  ],
};

const MODULE_VIEW: Record<StageRuleModule, DisplayView> = {
  PMM: "projects", OPM: "opportunities", LEM: "leads",
};

/** Every pickable field for a module: curated (most used) first, then the
 *  remaining extra-column catalog fields alphabetically, deduped by both
 *  FieldName and label so "Division"/"DivisionLookup" don't show twice. */
export function allFieldsFor(m: StageRuleModule): { value: string; label: string }[] {
  const out = [...STAGE_FIELD_CATALOG[m]];
  const seenVal = new Set(out.map(f => f.value));
  const seenLbl = new Set(out.map(f => f.label.trim().toLowerCase()));
  const extras = EXTRA_FIELD_CATALOG[MODULE_VIEW[m]]
    .filter(f => !seenVal.has(f.key) && !seenLbl.has(f.label.trim().toLowerCase()))
    .map(f => ({ value: f.key, label: f.label }))
    .sort((a, b) => a.label.localeCompare(b.label));
  return [...out, ...extras];
}

/** The status FieldName per module. The stage system already OWNS this field —
 *  moving a record between stages IS a status write, and the per-stage gates
 *  (who can act, locks, skips) already govern it. Offering it again in rule
 *  pickers only invites rules that fight the stage machinery (a skip
 *  condition on Status is circular; a Status lock overrides stage moves). */
const STATUS_FIELD_KEY: Record<StageRuleModule, string> = {
  PMM: "crmprojectstatuschoice", OPM: "crmopportunitystatuschoice", LEM: "leadstatus",
};
// Deliberately narrow: bare "Stage" is NOT excluded — tenants may have a
// legitimate custom field labeled "Stage" (e.g. construction phase text).
const STATUS_FIELD_LABELS = new Set(["status", "status / stage"]);
export function isStatusFieldOption(m: StageRuleModule, o: { value: string; label: string }): boolean {
  return o.value.trim().toLowerCase() === STATUS_FIELD_KEY[m]
    || STATUS_FIELD_LABELS.has(o.label.trim().toLowerCase());
}

/** allFieldsFor minus the module's status field — what RULE pickers (skip
 *  conditions, field locks, form layout) should offer. Legacy saved rules
 *  that reference status still display via each editor's unknown-field
 *  fallback; they just can't be created anew. */
export function ruleFieldsFor(m: StageRuleModule): { value: string; label: string }[] {
  return allFieldsFor(m).filter(o => !isStatusFieldOption(m, o));
}

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
   * if this rule didn't exist. Lowercase ids; absent/empty = nobody exempt.
   * Per-rule: a second non-exempt rule on the same field still locks it.
   */
  exemptGroupIds?: string[];
  /** "Only specific groups": when non-empty the lock applies ONLY to members. */
  appliesToGroupIds?: string[];
}

/**
 * REQUIRED FIELDS to enter a stage (#137) — mirrors the fieldLocks shape minus
 * direction: the rule names the TARGET stage (exact, case-insensitive) and the
 * fields that must be non-empty before a record may move there. Server-enforced
 * on every status write path; this client copy powers the Set-rules editor.
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

export interface StageSkipRule {
  module: StageRuleModule;
  field: string;
  value: string;
  skipStages: string[];
  /** User groups EXEMPT from this skip (#122) — members still SEE the stages. */
  exemptGroupIds?: string[];
  /**
   * "Only specific groups": when non-empty the skip applies ONLY to members.
   * On WorkflowTypeName rules BOTH lists may be stored: the type's audience is
   * stamped into exemptGroupIds and BEATS this scope (skippedStagesFor), so
   * people who can USE a type always SEE its skipped stages.
   */
  appliesToGroupIds?: string[];
}

export interface FormLayoutRule {
  module: StageRuleModule;
  /** Anchor stage name (case-insensitive against the tenant stage order). */
  stage: string;
  /**
   * When the rule applies relative to the anchor stage. Canonical stored form
   * OMITS the key for "at" (exact-stage — the original behavior). "from" = at
   * the anchor and every later stage; "until" = every stage before the anchor.
   * from/until position stages on the same tenant order as fieldLocks — an
   * anchor missing from the order deactivates the rule (mirrors the server).
   */
  direction?: "at" | "from" | "until";
  /** FieldNames hidden while the rule applies (implies not editable). */
  hidden: string[];
  /** FieldNames visible but read-only while the rule applies. */
  readOnly: string[];
  /**
   * User groups EXEMPT from this layout rule (#123) — members see and edit the
   * fields as if this rule didn't exist. Lowercase ids; absent/empty = applies
   * to everyone. Per-rule, like #122's lock/skip exemptions.
   */
  exemptGroupIds?: string[];
  /** "Only specific groups": when non-empty the layout rule applies ONLY to members. */
  appliesToGroupIds?: string[];
}

/**
 * One workflow type entry as STORED (#121): a bare string (unrestricted) or an
 * object whose allowedGroupIds lists the user groups allowed to SET the type
 * on records. Canonical form (mirrors the server sanitizer): string when
 * unrestricted, object only while groups are attached.
 */
export type WorkflowTypeEntry = string | {
  name: string;
  allowedGroupIds?: string[];
  /**
   * Specific USERS allowed to use this workflow (#131) — lowercase user ids,
   * same stance as allowedGroupIds (either list grants). Both absent/empty =
   * tenant-wide.
   */
  allowedUserIds?: string[];
  /**
   * This workflow's OWN ordered stage list (#131). When present (≥2 stages)
   * records carrying this WorkflowTypeName use THESE stages — lifecycle bar,
   * Advance, dropdowns AND lock/layout evaluation — instead of the module's
   * stageOrder. Absent = inherit the module order.
   */
  stages?: string[];
};
/** Normalized form — empty arrays = unrestricted / inherit. */
export interface WorkflowTypeDef { name: string; allowedGroupIds: string[]; allowedUserIds: string[]; stages: string[] }

export interface StageRules {
  fieldLocks: FieldLockRule[];
  stageSkips: StageSkipRule[];
  /**
   * WORKFLOW TYPES (per module): admin-named workflow variants ("Standard",
   * "Federal", …) stored on records in the WorkflowType column. They drive
   * stage skips (stageSkips rules with field "WorkflowTypeName") and the record
   * pages' Workflow Type dropdown. Absent key = feature unused for module.
   * Entries may carry group restrictions (#121) — see WorkflowTypeEntry.
   */
  workflowTypes?: Partial<Record<StageRuleModule, WorkflowTypeEntry[]>>;
  /**
   * FORM LAYOUT (per module + anchor stage): fields hidden or read-only while
   * a record sits in the rule's stage range — "at" the stage (default),
   * "from" it on, or "until" it. Server-enforced on every write path; this
   * client copy hides the cells / greys them out with an explanation.
   */
  formLayout?: FormLayoutRule[];
  /**
   * REQUIRED FIELDS to enter a stage (#137) — see RequiredFieldsRule.
   * Absent key = feature unused (docs untouched by it keep their shape).
   */
  requiredFields?: RequiredFieldsRule[];
  /**
   * ADMIN-DEFINED WORKFLOW (Workflow Stages editor): ordered stage names per
   * module. When set (≥2 stages) the server treats it as the authoritative
   * stage order — the effective order comes back via StageOrderMap.
   */
  stageOrder?: Partial<Record<StageRuleModule, string[]>>;
  /**
   * DISPLAY-ONLY workflow styling: stageColors maps LOWERCASED stage name →
   * hex color (steppers + grid stage-flow dots); buttonLabels renames the
   * lifecycle action buttons per module (old portal parity).
   */
  stageColors?: Partial<Record<StageRuleModule, Record<string, string>>>;
  buttonLabels?: Partial<Record<StageRuleModule, { advance?: string; back?: string; lost?: string; cancel?: string }>>;
  /**
   * PER-STAGE AUDIENCE ("Applies to" button on each Workflow Stages row):
   * LOWERCASED stage name → who that single stage applies to. Absent entry =
   * everyone. The SERVER filters the resolved /stage-rules stageOrder and
   * /field-options status lists with this — display/selection scoping only
   * (locks, layout and "who can act" perms evaluate against the FULL order).
   * groupIds may hold group ids plus "user:" / "org:" sentinels. Mirror of
   * the server sanitizer — dropping this key here would silently erase every
   * stage audience on the admin's next save.
   */
  stageAudiences?: Partial<Record<StageRuleModule, Record<string, StageAudience>>>;
  /**
   * STAGE GUIDANCE (#137): LOWERCASED stage name → one short tip shown on the
   * record pages while a record sits at that stage. DISPLAY-ONLY — never
   * touches enforcement. Mirror of the server sanitizer — dropping this key
   * here would silently erase every tip on the admin's next save.
   */
  stageGuidance?: Partial<Record<StageRuleModule, Record<string, string>>>;
}

/** Audience of ONE stage: "groups" = only members see it, "except" = everyone
 *  BUT members. "Everyone" is stored as absence of the entry. */
export interface StageAudience {
  applyMode: "groups" | "except";
  /** Group ids / "user:" / "org:" sentinels, stored lowercase. */
  groupIds: string[];
}

/** Custom color for a stage (case-insensitive), or null. */
export function stageColorOf(rules: StageRules, mod: StageRuleModule, stage: string): string | null {
  return rules.stageColors?.[mod]?.[stage.trim().toLowerCase()] ?? null;
}

/** Team tip for a stage (case-insensitive), or null. Display-only (#137). */
export function guidanceFor(rules: StageRules, mod: StageRuleModule, stage: string | null | undefined): string | null {
  const s = (stage ?? "").trim().toLowerCase();
  if (!s) return null;
  return rules.stageGuidance?.[mod]?.[s] ?? null;
}

/** Tenant-wide stage order per module; null = no configured order (use fallbacks). */
export type StageOrderMap = Record<StageRuleModule, string[] | null>;

export const EMPTY_STAGE_RULES: StageRules = { fieldLocks: [], stageSkips: [] };
const EMPTY_ORDER: StageOrderMap = { PMM: null, OPM: null, LEM: null };

// Built-in stage orders used for lock evaluation when the tenant has no
// configured order. MUST stay in lockstep with BOTH the server's
// BUILTIN_STAGE_ORDER (api-server/src/lib/rds-provider.ts) and the fallback
// stage lists in pages/project-detail.tsx.
export const FALLBACK_STAGE_ORDER: Record<StageRuleModule, string[]> = {
  PMM: ["Pipeline", "Active"],
  OPM: ["Pending Assignment", "Proposal Development", "Contract Negotiations", "Awarded", "Lost"],
  LEM: ["New", "Prospecting", "Qualifying", "Proposal", "Negotiation", "Awarded"],
};

/* ── Evaluation (verbatim mirror of the server lib) ─────────────────────── */

const norm = (s: string) => s.trim().toLowerCase();

export function stagePos(stage: string | null | undefined, order: string[]): number {
  const s = norm(String(stage ?? ""));
  if (!s) return -Infinity;
  const idx = order.findIndex((o) => norm(o) === s);
  return idx >= 0 ? idx : Infinity;
}

export function lockApplies(rule: FieldLockRule, currentStage: string | null | undefined, order: string[]): boolean {
  const anchorIdx = order.findIndex((o) => norm(o) === norm(rule.stage));
  if (anchorIdx < 0) {
    // Anchor stage missing from the evaluated order (verbatim mirror of the
    // server's lockApplies). Rules can legitimately anchor on stages outside
    // the tenant workflow — a record's own schedule phase, or an "in-use"
    // status materialized by the stage editor — so this is NOT always a
    // stale rule. Ordering is unknowable here, but a record SITTING ON the
    // anchor stage is unambiguous: "from" (locked at and after the stage)
    // applies there; "until" (locked before reaching it) does not. Any other
    // stage keeps the stale-rule stance (inactive).
    const cur = norm(String(currentStage ?? ""));
    return rule.direction === "from" && cur !== "" && cur === norm(rule.stage);
  }
  const cur = stagePos(currentStage, order);
  return rule.direction === "from" ? cur >= anchorIdx : cur < anchorIdx;
}

/**
 * Whether the signed-in user's group memberships exempt them from a rule
 * (#122) — verbatim mirror of the server's ruleExempts. memberGroupIds = the
 * user's group ids LOWERCASED; undefined/empty = not exempt.
 */
export function ruleExempts(
  rule: { exemptGroupIds?: string[]; appliesToGroupIds?: string[] },
  memberGroupIds?: ReadonlySet<string> | null,
): boolean {
  // "Only specific groups" mode: rule applies ONLY to members. Membership
  // UNKNOWN (undefined) fails closed (rule applies); a loaded-but-empty set
  // means the user is in no groups → exempt. Mirrors the server exactly.
  const only = rule.appliesToGroupIds ?? [];
  if (only.length > 0) {
    if (!memberGroupIds) return false;
    return !only.some((id) => memberGroupIds.has(id.trim().toLowerCase()));
  }
  if (!memberGroupIds || memberGroupIds.size === 0) return false;
  return (rule.exemptGroupIds ?? []).some((id) => memberGroupIds.has(id.trim().toLowerCase()));
}

export function computeLockedFields(
  rules: StageRules,
  module: StageRuleModule,
  currentStage: string | null | undefined,
  order: string[],
  /** Signed-in user's group ids (lowercased) — rules exempting one of them are dropped PER-RULE (#122). */
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

export function lockMessage(
  rule: FieldLockRule,
  fieldLabel: string,
  currentStage?: string | null,
  order?: string[],
): string {
  if (rule.direction === "from") {
    const anchor = rule.stage;
    const cur = (currentStage ?? "").trim();
    const anchorNorm = norm(anchor);
    const curNorm = norm(cur);
    if (!cur || !order) {
      // No context — plain fallback.
      return `"${fieldLabel}" is locked. Your company's rules lock this field once a record reaches "${anchor}".`;
    }
    if (curNorm === anchorNorm) {
      return `"${fieldLabel}" is locked. Your company's rules lock this field once a record reaches "${anchor}", and this record is there now.`;
    }
    // Current stage is beyond the anchor (treated as past all configured stages
    // when it isn't in the list — e.g. "Closed" comes after every workflow step).
    const inOrder = order.some(s => norm(s) === curNorm);
    const beyondNote = inOrder
      ? `"${cur}" comes after "${anchor}" in the workflow`
      : `"${cur}" is a terminal status that sits beyond all workflow steps`;
    return `"${fieldLabel}" is locked. Your company's rules lock this field once a record reaches "${anchor}". ${beyondNote}, so the lock applies here too.`;
  }
  // "until" direction
  const anchor = rule.stage;
  const cur = (currentStage ?? "").trim();
  return cur
    ? `"${fieldLabel}" is locked until this record reaches "${anchor}". The current status is "${cur}" — once it progresses to "${anchor}" the field will unlock.`
    : `"${fieldLabel}" is locked until this record reaches "${anchor}". It will unlock once the record progresses to that stage.`;
}

export function skipConditionMatches(rule: StageSkipRule, fieldValue: string | null | undefined): boolean {
  return norm(String(fieldValue ?? "")) === norm(rule.value);
}

export function skippedStagesFor(
  rules: StageRules,
  module: StageRuleModule,
  // The caller supplies the record's DISPLAYED value(s) for a field — the
  // first non-empty column of the same fallback chain the page renders (see
  // condFieldValues in project-detail). The array form exists for fields that
  // legitimately show several values; the rule matches when ANY entry equals
  // its value. Do NOT pass every populated candidate column: stale shadowed
  // columns (e.g. BusinessUnitName derived from the division link) would keep
  // a rule matched after the user edits the value the page actually shows.
  getFieldValue: (field: string) => string | string[] | null | undefined,
  /** Signed-in user's group ids (lowercased) — exempt members still SEE the stages (#122). */
  memberGroupIds?: ReadonlySet<string> | null,
): Set<string> {
  const out = new Set<string>();
  for (const rule of rules.stageSkips) {
    if (rule.module !== module) continue;
    // Workflow-type rules (#121): the type's audience is stamped into
    // exemptGroupIds and BEATS an "only these groups" scope — people who can
    // USE the type must always SEE its skipped stages. Generic rules keep the
    // appliesTo-wins canon inside ruleExempts.
    if (
      rule.field === "WorkflowTypeName" &&
      memberGroupIds &&
      (rule.exemptGroupIds ?? []).some((id) => memberGroupIds.has(id.trim().toLowerCase()))
    ) continue;
    if (ruleExempts(rule, memberGroupIds)) continue;
    const raw = getFieldValue(rule.field);
    const candidates = Array.isArray(raw) ? raw : [raw];
    if (!candidates.some((v) => skipConditionMatches(rule, v))) continue;
    for (const s of rule.skipStages) out.add(norm(s));
  }
  return out;
}

/* ── Field aliasing + labels ────────────────────────────────────────────────
   A lock on "Status" must also catch the cell that saves
   "CRMProjectStatusChoice" (and vice versa). Same substring grouping the
   server's column resolution uses (fieldKind in rds-provider.ts). */

export function webFieldKind(name: string): string | null {
  const n = name.toLowerCase();
  if (n.includes("status")) return "status";
  if (n.includes("sector")) return "sector";
  // Classification choice fields — aliases the per-table column variants
  // (e.g. ProjectType on PMM vs CRMProjectTypeChoice on Lead) the same way
  // the server's fieldKind does, so locks and saves stay in lockstep.
  if (n.includes("projecttype")) return "projecttype";
  if (n.includes("servicetype")) return "servicetype";
  if (n.includes("requestcategory")) return "requestcategory";
  if (n.includes("labor")) return "labor";
  if (n.includes("approx")) return "approxvalue";
  if (n.includes("nonoperating") || n.includes("non-operating") || n === "nonoperatingcost") return "noncost";
  if (n.includes("value")) return "contractvalue";
  // Org FK lookups — mirrors the server exactly: a rule naming "Department"
  // must also catch the cell that saves "DepartmentLookup" (and vice versa).
  if (n === "department" || n === "departmentlookup" || n === "departmentid") return "department";
  if (n === "division" || n === "divisionlookup" || n === "divisionid") return "division";
  return null;
}

/** Human label for lock messages — mirrors the server's friendlyFieldLabel.
 *  Pass `mod` to get the module-specific label (e.g. "Estimated Value" for
 *  ContractValue on Leads instead of the generic "Contract Value"). */
export function friendlyFieldLabel(name: string, mod?: StageRuleModule): string {
  // Module-aware: check the curated catalog first so per-module aliases
  // (e.g. LEM ContractValue → "Estimated Value") win over the generic switch.
  if (mod) {
    const hit = STAGE_FIELD_CATALOG[mod].find(
      o => o.value.toLowerCase() === name.toLowerCase(),
    );
    if (hit) return hit.label;
  }
  switch (webFieldKind(name)) {
    case "status": return "Status";
    case "sector": return "Sector";
    case "projecttype": return "Project Type";
    case "servicetype": return "Service Type";
    case "requestcategory": return "Project Category";
    case "labor": return "Labor Contract Amount";
    case "approxvalue": return "Estimated Value";
    case "contractvalue": return "Contract Value";
    case "noncost": return "Non-Operating Cost";
    default: return name.replace(/([a-z0-9])([A-Z])/g, "$1 $2");
  }
}

/** Required-fields rules gating ENTRY to `targetStage` (#137) — verbatim
 *  mirror of the server's requiredFieldsForTarget (stage-rules.ts). */
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

/**
 * Friendly message when a save would BLANK a field that is required for the
 * record's CURRENT stage, or null when the save may proceed — client mirror
 * of the server's blank-guard in checkRequiredFieldsForStage (the server
 * enforces regardless; this avoids the doomed round-trip). Matching follows
 * the lock convention: exact lowercased name first, then field-kind aliases.
 */
export function requiredBlankNote(
  rules: StageRules,
  module: StageRuleModule,
  currentStage: string | null | undefined,
  fieldName: string,
  memberGroupIds?: ReadonlySet<string> | null,
): string | null {
  const applicable = requiredFieldsForTarget(rules, module, currentStage, memberGroupIds);
  if (applicable.length === 0) return null;
  const fk = norm(fieldName);
  const kind = webFieldKind(fieldName);
  for (const r of applicable) {
    for (const f of r.fields) {
      if (norm(f) !== fk && !(kind !== null && webFieldKind(f) === kind)) continue;
      return `"${friendlyFieldLabel(f, module)}" is required while this record is in the "${r.stage}" stage, so it can't be left empty. Fill it in, or move the record to a stage that doesn't require it.`;
    }
  }
  return null;
}

/**
 * The lock message for the FIRST of `names` that is locked, or null when none
 * are. `names` = the exact FieldName(s) a cell saves; matching is direct
 * (lowercased) first, then via the field-kind alias groups above.
 * Pass `currentStage` + `order` to get the plain-language "why" explanation.
 */
export function lockNoteForFields(
  locked: Map<string, FieldLockRule>,
  names: string[],
  currentStage?: string | null,
  order?: string[],
): string | null {
  if (locked.size === 0) return null;
  for (const name of names) {
    const n = name.trim();
    if (!n) continue;
    let rule = locked.get(n.toLowerCase()) ?? null;
    if (!rule) {
      const wk = webFieldKind(n);
      if (wk) {
        for (const [k, r] of locked) {
          if (webFieldKind(k) === wk) { rule = r; break; }
        }
      }
    }
    if (rule) return lockMessage(rule, friendlyFieldLabel(n), currentStage, order);
  }
  return null;
}

/** Admin-defined workflow type NAMES for a module ([] = feature unused). */
export function workflowTypesFor(rules: StageRules, mod: StageRuleModule): string[] {
  return workflowTypeDefsFor(rules, mod).map((d) => d.name);
}

/** Workflow types normalized to full defs (#121/#131). */
export function workflowTypeDefsFor(rules: StageRules, mod: StageRuleModule): WorkflowTypeDef[] {
  return (rules.workflowTypes?.[mod] ?? []).map((e) =>
    typeof e === "string"
      ? { name: e, allowedGroupIds: [], allowedUserIds: [], stages: [] }
      : { name: e.name, allowedGroupIds: e.allowedGroupIds ?? [], allowedUserIds: e.allowedUserIds ?? [], stages: e.stages ?? [] });
}

/**
 * The workflow's OWN stage list for a record's WorkflowTypeName (#131), or
 * null when the record should use the module stage order (blank/unknown type,
 * or a workflow without a custom list). Verbatim mirror of the server helper.
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

/**
 * Whether a single form-layout rule applies at the record's current stage —
 * verbatim mirror of the server's layoutApplies. "at" (default) = exact,
 * case-insensitive stage match (blank current stage never matches).
 * "from"/"until" mirror lockApplies: stages position on the tenant order, a
 * record with NO stage yet counts as before every stage (so "until" applies
 * to it), and a missing anchor falls back to exact-stage equality — a record
 * sitting ON the rule's stage is "at & after" it even when the order doesn't
 * contain that stage (schedule phases, in-use statuses).
 */
export function layoutApplies(rule: FormLayoutRule, currentStage: string | null | undefined, order: string[]): boolean {
  const dir = rule.direction ?? "at";
  if (dir === "at") {
    const cur = norm(String(currentStage ?? ""));
    return cur !== "" && norm(rule.stage) === cur;
  }
  const anchorIdx = order.findIndex((o) => norm(o) === norm(rule.stage));
  if (anchorIdx < 0) {
    // Same anchor-off-the-order fallback as lockApplies (mirrors the server).
    const cur = norm(String(currentStage ?? ""));
    return dir === "from" && cur !== "" && cur === norm(rule.stage);
  }
  const cur = stagePos(currentStage, order);
  return dir === "from" ? cur >= anchorIdx : cur < anchorIdx;
}

/**
 * Form-layout field states for a record at its current stage (verbatim mirror
 * of the server's computeLayoutFields). Lowercased FieldName → rule + state.
 * "from"/"until" scopes evaluate against the SAME stage order as field locks.
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

/** Human message for a form-layout read-only/hidden cell — mirrors the server. */
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
 * Layout note for the FIRST of `names` hidden or read-only at the current
 * stage, alias-aware like lockNoteForFields; null when none apply.
 */
export function layoutNoteForFields(
  layout: Map<string, { rule: FormLayoutRule; state: "hidden" | "readOnly" }>,
  names: string[],
): string | null {
  if (layout.size === 0) return null;
  for (const name of names) {
    const n = name.trim();
    if (!n) continue;
    let hit = layout.get(n.toLowerCase()) ?? null;
    if (!hit) {
      const wk = webFieldKind(n);
      if (wk) {
        for (const [k, h] of layout) {
          if (webFieldKind(k) === wk) { hit = h; break; }
        }
      }
    }
    if (hit) return layoutMessage(hit.rule, friendlyFieldLabel(n), hit.state);
  }
  return null;
}

/** Lowercased field keys HIDDEN at the current stage (for render filtering). */
export function layoutHiddenKeys(layout: Map<string, { rule: FormLayoutRule; state: "hidden" | "readOnly" }>): Set<string> {
  const out = new Set<string>();
  for (const [k, h] of layout) if (h.state === "hidden") out.add(k);
  return out;
}

/** Case-insensitive raw-field reader for skip-rule conditions. */
export function readRawField(raw: Record<string, unknown> | null | undefined, field: string): string {
  if (!raw) return "";
  const direct = raw[field];
  if (direct != null && String(direct).trim() !== "") return String(direct).trim();
  const want = field.trim().toLowerCase();
  for (const [k, v] of Object.entries(raw)) {
    if (k.trim().toLowerCase() === want && v != null && String(v).trim() !== "") return String(v).trim();
  }
  return "";
}

/* ── Singleton state (mirrors displayDefaults.ts) ───────────────────────── */

export interface StageRulesState {
  rules: StageRules;
  stageOrder: StageOrderMap;
}

const EMPTY_STATE: StageRulesState = { rules: EMPTY_STAGE_RULES, stageOrder: EMPTY_ORDER };

let current: StageRulesState = EMPTY_STATE;
let version = 0;
let loadedAt = 0;                 // 0 = never loaded this sign-in
let inFlight: Promise<void> | null = null;
let loadSeq = 0;                  // invalidates in-flight fetches on auth change
const listeners = new Set<() => void>();

const STALE_MS = 60_000;

function bump() {
  version++;
  for (const l of Array.from(listeners)) {
    try { l(); } catch { /* ignore */ }
  }
}

function subscribe(cb: () => void): () => void {
  listeners.add(cb);
  return () => listeners.delete(cb);
}

/** Reactive version counter — re-renders the component when rules change. */
export function useStageRulesVersion(): number {
  return useSyncExternalStore(subscribe, () => version, () => version);
}

export function getStageRules(): StageRulesState {
  return current;
}

/**
 * True once this session's own-tenant rules are usable as an instant-render
 * seed: either fetched this sign-in, or just saved (save momentarily zeroes
 * loadedAt to force a refetch while `current` already holds the saved doc).
 */
export function stageRulesLoaded(): boolean {
  return loadedAt > 0 || current !== EMPTY_STATE;
}

// Light client-side shape guard (the server sanitizes authoritatively).
// Exported for tests — the mirror must stay lockstep with the server
// sanitizer, and round-trip tests are the cheapest way to catch drift.
export function coerceRules(input: unknown): StageRules {
  const o = (input && typeof input === "object" ? input : {}) as Record<string, unknown>;
  const mods = STAGE_RULE_MODULES as readonly string[];
  const str = (v: unknown): string => (typeof v === "string" ? v.trim() : "");
  const list = (v: unknown): string[] => (Array.isArray(v) ? v.map(str).filter(Boolean) : []);
  const fieldLocks: FieldLockRule[] = [];
  if (Array.isArray(o.fieldLocks)) {
    for (const r of o.fieldLocks) {
      const rr = (r && typeof r === "object" ? r : {}) as Record<string, unknown>;
      const module = str(rr.module).toUpperCase();
      const stage = str(rr.stage);
      const direction = rr.direction === "until" ? "until" as const : rr.direction === "from" ? "from" as const : null;
      const fields = list(rr.fields);
      if (!mods.includes(module) || !stage || !direction || fields.length === 0) continue;
      // Exempt groups (#122) must survive the round-trip — dropping the key
      // here would silently ERASE exemptions on the next client save (same
      // trap as workflowTypes' allowedGroupIds below).
      const lockExempt = list(rr.exemptGroupIds).map((s) => s.toLowerCase());
      const lockOnly = list(rr.appliesToGroupIds).map((s) => s.toLowerCase());
      const lockRule: FieldLockRule = { module: module as StageRuleModule, stage, direction, fields };
      if (lockOnly.length) lockRule.appliesToGroupIds = lockOnly;
      else if (lockExempt.length) lockRule.exemptGroupIds = lockExempt;
      fieldLocks.push(lockRule);
    }
  }
  const stageSkips: StageSkipRule[] = [];
  if (Array.isArray(o.stageSkips)) {
    for (const r of o.stageSkips) {
      const rr = (r && typeof r === "object" ? r : {}) as Record<string, unknown>;
      const module = str(rr.module).toUpperCase();
      const field = str(rr.field);
      const value = str(rr.value);
      const skipStages = list(rr.skipStages);
      if (!mods.includes(module) || !field || !value || skipStages.length === 0) continue;
      const skipExempt = list(rr.exemptGroupIds).map((s) => s.toLowerCase());
      const skipOnly = list(rr.appliesToGroupIds).map((s) => s.toLowerCase());
      const skipRule: StageSkipRule = { module: module as StageRuleModule, field, value, skipStages };
      if (skipOnly.length) skipRule.appliesToGroupIds = skipOnly;
      // Workflow-type rules keep BOTH lists (mirrors the server sanitizer):
      // the type's audience lives in exemptGroupIds and must survive an
      // "only these groups" scope so audience members keep seeing the stages.
      if (skipExempt.length && (!skipOnly.length || field === "WorkflowTypeName")) {
        skipRule.exemptGroupIds = skipExempt;
      }
      stageSkips.push(skipRule);
    }
  }
  let stageOrder: StageRules["stageOrder"];
  if (o.stageOrder && typeof o.stageOrder === "object") {
    const so = o.stageOrder as Record<string, unknown>;
    for (const m of STAGE_RULE_MODULES) {
      const lst = list(so[m]);
      if (lst.length >= 2) {
        if (!stageOrder) stageOrder = {};
        stageOrder[m] = lst;
      }
    }
  }
  const HEX_RE = /^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/;
  // Mirror the server: 6-digit hex only (alpha suffixes break on #RGB),
  // capped at 30 stages per module.
  const expandHex = (c: string) =>
    c.length === 4 ? `#${c[1]}${c[1]}${c[2]}${c[2]}${c[3]}${c[3]}` : c;
  let stageColors: StageRules["stageColors"];
  if (o.stageColors && typeof o.stageColors === "object") {
    const sc = o.stageColors as Record<string, unknown>;
    for (const m of STAGE_RULE_MODULES) {
      const mm = sc[m];
      if (!mm || typeof mm !== "object") continue;
      const entries: Record<string, string> = {};
      let n = 0;
      for (const [k, v] of Object.entries(mm as Record<string, unknown>)) {
        const stage = str(k).toLowerCase();
        const color = str(v);
        if (!stage || !HEX_RE.test(color)) continue;
        entries[stage] = expandHex(color);
        if (++n >= 30) break;
      }
      if (Object.keys(entries).length) {
        if (!stageColors) stageColors = {};
        stageColors[m] = entries;
      }
    }
  }
  // Per-stage audiences — mirror the server: LOWERCASED stage keys, mode
  // whitelist, ids lowercased, empty-audience entries dropped ("everyone" is
  // absence), 30 entries/module, 50 ids each.
  let stageAudiences: StageRules["stageAudiences"];
  if (o.stageAudiences && typeof o.stageAudiences === "object") {
    const sa = o.stageAudiences as Record<string, unknown>;
    for (const m of STAGE_RULE_MODULES) {
      const mm = sa[m];
      if (!mm || typeof mm !== "object") continue;
      const entries: Record<string, StageAudience> = {};
      let n = 0;
      for (const [k, v] of Object.entries(mm as Record<string, unknown>)) {
        const stage = str(k).toLowerCase();
        if (!stage || !v || typeof v !== "object") continue;
        const modeRaw = str((v as { applyMode?: unknown }).applyMode).toLowerCase();
        if (modeRaw !== "groups" && modeRaw !== "except") continue;
        const ids = list((v as { groupIds?: unknown }).groupIds).slice(0, 50).map((s) => s.toLowerCase());
        if (ids.length === 0) continue;
        entries[stage] = { applyMode: modeRaw, groupIds: ids };
        if (++n >= 30) break;
      }
      if (n > 0) {
        if (!stageAudiences) stageAudiences = {};
        stageAudiences[m] = entries;
      }
    }
  }
  let buttonLabels: StageRules["buttonLabels"];
  if (o.buttonLabels && typeof o.buttonLabels === "object") {
    const bl = o.buttonLabels as Record<string, unknown>;
    for (const m of STAGE_RULE_MODULES) {
      const mm = (bl[m] && typeof bl[m] === "object" ? bl[m] : null) as Record<string, unknown> | null;
      if (!mm) continue;
      const entry: { advance?: string; back?: string; lost?: string; cancel?: string } = {};
      for (const key of ["advance", "back", "lost", "cancel"] as const) {
        const v = str(mm[key]).slice(0, 24);
        if (v) entry[key] = v;
      }
      if (Object.keys(entry).length) {
        if (!buttonLabels) buttonLabels = {};
        buttonLabels[m] = entry;
      }
    }
  }
  // Workflow types: per-module admin-named lists (mirror the server's caps:
  // 24 types/module, 60 chars, case-insensitive dedupe). Entries may be bare
  // strings (unrestricted) or { name, allowedGroupIds } objects (#121) —
  // coercing objects through str() would blank their names and silently
  // ERASE group restrictions on the next client save.
  let workflowTypes: StageRules["workflowTypes"];
  if (o.workflowTypes && typeof o.workflowTypes === "object") {
    const wt = o.workflowTypes as Record<string, unknown>;
    for (const m of STAGE_RULE_MODULES) {
      const raw = Array.isArray(wt[m]) ? (wt[m] as unknown[]) : [];
      const entries: WorkflowTypeEntry[] = [];
      const seen = new Set<string>();
      for (const v of raw) {
        const rawName = typeof v === "string" ? v
          : v && typeof v === "object" ? (v as { name?: unknown }).name : "";
        const name = str(rawName).slice(0, 60);
        const key = name.toLowerCase();
        if (!name || seen.has(key)) continue;
        seen.add(key);
        const gids = v && typeof v === "object"
          ? list((v as { allowedGroupIds?: unknown }).allowedGroupIds).slice(0, 50)
          : [];
        // #131: allowedUserIds + per-workflow stages must SURVIVE the
        // round-trip — dropping either key here would silently erase the
        // config on the next client save (the classic coerceRules trap).
        const uids = v && typeof v === "object"
          ? list((v as { allowedUserIds?: unknown }).allowedUserIds).slice(0, 200).map((s) => s.toLowerCase())
          : [];
        const stg = v && typeof v === "object"
          ? list((v as { stages?: unknown }).stages).slice(0, 30)
          : [];
        if (gids.length > 0 || uids.length > 0 || stg.length >= 2) {
          const obj: Exclude<WorkflowTypeEntry, string> = { name };
          if (gids.length > 0) obj.allowedGroupIds = gids;
          if (uids.length > 0) obj.allowedUserIds = uids;
          if (stg.length >= 2) obj.stages = stg;
          entries.push(obj);
        } else {
          entries.push(name);
        }
        if (entries.length >= 24) break;
      }
      if (entries.length) {
        if (!workflowTypes) workflowTypes = {};
        workflowTypes[m] = entries;
      }
    }
  }
  // Form-layout rules: module + anchor stage + at least one field. Dup
  // module+stage+scope UNION-merging is the server's job — this only PRESERVES
  // what the server sent (dropping unknown keys here would silently erase
  // them again on the next save).
  const formLayout: FormLayoutRule[] = [];
  if (Array.isArray(o.formLayout)) {
    for (const r of o.formLayout) {
      const rr = (r && typeof r === "object" ? r : {}) as Record<string, unknown>;
      const module = str(rr.module).toUpperCase();
      const stage = str(rr.stage);
      const hidden = list(rr.hidden);
      const readOnly = list(rr.readOnly);
      if (!mods.includes(module) || !stage || (hidden.length === 0 && readOnly.length === 0)) continue;
      const layoutRule: FormLayoutRule = { module: module as StageRuleModule, stage, hidden, readOnly };
      // Scope key (whitelist deserializer!) — dropping it here would silently
      // erase from/until scopes on the user's next settings save.
      const dirRaw = str(rr.direction).toLowerCase();
      if (dirRaw === "from" || dirRaw === "until") layoutRule.direction = dirRaw;
      const layoutExempt = list(rr.exemptGroupIds).map((s) => s.toLowerCase());
      const layoutOnly = list(rr.appliesToGroupIds).map((s) => s.toLowerCase());
      if (layoutOnly.length) layoutRule.appliesToGroupIds = layoutOnly;
      else if (layoutExempt.length) layoutRule.exemptGroupIds = layoutExempt;
      formLayout.push(layoutRule);
    }
  }
  // Required-fields rules (#137) — mirrors the fieldLocks shape minus
  // direction. Dropping this key here would silently ERASE every
  // required-fields rule on the admin's next settings save.
  const requiredFields: RequiredFieldsRule[] = [];
  if (Array.isArray(o.requiredFields)) {
    for (const r of o.requiredFields) {
      const rr = (r && typeof r === "object" ? r : {}) as Record<string, unknown>;
      const module = str(rr.module).toUpperCase();
      const stage = str(rr.stage);
      const fields = list(rr.fields);
      if (!mods.includes(module) || !stage || fields.length === 0) continue;
      const reqExempt = list(rr.exemptGroupIds).map((s) => s.toLowerCase());
      const reqOnly = list(rr.appliesToGroupIds).map((s) => s.toLowerCase());
      const reqRule: RequiredFieldsRule = { module: module as StageRuleModule, stage, fields };
      if (reqOnly.length) reqRule.appliesToGroupIds = reqOnly;
      else if (reqExempt.length) reqRule.exemptGroupIds = reqExempt;
      requiredFields.push(reqRule);
    }
  }
  // Stage guidance (#137): LOWERCASED stage → short tip. Display-only, but
  // same round-trip stance — dropping the key would erase saved tips.
  let stageGuidance: StageRules["stageGuidance"];
  if (o.stageGuidance && typeof o.stageGuidance === "object") {
    const sg = o.stageGuidance as Record<string, unknown>;
    for (const m of STAGE_RULE_MODULES) {
      const mm = sg[m];
      if (!mm || typeof mm !== "object") continue;
      const entries: Record<string, string> = {};
      let n = 0;
      for (const [k, v] of Object.entries(mm as Record<string, unknown>)) {
        const stage = str(k).toLowerCase();
        const tip = typeof v === "string" ? v.trim().slice(0, 240) : "";
        if (!stage || !tip) continue;
        entries[stage] = tip;
        if (++n >= 30) break;
      }
      if (n > 0) {
        if (!stageGuidance) stageGuidance = {};
        stageGuidance[m] = entries;
      }
    }
  }
  const out: StageRules = { fieldLocks, stageSkips };
  if (stageOrder) out.stageOrder = stageOrder;
  if (stageColors) out.stageColors = stageColors;
  if (buttonLabels) out.buttonLabels = buttonLabels;
  if (workflowTypes) out.workflowTypes = workflowTypes;
  if (formLayout.length) out.formLayout = formLayout;
  if (requiredFields.length) out.requiredFields = requiredFields;
  if (stageAudiences) out.stageAudiences = stageAudiences;
  if (stageGuidance) out.stageGuidance = stageGuidance;
  return out;
}

function coerceOrder(input: unknown): StageOrderMap {
  const o = (input && typeof input === "object" ? input : {}) as Record<string, unknown>;
  const out: StageOrderMap = { PMM: null, OPM: null, LEM: null };
  for (const m of STAGE_RULE_MODULES) {
    const v = o[m];
    if (Array.isArray(v)) {
      const list = v.filter((x): x is string => typeof x === "string" && x.trim() !== "");
      if (list.length) out[m] = list;
    }
  }
  return out;
}

function applyFetched(next: StageRulesState) {
  if (JSON.stringify(next) !== JSON.stringify(current)) {
    const hadData = current !== EMPTY_STATE;
    current = next;
    bump();
    // The effective rules CHANGED under this session (another admin's save,
    // a group-membership change, a template rescope — all server-side).
    // Status dropdowns embed the workflow stage names, so drop the cached
    // option lists: the version bump above re-runs the version-keyed option
    // effects, and they must not be answered from the pre-change cache.
    // Skipped on the very first fill after sign-in (nothing stale to drop).
    if (hadData) bustCache("field-options:");
  }
}

/**
 * Fetch the signed-in user's company stage rules (+ tenant stage order).
 * Throttled to once a minute; never throws — on failure last-known rules stay
 * (server enforcement is the backstop, so a stale/empty client copy is safe).
 */
export function loadStageRules(opts?: { force?: boolean }): Promise<void> {
  const user = getStoredUser();
  if (!user) {
    if (current !== EMPTY_STATE) { current = EMPTY_STATE; bump(); }
    loadedAt = 0;
    return Promise.resolve();
  }
  if (!opts?.force) {
    if (inFlight) return inFlight;
    if (loadedAt && Date.now() - loadedAt < STALE_MS) return Promise.resolve();
  }
  const seq = ++loadSeq;
  let p!: Promise<void>;
  p = (async () => {
    try {
      const res = await fetch(`${API}/stage-rules`, { headers: authHeaders() });
      if (seq !== loadSeq) return; // auth changed mid-flight — drop the result
      if (!res.ok) return;         // keep last-known rules on any failure
      const body = (await res.json()) as { rules?: unknown; stageOrder?: unknown };
      if (seq !== loadSeq) return;
      loadedAt = Date.now();
      applyFetched({ rules: coerceRules(body?.rules), stageOrder: coerceOrder(body?.stageOrder) });
    } catch {
      /* offline/transient — keep last-known rules */
    } finally {
      if (inFlight === p) inFlight = null;
    }
  })();
  inFlight = p;
  return p;
}

/**
 * Persist rules (admin only — the server rejects everyone else). `tenantId`
 * is only for superadmins editing another company; the local singleton (the
 * superadmin's own tenant) is left untouched in that case. Throws on failure.
 */
export async function saveStageRules(rules: StageRules, tenantId?: string, recordId?: string): Promise<StageRules> {
  const body: Record<string, unknown> = { rules };
  if (tenantId) body.tenantId = tenantId;
  if (recordId) body.recordId = recordId;
  const res = await fetch(`${API}/stage-rules`, {
    method: "PUT",
    headers: { ...authHeaders(), "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const e = await res.json().catch(() => ({} as Record<string, unknown>));
    throw new Error(typeof (e as { error?: unknown }).error === "string" ? (e as { error: string }).error : `HTTP ${res.status}`);
  }
  const bodyJson = (await res.json().catch(() => ({}))) as { rules?: unknown; tenant?: unknown };
  const saved = coerceRules(bodyJson?.rules);
  // Per-RECORD override saves must never touch the app-wide singleton — it
  // mirrors the COMPANY document that every record page reads. Announce the
  // record change instead so the affected record page can refresh its
  // effective copy (lock greying, skip hints).
  if (recordId) {
    notifyRecordStageRulesChanged(recordId);
    return saved;
  }
  const own = (getStoredUser()?.tenant ?? "").trim().toLowerCase();
  // The server echoes the EFFECTIVE tenant label it saved for — trust it over
  // the request param, so an own-tenant save made under a differently-shaped
  // identifier (settings scope selector) still updates this tab's singleton.
  const echo = typeof bodyJson?.tenant === "string" ? bodyJson.tenant.trim().toLowerCase() : "";
  const isOwnTenant = !tenantId || (!!own && (tenantId.trim().toLowerCase() === own || echo === own));
  if (isOwnTenant) {
    // A saved workflow (stageOrder) changes the EFFECTIVE order the server
    // computes, so optimistically overlay the saved override now and refetch
    // the authoritative map (covers override removal reverting to derived).
    const overlay: StageOrderMap = { ...current.stageOrder };
    for (const m of STAGE_RULE_MODULES) {
      const custom = saved.stageOrder?.[m];
      if (custom && custom.length >= 2) {
        overlay[m] = custom;
      } else if (current.rules.stageOrder?.[m]) {
        // Override REMOVED ("Reset to standard"): the effective order reverts
        // to the server-derived one, which the client can't compute — clear
        // it (fall back to builtins) until the forced refetch lands, instead
        // of keeping the old custom order on screen.
        overlay[m] = null;
      }
    }
    loadedAt = Date.now();
    applyFetched({ rules: saved, stageOrder: overlay });
    loadedAt = 0; // next loadStageRules() refetches the effective order
    void loadStageRules();
    // Status dropdowns embed the workflow stage names (the server merges the
    // saved order into /field-options) — drop the cached lists so record
    // pages refetch them instead of serving the pre-save snapshot.
    bustCache("field-options:");
    // Record pages open in OTHER browser tabs have their own singleton —
    // ping them so they resync without a manual refresh.
    pingSiblingTabs();
  }
  return saved;
}

/** Read another company's rules + stage order (superadmin Settings scope) —
 *  or, with `recordId`, ONE record's EFFECTIVE rules (its own override doc
 *  when it has one, the company doc otherwise; `source` says which). Never
 *  touches the singleton. */
export async function fetchStageRulesFor(tenantId?: string, recordId?: string): Promise<StageRulesState & { source?: "record" | "tenant" }> {
  const qs = new URLSearchParams();
  if (tenantId) qs.set("tenantId", tenantId);
  if (recordId) qs.set("recordId", recordId);
  const q = qs.toString();
  const res = await fetch(`${API}/stage-rules${q ? `?${q}` : ""}`, { headers: authHeaders() });
  if (!res.ok) {
    const e = await res.json().catch(() => ({} as Record<string, unknown>));
    throw new Error(typeof (e as { error?: unknown }).error === "string" ? (e as { error: string }).error : `HTTP ${res.status}`);
  }
  const body = (await res.json()) as { rules?: unknown; stageOrder?: unknown; source?: unknown };
  return {
    rules: coerceRules(body?.rules),
    stageOrder: coerceOrder(body?.stageOrder),
    ...(body?.source === "record" || body?.source === "tenant" ? { source: body.source } : {}),
  };
}

/* ── Per-RECORD stage rule overrides ─────────────────────────────────────────
   An admin can fork the company rules for ONE record from the record page's
   schedule card. The fork lives in its own settings doc server-side; the
   singleton above always mirrors the COMPANY doc. Record pages that need the
   effective doc fetch it with fetchStageRulesFor(undefined, recordId) and
   re-fetch when this event fires. */

/** Fired (same tab) after a record's override doc is saved or reset. */
export const RECORD_STAGE_RULES_EVENT = "rmone:recordStageRulesChanged";

export function notifyRecordStageRulesChanged(recordId: string): void {
  try {
    window.dispatchEvent(new CustomEvent(RECORD_STAGE_RULES_EVENT, { detail: { recordId } }));
  } catch { /* SSR/test — no window */ }
}

/** A single per-record stage-rules fork returned by the /record-forks list. */
export interface RecordFork {
  recordId: string;
  ruleCount: number;
  lastChangedAt: string;
  /** Settings-row label ("tenantLabel · TICKETID") — may be null for old rows. */
  label: string | null;
}

/** Fetch every record that has its own stage-rules override for this tenant.
 *  Admin-only (the server enforces this). Returns [] on success with no forks. */
export async function fetchRecordForks(tenantId?: string): Promise<RecordFork[]> {
  const qs = new URLSearchParams();
  if (tenantId) qs.set("tenantId", tenantId);
  const q = qs.toString();
  const res = await fetch(`${API}/stage-rules/record-forks${q ? `?${q}` : ""}`, { headers: authHeaders() });
  if (!res.ok) {
    const e = await res.json().catch(() => ({} as Record<string, unknown>));
    throw new Error(typeof (e as { error?: unknown }).error === "string" ? (e as { error: string }).error : `HTTP ${res.status}`);
  }
  const body = (await res.json()) as { forks?: unknown };
  if (!Array.isArray(body?.forks)) return [];
  return (body.forks as Record<string, unknown>[])
    .map(f => ({
      recordId: String(f.recordId ?? "").trim().toUpperCase(),
      ruleCount: Number(f.ruleCount ?? 0),
      lastChangedAt: String(f.lastChangedAt ?? ""),
      label: f.label ? String(f.label) : null,
    }))
    .filter(f => f.recordId);
}

/** Delete a record's override doc — company rules govern it again. Admin-only
 *  server-side. Throws on failure. */
export async function resetRecordStageRules(recordId: string, tenantId?: string): Promise<void> {
  const body: Record<string, unknown> = { rules: null, recordId };
  if (tenantId) body.tenantId = tenantId;
  const res = await fetch(`${API}/stage-rules`, {
    method: "PUT",
    headers: { ...authHeaders(), "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const e = await res.json().catch(() => ({} as Record<string, unknown>));
    throw new Error(typeof (e as { error?: unknown }).error === "string" ? (e as { error: string }).error : `HTTP ${res.status}`);
  }
  notifyRecordStageRulesChanged(recordId);
}

/* ── Workflow TEMPLATES (#131) ───────────────────────────────────────────────
   Reusable named stage-list templates in a standard format, stored per tenant
   in their own settings doc (GET/PUT /api/onboarding/workflow-templates).
   Settings-page-only — no singleton: record pages never read templates. */

export interface WorkflowTemplate {
  /** Stable id (slug) — the server mints one from the name when absent. */
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

// Light shape guard (the server sanitizes authoritatively on PUT).
function coerceTemplates(input: unknown): WorkflowTemplate[] {
  const o = (input && typeof input === "object" ? input : {}) as Record<string, unknown>;
  const out: WorkflowTemplate[] = [];
  if (!Array.isArray(o.templates)) return out;
  for (const t of o.templates) {
    if (!t || typeof t !== "object") continue;
    const tt = t as Record<string, unknown>;
    const id = typeof tt.id === "string" ? tt.id.trim() : "";
    const name = typeof tt.name === "string" ? tt.name.trim() : "";
    const stages = Array.isArray(tt.stages)
      ? tt.stages.filter((s): s is string => typeof s === "string" && s.trim() !== "").map(s => s.trim())
      : [];
    if (!id || !name || stages.length < 2) continue;
    const module = tt.module === "PMM" || tt.module === "OPM" || tt.module === "LEM" ? tt.module : undefined;
    const tpl: WorkflowTemplate = { id, name, stages };
    if (module) tpl.module = module;
    if (tt.stageColors && typeof tt.stageColors === "object") {
      const colors: Record<string, string> = {};
      for (const [k, v] of Object.entries(tt.stageColors as Record<string, unknown>)) {
        if (typeof v === "string" && /^#[0-9a-fA-F]{6}$/.test(v.trim()) && k.trim()) colors[k.trim().toLowerCase()] = v.trim();
      }
      if (Object.keys(colors).length) tpl.stageColors = colors;
    }
    const mode = tt.applyMode === "except" || tt.applyMode === "groups" ? tt.applyMode : undefined;
    const gids = Array.isArray(tt.groupIds) ? tt.groupIds.filter((g): g is string => typeof g === "string" && g.trim() !== "").map(g => g.trim()) : [];
    if (mode && gids.length > 0) { tpl.applyMode = mode; tpl.groupIds = gids; }
    out.push(tpl);
  }
  return out;
}

export async function fetchWorkflowTemplates(tenantId?: string): Promise<WorkflowTemplate[]> {
  const qs = tenantId ? `?tenantId=${encodeURIComponent(tenantId)}` : "";
  const res = await fetch(`${API}/workflow-templates${qs}`, { headers: authHeaders() });
  if (!res.ok) {
    const e = await res.json().catch(() => ({} as Record<string, unknown>));
    throw new Error(typeof (e as { error?: unknown }).error === "string" ? (e as { error: string }).error : `HTTP ${res.status}`);
  }
  return coerceTemplates(await res.json());
}

/** Persist the FULL template list (admin only). Returns the sanitized list. */
export async function saveWorkflowTemplates(templates: WorkflowTemplate[], tenantId?: string): Promise<WorkflowTemplate[]> {
  const body: Record<string, unknown> = { templates };
  if (tenantId) body.tenantId = tenantId;
  const res = await fetch(`${API}/workflow-templates`, {
    method: "PUT",
    headers: { ...authHeaders(), "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const e = await res.json().catch(() => ({} as Record<string, unknown>));
    throw new Error(typeof (e as { error?: unknown }).error === "string" ? (e as { error: string }).error : `HTTP ${res.status}`);
  }
  const bodyJson = (await res.json().catch(() => ({}))) as { tenant?: unknown };
  // Group-scoped templates ARE viewer workflows now (the server resolves them
  // into /stage-rules stageOrder and /field-options status lists), so a
  // template save must resync exactly like a stage-rules save: this tab's
  // singleton + option caches now, sibling tabs via the ping. Same own-tenant
  // gate as saveStageRules — a superadmin editing another company must not
  // clobber their own tenant's copy.
  const own = (getStoredUser()?.tenant ?? "").trim().toLowerCase();
  const echo = typeof bodyJson?.tenant === "string" ? bodyJson.tenant.trim().toLowerCase() : "";
  const isOwnTenant = !tenantId || (!!own && (tenantId.trim().toLowerCase() === own || echo === own));
  if (isOwnTenant) {
    bustCache("field-options:");
    loadedAt = 0;
    void loadStageRules({ force: true });
    pingSiblingTabs();
  }
  return coerceTemplates(bodyJson);
}

// ── Cross-tab sync ─────────────────────────────────────────────────────────
// Each browser tab holds its OWN singleton, so a rules save in the Settings
// tab must actively reach record pages already open in sibling tabs — without
// it, those tabs stay stale until a manual refresh. BroadcastChannel skips the
// posting tab and keeps everything out of localStorage (zero-browser-storage
// rule: no app data may persist in browser storage).
const RULES_SYNC_CHANNEL = "rmone:stage-rules-sync";

function pingSiblingTabs(): void {
  if (typeof BroadcastChannel === "undefined") return;
  try {
    const ch = new BroadcastChannel(RULES_SYNC_CHANNEL);
    ch.postMessage({ tenant: (getStoredUser()?.tenant ?? "").trim().toLowerCase() });
    ch.close();
  } catch { /* blocked/unsupported — the visibility refetch below still covers it */ }
}

// Different sign-in (or tenant switch) → these rules no longer apply.
if (typeof window !== "undefined") {
  window.addEventListener("rmone:authChanged", () => {
    loadSeq++;
    inFlight = null;
    loadedAt = 0;
    if (current !== EMPTY_STATE) { current = EMPTY_STATE; bump(); }
    void loadStageRules();
  });
  const resyncFromPing = (e: MessageEvent) => {
    const own = (getStoredUser()?.tenant ?? "").trim().toLowerCase();
    const from = typeof e.data?.tenant === "string" ? e.data.tenant : "";
    if (!own || (from && from !== own)) return;
    // Status dropdowns embed the workflow stages server-side — drop the
    // cached lists so version-keyed option effects refetch them fresh.
    bustCache("field-options:");
    loadedAt = 0;
    void loadStageRules({ force: true });
  };
  if (typeof BroadcastChannel !== "undefined") {
    try {
      const ch = new BroadcastChannel(RULES_SYNC_CHANNEL);
      ch.onmessage = resyncFromPing;
      // Group MEMBERSHIP changes also change which group-scoped workflow a
      // viewer resolves to — piggyback on the permissions sync ping so record
      // pages in sibling tabs pick up the new workflow without a refresh.
      const permCh = new BroadcastChannel("rmone:permissions-sync");
      permCh.onmessage = resyncFromPing;
    } catch { /* unsupported */ }
  }
  // Same-tab counterpart of the permissions ping (BroadcastChannel skips the
  // posting tab): notifyPermissionsChanged dispatches this window event.
  window.addEventListener("rmone:permissionsChanged", () => {
    bustCache("field-options:");
    loadedAt = 0;
    void loadStageRules({ force: true });
  });
  // Belt-and-braces: coming back to a backgrounded tab refetches when the
  // local copy is older than STALE_MS (loadStageRules throttles internally),
  // so even without BroadcastChannel a stale tab self-heals on focus.
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible") void loadStageRules();
  });
}
