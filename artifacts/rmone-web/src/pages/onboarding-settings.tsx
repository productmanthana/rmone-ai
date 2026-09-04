import { useEffect, useState, useCallback, useRef, useMemo, Suspense } from "react";
import { createPortal } from "react-dom";
import { useLocation, Link } from "wouter";
import {
  ArrowLeft, Save, Loader2, Settings2, Building2, Globe, RotateCcw, ChevronDown, ChevronUp, GripVertical, X, Plus,
  Search as SearchIcon, ClipboardList, CalendarDays,
  Users, TrendingUp, CalendarClock, DollarSign, Network, Monitor,
  Activity, CheckCircle2, ChevronRight, Layers, AlertTriangle, Check,
} from "lucide-react";
import type { StageRuleModule } from "@/lib/stageRules";
import DisplayDefaultsSettings from "@/components/DisplayDefaultsSettings";
import { ScheduleStageRulesHost, type ScheduleRuleTarget } from "@/components/StageRulesSettings";
import AccessLevelsSettings from "@/components/AccessLevelsSettings";
import NavigationSettings from "@/components/NavigationSettings";
import UserGroupsSettings from "@/components/UserGroupsSettings";
import StaffingTemplatesSettings from "@/components/StaffingTemplatesSettings";
import InviteMembersDialog from "@/components/InviteMembersDialog";
import { PanelsTopLeft as NavigationIcon } from "lucide-react";
import { Users2 as UserGroupsIcon, ShieldCheck as AccessLevelsIcon } from "lucide-react";

import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import {
  Select, SelectContent, SelectGroup, SelectItem, SelectLabel, SelectSeparator, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import { loadBusinessRules } from "@/lib/businessRules";
import { MODE_HAS_SCHEDULE } from "@/lib/projectViewMode";
import { authHeaders, bustCache, reapplyDefaultHours, getOnboardingSettings, onboardingSettingsCacheKey, peekCached, getStoredUser, getUserList, getLifecycles, deleteLifecycle, notifyLifecyclesChanged } from "@/lib/api";
import { personAudienceOptions } from "@/lib/audienceIds";
import { useAuth } from "@/lib/useAuth";
import { isSuperAdmin } from "@/lib/roleResolver";
import { lazyWithReload } from "@/lib/lazyReload";
import { warmSettingsSeeds } from "@/lib/settingsSeed";
import { ModuleHeader } from "@/components/layout/ModuleHeader";
import { warmInviteRoster } from "@/lib/inviteRoster";
import { PhaseListEditor, PhaseSetsSaveBar, ScopePicker, type PhaseScopeMode } from "@/components/PhaseListEditor";
import { fetchUserGroups, getMyCapabilitiesChecked, groupColorMap, usePermissionsVersion, type UserGroup } from "@/lib/permissions";
import { fetchOrgAudienceGroups } from "@/lib/orgAudience";
import MultiPick from "@/components/MultiPick";
import { GroupMembersHover, useGroupMemberNames } from "@/components/GroupMembersHover";
import { parseDisplayRules, parsePastEditRules, parseDurationRules, type DisplayModeValue } from "@/lib/audienceRules";

const ManageOrganizationPage = lazyWithReload(() => import("./manage-organization"));
const OfficesPage = lazyWithReload(() => import("./offices"));
const BillingRatesPage = lazyWithReload(() => import("./billing-rates"));

const API = "/api/onboarding";

// Mirror of the backend OnboardingDefaults shape.
interface OnboardingDefaults {
  unassignedLabel:         string;
  defaultJobTitle:         string;
  roleMirrorsTitle:        boolean;
  defaultProjectStatus:    string;
  defaultOpportunityStage: string;
  defaultOpportunityStages: string;
  defaultProjectType:      string;
  defaultPhases:           string;
  /** JSON string — Array<{id,name,phases,groupIds}>; team-scoped phase sets. */
  projectPhaseSets:        string;
  oppStageSets:            string;
  durationMonths:          number;
  oppDurationMonths:       number;
  durationMonthsBack:      number;
  startRule:               "monday-of-week" | "month-back";
  forecastHorizonDays:     number;
  emailDomainMode:         "from-company" | "fixed";
  emailFixedDomain:        string;
  // Governance / data quality
  dataSourcePriority:      string;
  fallbackDenominatorEnabled: boolean;
  useHistoricalProxyActuals: boolean;
  // Actuals vs Forecast: where "actual hours" come from.
  useImportedActuals:         boolean;
  usePlannedAsActualFallback: boolean;
  // Security defaults
  apiAccessEnabled:               boolean;
  restrictFinancialEditsToAdmin:  boolean;
// Organization structure grouping
  orgGrouping: "department" | "division";
  /** Show/hide the Business Unit tier on create/edit forms. */
  showBusinessUnit: boolean;
  /** Show/hide the Division tier on create/edit forms; bridge divisions keep the FK chain intact when hidden. */
  showDivision:    boolean;
  /** Show/hide the Department tier on create/edit forms. */
  showDepartment:  boolean;
  enableDefaultRate:       boolean;
  defaultRate:             number | null;
  projectDisplayMode: "full" | "no-schedule" | "no-schedule-no-hours" | "no-schedule-no-grid" | "schedule-no-grid";
  /** Server-managed: "" = never touched, "auto" = set by the import pipeline, "manual" = admin-saved. */
  projectDisplayModeSource?: "" | "auto" | "manual";
  oppDisplayModeSource?: "" | "auto" | "manual";
  /** Opportunity-side display mode — same options, configured separately. */
  oppDisplayMode: "full" | "no-schedule" | "no-schedule-no-hours" | "no-schedule-no-grid" | "schedule-no-grid";
  /** Legacy shared audience (fallback); per-setting keys below take precedence. */
  projSchedApplyMode:      "everyone" | "except" | "groups";
  projSchedGroupIds:       string;
  oppSchedApplyMode:       "everyone" | "except" | "groups";
  oppSchedGroupIds:        string;
  /** Per-setting audience keys — each setting can now target a different audience. */
  projDurationApplyMode:   "everyone" | "except" | "groups";
  projDurationGroupIds:    string;
  projDisplayApplyMode:    "everyone" | "except" | "groups";
  projDisplayGroupIds:     string;
  projPastEditApplyMode:   "everyone" | "except" | "groups";
  projPastEditGroupIds:    string;
  oppDisplayApplyMode:     "everyone" | "except" | "groups";
  oppDisplayGroupIds:      string;
  oppPastEditApplyMode:    "everyone" | "except" | "groups";
  oppPastEditGroupIds:     string;
  /** Per-audience EXCEPTION rules (ordered JSON lists — see lib/audienceRules.ts).
   *  Non-empty → the legacy ApplyMode/GroupIds pair for that setting is ignored. */
  projDisplayRules:        string;
  oppDisplayRules:         string;
  projPastEditRules:       string;
  oppPastEditRules:        string;
  projDurationRules:       string;
  /** Legacy shared audience for the calendar block (fallback). */
  workCalendarApplyMode:   "everyone" | "except" | "groups";
  workCalendarGroupIds:    string;
  /** Per-setting audience keys for the calendar section. */
  nonWorkingDaysApplyMode: "everyone" | "except" | "groups";
  nonWorkingDaysGroupIds:  string;
  workWeekHoursApplyMode:  "everyone" | "except" | "groups";
  workWeekHoursGroupIds:   string;
  holidaysApplyMode:       "everyone" | "except" | "groups";
  holidaysGroupIds:        string;
  // Business rules & live-analytics thresholds
  workWeekHours:           number;
  targetUtilizationPct:    number;
  overCapacityPct:         number;
  underAllocatedPct:       number;
  concentrationPct:        number;
  forecastWeeks:           number;
  demandUrgencyDays:       number;
  proposalCoveragePct:     number;
  // Hours grid behaviour
  allowPastDateEdit:       boolean;
  pastEditLimitWeeks:      number | null;
  oppAllowPastDateEdit:    boolean;
  oppPastEditLimitWeeks:   number | null;
  nonWorkingDays:          number[];
  holidayDates:            string[];
  // Employment-type name colors ("" = no color, "#rrggbb" otherwise)
  empColorPartTime:        string;
  empColorAsNeeded:        string;
  empColorScaContingency:  string;
  empColorTemporary:       string;
  empColorFullTime:        string;
}

interface SettingsResponse {
  scope: string;
  tenantLabel?: string;
  builtin: OnboardingDefaults;
  global: Partial<OnboardingDefaults>;
  client?: Partial<OnboardingDefaults>;
  effective: OnboardingDefaults;
}

type HistoryItem = { tenantId: string };

// Each card saves ONLY its own fields — clicking Save on one card must not
// persist half-typed edits sitting on another card (and must not spin every
// Save button). Keys grouped per card, mirroring the JSX below.
type SectionKey = "projects" | "staff" | "forecast";
const SECTION_FIELDS: Record<SectionKey, (keyof OnboardingDefaults)[]> = {
  projects: [
    "defaultOpportunityStage", "defaultOpportunityStages",
    "defaultPhases", "projectPhaseSets", "oppStageSets", "durationMonths", "oppDurationMonths", "startRule", "forecastHorizonDays",
    // Schedule display & past-editing — per module + per setting, each with its own audience.
    "projectDisplayMode", "allowPastDateEdit", "pastEditLimitWeeks",
    "projSchedApplyMode", "projSchedGroupIds",   // legacy fallback
    "projDurationApplyMode", "projDurationGroupIds",
    "projDisplayApplyMode", "projDisplayGroupIds",
    "projPastEditApplyMode", "projPastEditGroupIds",
    "oppDisplayMode", "oppAllowPastDateEdit", "oppPastEditLimitWeeks",
    "oppSchedApplyMode", "oppSchedGroupIds",     // legacy fallback
    "oppDisplayApplyMode", "oppDisplayGroupIds",
    "oppPastEditApplyMode", "oppPastEditGroupIds",
    // Per-audience exception rules (new model — replaces the pairs above once set)
    "projDisplayRules", "oppDisplayRules",
    "projPastEditRules", "oppPastEditRules",
    "projDurationRules",
  ],
  staff: [
    "overCapacityPct", "targetUtilizationPct", "underAllocatedPct",
    "concentrationPct", "demandUrgencyDays",
    "empColorPartTime", "empColorAsNeeded", "empColorScaContingency",
    "empColorTemporary", "empColorFullTime",
    // Working week & holiday calendar (moved here from the old Schedule card).
    "nonWorkingDays", "workWeekHours", "holidayDates",
    "workCalendarApplyMode", "workCalendarGroupIds",   // legacy fallback
    "nonWorkingDaysApplyMode", "nonWorkingDaysGroupIds",
    "workWeekHoursApplyMode", "workWeekHoursGroupIds",
    "holidaysApplyMode", "holidaysGroupIds",
  ],
  forecast: ["forecastWeeks", "proposalCoveragePct", "useImportedActuals", "usePlannedAsActualFallback"],
};

// The two "fields" sub-tabs auto-save (#user request): any add/remove/change
// persists on its own instead of via the Save button. Keys per tab — an
// auto-save writes ONLY its tab's keys onto the saved baseline, so half-typed
// edits on the stages/phases tabs are never committed by accident.
const AUTO_SAVE_TABS: Record<string, readonly (keyof OnboardingDefaults)[]> = {
  // Schedule / stage lists (#user): adding, renaming, reordering or removing a
  // stage — and editing a named set's audience — now persists on its own, the
  // same way the fields tabs do. These saves reconcile the tenant's LIVE stage
  // list and lifecycle templates, so they run on a longer debounce (below) and
  // skip the slow assumed-date backfill (their keys aren't in AUTO_APPLY_KEYS).
  "proj-defaults": [
    "defaultPhases", "projectPhaseSets",
    "projectDisplayMode", "projDisplayRules", "projDisplayApplyMode", "projDisplayGroupIds",
    "allowPastDateEdit", "pastEditLimitWeeks", "projPastEditRules", "projPastEditApplyMode", "projPastEditGroupIds",
    "durationMonths", "projDurationRules", "projDurationApplyMode", "projDurationGroupIds",
    "forecastHorizonDays",
  ],
  "opp-defaults": [
    "defaultOpportunityStages", "oppStageSets",
    "oppDisplayMode", "oppDisplayRules", "oppDisplayApplyMode", "oppDisplayGroupIds",
    "oppAllowPastDateEdit", "oppPastEditLimitWeeks", "oppPastEditRules", "oppPastEditApplyMode", "oppPastEditGroupIds",
    "oppDurationMonths",
  ],
};
/** Auto tabs whose save drives a live core2 reconcile — longer settle time,
 *  plus the extra cache busts the manual save does. */
const STAGE_AUTO_SAVE_TABS = new Set(["proj-defaults", "opp-defaults"]);
// Date-driving keys: only these trigger the slow assumed-dates backfill
// (apply-defaults) after an auto-save — display/past-edit saves stay a single
// fast PUT (the server already gates its own reconciles the same way).
const AUTO_APPLY_KEYS = new Set<string>([
  "durationMonths", "projDurationRules", "projDurationApplyMode", "projDurationGroupIds",
  "oppDurationMonths", "startRule", "forecastHorizonDays",
]);
/** Stable JSON of just `keys` of a settings doc — dirty/clean comparisons. */
const sliceJson = (doc: unknown, keys: readonly string[]) => {
  const d = (doc ?? {}) as Record<string, unknown>;
  return JSON.stringify(keys.map(k => [k, d[k] ?? null]));
};

// Defined at module scope (NOT inside the page component) so its identity is
// stable across renders. When it lived inside the component, every keystroke
// re-created the component type, which remounted the <Input> and dropped focus
// after each character.
function Field({
  keyName, label, hint, overriddenKeys, children, actions,
}: {
  keyName: keyof OnboardingDefaults;
  label: string;
  hint?: React.ReactNode;
  overriddenKeys: Set<string>;
  children: React.ReactNode;
  actions?: React.ReactNode;
}) {
  return (
    <div style={{
      borderRadius: 12, border: "1px solid hsl(var(--border))",
      background: "hsl(var(--card))",
      boxShadow: "0 1px 3px rgba(0,0,0,.06), 0 6px 16px -8px rgba(0,0,0,.12)",
      overflow: "hidden",
    }}>
      {/* Card header — title + optional badge + optional actions */}
      <div style={{
        display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap",
        padding: "14px 20px 12px",
        borderBottom: "1px solid hsl(var(--border)/55%)",
      }}>
        <Label style={{ fontSize: 14, fontWeight: 600, color: "hsl(var(--foreground))", margin: 0 }}>{label}</Label>
        {overriddenKeys.has(keyName as string) && (
          <span style={{
            padding: "2px 8px", borderRadius: 999, fontSize: 10, fontWeight: 700,
            letterSpacing: ".06em", textTransform: "uppercase" as const,
            background: "hsl(var(--primary)/10%)", color: "hsl(var(--primary))",
            border: "1px solid hsl(var(--primary)/22%)", whiteSpace: "nowrap" as const,
          }}>Customized</span>
        )}
        {actions && <div style={{ display: "flex", alignItems: "center", gap: 8, marginLeft: "auto" }}>{actions}</div>}
      </div>
      {/* Card body */}
      <div style={{ padding: "16px 20px" }}>
        {children}
        {hint && <div style={{ fontSize: 12, color: "hsl(var(--muted-foreground))", margin: "10px 0 0", lineHeight: 1.55 }}>{hint}</div>}
      </div>
    </div>
  );
}


// ── Settings-redesign layout definitions ─────────────────────────────────
// Categories drive the left sidebar. Clicking a category shows ONLY that
// category's sections in the main pane (no single long scrolling page).
// hint: Structural change (rename/retype). Check callers of this entity.
type CatId = "hub" | SectionKey | "org" | "billing" | "display" | "accesslevels" | "navigation" | "templates";
const CATS: { id: SectionKey; label: string; color: string; icon: typeof ClipboardList }[] = [
  { id: "projects", label: "Projects & Opportunities", color: "#6ab04c", icon: ClipboardList },
  { id: "staff",    label: "Staff & Resources",        color: "#f59e0b", icon: Users },
  { id: "forecast", label: "Forecast",                 color: "#8b5cf6", icon: TrendingUp },
];

// Sub-sections (accordions) within each category. `terms` feeds the sidebar
// search — include the visible field labels so searching finds them.
const SUBS: { id: string; cat: SectionKey; title: string; desc: string; terms: string[] }[] = [
  { id: "proj-defaults", cat: "projects", title: "Projects",      desc: "Schedule phases, display mode, editing rules and assumed length for projects",
    terms: ["project defaults", "default lifecycle phases", "phases", "without schedule", "hours",
            "project display mode", "visible sections", "allow editing past weeks", "past edit limit",
            "weeks back", "lock", "retroactive", "assumed project length", "months", "forecast window days", "horizon"] },
  { id: "opp-defaults",  cat: "projects", title: "Opportunities", desc: "Pipeline stages, display mode, editing rules and assumed length for opportunities",
    terms: ["opportunity defaults", "default opportunity stage", "opportunity stage set", "pipeline stages",
            "opportunity display mode", "past date editing", "opportunity duration", "months"] },
  { id: "staff-manage", cat: "staff", title: "Manage Staff", desc: "Add, edit, invite, deactivate or delete team members",
    terms: ["manage staff", "add staff", "invite", "invites", "set password link", "deactivate", "reactivate", "delete member", "bulk upload", "access level", "team members"] },
  { id: "staff-access", cat: "staff", title: "Access Levels", desc: "Custom permission sets controlling what each user can do",
    terms: ["access levels", "permission sets", "financial access", "member assignment", "custom access", "permissions"] },
  { id: "staff-groups", cat: "staff", title: "User Groups", desc: "Membership groups used by stage permissions",
    terms: ["user groups", "group membership", "stage permissions", "groups"] },
  { id: "staff-calendar", cat: "staff", title: "Working Week & Holiday Calendar", desc: "Non-working days, full-week hours and company holidays",
    terms: ["non-working days", "hours in a full week", "hours per week", "weekend", "apply to existing allocations",
            "holiday calendar", "holidays", "public holiday", "company holiday", "non-working dates", "day off", "working week"] },
  { id: "staff-templates", cat: "staff", title: "Staffing Templates", desc: "Saved role mixes you can apply to new project teams",
    terms: ["staffing templates", "saved templates", "role mixes", "apply to projects", "team template"] },
  { id: "staff-util", cat: "staff", title: "Utilization & Demand Risk", desc: "The % bands that flag allocation levels, plus the risk and urgency thresholds",
    terms: ["over-capacity flag", "optimal band start", "under-allocated flag", "utilization", "target",
            "concentration risk threshold", "demand urgency window", "urgent", "unfilled role"] },
  { id: "staff-colors", cat: "staff", title: "Employment Type Colors", desc: "Color-code staff names by employment type across the app",
    terms: ["employment type colors", "part-time", "as needed", "sca contingency", "temporary", "full-time", "name color", "color coding"] },
  { id: "forecast-main", cat: "forecast", title: "Forecast Settings", desc: "Lookahead window, pipeline health targets and actuals source",
    terms: ["forecast window weeks", "pipeline coverage target", "capacity", "healthy pipeline",
            "actuals", "imported actuals", "planned as actuals", "substitution", "actuals vs forecast"] },
];

// ── All-Settings hub: RM ONE brand palette + card catalog ────────────────
// The hub replaces the old left sidebar: every settings area is a card in a
// grid (mockup-style), colored with the RM ONE brand palette — navy + green
// from the logo, lime + orange from the brand ring.
type HubColor = "navy" | "green" | "lime" | "orange";
const RM_BRAND: Record<HubColor, { hex: string; label: string; bodyVar: string }> = {
  // hex     = used for colored header bands + alpha tints (always on light/white backdrop)
  // bodyVar = CSS var that adapts in dark mode so card-body text stays readable
  //           (see index.css .dark block — navy in particular would be invisible
  //            at #33404C on a #2E4557 dark card surface)
  navy:   { hex: "#33404C", label: "RMONE Navy",   bodyVar: "var(--rm-brand-navy,   #33404C)" },
  green:  { hex: "#79A93C", label: "RMONE Green",  bodyVar: "var(--rm-brand-green,  #79A93C)" },
  lime:   { hex: "#A2B32F", label: "RMONE Lime",   bodyVar: "var(--rm-brand-lime,   #A2B32F)" },
  orange: { hex: "#E8921C", label: "RMONE Orange", bodyVar: "var(--rm-brand-orange, #E8921C)" },
};

// One card per settings area. `bullets` are the quick-jump rows on the card;
// a bullet with `sub` deep-opens that accordion inside the category.
const SETTINGS_CARDS: {
  id: Exclude<CatId, "hub">; title: string; desc: string; color: HubColor;
  icon: typeof ClipboardList;
  bullets: { label: string; sub?: string }[];
}[] = [
  { id: "org", title: "Organization", color: "navy", icon: Network,
    desc: "Company structure — business units, divisions, departments, roles and job titles",
    bullets: [{ label: "Business Units" }, { label: "Divisions & Departments" }, { label: "Roles & Job Titles" }] },
  { id: "staff", title: "Staff & Resources", color: "green", icon: Users,
    desc: "Manage staff, access levels, user groups, working week, utilization bands and staffing templates",
    bullets: [
      { label: "Manage Staff", sub: "staff-manage" },
      { label: "Access Levels", sub: "staff-access" },
      { label: "User Groups", sub: "staff-groups" },
      { label: "Working Week & Holiday Calendar", sub: "staff-calendar" },
      { label: "Staffing Templates", sub: "staff-templates" },
      { label: "Utilization & Demand Risk", sub: "staff-util" },
      { label: "Employment Type Colors", sub: "staff-colors" },
    ] },
  { id: "projects", title: "Projects & Opportunities schedule", color: "navy", icon: ClipboardList,
    desc: "Defaults, schedule display and editing rules for projects and the pipeline",
    bullets: [{ label: "Projects", sub: "proj-defaults" }, { label: "Opportunities", sub: "opp-defaults" }] },
  { id: "billing", title: "Billing Rates", color: "orange", icon: DollarSign,
    desc: "Billing rates, cost rates, and department overrides",
    bullets: [{ label: "Billing Rates" }, { label: "Cost Rates" }, { label: "Department Overrides" }] },
  { id: "display", title: "Display Defaults", color: "lime", icon: Monitor,
    desc: "Default fields, grid columns, and view modes for everyone",
    bullets: [{ label: "Default Fields" }, { label: "Grid Columns" }, { label: "View Mode" }] },
  { id: "forecast", title: "Forecast", color: "green", icon: TrendingUp,
    desc: "Lookahead window and pipeline health targets",
    bullets: [{ label: "Forecast Window", sub: "forecast-main" }, { label: "Pipeline Coverage Target", sub: "forecast-main" }, { label: "Actuals Source", sub: "forecast-main" }] },
  { id: "navigation", title: "Navigation", color: "lime", icon: NavigationIcon,
    desc: "Show, hide, rename and reorder the menu for each group",
    bullets: [{ label: "Show / Hide Items" }, { label: "Rename Items" }, { label: "Reorder Menu" }] },
];

// Staff & Resources tabs that manage their OWN saves (or need no save at
// all) — the category-level Save button is hidden for these so it can't
// mislead (it only persists the staff defaults fields).
const DELEGATED_STAFF_SUBS = new Set(["staff-groups", "staff-manage", "staff-access", "staff-templates"]);

// Which OnboardingDefaults keys signal that the Organization card has been
// customized (its own fields aren't part of SECTION_FIELDS).
const ORG_OVERRIDE_KEYS: (keyof OnboardingDefaults)[] = [
  "orgGrouping", "showBusinessUnit", "showDivision", "showDepartment",
  "unassignedLabel", "defaultJobTitle", "roleMirrorsTitle",
];

// Module scope for the same reason as Field: a stable component identity so
// the inputs inside don't remount (and drop focus) on every parent render.
function AccordionSection({
  title, desc, color, open, onToggle, children, footer,
}: {
  title: string; desc: string; color: string; open: boolean;
  onToggle: () => void; children: React.ReactNode; footer?: React.ReactNode;
}) {
  return (
    <div style={{
      border: `1px solid ${open ? `${color}40` : "hsl(var(--border))"}`,
      borderRadius: 12, overflow: "hidden", transition: "border-color 0.2s",
      background: "hsl(var(--card))",
    }}>
      <button
        type="button"
        onClick={onToggle}
        style={{
          width: "100%", display: "flex", alignItems: "center", justifyContent: "space-between",
          gap: 12, padding: "14px 20px", background: open ? `${color}08` : "transparent",
          border: "none", cursor: "pointer", textAlign: "left",
          borderBottom: open ? `1px solid ${color}20` : "none",
          transition: "background 0.2s",
        }}
      >
        <div style={{ minWidth: 0 }}>
          <div style={{ fontSize: 14, fontWeight: 600, color: open ? color : "hsl(var(--foreground))" }}>{title}</div>
          <div style={{ fontSize: 12, color: "hsl(var(--muted-foreground))", marginTop: 2 }}>{desc}</div>
        </div>
        <div style={{
          width: 24, height: 24, borderRadius: 6, display: "flex", alignItems: "center", justifyContent: "center",
          background: open ? `${color}15` : "hsl(var(--muted))", color: open ? color : "hsl(var(--muted-foreground))",
          flexShrink: 0, transition: "all 0.2s", transform: open ? "rotate(180deg)" : "rotate(0deg)",
        }}>
          <ChevronDown style={{ width: 14, height: 14 }} />
        </div>
      </button>
      {open && (
        <div style={{ padding: "20px 20px 24px", display: "flex", flexDirection: "column", gap: 20 }}>
          {children}
          {footer}
        </div>
      )}
    </div>
  );
}

// hint: Logic changed on both sides. Requires understanding intent of each change.
// ── Per-audience exception rules editor ─────────────────────────────────────
// One card per setting: a base "EVERYONE" row plus ordered exception rows,
// each targeting one or more audiences (user groups and/or BU/Division/
// Department org units) with its OWN value. The first matching row (top to
// bottom) wins for a given user; users matching no row get the Everyone value.
type RuleRowOf<V> = { ids: string[]; value: V };

/** Number input that lets the user clear/retype freely: keeps a local draft
 *  string while typing and only commits values that parse within [min,max].
 *  Snaps back to the last valid value on blur. Module-scope so React never
 *  remounts it mid-keystroke (see Field above for the same lesson). */
function ClampedNumInput({ value, min, max, onCommit, width = 80 }: {
  value: number;
  min: number;
  max: number;
  onCommit: (n: number) => void;
  width?: number;
}) {
  const [draft, setDraft] = useState<string | null>(null);
  return (
    <Input
      type="number" min={min} max={max}
      value={draft ?? String(value)}
      onChange={e => {
        const raw = e.target.value;
        setDraft(raw);
        const n = parseInt(raw, 10);
        if (!isNaN(n) && n >= min && n <= max) onCommit(n);
      }}
      onBlur={() => setDraft(null)}
      style={{ width }}
    />
  );
}

function AudienceRulesCard<V>({ title, badge, hint, baseValue, rows, onCommit, renderValue, newRowValue, groups, groupsReady, groupColors, people, onSave, saving, hideAddNew }: {
  title: string;
  badge?: React.ReactNode;
  hint?: React.ReactNode;
  baseValue: V;
  rows: RuleRowOf<V>[];
  onCommit: (base: V, rows: RuleRowOf<V>[]) => void;
  renderValue: (v: V, setV: (v: V) => void) => React.ReactNode;
  newRowValue: V;
  groups: UserGroup[];
  groupsReady: boolean;
  groupColors: Map<string, string>;
  /** Tenant roster — rows can target specific PEOPLE ("user:<id>" sentinels)
   *  alongside groups and org units. null = people unavailable here. */
  people: { value: string; label: string }[] | null;
  onSave?: () => void;
  saving?: boolean;
  /** When true the "+ New" exception row is hidden — the setting applies to
   *  everyone and cannot be audience-scoped. */
  hideAddNew?: boolean;
}) {
  // One flat audience list per row: groups, org units, and individual people.
  const opts = [
    ...groups.map(g => ({ value: g.id, label: g.name, color: groupColors.get(g.id) })),
    ...personAudienceOptions(people),
  ];
  // Drag-and-drop reorder state (same HTML5 pattern as PhaseListEditor).
  // Only the grip column is draggable so the pickers/inputs in each row keep
  // their normal mouse behavior; the whole row is a drop target.
  const [dragIdx, setDragIdx] = useState<number | null>(null);
  const [overIdx, setOverIdx] = useState<number | null>(null);
  const moveRow = (from: number, to: number) => {
    if (from === to) return;
    const next = [...rows];
    const [row] = next.splice(from, 1);
    next.splice(to, 0, row);
    onCommit(baseValue, next);
  };
  const memberNamesOf = useGroupMemberNames(true);
  const hoverWrap = (value: string, node: React.ReactNode): React.ReactNode => {
    const g = groups.find(x => x.id === value);
    if (!g) return node;
    return (
      <GroupMembersHover groupName={g.name} memberIds={g.memberIds} names={memberNamesOf(g.memberIds)}>
        {node}
      </GroupMembersHover>
    );
  };

  // Column widths: grip=34, audience=230, control=flex, actions=28
  const gripW = 34;
  const badgeW = 230;

  const everyoneBadge = (
    <span style={{
      display: "inline-flex", alignItems: "center", padding: "3px 10px",
      borderRadius: 999, fontSize: 10.5, fontWeight: 800, letterSpacing: 0.8,
      textTransform: "uppercase", whiteSpace: "nowrap", flexShrink: 0,
      width: badgeW, justifyContent: "center",
      background: "hsl(var(--muted))", color: "hsl(var(--muted-foreground))",
      border: "1px solid hsl(var(--border))",
    }}>Everyone</span>
  );
  const moveBtn = (dir: "up" | "down", disabled: boolean, onClick: () => void) => (
    <button type="button" title={dir === "up" ? "Move up" : "Move down"} disabled={disabled}
      onClick={onClick}
      style={{
        width: 24, height: 20, display: "flex", alignItems: "center", justifyContent: "center",
        borderRadius: 4, border: "1px solid hsl(var(--border))",
        background: "hsl(var(--background))", padding: 0, lineHeight: 1,
        color: disabled ? "hsl(var(--border))" : "hsl(var(--muted-foreground))",
        cursor: disabled ? "default" : "pointer",
      }}>
      {dir === "up" ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
    </button>
  );

  return (
    <div style={{
      borderRadius: 12, border: "1px solid hsl(var(--border))",
      background: "hsl(var(--card))",
      boxShadow: "0 1px 3px rgba(0,0,0,.06), 0 6px 16px -8px rgba(0,0,0,.12)",
      overflow: "hidden",
    }}>
      {/* Header */}
      <div style={{
        padding: "14px 20px 12px",
        borderBottom: "1px solid hsl(var(--border)/55%)",
      }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <span style={{ fontSize: 14, fontWeight: 600, color: "hsl(var(--foreground))" }}>{title}</span>
          {badge}
        </div>
        {hint && <p style={{ fontSize: 12, color: "hsl(var(--muted-foreground))", margin: "4px 0 0", lineHeight: 1.5 }}>{hint}</p>}
      </div>
      <div style={{ padding: "14px 18px", display: "flex", flexDirection: "column", gap: 10 }}>

      {/* Rows container — strict 4-column grid so EVERYONE and every exception
           row stay perfectly pixel-aligned at every viewport width.
           Columns: [grip/spacer] [badge/picker] [value] [delete/spacer] */}
      <div style={{
        borderRadius: 8, border: "1px solid hsl(var(--border))",
        background: "hsl(var(--muted) / 0.18)",
      }}>
        {/* EVERYONE row */}
        <div style={{
          display: "grid",
          gridTemplateColumns: `${gripW}px ${badgeW}px 1fr 28px`,
          alignItems: "center",
          columnGap: 10,
          padding: "10px 12px",
          borderBottom: rows.length > 0 ? "1px solid hsl(var(--border))" : "none",
        }}>
          {/* col 1 — spacer (no grip on the base row) */}
          <div />
          {/* col 2 — Everyone badge */}
          {everyoneBadge}
          {/* col 3 — value control */}
          <div style={{ minWidth: 0 }}>
            {renderValue(baseValue, v => onCommit(v, rows))}
          </div>
          {/* col 4 — spacer balancing the delete button on exception rows */}
          <div />
        </div>

        {/* Exception rows */}
        {rows.map((r, i) => (
          <div key={i}
            onDragOver={e => { if (dragIdx !== null) { e.preventDefault(); setOverIdx(i); } }}
            onDrop={() => { if (dragIdx !== null) moveRow(dragIdx, i); setDragIdx(null); setOverIdx(null); }}
            style={{
              display: "grid",
              gridTemplateColumns: `${gripW}px ${badgeW}px 1fr 28px`,
              alignItems: "center",
              columnGap: 10,
              padding: "10px 12px",
              borderBottom: i < rows.length - 1 ? "1px solid hsl(var(--border))" : "none",
              background: overIdx === i && dragIdx !== null && dragIdx !== i
                ? "hsl(var(--primary) / 0.08)" : "hsl(var(--background))",
              opacity: dragIdx === i ? 0.5 : 1,
            }}>
            {/* col 1 — drag grip + up/down buttons */}
            <div
              draggable
              onDragStart={() => setDragIdx(i)}
              onDragEnd={() => { setDragIdx(null); setOverIdx(null); }}
              title="Drag to reorder"
              style={{
                display: "flex", flexDirection: "column",
                alignItems: "center", gap: 2, cursor: "grab",
              }}>
              <GripVertical size={13} style={{ color: "hsl(var(--muted-foreground))" }} />
              {moveBtn("up", i === 0, () => moveRow(i, i - 1))}
              {moveBtn("down", i === rows.length - 1, () => moveRow(i, i + 1))}
            </div>

            {/* col 2 — audience picker (same width as Everyone badge) */}
            <div style={{ minWidth: 0 }}>
              <MultiPick
                options={opts}
                selected={r.ids}
                onChange={ids => onCommit(baseValue, rows.map((x, j) => j === i ? { ...x, ids } : x))}
                placeholder={groupsReady ? "Pick audience…" : "Loading…"}
                hoverWrap={hoverWrap}
                popupSide="right"
              />
            </div>

            {/* col 3 — value control */}
            <div style={{ minWidth: 0 }}>
              {renderValue(r.value, v => onCommit(baseValue, rows.map((x, j) => j === i ? { ...x, value: v } : x)))}
            </div>

            {/* col 4 — delete */}
            <button type="button" title="Remove exception"
              onClick={() => onCommit(baseValue, rows.filter((_, j) => j !== i))}
              style={{
                width: 28, height: 28, display: "flex", alignItems: "center",
                justifyContent: "center", borderRadius: 6, border: "none",
                background: "transparent", cursor: "pointer",
                color: "hsl(var(--muted-foreground))",
              }}>
              <X size={15} />
            </button>
          </div>
        ))}

        {/* Add exception — hidden when the setting is company-wide only */}
        {!hideAddNew && (
        <div style={{ padding: "8px 12px", paddingLeft: gripW + 10 + 12 }}>
          <button type="button"
            onClick={() => onCommit(baseValue, [...rows, { ids: [], value: newRowValue }])}
            style={{
              display: "inline-flex", alignItems: "center", gap: 6,
              padding: "5px 12px", borderRadius: 8,
              border: "1.5px dashed hsl(var(--border))", background: "transparent",
              fontSize: 12.5, fontWeight: 600, color: "hsl(var(--muted-foreground))",
              cursor: "pointer",
            }}>
            <Plus size={13} /> New
          </button>
        </div>
        )}
      </div>

      {rows.length > 1 && (
        <p style={{ fontSize: 11.5, color: "hsl(var(--muted-foreground))", margin: 0, lineHeight: 1.5 }}>
          Top row wins when someone matches multiple exceptions.
        </p>
      )}
      </div>
    </div>
  );
}

// ── Display-mode layout preview popup ────────────────────────────────────

const DM_LABEL: Record<string, string> = {
  "full":                "Full View",
  "no-schedule":         "Hours Grid Only",
  "schedule-no-grid":    "Schedule + Table",
  "no-schedule-no-grid": "Table Only",
  "no-schedule-no-hours":"Summary Only",
};
const DM_SUB: Record<string, string> = {
  "full":                "Schedule phases + weekly hours grid",
  "no-schedule":         "Weekly grid only — no phase bars",
  "schedule-no-grid":    "Phase bars + date/hours table, no weekly grid",
  "no-schedule-no-grid": "Date/hours table only — no phase bars, no weekly grid",
  "no-schedule-no-hours":"Names & roles only — no hours data",
};
const DM_GROUPS: { label: string; items: string[] }[] = [
  { label: "With weekly hours grid",    items: ["full", "no-schedule"] },
  { label: "Without weekly hours grid", items: ["schedule-no-grid", "no-schedule-no-grid", "no-schedule-no-hours"] },
];

function LayoutPreview({ mode }: { mode: string }) {
  const hasPhases   = !["no-schedule","no-schedule-no-grid","no-schedule-no-hours"].includes(mode);
  const hasWeekly   = ["full","no-schedule"].includes(mode);
  const hasDateTbl  = ["schedule-no-grid","no-schedule-no-grid"].includes(mode);
  const namesOnly   = mode === "no-schedule-no-hours";
  const PHASES = [
    { color: "#6EAA3E", label: "Preconstruction" },
    { color: "#1F6FB2", label: "Construction" },
    { color: "#F2921F", label: "Closeout" },
  ];
  const MEMBERS = ["Alex J.","Jordan P.","Sam R."];
  const WEEK_HOURS = [[40,32,0,16],[0,24,40,8],[24,24,16,24]];
  // Date table preview rows: Start, End, Hrs
  const DATE_ROWS = [
    { start:"Jan 15", end:"Mar 20", hrs:"320h" },
    { start:"Feb 01", end:"Apr 10", hrs:"280h" },
    { start:"Mar 01", end:"May 15", hrs:"200h" },
  ];

  return (
    <div style={{ width: 186, display: "flex", flexDirection: "column", gap: 5 }}>
      {/* Phase bar */}
      {hasPhases && (
        <div style={{ background:"#fff", borderRadius:6, border:"1px solid #DBE1E7", padding:"5px 7px", display:"flex", gap:4 }}>
          {PHASES.map(p => (
            <div key={p.color} style={{ flex:1, display:"flex", flexDirection:"column", alignItems:"center", gap:2 }}>
              <div style={{ width:"100%", height:8, borderRadius:4, background:p.color }}/>
              <span style={{ fontSize:6.5, color:"#4E606F", whiteSpace:"nowrap", overflow:"hidden", textOverflow:"ellipsis", maxWidth:"100%" }}>{p.label}</span>
            </div>
          ))}
        </div>
      )}

      {/* Weekly grid */}
      {hasWeekly && (
        <div style={{ background:"#fff", borderRadius:6, border:"1px solid #DBE1E7", overflow:"hidden", fontSize:7 }}>
          <div style={{ display:"flex", background:"#F4F6F9", borderBottom:"1px solid #DBE1E7" }}>
            <div style={{ width:48, padding:"3px 5px", fontWeight:700, color:"#71828F" }}>Member</div>
            {["W1","W2","W3","W4"].map(w => (
              <div key={w} style={{ flex:1, padding:"3px 2px", textAlign:"center", fontWeight:700, color:"#71828F" }}>{w}</div>
            ))}
          </div>
          {MEMBERS.map((name, ri) => (
            <div key={name} style={{ display:"flex", alignItems:"center", borderBottom:"1px solid #F4F6F9" }}>
              <div style={{ width:48, padding:"2px 5px", color:"#1E3042", fontWeight:600, overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap" }}>{name}</div>
              {WEEK_HOURS[ri].map((h, ci) => (
                <div key={ci} style={{ flex:1, textAlign:"center", padding:"2px", color: h === 0 ? "#B2BEC9" : "#1E3042" }}>
                  {h === 0 ? "—" : h}
                </div>
              ))}
            </div>
          ))}
        </div>
      )}

      {/* Date/hours table — flat table rows, no timeline bars */}
      {hasDateTbl && (
        <div style={{ background:"#fff", borderRadius:6, border:"1px solid #DBE1E7", overflow:"hidden", fontSize:7 }}>
          {/* Column header */}
          <div style={{ display:"flex", background:"#F4F6F9", borderBottom:"1px solid #DBE1E7" }}>
            <div style={{ flex:"0 0 46px", padding:"3px 5px", fontWeight:700, color:"#71828F" }}>Member</div>
            <div style={{ flex:1, padding:"3px 3px", fontWeight:700, color:"#71828F" }}>Start</div>
            <div style={{ flex:1, padding:"3px 3px", fontWeight:700, color:"#71828F" }}>End</div>
            <div style={{ flex:"0 0 26px", padding:"3px 2px", textAlign:"right", fontWeight:700, color:"#71828F" }}>Hrs</div>
          </div>
          {MEMBERS.map((name, ri) => (
            <div key={name} style={{ display:"flex", alignItems:"center", borderBottom:"1px solid #F4F6F9" }}>
              <div style={{ flex:"0 0 46px", padding:"2px 5px", color:"#1E3042", fontWeight:600, overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap" }}>{name}</div>
              <div style={{ flex:1, padding:"2px 3px", color:"#4E606F" }}>{DATE_ROWS[ri].start}</div>
              <div style={{ flex:1, padding:"2px 3px", color:"#4E606F" }}>{DATE_ROWS[ri].end}</div>
              <div style={{ flex:"0 0 26px", padding:"2px 2px", textAlign:"right", color:"#1E3042", fontWeight:500 }}>{DATE_ROWS[ri].hrs}</div>
            </div>
          ))}
        </div>
      )}

      {/* Summary only */}
      {namesOnly && (
        <div style={{ background:"#fff", borderRadius:6, border:"1px solid #DBE1E7", overflow:"hidden", fontSize:7 }}>
          {["Alex J. · Senior PM","Jordan P. · Designer","Sam R. · Engineer"].map(entry => (
            <div key={entry} style={{ display:"flex", alignItems:"center", borderBottom:"1px solid #F4F6F9", padding:"4px 6px", gap:5 }}>
              <div style={{ width:12, height:12, borderRadius:"50%", background:"#C6DFA6", flexShrink:0 }}/>
              <div style={{ color:"#1E3042" }}>{entry}</div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

/** Colored schedule-presence badge — green: this layout shows the phase
 *  schedule (member dates are bounded by it); amber: no schedule shown.
 *  Same visual language as the per-project Team Layout picker. */
function dmScheduleChip(mode: string) {
  const withSched = (MODE_HAS_SCHEDULE as Record<string, boolean | undefined>)[mode];
  if (withSched === undefined) return null;
  return (
    <span style={{
      flexShrink: 0, padding: "2px 7px", borderRadius: 999,
      fontSize: 9, fontWeight: 800, letterSpacing: 0.4, textTransform: "uppercase" as const,
      backgroundColor: withSched ? "rgba(107,165,57,0.14)" : "rgba(245,158,11,0.13)",
      border: `1px solid ${withSched ? "rgba(107,165,57,0.55)" : "rgba(245,158,11,0.55)"}`,
      // Semantic ink tokens flip with data-theme, matching the popover surface.
      color: withSched ? "var(--rm-green-ink, #4C7B22)" : "var(--rm-ink-orange, #B45309)",
    }}>
      {withSched ? "Schedule" : "No schedule"}
    </span>
  );
}

function DisplayModeSelector({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  const [open, setOpen] = useState(false);
  const [hovered, setHovered] = useState<string | null>(null);
  const preview = hovered ?? value;
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button type="button" style={{
          display:"flex", alignItems:"center", justifyContent:"space-between",
          width:"100%", height:36, padding:"0 10px 0 12px",
          background:"hsl(var(--background))", border:"1px solid hsl(var(--input))",
          borderRadius:8, fontSize:13.5, color:"hsl(var(--foreground))",
          cursor:"pointer", textAlign:"left",
        }}>
          <span style={{ display:"flex", alignItems:"center", gap:7, minWidth:0 }}>
            {dmScheduleChip(value)}
            <span style={{ overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap" }}>
              {DM_LABEL[value] ?? value} — {DM_SUB[value] ?? ""}
            </span>
          </span>
          <ChevronDown size={15} style={{ flexShrink:0, marginLeft:8, color:"hsl(var(--muted-foreground))" }}/>
        </button>
      </PopoverTrigger>
      <PopoverContent align="start" sideOffset={4} className="p-0" style={{ width:490 }}>
        <div style={{ display:"flex" }}>
          {/* Option list */}
          <div style={{ flex:1, padding:"6px 0" }}>
            {DM_GROUPS.map((group, gi) => (
              <div key={gi}>
                {gi > 0 && <div style={{ height:1, background:"hsl(var(--border))", margin:"4px 0" }}/>}
                <div style={{ padding:"4px 12px 3px", fontSize:10.5, fontWeight:700, letterSpacing:".07em", textTransform:"uppercase" as const, color:"hsl(var(--muted-foreground))" }}>
                  {group.label}
                </div>
                {group.items.map(mode => (
                  <button key={mode} type="button"
                    onClick={() => { onChange(mode); setOpen(false); }}
                    onMouseEnter={() => setHovered(mode)}
                    onMouseLeave={() => setHovered(null)}
                    style={{
                      display:"flex", alignItems:"center", gap:8,
                      width:"100%", textAlign:"left", padding:"7px 12px",
                      background: hovered === mode
                        ? "hsl(var(--accent))"
                        : value === mode
                          ? "hsl(var(--accent)/0.4)"
                          : "transparent",
                      border:"none", cursor:"pointer",
                    }}>
                    <div style={{ flex:1, minWidth:0 }}>
                      <div style={{ display:"flex", alignItems:"center", gap:7, minWidth:0, flexWrap:"wrap" }}>
                        <span style={{ fontSize:13, fontWeight: value === mode ? 600 : 400, color:"hsl(var(--foreground))" }}>
                          {DM_LABEL[mode]}
                        </span>
                        {dmScheduleChip(mode)}
                      </div>
                      <div style={{ fontSize:11, color:"hsl(var(--muted-foreground))", marginTop:1 }}>
                        {DM_SUB[mode]}
                      </div>
                    </div>
                    {value === mode && <Check size={13} style={{ color:"#6EAA3E", flexShrink:0 }}/>}
                  </button>
                ))}
              </div>
            ))}
          </div>
          {/* Live preview panel */}
          <div style={{
            width:210, borderLeft:"1px solid hsl(var(--border))", padding:"10px",
            background:"#F4F6F9", display:"flex", flexDirection:"column", gap:6,
          }}>
            <div style={{ fontSize:10, fontWeight:700, letterSpacing:".07em", textTransform:"uppercase" as const, color:"#71828F" }}>
              Preview
            </div>
            <LayoutPreview mode={preview}/>
            <div style={{ fontSize:10.5, color:"#71828F", lineHeight:1.5, marginTop:2 }}>
              {DM_SUB[preview]}
            </div>
          </div>
        </div>
      </PopoverContent>
    </Popover>
  );
}

// hint: Logic changed on both sides. Requires understanding intent of each change.
export default function OnboardingSettingsPage({ embedded, initialCat }: { embedded?: boolean; initialCat?: string } = {}) {
  const [location, navigate] = useLocation();
  const { toast } = useToast();
  const { user } = useAuth();
  // Only the cross-company superadmin accounts may edit global defaults or pick
  // another company. A normal client only ever manages their OWN company's
  // defaults, so for them the whole scope selector is hidden and locked to their
  // tenant.
  const superadmin = isSuperAdmin(user?.username, user?.tenant);
  // Company settings are capability-gated, not merely hidden in the sidebar.
  // A Manager can type this URL directly, so ask the server before rendering
  // any settings cards and stay closed on a failed capability read.
  const permissionsVersion = usePermissionsVersion();
  const [canManageSettings, setCanManageSettings] = useState<boolean | null>(superadmin ? true : null);
  useEffect(() => {
    if (superadmin) { setCanManageSettings(true); return; }
    let alive = true;
    void getMyCapabilitiesChecked()
      .then((caps) => { if (alive) setCanManageSettings(caps?.canSettings === true); })
      .catch(() => { if (alive) setCanManageSettings(false); });
    return () => { alive = false; };
  }, [superadmin, user?.username, user?.tenant, permissionsVersion]);

  // "global" or a specific client name.
  const [scope, setScope]       = useState<"global" | "client">("global");
  const [clientName, setClientName] = useState("");

  // User groups for the "applies to" audience pickers (schedule display /
  // past editing / working-week calendar). Mirrors PhaseSetsSaveBar: at the
  // superadmin GLOBAL scope there is no tenant, so groups (and the pickers)
  // are unavailable.
  const scopeTenantId = superadmin ? (scope === "client" && clientName.trim() ? clientName.trim() : null) : undefined;
  const [scopeGroups, setScopeGroups] = useState<UserGroup[] | null>(null);
  useEffect(() => {
    if (scopeTenantId === null) { setScopeGroups(null); return; }
    let dead = false;
    Promise.all([
      fetchUserGroups(scopeTenantId ?? undefined),
      // Org units (BU/Division/Dept) as live audiences — [] on failure.
      fetchOrgAudienceGroups(scopeTenantId ?? undefined).catch(() => []),
    ])
      .then(([g, org]) => { if (!dead) setScopeGroups([...g, ...org]); })
      .catch(() => { /* pickers stay in loading state; audience still saves */ });
    return () => { dead = true; };
  }, [scopeTenantId]);
  const scopeGroupColors = useMemo(() => groupColorMap(scopeGroups ?? []), [scopeGroups]);
  // Tenant roster for "Only specific people" audiences — own-tenant only
  // (the user-list API answers for the signed-in tenant, so cross-tenant
  // superadmin edits scope by group/org unit). null = people unavailable;
  // the pickers then hide the people option.
  const [scopePeople, setScopePeople] = useState<{ value: string; label: string }[] | null>(null);
  useEffect(() => {
    if (superadmin) { setScopePeople(null); return; }
    let dead = false;
    getUserList()
      .then((raw) => {
        if (dead || !Array.isArray(raw)) return;
        const opts = (raw as Record<string, unknown>[])
          .map((u) => ({
            value: String(u.Id ?? u.id ?? ""),
            label: String(u.Name ?? u.name ?? u.UserName ?? u.username ?? ""),
          }))
          .filter((p) => p.value && p.label)
          .sort((a, b) => a.label.localeCompare(b.label));
        setScopePeople(opts);
      })
      .catch(() => { /* audience pickers fall back to groups-only */ });
    return () => { dead = true; };
  }, [superadmin]);
  const [clients, setClients]   = useState<string[]>([]);

  const [form, setForm]         = useState<OnboardingDefaults | null>(null);
  const [resp, setResp]         = useState<SettingsResponse | null>(null);
  const [loading, setLoading]   = useState(false);
  // Which card's Save (or the reset button) is in flight — drives that
  // button's spinner only; all save buttons are disabled while one runs.
  const [savingSection, setSavingSection] = useState<SectionKey | "reset" | null>(null);
  // Auto-save status for the fields tabs (idle → saving → saved/error).
  const [autoSave, setAutoSave] = useState<{ kind: "idle" | "saving" | "saved" | "error" }>({ kind: "idle" });
  const saving = savingSection !== null || autoSave.kind === "saving";
  const [reapplying, setReapplying] = useState(false);
  // Holiday-calendar add-row draft (kept out of `form` until Add is clicked).
  const [holidayDraftDate, setHolidayDraftDate] = useState("");
  const [holidayDraftLabel, setHolidayDraftLabel] = useState("");

  // Lifecycle templates from DB — shown in the schedule sidebar so admins can
  // see what came from imports and add any as a named saved schedule.
  const [projLifecycles, setProjLifecycles] = useState<Array<{ id: number; name: string; phases: string[] }>>([]);
  const [oppLifecycles, setOppLifecycles] = useState<Array<{ id: number; name: string; phases: string[] }>>([]);

  // Non-superadmins are locked to their own company's defaults.
  useEffect(() => {
    if (!superadmin && user?.tenant) {
      setScope("client");
      setClientName(user.tenant);
    }
  }, [superadmin, user?.tenant]);

  // Pre-warm the per-section settings docs (stage rules, display defaults,
  // access levels, user groups, staffing templates) so opening any card
  // paints instantly instead of spinning on its first fetch. Own-tenant
  // admins only — superadmin client scopes seed per-card on first open.
  useEffect(() => {
    if (!superadmin) {
      warmSettingsSeeds();
      // Manage Staff roster too — same instant-paint treatment (keyed by the
      // same tenant label the embedded card passes to the backend).
      const own = getStoredUser()?.tenant ?? "";
      if (own) warmInviteRoster(own);
    }
  }, [superadmin]);

  // Pull the list of onboarded clients so a superadmin can pick one to customize.
  // A normal client has no need for (and no access to) the cross-company list.
  useEffect(() => {
    if (!superadmin) return;
    (async () => {
      try {
        const res = await fetch(`${API}/history`, { headers: authHeaders() });
        if (!res.ok) return;
        const d = await res.json() as { jobs?: HistoryItem[] } | HistoryItem[];
        const jobs = Array.isArray(d) ? d : (d.jobs ?? []);
        const names = Array.from(new Set(jobs.map(j => j.tenantId).filter(Boolean)));
        setClients(names);
      } catch { /* ignore */ }
    })();
  }, [superadmin]);

  const load = useCallback(async (s: "global" | "client", name: string) => {
    const tenantArg = s === "client" ? name.trim() : undefined;
    // Instant paint: if this scope/client was fetched earlier this session,
    // show it immediately instead of blanking the form behind a spinner —
    // the background refresh below will silently replace it if it changed.
    const seeded = peekCached<SettingsResponse>(onboardingSettingsCacheKey(tenantArg));
    if (seeded) {
      setResp(seeded);
      setForm(seeded.effective);
    } else {
      setLoading(true);
    }
    try {
      const d = await getOnboardingSettings<SettingsResponse>(tenantArg);
      setResp(d);
      setForm(d.effective);
    } catch (e: any) {
      if (!seeded) toast({ title: "Could not load settings", description: e.message, variant: "destructive" });
    } finally {
      setLoading(false);
    }
  }, [toast]);

  // Load global on mount; reload when scope/client changes.
  useEffect(() => {
    // Non-superadmins never see the global layer.
    if (!superadmin && scope === "global") return;
    // Superadmin in client mode without a chosen client → clear until one is chosen.
    if (superadmin && scope === "client" && !clientName.trim()) { setForm(null); setResp(null); return; }
    // For non-superadmins, clientName may still be resolving from the auth object;
    // when blank the server derives the tenant from the JWT — still attempt load.
    load(scope, clientName);
  }, [scope, clientName, load, superadmin]);

  // Auto-detect the display mode once per Settings page load if the admin has
  // never manually configured it (source === "" or absent). The server checks
  // whether the tenant has any schedule phase rows and picks "full" (has
  // schedule) or "schedule-no-grid" (no schedule), stamps source="auto", and
  // saves. We then reload the form so the dropdown reflects the detected value.
  // Tracks the last effective tenant ID for which auto-detection has already
  // run this session. Keyed by tenant (not a boolean) so that switching from
  // global scope (no tenant) to a specific client scope triggers a fresh check
  // for that client, even though the ref was set for the previous scope.
  const autoDetectRanRef = useRef<string | null>(null);
  // The effective tenant to detect against: for superadmins it is the selected
  // client name (null while in global scope or no client chosen); for regular
  // admins it is always their own tenant (represented by an empty string so the
  // server derives it from the JWT — matches the original behaviour).
  const effectiveTenantId = superadmin
    ? (scope === "client" && clientName.trim() ? clientName.trim() : null)
    : null; // non-superadmin: no body param needed; server uses JWT tenant
  useEffect(() => {
    if (!form) return;
    const source = (form as any).projectDisplayModeSource as string | undefined;
    if (source === "manual" || source === "auto") return; // already set — skip
    // Superadmins in global scope have no tenant — nothing to detect.
    if (superadmin && effectiveTenantId === null) return;
    // Guard is keyed by tenant so switching clients triggers a new detection.
    const runKey = effectiveTenantId ?? "__self__";
    if (autoDetectRanRef.current === runKey) return;
    autoDetectRanRef.current = runKey;
    let dead = false;
    (async () => {
      try {
        const res = await fetch(`${API}/settings/auto-detect-display`, {
          method: "POST",
          headers: { ...authHeaders(), "Content-Type": "application/json" },
          body: JSON.stringify({ tenantId: effectiveTenantId }),
        });
        if (!res.ok || dead) return;
        const result = await res.json().catch(() => null) as { detected?: string; saved?: boolean } | null;
        if (!result?.saved || dead) return;
        // Reload to pick up the server-saved value (and the "auto" source marker).
        load(scope, clientName);
      } catch { /* silent — the admin can still pick manually */ }
    })();
    return () => { dead = true; };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [form?.projectDisplayModeSource, !form, effectiveTenantId]);

  // Which display-mode dropdowns the admin ACTUALLY touched this session. The
  // save body always echoes the full effective baseline, so the server needs
  // this list to tell a deliberate layout choice (which permanently locks out
  // the import-time auto-select) from an unrelated card save that merely
  // carried the field along unchanged.
  const touchedDisplayKeys = useRef<Set<string>>(new Set());
  const set = <K extends keyof OnboardingDefaults>(key: K, value: OnboardingDefaults[K]) => {
    if (key === "projectDisplayMode" || key === "oppDisplayMode") touchedDisplayKeys.current.add(key);
    setForm(prev => (prev ? { ...prev, [key]: value } : prev));
  };

  /** Sets-only save used by "Save As…" / Manage dialogs: persists JUST the given
   *  fields on top of the last-loaded baseline. The card's other unsaved edits
   *  are neither committed nor lost — plain Save stays the only way to commit
   *  them (mirrors how workflow stage sets behave in Stage Rules). */
  const saveFields = useCallback(async (fields: Partial<OnboardingDefaults>) => {
    if (!form) return;
    try {
      const baseline = resp?.effective ?? form;
      const settings: OnboardingDefaults = { ...baseline, ...fields };
       const body: any = { settings, settingsSection: "projects" };
      if (touchedDisplayKeys.current.size) body.touchedDisplayKeys = Array.from(touchedDisplayKeys.current);
      if (scope === "client" && clientName.trim()) body.tenantId = clientName.trim();
      const res = await fetch(`${API}/settings`, {
        method: "PUT",
        headers: { ...authHeaders(), "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        const e = await res.json().catch(() => ({}));
        throw new Error(e.error ?? `HTTP ${res.status}`);
      }
      bustCache("field-options:");
      bustCache(onboardingSettingsCacheKey(scope === "client" ? clientName.trim() : undefined));
      bustCache(onboardingSettingsCacheKey(undefined));
      // This sets-only save is exactly what the "Save As…" / Manage dialogs
      // use for named phase/stage sets — the server syncs those into lifecycle
      // templates, so the record page's "Pick a lifecycle template" picker
      // must drop its cached list (and refresh live if it's mounted).
      notifyLifecyclesChanged();
      // No reload here — a reload would reset the form and wipe the card's
      // unsaved edits. The form already carries the new sets value, and the
      // next full Save overlays the section's fields anyway.
      toast({ title: "Saved", description: "The named set was stored. Other edits on this card still need Save." });
    } catch (e: any) {
      toast({
        title: "Could not save the named set",
        description: e.message ?? "Something went wrong — please try again.",
        variant: "destructive",
      });
    }
  }, [form, resp, scope, clientName, toast]);

  const save = useCallback(async (section: SectionKey, overrides?: Partial<OnboardingDefaults>) => {
    if (!form) return;
    setSavingSection(section);
    try {
      // Persist ONLY the clicked card's fields: start from the last-loaded
      // saved state and overlay just this section's edits, so unsaved changes
      // on other cards are neither saved nor lost.
      const baseline = resp?.effective ?? form;
      const settings: OnboardingDefaults = { ...baseline };
      for (const k of SECTION_FIELDS[section]) (settings as any)[k] = form[k];
      // Same-tick overrides (e.g. "Save As" just appended a phase set): React
      // state hasn't flushed into `form` yet, so the caller passes the fresh
      // values directly.
      if (overrides) Object.assign(settings as any, overrides);
      // The working-week calendar's per-group audience UI was removed — these
      // settings always apply to everyone now. Normalize any previously-saved
      // scoping on the next save so no invisible audience keeps filtering them.
      if (section === "staff") {
        for (const [modeKey, idsKey] of [
          ["nonWorkingDaysApplyMode", "nonWorkingDaysGroupIds"],
          ["workWeekHoursApplyMode", "workWeekHoursGroupIds"],
          ["holidaysApplyMode", "holidaysGroupIds"],
          ["workCalendarApplyMode", "workCalendarGroupIds"], // legacy pair
        ] as const) {
          (settings as any)[modeKey] = "everyone";
          (settings as any)[idsKey] = "";
        }
      }
       const body: any = { settings, settingsSection: section };
      if (touchedDisplayKeys.current.size) body.touchedDisplayKeys = Array.from(touchedDisplayKeys.current);
      if (scope === "client" && clientName.trim()) body.tenantId = clientName.trim();
      const res = await fetch(`${API}/settings`, {
        method: "PUT",
        headers: { ...authHeaders(), "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        const e = await res.json().catch(() => ({}));
        throw new Error(e.error ?? `HTTP ${res.status}`);
      }
      const saved = await res.json().catch(() => ({} as any));
      if (section === "projects") {
        // Saving the opportunity stage set reconciles this tenant's live stage
        // list, so drop the cached field-option lookups (e.g. the OPM stage
        // dropdown) so they re-fetch the new set instead of serving the old one.
        // The cache key prefix is "field-options:" (see getFieldOptions in api.ts).
        bustCache("field-options:");
        // Saving "Default lifecycle phases" or the named phase/stage sets
        // reconciles this tenant's live lifecycle templates — drop the cached
        // list AND poke any mounted record page so its template picker
        // refreshes immediately instead of serving the stale list.
        notifyLifecyclesChanged();
      }
      // The settings response itself is cached (see getOnboardingSettings) —
      // drop both the just-saved scope's entry AND the global one (a global
      // save changes what every client without an override inherits).
      bustCache(onboardingSettingsCacheKey(scope === "client" ? clientName.trim() : undefined));
      bustCache(onboardingSettingsCacheKey(undefined));

      // For a specific client, saving the primary-defaults card also backfills
      // the just-saved defaults onto existing records (fills blanks only — never
      // overwrites real values; each change is logged in the assumptions
      // review). The other cards are thresholds/behaviour toggles with nothing
      // to backfill, so they skip this slow step. Global scope has no single
      // company to apply to, so it only stores the defaults.
      let applyNote = "";
      let applyWarned = false;
      if (section === "projects" && scope === "client" && clientName.trim()) {
        try {
          const ar = await fetch(`${API}/apply-defaults`, {
            method: "POST",
            headers: { ...authHeaders(), "Content-Type": "application/json" },
            body: JSON.stringify({ tenantId: clientName.trim() }),
          });
          const data = await ar.json().catch(() => ({}));
          if (!ar.ok) throw new Error(data.error ?? `HTTP ${ar.status}`);
          const fields = (data.fields ?? []) as any[];
          applyWarned = fields.some((f) => f.status === "applied_audit_failed");
          const applied = fields.filter((f) => f.applied > 0);
          applyNote = applied.length
            ? " " + applied.map((f) => f.note).join(" ")
            : " Nothing needed filling — no blank fields were found on existing records.";
        } catch (ae: any) {
          applyWarned = true;
          applyNote = ` Defaults saved, but applying to existing records failed: ${ae.message}`;
        }
      }

      // Surface the live opportunity-stage reconcile result (or its failure).
      if (saved?.stageSyncError) {
        applyWarned = true;
        applyNote += ` Note: the opportunity stage dropdown couldn't be updated to match (${saved.stageSyncError}).`;
      } else if (saved?.stageSync && (saved.stageSync.added || saved.stageSync.removed || saved.stageSync.recordsCleared)) {
        applyNote += ` Opportunity stages updated (${saved.stageSync.added} added, ${saved.stageSync.removed} removed).`;
        if (saved.stageSync.recordsCleared) {
          applyNote += ` Cleared the removed stage from ${saved.stageSync.recordsCleared} existing opportunit${saved.stageSync.recordsCleared === 1 ? "y" : "ies"}.`;
        }
      }

      // Surface the live lifecycle-phase reconcile result (or its failure).
      if (saved?.phaseSyncError) {
        applyWarned = true;
        applyNote += ` Note: the "Standard" lifecycle template couldn't be updated to match (${saved.phaseSyncError}).`;
      } else if (saved?.phaseSync?.updated) {
        applyNote += ` Updated the "Standard" lifecycle template to ${saved.phaseSync.phases.length} phase${saved.phaseSync.phases.length === 1 ? "" : "s"}.`;
      }

      // Surface the opportunity default-schedule sync: existing opportunities
      // moved from the previous default to the new one (updated), plus
      // opportunities that had NO schedule at all seeded with the default
      // (adopted). Bust the cached per-record task data so their Schedule tabs
      // show it without waiting for the session cache TTL.
      if (saved?.oppScheduleSyncError) {
        applyWarned = true;
        applyNote += ` Note: existing opportunity schedules couldn't all be updated (${saved.oppScheduleSyncError}).`;
      } else if (saved?.oppScheduleSync?.updated) {
        applyNote += ` Updated the schedule on existing opportunities to the new stage list.`;
      }
      if (saved?.oppScheduleAdoptError) {
        applyWarned = true;
        applyNote += ` Note: ${saved.oppScheduleAdoptError}.`;
      } else if (saved?.oppScheduleAdopt?.adopted) {
        const n = saved.oppScheduleAdopt.adopted;
        applyNote += ` Applied the default schedule to ${n} opportunit${n === 1 ? "y" : "ies"} that had none.`;
      }
      if (saved?.oppScheduleSync?.updated || saved?.oppScheduleAdopt?.adopted) {
        bustCache("project:tasks:");
      }

      // Surface the live schedule-date reconcile result (or its failure). The
      // start-rule / assumed-length / forecast-window settings now re-derive the
      // assumed Start & Completion dates on existing records, so their schedule
      // bars move when these settings change.
      if (saved?.dateSyncError) {
        applyWarned = true;
        applyNote += ` Note: existing schedule dates couldn't be updated to match (${saved.dateSyncError}).`;
      } else if (saved?.dateSync?.recordsUpdated) {
        applyNote += ` Re-derived the assumed start/finish dates on ${saved.dateSync.recordsUpdated} existing record${saved.dateSync.recordsUpdated === 1 ? "" : "s"}.`;
        // The project pages cache record detail/lists per session; drop them so
        // the new dates show without waiting for the cache TTL.
        bustCache();
      }

      toast({
        title: scope === "global"
          ? "Settings saved"
          : applyWarned ? "Saved (with a warning)" : section === "projects" ? "Saved & applied" : "Saved",
        description: scope === "global"
          ? "Global defaults updated. New clients start from these."
          : `Settings for "${clientName.trim()}" updated.${applyNote}`,
        variant: applyWarned ? "destructive" : undefined,
      });
      // Reload so "inherited vs overridden" reflects what was actually stored.
      // AWAIT it: save() builds its body from the last-loaded saved state, so
      // the buttons must stay disabled until the reload lands or a rapid
      // second save could overlay a stale baseline and undo this one.
      await load(scope, clientName);
      // Business rules feed the live dashboards (utilization bands, forecast
      // window, AI severity). The live layer reads the SIGNED-IN company's
      // effective rules, so refresh the in-session singleton after any save:
      // a global save changes the fallback, a company save changes that
      // company's live thresholds — either may apply to the current session.
      void loadBusinessRules();
    } catch (e: any) {
      toast({ title: "Could not save", description: e.message, variant: "destructive" });
    } finally {
      setSavingSection(null);
    }
  }, [form, resp, scope, clientName, toast, load]);

  // ── Auto-save: "Project fields" / "Opp fields" tabs (#user request) ──────
  // Edits there persist on their own — no Save button. Timers and resolving
  // saves read live refs (debounce-timers-stale-closure): a fired timer must
  // save the LATEST doc, never the closure that scheduled it.
  const formRef = useRef<OnboardingDefaults | null>(null);
  formRef.current = form;
  const respRef = useRef<SettingsResponse | null>(null);
  respRef.current = resp;
  const savingSectionRef = useRef<SectionKey | "reset" | null>(null);
  savingSectionRef.current = savingSection;
  const reapplyingRef = useRef(false);
  reapplyingRef.current = reapplying;
  // Scope token: a fired timer / resolving save no-ops if the superadmin
  // switched company (or scope) after it was scheduled.
  const scopeTokRef = useRef("");
  scopeTokRef.current = `${scope}\u0000${clientName.trim()}`;
  const autoBusyRef = useRef(false);
  const autoPendingRef = useRef(false);
  const autoTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Last slice we successfully PUT, per tab — treated as clean so a server-side
  // sanitizer normalizing our payload can't put the watcher in a save loop.
  const lastSavedSliceRef = useRef<Record<string, string>>({});
  const autoSaveFnRef = useRef<(tabIds: string[], scopeTok: string) => Promise<void>>(async () => {});

  const runAutoSave = async (tabIds: string[], scopeTok: string) => {
    if (scopeTok !== scopeTokRef.current) return; // scope switched — drop
    if (savingSectionRef.current !== null || reapplyingRef.current) {
      // A manual save/reset is in flight — retry shortly rather than racing it.
      if (autoTimerRef.current) clearTimeout(autoTimerRef.current);
      autoTimerRef.current = setTimeout(() => { void autoSaveFnRef.current(tabIds, scopeTok); }, 600);
      return;
    }
    if (autoBusyRef.current) { autoPendingRef.current = true; return; }
    const f = formRef.current;
    if (!f) return;
    const baseline = (respRef.current?.effective ?? f) as OnboardingDefaults;
    const dirty = tabIds.filter(t => {
      const ks = AUTO_SAVE_TABS[t];
      if (!ks) return false;
      const cur = sliceJson(f, ks);
      return cur !== sliceJson(baseline, ks) && cur !== lastSavedSliceRef.current[t];
    });
    if (dirty.length === 0) return;
    const keys = dirty.flatMap(t => AUTO_SAVE_TABS[t]);
    autoBusyRef.current = true;
    setAutoSave({ kind: "saving" });
    const [tokScope, tokClient] = scopeTok.split("\u0000");
    try {
      // Only THIS tab's keys overlaid on the saved baseline — same body shape
      // as the manual per-section save, narrower field set.
      const settings: OnboardingDefaults = { ...baseline };
      for (const k of keys) (settings as any)[k] = (f as any)[k];
       const body: any = { settings, auto: true, settingsSection: "projects" };
      if (touchedDisplayKeys.current.size) body.touchedDisplayKeys = Array.from(touchedDisplayKeys.current);
      if (tokScope === "client" && tokClient) body.tenantId = tokClient;
      const res = await fetch(`${API}/settings`, {
        method: "PUT",
        headers: { ...authHeaders(), "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        const e = await res.json().catch(() => ({}));
        throw new Error(e.error ?? `HTTP ${res.status}`);
      }
      const saved = await res.json().catch(() => ({} as any));
      bustCache(onboardingSettingsCacheKey(tokScope === "client" ? tokClient : undefined));
      bustCache(onboardingSettingsCacheKey(undefined));
      // A stage/phase-list save rewrites the live stage dropdown and the
      // lifecycle templates — drop the same caches the manual Save drops, or
      // the record pages keep serving the previous list until their TTL.
      if (dirty.some(t => STAGE_AUTO_SAVE_TABS.has(t))) {
        bustCache("field-options:");
        notifyLifecyclesChanged();
      }
      // Backfill assumed dates only when a date-driving setting changed —
      // display-mode / past-edit saves stay a single fast PUT.
      let applyWarned = false;
      let applyNote = "";
      const durChanged = keys.some(k =>
        AUTO_APPLY_KEYS.has(k as string) &&
        JSON.stringify((f as any)[k] ?? null) !== JSON.stringify((baseline as any)[k] ?? null));
      if (durChanged && tokScope === "client" && tokClient) {
        try {
          const ar = await fetch(`${API}/apply-defaults`, {
            method: "POST",
            headers: { ...authHeaders(), "Content-Type": "application/json" },
            body: JSON.stringify({ tenantId: tokClient }),
          });
          const data = await ar.json().catch(() => ({}));
          if (!ar.ok) throw new Error(data.error ?? `HTTP ${ar.status}`);
          const fieldsArr = (data.fields ?? []) as any[];
          applyWarned = fieldsArr.some((x) => x.status === "applied_audit_failed");
          const applied = fieldsArr.filter((x) => x.applied > 0);
          if (applied.length) applyNote = applied.map((x) => x.note).join(" ");
        } catch (ae: any) {
          applyWarned = true;
          applyNote = `Saved, but applying to existing records failed: ${ae.message}`;
        }
      }
      // Stage-list reconciles are silent when they go through cleanly, but a
      // failure — or a change that touched existing records — must be visible.
      for (const [err, note] of [
        [saved?.stageSyncError, "the stage dropdown couldn't be updated to match"],
        [saved?.phaseSyncError, "the \"Standard\" lifecycle template couldn't be updated to match"],
        [saved?.oppScheduleSyncError, "existing opportunity schedules couldn't all be updated"],
        [saved?.oppScheduleAdoptError, "some opportunities couldn't be given the default schedule"],
      ] as [string | undefined, string][]) {
        if (err) { applyWarned = true; applyNote += ` Saved, but ${note} (${err}).`; }
      }
      if (saved?.stageSync?.recordsCleared) {
        const n = saved.stageSync.recordsCleared;
        applyNote += ` Cleared the removed stage from ${n} existing opportunit${n === 1 ? "y" : "ies"}.`;
      }
      if (saved?.oppScheduleAdopt?.adopted) {
        const n = saved.oppScheduleAdopt.adopted;
        applyNote += ` Applied the default schedule to ${n} opportunit${n === 1 ? "y" : "ies"} that had none.`;
      }
      if (saved?.oppScheduleSync?.updated || saved?.oppScheduleAdopt?.adopted) bustCache("project:tasks:");
      if (saved?.dateSyncError) {
        applyWarned = true;
        applyNote += ` Existing schedule dates couldn't be updated to match (${saved.dateSyncError}).`;
      } else if (saved?.dateSync?.recordsUpdated) {
        applyNote += ` Re-derived the assumed start/finish dates on ${saved.dateSync.recordsUpdated} existing record${saved.dateSync.recordsUpdated === 1 ? "" : "s"}.`;
        bustCache();
      }
      if (scopeTok === scopeTokRef.current) {
        // ALL post-await bookkeeping is scope-guarded: an in-flight save from a
        // previous tenant must not stamp clean markers (or state) into the new
        // scope — the switch effect just cleared them.
        for (const t of dirty) lastSavedSliceRef.current[t] = sliceJson(f, AUTO_SAVE_TABS[t]);
        // Advance the local baseline instead of reloading — a reload would wipe
        // edits made while this save was in flight; they stay dirty and the
        // watcher saves them next (settings-per-section-save application guard).
        // Prefer the server's returned docs (keeps "customized" badges honest);
        // fall back to an optimistic merge of what we sent.
        setResp(prev => {
          if (!prev) return prev;
          let eff: any;
          if (saved?.effective) {
            eff = saved.effective;
          } else {
            eff = { ...(prev.effective as any) };
            for (const k of keys) eff[k] = (f as any)[k];
          }
          const next: SettingsResponse = { ...prev, effective: eff };
          if (saved?.client) next.client = saved.client;
          if (saved?.global) next.global = saved.global;
          return next;
        });
        setAutoSave({ kind: "saved" });
        // Silent on routine saves — only surface real backfill work or warnings.
        if (applyWarned || applyNote.trim()) {
          toast({
            title: applyWarned ? "Saved (with a warning)" : "Saved & applied",
            description: applyNote.trim(),
            variant: applyWarned ? "destructive" : undefined,
          });
        }
      }
      void loadBusinessRules();
    } catch (e: any) {
      if (scopeTok === scopeTokRef.current) {
        setAutoSave({ kind: "error" });
        toast({ title: "Could not save", description: e.message, variant: "destructive" });
      }
    } finally {
      autoBusyRef.current = false;
      if (autoPendingRef.current) {
        autoPendingRef.current = false;
        void autoSaveFnRef.current(Object.keys(AUTO_SAVE_TABS), scopeTokRef.current);
      }
    }
  };
  autoSaveFnRef.current = runAutoSave;

  // Watcher: whenever an auto-tab's keys drift from the saved baseline,
  // debounce a save. Runs regardless of which tab is on screen, so edits
  // aren't stranded by a quick tab switch.
  useEffect(() => {
    if (!form || !resp || loading) return;
    const baseline = resp.effective ?? form;
    const dirtyTabs = Object.keys(AUTO_SAVE_TABS).filter(t => {
      const ks = AUTO_SAVE_TABS[t];
      const cur = sliceJson(form, ks);
      return cur !== sliceJson(baseline, ks) && cur !== lastSavedSliceRef.current[t];
    });
    if (dirtyTabs.length === 0) return;
    const tok = scopeTokRef.current;
    if (autoTimerRef.current) clearTimeout(autoTimerRef.current);
    // Stage-list edits usually come in bursts (rename, then reorder, then add
    // another) and each save reconciles live records — let them settle longer.
    const delay = dirtyTabs.some(t => STAGE_AUTO_SAVE_TABS.has(t)) ? 1500 : 800;
    const timer = setTimeout(() => { void autoSaveFnRef.current(dirtyTabs, tok); }, delay);
    autoTimerRef.current = timer;
    return () => clearTimeout(timer);
  }, [form, resp, loading]);
  // "Saved" decays back to the idle hint after a moment.
  useEffect(() => {
    if (autoSave.kind !== "saved") return;
    const t = setTimeout(() => setAutoSave(s => (s.kind === "saved" ? { kind: "idle" } : s)), 2500);
    return () => clearTimeout(t);
  }, [autoSave]);
  // Scope switch: clear per-tab clean markers (they belong to the old tenant)
  // and any pending retry timer.
  useEffect(() => {
    lastSavedSliceRef.current = {};
    setAutoSave({ kind: "idle" });
    return () => { if (autoTimerRef.current) clearTimeout(autoTimerRef.current); };
  }, [scope, clientName]);

  // Reset the per-client overrides back to inherited (global/built-in).
  const resetClient = useCallback(async () => {
    if (scope !== "client" || !clientName.trim()) return;
    setSavingSection("reset");
    try {
      const res = await fetch(`${API}/settings`, {
        method: "PUT",
        headers: { ...authHeaders(), "Content-Type": "application/json" },
        body: JSON.stringify({ tenantId: clientName.trim(), settings: {} }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      bustCache(onboardingSettingsCacheKey(clientName.trim()));
      // Falling back to inherited defaults can change the effective phase/stage
      // sets, which resyncs lifecycle templates server-side.
      notifyLifecyclesChanged();
      toast({ title: "Reset to inherited", description: `"${clientName.trim()}" now follows the global defaults.` });
      load(scope, clientName);
    } catch (e: any) {
      toast({ title: "Could not reset", description: e.message, variant: "destructive" });
    } finally {
      setSavingSection(null);
    }
  }, [scope, clientName, toast, load]);

  // Rescales existing weekly allocations that are still at the system default
  // (never manually edited) onto the CURRENT "Hours in a full week" value, so
  // e.g. changing it from 40 to 50 is reflected on the "Hours by Phase" table
  // for people already assigned, not just new assignments going forward.
  const reapplyHours = useCallback(async () => {
    if (!form) return;
    setReapplying(true);
    try {
      // The rescale reads the LAST SAVED "Hours in a full week" value from the
      // server — if the admin typed a new number but hasn't hit Save yet, that
      // unsaved value would silently be ignored (rescaling to the old number).
      // Save first so "Apply to existing allocations" always rescales to
      // whatever is currently in the field. Capture the PREVIOUS saved value
      // first — the server uses it to recognize allocations that are still at
      // the old default (vs deliberately set rates, which are never touched).
      const prevFullWeekHours = Number(resp?.effective?.workWeekHours) || undefined;
      // Save only the Schedule card's fields (this button lives on that card) —
      // same per-section rule as the Save buttons.
      const baseline = resp?.effective ?? form;
      const settings: OnboardingDefaults = { ...baseline };
      for (const k of SECTION_FIELDS.staff) (settings as any)[k] = form[k];
      const body: any = { settings };
      if (touchedDisplayKeys.current.size) body.touchedDisplayKeys = Array.from(touchedDisplayKeys.current);
      if (scope === "client" && clientName.trim()) body.tenantId = clientName.trim();
      const saveRes = await fetch(`${API}/settings`, {
        method: "PUT",
        headers: { ...authHeaders(), "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!saveRes.ok) {
        const e = await saveRes.json().catch(() => ({}));
        throw new Error(e.error ?? `HTTP ${saveRes.status}`);
      }
      void loadBusinessRules();
      // Await so the refreshed saved state is in place before buttons re-enable
      // (same stale-baseline guard as save()).
      await load(scope, clientName);

      // Pass the target tenant so a superadmin editing another client's
      // settings rescales THAT client's allocations (not their own). For
      // regular admins the server ignores this and uses their own tenant.
      const targetTenant = scope === "client" && clientName.trim() ? clientName.trim() : undefined;
      const result = await reapplyDefaultHours(prevFullWeekHours, targetTenant);
      bustCache();
      toast({
        title: "Applied",
        description: result.rowsUpdated > 0
          ? `Updated ${result.rowsUpdated} weekly allocation${result.rowsUpdated === 1 ? "" : "s"} across ${result.groupsRescaled} assignment${result.groupsRescaled === 1 ? "" : "s"} to ${result.fullWeekHours}h/week, including manually edited or distributed weeks. It may take up to 30 seconds to appear when you open a project.`
          : `Nothing to update — every assignment already matches ${result.fullWeekHours}h/week.`,
      });
    } catch (e: any) {
      toast({ title: "Could not apply", description: e.message, variant: "destructive" });
    } finally {
      setReapplying(false);
    }
  }, [form, scope, clientName, toast, load, resp]);

  // Which keys differ from what this scope inherits (for the "overridden" badge).
  const overriddenKeys = new Set<string>(
    resp ? Object.keys(scope === "client" ? (resp.client ?? {}) : (resp.global ?? {})) : [],
  );


  // ── Hub layout state ─────────────────────────────────────────────────────
  // "hub" = the All-Settings card grid; anything else = one settings area.
  const [activeCat, setActiveCat]     = useState<CatId>(() => {
    // Legacy deep-links: User Groups, Access Levels and Staffing Templates
    // used to be their own categories — land those links on Staff & Resources
    // (openSub below picks the matching tab).
    if (initialCat === "usergroups" || initialCat === "accesslevels" || initialCat === "templates") return "staff";
    // The old standalone "Schedule" category was split: working week +
    // holidays live under Staff & Resources, display/past-editing under
    // Projects & Opportunities. Legacy links land on the calendar tab.
    if (initialCat === "schedule") return "staff";
    // Stage Rules merged into the schedule cards (client model: stages ==
    // schedule) — legacy links land on the Opportunities schedule tab.
    if (initialCat === "stagerules") return "projects";
    const validCats: CatId[] = ["org", "projects", "staff", "forecast", "billing", "display", "navigation"];
    return (validCats.includes(initialCat as CatId) ? initialCat as CatId : "hub");
  });
  const [openSub, setOpenSub]         = useState<string | null>(() => {
    if (initialCat === "usergroups") return "staff-groups";
    if (initialCat === "accesslevels") return "staff-access";
    if (initialCat === "templates") return "staff-templates";
    if (initialCat === "schedule") return "staff-calendar";
    if (initialCat === "stagerules") return "opp-defaults";
    return initialCat && initialCat !== "org" && initialCat !== "projects" ? null : "proj-defaults";
  });

  // Re-fetch lifecycle templates whenever the projects or opportunities sub-tab
  // becomes active so the sidebar always matches the live DB (no stale cache).
  // `lcVersion` is bumped after any lifecycle create/delete so the list
  // refreshes immediately without requiring a tab switch.
  const [lcVersion, setLcVersion] = useState(0);
  const toLifecycleTpl = useCallback((arr: unknown[]) =>
    (arr as Array<{ ID: number; Name: string; Stages: Array<{ Name: string; StageStep: number }> }>)
      .map(lc => ({
        id: lc.ID,
        name: lc.Name ?? "",
        phases: (lc.Stages ?? [])
          .slice()
          .sort((a, b) => a.StageStep - b.StageStep)
          .map(s => s.Name),
      }))
      .filter(t => t.name && t.phases.length > 0),
  []);
  useEffect(() => {
    if (openSub !== "proj-defaults" && openSub !== "opp-defaults") return;
    let dead = false;
    (async () => {
      try {
        bustCache("lifecycles");
        const [pmm, opm] = await Promise.all([
          getLifecycles("PMM"),
          getLifecycles("OPM"),
        ]);
        if (dead) return;
        setProjLifecycles(toLifecycleTpl(pmm));
        setOppLifecycles(toLifecycleTpl(opm));
      } catch { /* non-critical */ }
    })();
    return () => { dead = true; };
  }, [openSub, lcVersion, toLifecycleTpl]);

  // addException fn exposed by the active PhaseSetsSaveBar — shown as a
  // button in the page header row (before Save) when on the phases/stages tab.
  const [addExceptionFn, setAddExceptionFn] = useState<(() => void) | null>(null);
  // savedSchedules popup fn — exposed by whichever PhaseSetsSaveBar is visible.
  const [savedSchedulesFn, setSavedSchedulesFn] = useState<(() => void) | null>(null);
  // makeDefault fn — non-null only when a saved (non-default) schedule is selected;
  // PhaseSetsSaveBar sets it to null when the Default card is active.
  const [makeDefaultFn, setMakeDefaultFn] = useState<(() => void) | null>(null);
  // Per-stage "Set rules" drawer — opened from the schedule cards (client
  // model: stages == schedule, ONE card, rules right on it). The host below
  // owns the rules doc and reports live per-stage counts for the badges.
  const [ruleTarget, setRuleTarget] = useState<ScheduleRuleTarget | null>(null);
  const [ruleCountFn, setRuleCountFn] = useState<((mod: StageRuleModule, stage: string) => number) | null>(null);
  const onRuleCountsChange = useCallback(
    (fn: ((mod: StageRuleModule, stage: string) => number) | null) => setRuleCountFn(() => fn),
    [],
  );
  // Stable color-change fns registered by the PhaseSetsSaveBars — called
  // when the "Set rules" drawer's inline color picker fires (so the rules
  // drawer can write phase colors back to whichever set is currently selected
  // in the phase editor without knowing which set that is).
  // ONE SLOT PER MODULE: the Projects (PMM) and Opportunities (OPM) bars are
  // both mounted on this page, and with a single shared slot whichever bar
  // registered last received EVERY color change — an Opportunities color
  // edit could be written into the Projects set (and never into the opp set,
  // so it looked unsaved after refresh). The drawer reports its module and we
  // route to that bar only.
  const colorChangeFnsRef = useRef<{ [m in StageRuleModule]?: ((phase: string, color: string | null) => void) | null }>({});
  const onColorChangeReadyPMM = useCallback(
    (fn: ((phase: string, color: string | null) => void) | null) => { colorChangeFnsRef.current.PMM = fn; },
    [],
  );
  const onColorChangeReadyOPM = useCallback(
    (fn: ((phase: string, color: string | null) => void) | null) => { colorChangeFnsRef.current.OPM = fn; },
    [],
  );
  // Tenant-scope switch closes any open rules drawer — its target belonged
  // to the previous scope (the host itself also remounts, see below).
  useEffect(() => { setRuleTarget(null); }, [superadmin, scope, clientName]);
  const [search, setSearch]           = useState("");

  // ── Hub card drag-to-reorder ────────────────────────────────────────────
  const [hubCardOrder, setHubCardOrder] = useState<string[]>(() => {
    try {
      const raw = localStorage.getItem("settings:hubCardOrder");
      if (raw) {
        const saved = JSON.parse(raw) as string[];
        const validIds: string[] = SETTINGS_CARDS.map(c => c.id as string);
        const ordered = saved.filter(id => validIds.includes(id));
        const missing = validIds.filter(id => !ordered.includes(id));
        return [...ordered, ...missing];
      }
    } catch {}
    return SETTINGS_CARDS.map(c => c.id as string);
  });
  const [dragCardId, setDragCardId] = useState<string | null>(null);
  const [dropCardId, setDropCardId] = useState<string | null>(null);
  const dragCardRef = useRef<string | null>(null);

  // Deep-link from rule editors ("+ New group" in Stage Rules, "Stage Rules"
  // in User Groups): switch to the requested category/tab without a page
  // reload. The /configuration route mounts this page with `embedded` (chrome
  // only — it still renders the full hub with navigation), so the listener
  // must run there too; the category is validated against the known set.
  useEffect(() => {
    const h = (e: Event) => {
      const d = (e as CustomEvent).detail as { cat?: string; sub?: string } | undefined;
      // Legacy "stagerules" links: rules now live on the schedule cards.
      if (d?.cat === "stagerules") {
        setActiveCat("projects");
        setOpenSub(d.sub ?? "opp-defaults");
        window.scrollTo({ top: 0 });
        return;
      }
      const validCats: CatId[] = ["org", "projects", "staff", "forecast", "billing", "display", "navigation"];
      if (!d?.cat || !validCats.includes(d.cat as CatId)) return;
      setActiveCat(d.cat as CatId);
      setOpenSub(d.sub ?? null);
      window.scrollTo({ top: 0 });
    };
    window.addEventListener("rmone:openSettingsSection", h);
    return () => window.removeEventListener("rmone:openSettingsSection", h);
  }, [embedded]);

  // Hub search filters the card grid (title, description, bullets, and the
  // deeper per-section search terms).
  const visibleCards = useMemo(() => {
    // Sort by the user's saved drag order first, then filter by search.
    const sorted = [...SETTINGS_CARDS].sort((a, b) => {
      const ai = hubCardOrder.indexOf(a.id);
      const bi = hubCardOrder.indexOf(b.id);
      return (ai === -1 ? 999 : ai) - (bi === -1 ? 999 : bi);
    });
    const q = search.trim().toLowerCase();
    if (!q) return sorted;
    return sorted.filter(c =>
      c.title.toLowerCase().includes(q) ||
      c.desc.toLowerCase().includes(q) ||
      c.bullets.some(b => b.label.toLowerCase().includes(q)) ||
      SUBS.some(s => s.cat === c.id && (
        s.title.toLowerCase().includes(q) || s.terms.some(t => t.includes(q))
      )),
    );
  }, [search, hubCardOrder]);

  const gotoCat = (cat: SectionKey, sub?: string) => {
    setActiveCat(cat);
    setSearch("");
    setOpenSub(sub ?? SUBS.find(s => s.cat === cat)?.id ?? null);
  };

  const isFormCat = (id: CatId): id is SectionKey => CATS.some(c => c.id === id);

  const openCard = (id: Exclude<CatId, "hub">, sub?: string) => {
    if (isFormCat(id)) gotoCat(id, sub);
    else { setActiveCat(id); setSearch(""); }
  };

  // Honest per-card header stat: real numbers where the loaded settings (or
  // stage rules) provide them, short factual text labels otherwise — never a
  // fabricated percentage.
  const cardStat = (id: Exclude<CatId, "hub">): { big: string; sub: string } => {
    switch (id) {
      case "org": {
        const n = form ? [form.showBusinessUnit, form.showDivision, form.showDepartment].filter(Boolean).length : null;
        return { big: n == null ? "—" : String(n), sub: "Org tiers shown" };
      }
      case "projects": {
        const n = form ? form.defaultOpportunityStages.split(",").map(s => s.trim()).filter(Boolean).length : null;
        return { big: n == null ? "—" : String(n), sub: "Pipeline stages" };
      }
      case "staff":     return { big: form ? `${form.targetUtilizationPct}%` : "—", sub: "Target utilization" };
      case "forecast":  return { big: form ? `${form.forecastWeeks} wk` : "—", sub: "Forecast window" };
      case "billing":      return { big: "$/hr",   sub: "Role-based rates" };
      case "display":      return { big: "UI",     sub: "Company defaults" };
      case "accesslevels": return { big: "Access", sub: "Permission sets" };
      case "navigation":   return { big: "Menu",   sub: "Show, hide, rename" };
      case "templates":    return { big: "Teams",  sub: "Saved role mixes" };
    }
  };

  // Green "Customized" marker: only where we can honestly tell (this scope has
  // overrides on that card's fields).
  const cardCustomized = (id: Exclude<CatId, "hub">): boolean => {
    if (isFormCat(id)) return SECTION_FIELDS[id].some(k => overriddenKeys.has(k));
    if (id === "org") return ORG_OVERRIDE_KEYS.some(k => overriddenKeys.has(k));
    return false;
  };

  // Per-accordion Save. Saving persists the whole CATEGORY's fields (the same
  // per-section granularity as before the redesign) — never other categories'
  // half-typed edits.
  const saveFooter = (cat: SectionKey, color: string) => (
    <div style={{ display: "flex", justifyContent: "flex-end", paddingTop: 4 }}>
      <Button size="sm" onClick={() => save(cat)} disabled={saving || reapplying}
        style={{ background: color, color: "#fff", border: "none" }}>
        {savingSection === cat ? <Loader2 className="w-3.5 h-3.5 mr-1.5 animate-spin" /> : <Save className="w-3.5 h-3.5 mr-1.5" />}
        Save
      </Button>
    </div>
  );

  // The editable fields for one accordion section. All field JSX and wiring is
  // unchanged from the previous card layout — only regrouped.
  const renderSub = (subId: string): React.ReactNode => {
    // User Groups lives inside Staff & Resources but manages its own saves —
    // render it directly without needing `form`.
    if (subId === "staff-groups") {
      return (
        <UserGroupsSettings
          tenantId={superadmin ? (scope === "client" && clientName.trim() ? clientName.trim() : null) : undefined}
          onNavigateToAccessLevels={() => setOpenSub("staff-access")}
        />
      );
    }
    // Manage Staff — the same roster editor as Resources → Manage Staff (same
    // component, same backend endpoints), embedded as a settings tab.
    if (subId === "staff-manage") {
      const tId = superadmin
        ? (scope === "client" && clientName.trim() ? clientName.trim() : "")
        : (getStoredUser()?.tenant ?? "");
      if (!tId) {
        return (
          <Card><CardContent className="py-10 text-center text-sm text-muted-foreground">
            Choose a client on the All Settings page to manage their staff.
          </CardContent></Card>
        );
      }
      return (
        <InviteMembersDialog
          embedded
          tenantId={tId}
          tenantLabel={superadmin && scope === "client" ? clientName.trim() : undefined}
        />
      );
    }
    // Access Levels — moved from its own settings card into Staff & Resources.
    if (subId === "staff-access") {
      return (
        <AccessLevelsSettings
          tenantId={superadmin ? (scope === "client" && clientName.trim() ? clientName.trim() : null) : undefined}
        />
      );
    }
    // Staffing Templates — moved from its own settings card into Staff & Resources.
    if (subId === "staff-templates") {
      return <StaffingTemplatesSettings />;
    }
    if (!form) return null;

    // "Applies to" audience picker — used by each individual setting (display
    // mode, past-edit, assumed length, working-week calendar). At the superadmin
    // GLOBAL scope there is no tenant (no groups), so the picker is hidden —
    // global defaults always apply to everyone.
    const renderAudience = (
      modeKey: keyof OnboardingDefaults,
      idsKey: keyof OnboardingDefaults,
      label: string,
      hint: React.ReactNode,
    ) => {
      if (scopeTenantId === null) return null;
      return (
        <Field overriddenKeys={overriddenKeys} keyName={modeKey} label={label} hint={hint}>
          <ScopePicker
            mode={(form[modeKey] as PhaseScopeMode) ?? "everyone"}
            groupIds={String(form[idsKey] ?? "").split(",").map(s => s.trim()).filter(Boolean)}
            onChange={(m, ids) => {
              set(modeKey, m);
              set(idsKey, m === "everyone" ? "" : ids.join(","));
            }}
            groups={scopeGroups ?? []}
            groupsReady={scopeGroups !== null}
            groupColors={scopeGroupColors}
            people={scopePeople}
          />
        </Field>
      );
    };

    // Full-width setting card WITHOUT an audience column — used by the
    // working-week calendar settings, whose per-group scoping was removed
    // (they now always apply to everyone).
    const renderSettingCard = (
      settingKey: keyof OnboardingDefaults,
      settingLabel: string,
      settingHint: React.ReactNode,
      settingContent: React.ReactNode,
    ) => {
      if (scopeTenantId === null) {
        return (
          <Field overriddenKeys={overriddenKeys} keyName={settingKey} label={settingLabel} hint={settingHint}>
            {settingContent}
          </Field>
        );
      }
      return (
        <div className="rounded-lg border border-border bg-muted/20 overflow-hidden">
          <div className="flex flex-col gap-1.5 p-4">
            <div className="flex items-center gap-2">
              <Label className="text-sm font-medium">{settingLabel}</Label>
              {overriddenKeys.has(settingKey as string) ? (
                <span className="text-[10px] uppercase tracking-wide rounded px-1.5 py-0.5 bg-primary/10 text-primary border border-primary/20">
                  customized
                </span>
              ) : null}
            </div>
            {settingContent}
            {settingHint && <p className="text-xs text-muted-foreground mt-auto pt-2">{settingHint}</p>}
          </div>
        </div>
      );
    };

    // ── Per-audience value controls (shared by base + exception rows) ──────
    const displayModeSelect = (v: DisplayModeValue, setV: (x: DisplayModeValue) => void) => (
      <DisplayModeSelector value={v} onChange={x => setV(x as DisplayModeValue)} />
    );

    type PastEditVal = { allow: boolean; limitWeeks: number | null };
    const pastEditControl = (v: PastEditVal, setV: (x: PastEditVal) => void) => {
      const pmode = !v.allow ? "locked" : v.limitWeeks === null ? "nolimit" : "limited";
      return (
        <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
          <Select
            value={pmode}
            onValueChange={m => setV(
              m === "locked" ? { allow: false, limitWeeks: null }
              : m === "nolimit" ? { allow: true, limitWeeks: null }
              : { allow: true, limitWeeks: v.limitWeeks ?? 8 })}
          >
            <SelectTrigger style={{ width: 230 }}><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="nolimit">Editable — no limit</SelectItem>
              <SelectItem value="limited">Allow going back…</SelectItem>
              <SelectItem value="locked">Locked to this week</SelectItem>
            </SelectContent>
          </Select>
          {pmode === "limited" && (
            <>
              <ClampedNumInput
                min={1} max={520}
                value={v.limitWeeks ?? 8}
                onCommit={n => setV({ allow: true, limitWeeks: n })}
              />
              <span style={{ fontSize: 12, color: "var(--muted-foreground)" }}>weeks</span>
            </>
          )}
        </div>
      );
    };

    const monthsControl = (v: number, setV: (n: number) => void) => (
      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
        <span style={{ fontSize: 12.5, color: "var(--muted-foreground)" }}>Assume</span>
        <ClampedNumInput min={1} max={120} value={v} onCommit={setV} />
        <span style={{ fontSize: 12.5, color: "var(--muted-foreground)" }}>months</span>
      </div>
    );

    // Lenient row parse for DISPLAY only: keeps rows whose audience is still
    // empty (mid-edit) so a freshly added exception doesn't vanish from the
    // card. The strict parsers (server sanitize + live resolution in
    // lib/businessRules.ts) drop audience-less rows.
    const lenientRows = <V,>(raw: unknown, coerce: (r: Record<string, unknown>) => V | null): RuleRowOf<V>[] => {
      if (typeof raw !== "string" || !raw) return [];
      try {
        const p = JSON.parse(raw);
        if (!Array.isArray(p)) return [];
        const out: RuleRowOf<V>[] = [];
        for (const r of p.slice(0, 20)) {
          if (!r || typeof r !== "object") continue;
          const rr = r as Record<string, unknown>;
          const value = coerce(rr);
          if (value === null) continue;
          const ids = Array.isArray(rr.ids) ? rr.ids.filter((x: unknown): x is string => typeof x === "string") : [];
          out.push({ ids, value });
        }
        return out;
      } catch { return []; }
    };
    const displayCoerce = (r: Record<string, unknown>): DisplayModeValue | null =>
      (["full", "no-schedule", "no-schedule-no-hours", "no-schedule-no-grid", "schedule-no-grid"] as readonly string[])
        .includes(r.value as string) ? r.value as DisplayModeValue : null;
    const pastEditCoerce = (r: Record<string, unknown>): PastEditVal | null =>
      typeof r.allow === "boolean"
        ? { allow: r.allow, limitWeeks: r.allow && typeof r.limitWeeks === "number" ? r.limitWeeks : null }
        : null;
    const monthsCoerce = (r: Record<string, unknown>): number | null =>
      typeof r.months === "number" && Number.isFinite(r.months) ? Math.min(120, Math.max(1, Math.round(r.months))) : null;

    const encodeRows = <V,>(rows: RuleRowOf<V>[], toRow: (r: RuleRowOf<V>) => Record<string, unknown>): string =>
      rows.length ? JSON.stringify(rows.map(toRow)) : "";

    // Setting card with per-audience exception rows: a base "Everyone" value
    // plus ordered exceptions targeting user groups AND/OR org units
    // (BU/Division/Department), each with its own value. Legacy single-
    // audience pairs are shown converted into the equivalent rows; the
    // conversion persists on first edit (legacy pair reset to "everyone").
    const renderRulesSetting = <V,>(cfg: {
      settingKey: keyof OnboardingDefaults;
      rulesKey: keyof OnboardingDefaults;
      legacyModeKey: keyof OnboardingDefaults;
      legacyIdsKey: keyof OnboardingDefaults;
      title: string;
      hint: React.ReactNode;
      rows: RuleRowOf<V>[];
      base: V;
      builtinDefault: V;
      setBase: (v: V) => void;
      encode: (rows: RuleRowOf<V>[]) => string;
      renderValue: (v: V, setV: (v: V) => void) => React.ReactNode;
      plainContent: React.ReactNode;
      /** When provided, an inline Save button appears on this card. */
      onSave?: () => void;
      saving?: boolean;
      /** Hide the "+ New" exception button so the setting is company-wide only. */
      hideAddNew?: boolean;
    }) => {
      // Superadmin GLOBAL scope: no tenant → no groups/org units; plain field.
      if (scopeTenantId === null) {
        return (
          <Field overriddenKeys={overriddenKeys} keyName={cfg.settingKey} label={cfg.title} hint={cfg.hint}>
            {cfg.plainContent}
          </Field>
        );
      }
      let rows = cfg.rows;
      let base = cfg.base;
      if (rows.length === 0) {
        // Convert a legacy single-audience pair into the equivalent rows view:
        //  - "groups": listed groups kept the tenant value, everyone else got
        //    the built-in default → base = default, exception = tenant value.
        //  - "except": listed groups got the default, everyone else kept the
        //    tenant value → base stays, exception = built-in default.
        const lmode = String(form[cfg.legacyModeKey] ?? "everyone");
        const lids = String(form[cfg.legacyIdsKey] ?? "").split(",").map(s => s.trim()).filter(Boolean);
        if (lids.length > 0 && lmode === "groups") { rows = [{ ids: lids, value: base }]; base = cfg.builtinDefault; }
        else if (lids.length > 0 && lmode === "except") { rows = [{ ids: lids, value: cfg.builtinDefault }]; }
      }
      const customized = overriddenKeys.has(cfg.settingKey as string) || overriddenKeys.has(cfg.rulesKey as string);
      return (
        <AudienceRulesCard
          title={cfg.title}
          badge={customized ? (
            <span className="text-[10px] uppercase tracking-wide rounded px-1.5 py-0.5 bg-primary/10 text-primary border border-primary/20">
              customized
            </span>
          ) : undefined}
          hint={cfg.hint}
          baseValue={base}
          rows={rows}
          onCommit={(b, rs) => {
            cfg.setBase(b);
            set(cfg.rulesKey, cfg.encode(rs) as never);
            set(cfg.legacyModeKey, "everyone" as never);
            set(cfg.legacyIdsKey, "" as never);
          }}
          renderValue={cfg.renderValue}
          newRowValue={cfg.builtinDefault}
          groups={scopeGroups ?? []}
          groupsReady={scopeGroups !== null}
          groupColors={scopeGroupColors}
          people={scopePeople}
          onSave={cfg.onSave}
          saving={cfg.saving}
          hideAddNew={cfg.hideAddNew}
        />
      );
    };

    // Schedule display + past-date editing block — one copy per module
    // (projects vs opportunities), each saved under its own settings keys.
    const renderSchedBlock = (mod: "proj" | "opp") => {
      const displayKey = mod === "proj" ? "projectDisplayMode" : "oppDisplayMode";
      const allowKey   = mod === "proj" ? "allowPastDateEdit" : "oppAllowPastDateEdit";
      const limitKey   = mod === "proj" ? "pastEditLimitWeeks" : "oppPastEditLimitWeeks";
      const noun       = mod === "proj" ? "project" : "opportunity";
      const displayRulesKey = mod === "proj" ? "projDisplayRules" : "oppDisplayRules";
      const pastRulesKey    = mod === "proj" ? "projPastEditRules" : "oppPastEditRules";
      const pastVal: PastEditVal = {
        allow: (form[allowKey] as boolean | undefined) ?? true,
        limitWeeks: (form[limitKey] as number | null | undefined) ?? null,
      };
      return (
        <>
          {renderRulesSetting<DisplayModeValue>({
            settingKey: displayKey,
            rulesKey: displayRulesKey,
            legacyModeKey: mod === "proj" ? "projDisplayApplyMode" : "oppDisplayApplyMode",
            legacyIdsKey: mod === "proj" ? "projDisplayGroupIds" : "oppDisplayGroupIds",
            title: "Visible sections (display mode)",
            hint: <>Controls what appears on each {noun}&apos;s detail page.</>,
            rows: lenientRows(form[displayRulesKey], displayCoerce),
            base: (form[displayKey] as DisplayModeValue) ?? "full",
            builtinDefault: "full",
            setBase: v => set(displayKey, v),
            encode: rows => encodeRows(rows, r => ({ ids: r.ids, value: r.value })),
            renderValue: displayModeSelect,
            plainContent: displayModeSelect((form[displayKey] as DisplayModeValue) ?? "full", v => set(displayKey, v)),
            onSave: () => void save("projects"),
            saving: savingSection === "projects",
            hideAddNew: true,
          })}
          {renderRulesSetting<PastEditVal>({
            settingKey: allowKey,
            rulesKey: pastRulesKey,
            legacyModeKey: mod === "proj" ? "projPastEditApplyMode" : "oppPastEditApplyMode",
            legacyIdsKey: mod === "proj" ? "projPastEditGroupIds" : "oppPastEditGroupIds",
            title: "Editing weeks that have already ended",
            hint: <>Controls whether hours in weeks that already ended can still be changed. Add
              exceptions to give specific user groups, business units, divisions or departments
              their own rule.</>,
            rows: lenientRows(form[pastRulesKey], pastEditCoerce),
            base: pastVal,
            builtinDefault: { allow: true, limitWeeks: null },
            setBase: v => { set(allowKey, v.allow); set(limitKey, v.limitWeeks); },
            encode: rows => encodeRows(rows, r => ({ ids: r.ids, allow: r.value.allow, limitWeeks: r.value.limitWeeks })),
            renderValue: pastEditControl,
            plainContent: pastEditControl(pastVal, v => { set(allowKey, v.allow); set(limitKey, v.limitWeeks); }),
            onSave: () => void save("projects"),
            saving: savingSection === "projects",
          })}
        </>
      );
    };

    switch (subId) {
      case "proj-defaults": {
        const noSchedLabels: Partial<Record<DisplayModeValue, string>> = {
          "no-schedule":          "Hours Grid Only",
          "no-schedule-no-grid":  "Table Only",
          "no-schedule-no-hours": "Summary Only",
        };
        const projDisplayMode = (form.projectDisplayMode as DisplayModeValue) ?? "full";
        const projHasNoSchedule = !!noSchedLabels[projDisplayMode];
        const setProjectDisplayMode = (v: DisplayModeValue) => {
          const cur = (form.projectDisplayMode as DisplayModeValue) ?? "full";
          if (noSchedLabels[v] && !noSchedLabels[cur]) {
            const label = noSchedLabels[v]!;
            if (!window.confirm(
              `You're switching to "${label}" — a layout without Schedule phases.\n\n` +
              `By confirming, you acknowledge that the Schedule phases section will be hidden. ` +
              `Projects will continue to work normally, but they won't show a phase Gantt or phase bars ` +
              `while this layout is active — you'll only be using the features included in "${label}".\n\n` +
              `You can switch back to "Full View" at any time to restore the Schedule phases section.`
            )) return;
          }
          set("projectDisplayMode", v);
        };
        const SecDiv = ({ n, title, desc }: { n: string; title: string; desc: string }) => (
          <div style={{ display: "flex", alignItems: "baseline", gap: 12, paddingTop: 8 }}>
            <span style={{ fontFamily: "ui-monospace, monospace", fontSize: 10, fontWeight: 700, letterSpacing: ".13em", textTransform: "uppercase", color: "hsl(var(--muted-foreground) / 0.6)", flexShrink: 0 }}>{n}</span>
            <div style={{ flex: 1 }}>
              <div style={{ fontSize: 13, fontWeight: 600, color: "hsl(var(--foreground))", letterSpacing: "-.005em" }}>{title}</div>
              <div style={{ fontSize: 12, color: "hsl(var(--muted-foreground))", marginTop: 2, lineHeight: 1.5 }}>{desc}</div>
            </div>
            <div style={{ height: 1, flex: "0 0 0", alignSelf: "center" }} />
          </div>
        );
        return (
          <div className="flex flex-col gap-4">
            <SecDiv n="§ 01" title="Detail page layout" desc="What sections appear on each project page, and who sees which layout." />
            {renderRulesSetting<DisplayModeValue>({
              settingKey: "projectDisplayMode",
              rulesKey: "projDisplayRules",
              legacyModeKey: "projDisplayApplyMode",
              legacyIdsKey: "projDisplayGroupIds",
              title: "Visible sections (display mode)",
              hint: <>Controls what appears on each project&apos;s detail page.
                {form.projectDisplayModeSource === "auto" && (
                  <span className="block mt-1 text-emerald-700">
                    Auto-selected from your last file import, based on how the team assignments were
                    given (weekly hours rows vs date ranges). Pick a different layout any time — your
                    choice will then stick.
                  </span>
                )}</>,
              rows: lenientRows(form.projDisplayRules, displayCoerce),
              base: projDisplayMode,
              builtinDefault: "full",
              setBase: setProjectDisplayMode,
              encode: rows => encodeRows(rows, r => ({ ids: r.ids, value: r.value })),
              renderValue: displayModeSelect,
              plainContent: displayModeSelect(projDisplayMode, setProjectDisplayMode),
              onSave: () => void save("projects"),
              saving: savingSection === "projects",
              hideAddNew: true,
            })}
            <SecDiv n="§ 02" title="Planning defaults" desc="Set how far back hours can be edited and how long records are assumed to run when dates are missing." />
              <div className="grid grid-cols-2 gap-4">
              <Field overriddenKeys={overriddenKeys} keyName="allowPastDateEdit" label="Editing weeks that have already ended"
                hint="Controls whether hours in weeks that already ended can still be changed.">
                {pastEditControl(
                  { allow: (form.allowPastDateEdit as boolean | undefined) ?? true, limitWeeks: (form.pastEditLimitWeeks as number | null | undefined) ?? null },
                  v => { set("allowPastDateEdit", v.allow); set("pastEditLimitWeeks", v.limitWeeks); },
                )}
              </Field>
              <Field overriddenKeys={overriddenKeys} keyName="durationMonths" label="Project length"
                hint="Applied when a project has no end date.">
                <div style={{ display: "flex", alignItems: "center", gap: 0, marginTop: 4 }}>
                  <Input type="number" min={1} max={120} value={form.durationMonths ?? 3}
                    onChange={e => set("durationMonths", Number(e.target.value))}
                    style={{ width: 78, borderRadius: "6px 0 0 6px", borderRight: "none", textAlign: "right", fontWeight: 600, fontFamily: "ui-monospace, monospace" }} />
                  <span style={{ height: 36, display: "flex", alignItems: "center", padding: "0 10px", border: "1px solid hsl(var(--border))", borderRadius: "0 6px 6px 0", background: "hsl(var(--muted) / 0.4)", fontSize: 12.5, color: "hsl(var(--muted-foreground))", whiteSpace: "nowrap" }}>months</span>
                </div>
              </Field>
              <Field overriddenKeys={overriddenKeys} keyName="forecastHorizonDays" label="Lead forecast window"
                hint="How long a lead is assumed to stay open with no close date. Leads only.">
                <div style={{ display: "flex", alignItems: "center", gap: 0, marginTop: 4 }}>
                  <Input type="number" min={1} max={3650} value={form.forecastHorizonDays}
                    onChange={e => set("forecastHorizonDays", Number(e.target.value))}
                    style={{ width: 78, borderRadius: "6px 0 0 6px", borderRight: "none", textAlign: "right", fontWeight: 600, fontFamily: "ui-monospace, monospace" }} />
                  <span style={{ height: 36, display: "flex", alignItems: "center", padding: "0 10px", border: "1px solid hsl(var(--border))", borderRadius: "0 6px 6px 0", background: "hsl(var(--muted) / 0.4)", fontSize: 12.5, color: "hsl(var(--muted-foreground))", whiteSpace: "nowrap" }}>days</span>
                </div>
              </Field>
            </div>
            <SecDiv n="§ 03" title="Phase lifecycle" desc="The ordered phases every project moves through — Gantt bars, team columns, Hours by Phase." />
            {!projHasNoSchedule && (
              <Field overriddenKeys={overriddenKeys} keyName="defaultPhases" label="Schedule phases (project lifecycle)"
                hint={
                  <details style={{ marginTop: 4, border: "1px solid hsl(var(--border))", borderRadius: 6, background: "hsl(var(--background))" }}>
                    <summary style={{ cursor: "pointer", padding: "7px 10px", display: "flex", alignItems: "center", gap: 7, fontSize: 12.5, fontWeight: 600, color: "hsl(var(--foreground) / 0.7)", listStyle: "none" }}>
                      <span style={{ width: 17, height: 17, borderRadius: "50%", background: "#eaf2e3", color: "#4c7a25", display: "inline-flex", alignItems: "center", justifyContent: "center", fontSize: 10, fontWeight: 700, flexShrink: 0 }}>i</span>
                      Where these phases show up
                    </summary>
                    <div style={{ padding: "0 12px 12px 34px", fontSize: 12.5, lineHeight: 1.65, color: "hsl(var(--muted-foreground))" }}>
                      <ul style={{ margin: 0, paddingLeft: 16 }}>
                        <li style={{ marginBottom: 4 }}>A project created without its own schedule <b>inherits this list</b> as its schedule.</li>
                        <li style={{ marginBottom: 4 }}>They appear as phase bars on the Gantt, on the <b>Hours by phase</b> card, and as phase columns on team grids.</li>
                        <li style={{ marginBottom: 4 }}>Colors are assigned automatically and stay the same everywhere.</li>
                        <li><b>Rules</b> on a phase can lock fields, require fields, or limit who can act.</li>
                      </ul>
                    </div>
                  </details>
                }
                actions={
                  <div style={{ display: "flex", gap: 6 }}>
                    {makeDefaultFn && (
                      <Button variant="outline" size="sm" onClick={makeDefaultFn}>
                        Make default
                      </Button>
                    )}
                    {addExceptionFn && (
                      <Button variant="outline" size="sm" onClick={addExceptionFn}>
                        <Plus className="w-3.5 h-3.5 mr-1.5" /> Add schedule
                      </Button>
                    )}
                    {savedSchedulesFn && (
                      <Button variant="outline" size="sm" onClick={savedSchedulesFn}>
                        Saved schedules
                      </Button>
                    )}
                  </div>
                }>
                <PhaseSetsSaveBar
                  phasesValue={form.defaultPhases}
                  onPhasesChange={v => set("defaultPhases", v)}
                  phaseSetsValue={form.projectPhaseSets ?? ""}
                  onPhaseSetsChange={v => set("projectPhaseSets", v)}
                  onSaveSection={overrides => void save("projects", overrides as Partial<OnboardingDefaults> | undefined)}
                  onSaveSetsOnly={fields => void saveFields(fields as Partial<OnboardingDefaults>)}
                  phasesFieldKey="defaultPhases"
                  setsFieldKey="projectPhaseSets"
                  saving={savingSection === "projects"}
                  tenantId={superadmin ? (scope === "client" && clientName.trim() ? clientName.trim() : null) : undefined}
                  suggestions={["Preconstruction", "Construction", "Closeout", "Design", "Permitting", "Bidding", "Procurement", "Commissioning"]}
                  importedScope="project"
                  onAddExceptionReady={fn => setAddExceptionFn(() => fn)}
                  onSavedSchedulesPopupReady={fn => setSavedSchedulesFn(() => fn)}
                  onMakeDefaultReady={fn => setMakeDefaultFn(() => fn)}
                  onSetRules={(name, list, colors) => setRuleTarget({ mod: "PMM", stage: name, order: list, phaseColor: colors[name] ?? null })}
                  ruleCountOf={ruleCountFn ? (n => ruleCountFn("PMM", n)) : undefined}
                  onColorChangeReady={onColorChangeReadyPMM}
                  lifecycleTemplates={projLifecycles}
                  onDeleteTemplate={async (id, name) => {
                    try {
                      await deleteLifecycle(id);
                      // Optimistic update — remove instantly from both lists.
                      setProjLifecycles(prev => prev.filter(t => t.id !== id));
                      setOppLifecycles(prev => prev.filter(t => t.id !== id));
                      // Bump version → re-fetch from DB so the lists are authoritative.
                      setLcVersion(v => v + 1);
                    } catch (e) {
                      alert(`Failed to delete "${name}": ${(e as Error).message ?? String(e)}`);
                    }
                  }}
                />
              </Field>
            )}
          </div>
        );
      }
      case "opp-defaults": {
        const SecDivO = ({ n, title, desc }: { n: string; title: string; desc: string }) => (
          <div style={{ display: "flex", alignItems: "baseline", gap: 12, paddingTop: 8 }}>
            <span style={{ fontFamily: "ui-monospace, monospace", fontSize: 10, fontWeight: 700, letterSpacing: ".13em", textTransform: "uppercase", color: "hsl(var(--muted-foreground) / 0.6)", flexShrink: 0 }}>{n}</span>
            <div style={{ flex: 1 }}>
              <div style={{ fontSize: 13, fontWeight: 600, color: "hsl(var(--foreground))", letterSpacing: "-.005em" }}>{title}</div>
              <div style={{ fontSize: 12, color: "hsl(var(--muted-foreground))", marginTop: 2, lineHeight: 1.5 }}>{desc}</div>
            </div>
          </div>
        );
        return (
          <div className="flex flex-col gap-4">
            <SecDivO n="§ 01" title="Detail page layout" desc="What sections appear on each opportunity page, and who sees which layout." />
            {renderRulesSetting<DisplayModeValue>({
              settingKey: "oppDisplayMode",
              rulesKey: "oppDisplayRules",
              legacyModeKey: "oppDisplayApplyMode",
              legacyIdsKey: "oppDisplayGroupIds",
              title: "Visible sections (display mode)",
              hint: <>Controls what appears on each opportunity&apos;s detail page.</>,
              rows: lenientRows(form.oppDisplayRules, displayCoerce),
              base: (form.oppDisplayMode as DisplayModeValue) ?? "full",
              builtinDefault: "full",
              setBase: v => set("oppDisplayMode", v),
              encode: rows => encodeRows(rows, r => ({ ids: r.ids, value: r.value })),
              renderValue: displayModeSelect,
              plainContent: displayModeSelect((form.oppDisplayMode as DisplayModeValue) ?? "full", v => set("oppDisplayMode", v)),
              onSave: () => void save("projects"),
              saving: savingSection === "projects",
              hideAddNew: true,
            })}
            <SecDivO n="§ 02" title="Planning defaults" desc="Set how far back hours can be edited and how long opportunities are assumed to run when dates are missing." />
              <div className="grid grid-cols-2 gap-4">
              <Field overriddenKeys={overriddenKeys} keyName="oppAllowPastDateEdit" label="Editing weeks that have already ended"
                hint="Controls whether hours in weeks that already ended can still be changed.">
                {pastEditControl(
                  { allow: (form.oppAllowPastDateEdit as boolean | undefined) ?? true, limitWeeks: (form.oppPastEditLimitWeeks as number | null | undefined) ?? null },
                  v => { set("oppAllowPastDateEdit", v.allow); set("oppPastEditLimitWeeks", v.limitWeeks); },
                )}
              </Field>
              <Field overriddenKeys={overriddenKeys} keyName="oppDurationMonths" label="Opportunity length"
                hint="Applied when an opportunity has no end date.">
                <div style={{ display: "flex", alignItems: "center", gap: 0, marginTop: 4 }}>
                  <Input type="number" min={1} max={120} value={form.oppDurationMonths ?? 3}
                    onChange={e => set("oppDurationMonths", Number(e.target.value))}
                    style={{ width: 78, borderRadius: "6px 0 0 6px", borderRight: "none", textAlign: "right", fontWeight: 600, fontFamily: "ui-monospace, monospace" }} />
                  <span style={{ height: 36, display: "flex", alignItems: "center", padding: "0 10px", border: "1px solid hsl(var(--border))", borderRadius: "0 6px 6px 0", background: "hsl(var(--muted) / 0.4)", fontSize: 12.5, color: "hsl(var(--muted-foreground))", whiteSpace: "nowrap" }}>months</span>
                </div>
              </Field>
            </div>
            <SecDivO n="§ 03" title="Stage lifecycle" desc="The ordered stages every opportunity moves through — pipeline board, schedule bar, Hours by phase." />
            <Field overriddenKeys={overriddenKeys} keyName="defaultOpportunityStages" label="Pipeline schedules (opportunity schedule set)"
              hint={
                <details style={{ marginTop: 4, border: "1px solid hsl(var(--border))", borderRadius: 6, background: "hsl(var(--background))" }}>
                  <summary style={{ cursor: "pointer", padding: "7px 10px", display: "flex", alignItems: "center", gap: 7, fontSize: 12.5, fontWeight: 600, color: "hsl(var(--foreground) / 0.7)", listStyle: "none" }}>
                    <span style={{ width: 17, height: 17, borderRadius: "50%", background: "#eaf2e3", color: "#4c7a25", display: "inline-flex", alignItems: "center", justifyContent: "center", fontSize: 10, fontWeight: 700, flexShrink: 0 }}>i</span>
                    Where these schedules show up
                  </summary>
                  <div style={{ padding: "0 12px 12px 34px", fontSize: 12.5, lineHeight: 1.65, color: "hsl(var(--muted-foreground))" }}>
                    <ul style={{ margin: 0, paddingLeft: 16 }}>
                      <li style={{ marginBottom: 4 }}>These are the steps every opportunity moves through — they drive the schedule bar on each opportunity page and the pipeline board.</li>
                      <li style={{ marginBottom: 4 }}>Use <b>Rules</b> on any schedule to lock fields, require fields before moving on, skip the schedule for some records, or control who can act there.</li>
                      <li style={{ marginBottom: 4 }}>Keep alternative schedules with <b>Add schedule</b> — press <b>Make default</b> on one to switch.</li>
                      <li>Colors are assigned automatically and stay consistent everywhere.</li>
                    </ul>
                  </div>
                </details>
              }
              actions={
                <div style={{ display: "flex", gap: 6 }}>
                  {makeDefaultFn && (
                    <Button variant="outline" size="sm" onClick={makeDefaultFn}>
                      Make default
                    </Button>
                  )}
                  {addExceptionFn && (
                    <Button variant="outline" size="sm" onClick={addExceptionFn}>
                      <Plus className="w-3.5 h-3.5 mr-1.5" /> Add schedule
                    </Button>
                  )}
                  {savedSchedulesFn && (
                    <Button variant="outline" size="sm" onClick={savedSchedulesFn}>
                      Saved schedules
                    </Button>
                  )}
                </div>
              }>
              <PhaseSetsSaveBar
                phasesValue={form.defaultOpportunityStages}
                onPhasesChange={v => set("defaultOpportunityStages", v)}
                phaseSetsValue={form.oppStageSets ?? ""}
                onPhaseSetsChange={v => set("oppStageSets", v)}
                onSaveSection={overrides => void save("projects", overrides as Partial<OnboardingDefaults> | undefined)}
                onSaveSetsOnly={fields => void saveFields(fields as Partial<OnboardingDefaults>)}
                phasesFieldKey="defaultOpportunityStages"
                setsFieldKey="oppStageSets"
                saving={savingSection === "projects"}
                tenantId={superadmin ? (scope === "client" && clientName.trim() ? clientName.trim() : null) : undefined}
                suggestions={["Pending Assignment", "Proposal Development", "Contract Negotiations", "Awarded", "Lost", "On Hold", "Cancelled"]}
                itemNoun="schedule"
                setNoun="schedule set"
                colored={false}
                importedScope="opp"
                onAddExceptionReady={fn => setAddExceptionFn(() => fn)}
                onSavedSchedulesPopupReady={fn => setSavedSchedulesFn(() => fn)}
                onMakeDefaultReady={fn => setMakeDefaultFn(() => fn)}
                onSetRules={(name, list, colors) => setRuleTarget({ mod: "OPM", stage: name, order: list, phaseColor: colors[name] ?? null })}
                ruleCountOf={ruleCountFn ? (n => ruleCountFn("OPM", n)) : undefined}
                onColorChangeReady={onColorChangeReadyOPM}
                lifecycleTemplates={oppLifecycles}
                onDeleteTemplate={async (id, name) => {
                  try {
                    await deleteLifecycle(id);
                    // Optimistic update — remove instantly from both lists.
                    setProjLifecycles(prev => prev.filter(t => t.id !== id));
                    setOppLifecycles(prev => prev.filter(t => t.id !== id));
                    // Bump version → re-fetch from DB so the lists are authoritative.
                    setLcVersion(v => v + 1);
                  } catch (e) {
                    alert(`Failed to delete "${name}": ${(e as Error).message ?? String(e)}`);
                  }
                }}
              />
            </Field>
          </div>
        );
      }
      case "staff-calendar":
        return (
          <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
            {renderSettingCard(
              "nonWorkingDays",
              "Non-working days",
              "Selected days are treated as off in the weekly hours grid — shown as a dot in column headers and marked OFF in the week-detail popup. Saturday and Sunday are off by default.",
              (() => {
                const nwd: number[] = (form.nonWorkingDays as number[] | undefined) ?? [0, 6];
                const DAYS = [
                  { idx: 1, short: "Mon", letter: "M" },
                  { idx: 2, short: "Tue", letter: "T" },
                  { idx: 3, short: "Wed", letter: "W" },
                  { idx: 4, short: "Thu", letter: "T" },
                  { idx: 5, short: "Fri", letter: "F" },
                  { idx: 6, short: "Sat", letter: "S" },
                  { idx: 0, short: "Sun", letter: "S" },
                ];
                const offCount = nwd.length;
                return (
                  <div style={{ marginTop: 10 }}>
                    {/* Week strip */}
                    <div style={{ display: "flex", gap: 6 }}>
                      {DAYS.map(({ idx, short, letter }) => {
                        const isOff = nwd.includes(idx);
                        const isWeekend = idx === 0 || idx === 6;
                        return (
                          <button
                            key={idx}
                            type="button"
                            title={isOff ? `${short}: non-working — click to mark as working` : `${short}: working — click to mark as non-working`}
                            onClick={() => {
                              setForm(prev => {
                                if (!prev) return prev;
                                const cur: number[] = (prev.nonWorkingDays as number[] | undefined) ?? [0, 6];
                                const next = isOff ? cur.filter(d => d !== idx) : [...cur, idx].sort((a, b) => a - b);
                                return { ...prev, nonWorkingDays: next };
                              });
                            }}
                            style={{
                              display: "flex",
                              flexDirection: "column",
                              alignItems: "center",
                              gap: 4,
                              background: "none",
                              border: "none",
                              padding: 0,
                              cursor: "pointer",
                              flexShrink: 0,
                            }}
                          >
                            {/* Circle */}
                            <div style={{
                              width: 40,
                              height: 40,
                              borderRadius: "50%",
                              display: "flex",
                              alignItems: "center",
                              justifyContent: "center",
                              fontSize: 15,
                              fontWeight: 700,
                              background: isOff ? "rgba(220,38,38,0.08)" : "transparent",
                              border: isOff
                                ? "2px solid rgba(220,38,38,0.5)"
                                : isWeekend
                                  ? "2px solid var(--border)"
                                  : "2px solid rgba(22,163,74,0.35)",
                              color: isOff
                                ? "#dc2626"
                                : isWeekend
                                  ? "var(--muted-foreground)"
                                  : "#16a34a",
                              boxShadow: isOff ? "0 0 0 3px rgba(220,38,38,0.07)" : "none",
                            }}>
                              {letter}
                            </div>
                            {/* Label */}
                            <span style={{
                              fontSize: 10,
                              fontWeight: 600,
                              letterSpacing: 0.3,
                              color: isOff ? "#dc2626" : "var(--muted-foreground)",
                              textTransform: "uppercase",
                            }}>
                              {short}
                            </span>
                            {/* Off indicator */}
                            <span style={{
                              fontSize: 9,
                              fontWeight: 700,
                              color: isOff ? "#dc2626" : "transparent",
                              letterSpacing: 0.5,
                              height: 12,
                              display: "block",
                            }}>
                              OFF
                            </span>
                          </button>
                        );
                      })}
                    </div>
                    {/* Summary line */}
                    <p style={{ fontSize: 11, color: "var(--muted-foreground)", marginTop: 8 }}>
                      {offCount === 0
                        ? "All days are working days."
                        : offCount === 7
                          ? "All days are marked as non-working."
                          : `${offCount} non-working ${offCount === 1 ? "day" : "days"} selected — ${DAYS.filter(d => nwd.includes(d.idx)).map(d => d.short).join(", ")}.`}
                    </p>
                  </div>
                );
              })(),
            )}
            {renderSettingCard(
              "workWeekHours",
              "Hours per week",
              "The hours that count as 100% allocation (used to convert hours ↔ %). After saving a new value, use 'Apply to existing allocations' to rescale people already assigned full-time — manually edited weeks are left untouched.",
              <div className="flex items-center gap-2">
                <Input type="number" min={1} max={168} value={form.workWeekHours}
                  onChange={e => set("workWeekHours", Number(e.target.value))} />
                <Button type="button" variant="outline" size="sm" onClick={reapplyHours} disabled={reapplying || saving}
                  className="whitespace-nowrap">
                  {reapplying ? <Loader2 className="w-3.5 h-3.5 mr-1 animate-spin" /> : null}
                  Apply to existing allocations
                </Button>
              </div>,
            )}
            {renderSettingCard(
              "holidayDates",
              "Company holidays",
              "Add specific dates (like national holidays) that count as non-working days. They show up as amber markers in the weekly hours grid headers.",
              (() => {
              // Entries are "YYYY-MM-DD" or "YYYY-MM-DD|Label".
              const list: string[] = (form.holidayDates as string[] | undefined) ?? [];
              const parseEntry = (e: string) => {
                const [date, ...rest] = e.split("|");
                return { date, label: rest.join("|") };
              };
              const fmt = (iso: string) => {
                const [y, m, d] = iso.split("-").map(Number);
                const dt = new Date(y, m - 1, d);
                return Number.isNaN(dt.getTime()) ? iso
                  : dt.toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" });
              };
              const sorted = [...list].sort();
              return (
                <div style={{ marginTop: 8, display: "flex", flexDirection: "column", gap: 10 }}>
                  <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
                    <Input type="date" value={holidayDraftDate}
                      onChange={e => setHolidayDraftDate(e.target.value)}
                      style={{ width: 170 }} />
                    <Input placeholder="Name (optional, e.g. Independence Day)" value={holidayDraftLabel}
                      onChange={e => setHolidayDraftLabel(e.target.value)}
                      style={{ width: 260 }} maxLength={80} />
                    <Button type="button" variant="outline" size="sm"
                      disabled={!/^\d{4}-\d{2}-\d{2}$/.test(holidayDraftDate)}
                      onClick={() => {
                        const d = holidayDraftDate;
                        const label = holidayDraftLabel.trim();
                        setForm(prev => {
                          if (!prev) return prev;
                          const cur: string[] = (prev.holidayDates as string[] | undefined) ?? [];
                          const next = cur.filter(e => e.split("|")[0] !== d);
                          next.push(label ? `${d}|${label}` : d);
                          return { ...prev, holidayDates: next.sort() };
                        });
                        setHolidayDraftDate(""); setHolidayDraftLabel("");
                      }}>
                      Add holiday
                    </Button>
                  </div>
                  {sorted.length === 0 ? (
                    <p style={{ fontSize: 12, color: "var(--muted-foreground)" }}>
                      No holidays added yet. Weekends are handled separately under Working Week.
                    </p>
                  ) : (
                    <div style={{ display: "flex", flexDirection: "column", gap: 4, maxHeight: 260, overflowY: "auto" }}>
                      {sorted.map(entry => {
                        const { date, label } = parseEntry(entry);
                        return (
                          <div key={entry} style={{
                            display: "flex", alignItems: "center", gap: 8,
                            border: "1px solid hsl(var(--border))", borderRadius: 8,
                            padding: "6px 10px", fontSize: 12.5,
                          }}>
                            <CalendarDays size={13} style={{ color: "#f59e0b", flexShrink: 0 }} />
                            <span style={{ fontWeight: 600 }}>{fmt(date)}</span>
                            {label && <span style={{ color: "var(--muted-foreground)" }}>{label}</span>}
                            <button type="button" title="Remove"
                              onClick={() => setForm(prev => {
                                if (!prev) return prev;
                                const cur: string[] = (prev.holidayDates as string[] | undefined) ?? [];
                                return { ...prev, holidayDates: cur.filter(e => e !== entry) };
                              })}
                              style={{ marginLeft: "auto", background: "none", border: "none", cursor: "pointer", color: "var(--muted-foreground)", padding: 2 }}>
                              <X size={13} />
                            </button>
                          </div>
                        );
                      })}
                      <p style={{ fontSize: 11, color: "var(--muted-foreground)", marginTop: 2 }}>
                        {sorted.length} holiday{sorted.length === 1 ? "" : "s"} — remember to press Save below.
                      </p>
                    </div>
                  )}
                </div>
              );
            })(),
            )}
          </div>
        );
      case "staff-util":
        return (
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 items-stretch">
            <Field overriddenKeys={overriddenKeys} keyName="overCapacityPct" label="Over-capacity flag (%)"
              hint={<>Above this, a person is flagged red (over-allocated) on <Link href="/resources?view=Staff" style={{ color: "#22c55e", textDecoration: "underline" }}>Resources → Staff</Link>.</>}>
              <Input type="number" min={100} max={300} value={form.overCapacityPct}
                onChange={e => set("overCapacityPct", Number(e.target.value))} />
            </Field>
            <Field overriddenKeys={overriddenKeys} keyName="targetUtilizationPct" label="Optimal band start (%)"
              hint={<>Where the green 'Optimal' band begins on <Link href="/resources?view=Staff" style={{ color: "#22c55e", textDecoration: "underline" }}>Resources → Staff</Link>. Also the sweet spot the home health score aims for.</>}>
              <Input type="number" min={1} max={100} value={form.targetUtilizationPct}
                onChange={e => set("targetUtilizationPct", Number(e.target.value))} />
            </Field>
            <Field overriddenKeys={overriddenKeys} keyName="underAllocatedPct" label="Under-allocated flag (%)"
              hint={<>At or below this (and above 0%), a person is flagged amber on <Link href="/resources?view=Staff" style={{ color: "#22c55e", textDecoration: "underline" }}>Resources → Staff</Link>.</>}>
              <Input type="number" min={1} max={99} value={form.underAllocatedPct}
                onChange={e => set("underAllocatedPct", Number(e.target.value))} />
            </Field>
            {/* Demand & Risk — merged into this tab (was its own "staff-risk" tab). */}
            <Field overriddenKeys={overriddenKeys} keyName="concentrationPct" label="Concentration risk threshold (%)"
              hint={<>If a person is on a single project at more than this % of their time, a 'Concentration risk' chip shows on their card in <Link href="/resources?view=Staff" style={{ color: "#22c55e", textDecoration: "underline" }}>Resources → Staff</Link>.</>}>
              <Input type="number" min={1} max={100} value={form.concentrationPct}
                onChange={e => set("concentrationPct", Number(e.target.value))} />
            </Field>
            <Field overriddenKeys={overriddenKeys} keyName="demandUrgencyDays" label="Demand urgency window (days)"
              hint={<>If an unfilled role starts within this many days, an 'URGENT' tag shows on its card in <Link href="/resources?view=Demand" style={{ color: "#22c55e", textDecoration: "underline" }}>Resources → Demand</Link>. Roles that have already started (past their start date) are always shown as urgent.</>}>
              <Input type="number" min={1} max={3650} value={form.demandUrgencyDays}
                onChange={e => set("demandUrgencyDays", Number(e.target.value))} />
            </Field>
          </div>
        );
      case "staff-colors": {
        const EMP_COLOR_ROWS: { key: keyof OnboardingDefaults; label: string }[] = [
          { key: "empColorPartTime",       label: "Part-Time" },
          { key: "empColorAsNeeded",       label: "As Needed" },
          { key: "empColorScaContingency", label: "SCA Contingency Staff" },
          { key: "empColorTemporary",      label: "Temporary" },
          { key: "empColorFullTime",       label: "Full-Time" },
        ];
        return (
          <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
            <p style={{ fontSize: 12, color: "hsl(var(--muted-foreground))", margin: 0, lineHeight: 1.55 }}>
              Staff names are shown in these colors wherever people appear — team lists,
              schedules, staff pages and pickers — so employment type is visible at a glance.
              Types set to "No color" display in the normal text color.
            </p>
            {EMP_COLOR_ROWS.map(({ key, label }) => {
              const val = String(form[key] ?? "");
              const builtinVal = String((resp?.builtin as any)?.[key] ?? "");
              const hasColor = /^#[0-9a-fA-F]{6}$/.test(val);
              return (
                <div key={key} style={{
                  display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap",
                  borderRadius: 10, border: "1px solid hsl(var(--border))",
                  background: "hsl(var(--muted) / 0.2)", padding: "10px 14px",
                }}>
                  {/* Live preview: a sample name rendered exactly as it will appear */}
                  <span style={{
                    fontSize: 13, fontWeight: 600, minWidth: 130,
                    color: hasColor ? val : "hsl(var(--foreground))",
                  }}>
                    Jordan Sample
                  </span>
                  <span style={{ fontSize: 12.5, color: "hsl(var(--muted-foreground))", flex: 1, minWidth: 120 }}>
                    {label}
                    {overriddenKeys.has(key as string) && (
                      <span style={{
                        marginLeft: 8, fontSize: 9, textTransform: "uppercase", letterSpacing: 0.5,
                        borderRadius: 4, padding: "1px 5px",
                        background: "hsl(var(--primary) / 0.1)", color: "hsl(var(--primary))",
                        border: "1px solid hsl(var(--primary) / 0.2)",
                      }}>customized</span>
                    )}
                  </span>
                  <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                    <label
                      title={hasColor ? `Change the ${label} color` : `Give ${label} a color`}
                      style={{
                        position: "relative", width: 30, height: 30, borderRadius: 8,
                        border: hasColor ? "1px solid hsl(var(--border))" : "1.5px dashed hsl(var(--muted-foreground) / 0.5)",
                        background: hasColor ? val : "transparent",
                        cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center",
                        overflow: "hidden", flexShrink: 0,
                      }}
                    >
                      {!hasColor && <span style={{ fontSize: 14, color: "hsl(var(--muted-foreground))", lineHeight: 1 }}>+</span>}
                      <input
                        type="color"
                        value={hasColor ? val : "#94A3B8"}
                        onChange={e => set(key, e.target.value.toUpperCase() as any)}
                        style={{ position: "absolute", inset: 0, opacity: 0, cursor: "pointer", width: "100%", height: "100%" }}
                      />
                    </label>
                    <span style={{ fontSize: 11.5, fontFamily: "monospace", color: "hsl(var(--muted-foreground))", minWidth: 62 }}>
                      {hasColor ? val : "No color"}
                    </span>
                    {hasColor && (
                      <button type="button" onClick={() => set(key, "" as any)}
                        title="Remove the color — show this type in the normal text color"
                        style={{
                          fontSize: 11, padding: "3px 8px", borderRadius: 6, cursor: "pointer",
                          border: "1px solid hsl(var(--border))", background: "transparent",
                          color: "hsl(var(--muted-foreground))",
                        }}>
                        No color
                      </button>
                    )}
                    {val !== builtinVal && (
                      <button type="button" onClick={() => set(key, builtinVal as any)}
                        title="Reset to the built-in default"
                        style={{
                          fontSize: 11, padding: "3px 8px", borderRadius: 6, cursor: "pointer",
                          border: "1px solid hsl(var(--border))", background: "transparent",
                          color: "hsl(var(--muted-foreground))", display: "inline-flex", alignItems: "center", gap: 4,
                        }}>
                        <RotateCcw style={{ width: 10, height: 10 }} /> Default
                      </button>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        );
      }
      case "forecast-main":
        return (
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 items-stretch">
            <Field overriddenKeys={overriddenKeys} keyName="forecastWeeks" label="Forecast window (weeks)"
              hint={<>How many weeks ahead the <Link href="/forecast" style={{ color: "#22c55e", textDecoration: "underline" }}>Forecast</Link> page looks at demand vs. capacity.</>}>
              <Input type="number" min={1} max={52} value={form.forecastWeeks}
                onChange={e => set("forecastWeeks", Number(e.target.value))} />
            </Field>
            <Field overriddenKeys={overriddenKeys} keyName="proposalCoveragePct" label="Pipeline coverage target (%)"
              hint={<>Healthy pipeline = at least this % of the active project portfolio value. See <Link href="/forecast" style={{ color: "#22c55e", textDecoration: "underline" }}>Forecast</Link>.</>}>
              <Input type="number" min={1} max={500} value={form.proposalCoveragePct}
                onChange={e => set("proposalCoveragePct", Number(e.target.value))} />
            </Field>
            <div style={{ gridColumn: "1 / -1" }}>
              <Field overriddenKeys={overriddenKeys} keyName="useImportedActuals" label="Actuals source (Actuals vs Forecast)"
                hint={<>Used by the <Link href="/actuals-forecast" style={{ color: "#22c55e", textDecoration: "underline" }}>Actuals vs Forecast</Link> graphs
                  and reports. Substituted values are always flagged on those pages — planned hours are never mixed in silently.</>}>
                <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
                  <label style={{ display: "flex", alignItems: "flex-start", gap: 9, fontSize: 13, cursor: "pointer" }}>
                    <input type="checkbox" checked={form.useImportedActuals !== false}
                      onChange={e => set("useImportedActuals", e.target.checked)} style={{ marginTop: 2 }} />
                    <span>
                      <b>Use imported actuals</b><br />
                      <span style={{ color: "hsl(var(--muted-foreground))", fontSize: 12 }}>
                        Count only actual hours brought in through the Actuals import (recommended).
                      </span>
                    </span>
                  </label>
                  <label style={{ display: "flex", alignItems: "flex-start", gap: 9, fontSize: 13, cursor: "pointer" }}>
                    <input type="checkbox" checked={form.usePlannedAsActualFallback === true}
                      onChange={e => set("usePlannedAsActualFallback", e.target.checked)} style={{ marginTop: 2 }} />
                    <span>
                      <b>Substitute planned hours as actuals when imports are turned off</b><br />
                      <span style={{ color: "hsl(var(--muted-foreground))", fontSize: 12 }}>
                        Only applies while “Use imported actuals” is unchecked; every substituted value is flagged.
                      </span>
                    </span>
                  </label>
                </div>
              </Field>
            </div>
          </div>
        );
      default:
        return null;
    }
  };

  const catHeader = (cat: (typeof CATS)[number], count: number) => {
    const Icon = cat.icon;
    return (
      <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 16 }}>
        <div style={{ width: 36, height: 36, borderRadius: 10, background: `${cat.color}15`, display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
          <Icon style={{ width: 18, height: 18, color: cat.color }} />
        </div>
        <div>
          <h2 style={{ fontSize: 16, fontWeight: 700, margin: 0, color: "hsl(var(--foreground))" }}>{cat.label}</h2>
          <div style={{ fontSize: 11, color: "hsl(var(--muted-foreground))" }}>{count} section{count === 1 ? "" : "s"}</div>
        </div>
        <div style={{ flex: 1, height: 1, background: `${cat.color}20`, marginLeft: 8 }} />
      </div>
    );
  };

  const subList = (subs: typeof SUBS, color: string) => (
    <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
      {subs.map(sub => (
        <AccordionSection
          key={sub.id}
          title={sub.title}
          desc={sub.desc}
          color={color}
          open={openSub === sub.id}
          onToggle={() => setOpenSub(prev => (prev === sub.id ? null : sub.id))}
          footer={saveFooter(sub.cat, color)}
        >
          {renderSub(sub.id)}
        </AccordionSection>
      ))}
    </div>
  );

  // ── Hub building blocks ──────────────────────────────────────────────────
  if (!superadmin && canManageSettings !== true) {
    return (
      <div className="min-h-[55vh] flex flex-col items-center justify-center gap-3 px-6 text-center">
        {canManageSettings === null ? (
          <><Loader2 className="w-5 h-5 animate-spin text-muted-foreground" /><p className="text-sm text-muted-foreground">Checking settings access…</p></>
        ) : (
          <>
            <AlertTriangle className="w-6 h-6 text-amber-600" />
            <h1 className="text-lg font-semibold">Company settings are not available</h1>
            <p className="text-sm text-muted-foreground max-w-md">Your access level does not include Company settings. Ask an administrator if you need to change company-wide rules.</p>
            <Button variant="outline" size="sm" onClick={() => navigate("/")}>Back to home</Button>
          </>
        )}
      </div>
    );
  }
  const currentCard = activeCat === "hub" ? null : SETTINGS_CARDS.find(c => c.id === activeCat) ?? null;

  // Breadcrumb bar shown at the top of every settings area — the way back to
  // the All-Settings card grid (the old sidebar is gone).
  const backBar = (
    <div style={{
      position: "sticky", top: 0, zIndex: 5, padding: "10px 24px",
      borderBottom: "1px solid hsl(var(--border))", display: "flex", alignItems: "center",
      gap: 10, flexShrink: 0, background: "hsl(var(--card))",
    }}>
      <button
        type="button"
        onClick={() => { setActiveCat("hub"); setSearch(""); }}
        style={{
          display: "flex", alignItems: "center", gap: 6, padding: "6px 12px", borderRadius: 8,
          border: "1px solid hsl(var(--border))", background: "hsl(var(--background))",
          cursor: "pointer", fontSize: 12.5, fontWeight: 600, color: "hsl(var(--foreground))",
        }}
      >
        <ArrowLeft style={{ width: 14, height: 14 }} /> All Settings
      </button>
      {currentCard && (
        <>
          <ChevronRight style={{ width: 13, height: 13, color: "hsl(var(--muted-foreground))" }} />
          <span style={{ fontSize: 13, fontWeight: 600, color: "hsl(var(--foreground))" }}>{currentCard.title}</span>
        </>
      )}
      <div style={{ flex: 1 }} />
      <span style={{ fontSize: 11, color: "hsl(var(--muted-foreground))", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
        {scope === "global" ? "Global defaults" : (clientName.trim() || user?.tenant || "Your company")}
      </span>
    </div>
  );

  const statChip = (icon: React.ReactNode, big: string, sub: string, hex: string) => (
    <div style={{
      display: "flex", alignItems: "center", gap: 12, padding: "14px 16px",
      background: "hsl(var(--card))", border: "1px solid hsl(var(--border))", borderRadius: 12,
    }}>
      <div style={{
        width: 36, height: 36, borderRadius: 10, background: `${hex}18`, color: hex,
        display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0,
      }}>
        {icon}
      </div>
      <div style={{ minWidth: 0 }}>
        <div style={{ fontSize: 16, fontWeight: 800, color: "hsl(var(--foreground))", lineHeight: 1.1 }}>{big}</div>
        <div style={{ fontSize: 11, color: "hsl(var(--muted-foreground))", marginTop: 2 }}>{sub}</div>
      </div>
    </div>
  );

  return (
    <div style={{ display: "flex", height: embedded ? "100%" : "100vh", overflow: "hidden", background: "hsl(var(--background))" }}>

      {/* ── All-Settings hub: card grid (replaces the old sidebar) ────────── */}
      {activeCat === "hub" && (
        <main style={{ flex: 1, overflowY: "auto", minWidth: 0 }}>
          <ModuleHeader
            title="Settings"
            section="Company configuration"
            context={scope === "global" ? "Global defaults" : (clientName.trim() || user?.tenant || "Your company")}
            icon={Settings2}
            backTo={!embedded ? { href: "/onboarding", label: "Back" } : undefined}
            sticky
            actions={
              <div style={{ position: "relative", width: 280, maxWidth: "70vw" }}>
              <SearchIcon style={{ position: "absolute", left: 11, top: "50%", transform: "translateY(-50%)", width: 14, height: 14, color: "hsl(var(--muted-foreground))" }} />
              <input
                value={search}
                onChange={e => setSearch(e.target.value)}
                placeholder="Search settings…"
                style={{
                  width: "100%", padding: "9px 12px 9px 32px", border: "1px solid hsl(var(--border))",
                  borderRadius: 10, fontSize: 13, background: "hsl(var(--card))",
                  color: "hsl(var(--foreground))", boxSizing: "border-box", outline: "none",
                }}
              />
              </div>
            }
          />

          <div style={{ padding: "16px 28px 60px", maxWidth: 1280, margin: "0 auto", boxSizing: "border-box" }}>
            {/* Superadmin scope selector — choose global vs a specific client */}
            {superadmin && (
              <Card className="mt-6">
                <CardHeader className="pb-3">
                  <CardTitle className="text-base">Who do these apply to?</CardTitle>
                  <CardDescription>
                    Global defaults are the starting point for every client. You can then tune the
                    defaults for one specific client — anything you don't change keeps following the global value.
                  </CardDescription>
                </CardHeader>
                <CardContent className="space-y-3">
                  <div className="flex flex-wrap gap-2">
                    <Button
                      variant={scope === "global" ? "default" : "outline"}
                      size="sm"
                      onClick={() => setScope("global")}
                    >
                      <Globe className="w-4 h-4 mr-1.5" /> Global defaults
                    </Button>
                    <Button
                      variant={scope === "client" ? "default" : "outline"}
                      size="sm"
                      onClick={() => setScope("client")}
                    >
                      <Building2 className="w-4 h-4 mr-1.5" /> A specific client
                    </Button>
                  </div>
                  {scope === "client" && (
                    <div className="space-y-1.5">
                      <Label className="text-sm">Client</Label>
                      {clients.length > 0 ? (
                        <Select value={clientName} onValueChange={setClientName}>
                          <SelectTrigger className="w-full sm:w-80">
                            <SelectValue placeholder="Choose a client…" />
                          </SelectTrigger>
                          <SelectContent>
                            {clients.map(c => <SelectItem key={c} value={c}>{c}</SelectItem>)}
                          </SelectContent>
                        </Select>
                      ) : (
                        <Input
                          className="w-full sm:w-80"
                          placeholder="Type a client (company) name…"
                          value={clientName}
                          onChange={e => setClientName(e.target.value)}
                        />
                      )}
                      {clientName.trim() && (
                        <p className="text-xs text-muted-foreground">
                          Saving these defaults also fills blanks on records already in the system
                          (currently the default Job Title for people who have none). Never overwrites
                          real values; every change is logged in the assumptions review. Use
                          "Reset to defaults" next to the All Settings heading to clear this client's overrides.
                        </p>
                      )}
                    </div>
                  )}
                </CardContent>
              </Card>
            )}

            {/* Superadmin picked "a specific client" but hasn't chosen one yet */}
            {superadmin && scope === "client" && !clientName.trim() ? (
              <Card className="mt-5"><CardContent className="py-10 text-center text-sm text-muted-foreground">
                Choose a client above to view or customize their settings.
              </CardContent></Card>
            ) : (
              <>
                {/* Card grid */}
                <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 20, marginTop: 16 }}>
                  {visibleCards.map(card => {
                    const c = RM_BRAND[card.color];
                    const Icon = card.icon;
                    const stat = cardStat(card.id);
                    const customized = cardCustomized(card.id);
                    const isDragging = dragCardId === card.id;
                    const isDropTarget = dropCardId === card.id && dragCardId !== card.id;
                    return (
                      <div
                        key={card.id}
                        role="button"
                        tabIndex={0}
                        draggable
                        onClick={() => openCard(card.id)}
                        onKeyDown={e => {
                          if (e.target !== e.currentTarget) return;
                          if (e.key === "Enter" || e.key === " ") { e.preventDefault(); openCard(card.id); }
                        }}
                        onDragStart={e => {
                          dragCardRef.current = card.id;
                          setDragCardId(card.id);
                          e.dataTransfer.effectAllowed = "move";
                          // Slight delay so the ghost image captures normal opacity first.
                          setTimeout(() => {}, 0);
                        }}
                        onDragEnd={() => {
                          dragCardRef.current = null;
                          setDragCardId(null);
                          setDropCardId(null);
                        }}
                        onDragOver={e => {
                          e.preventDefault();
                          e.dataTransfer.dropEffect = "move";
                          if (dragCardRef.current && dragCardRef.current !== card.id) {
                            setDropCardId(card.id);
                          }
                        }}
                        onDragLeave={() => setDropCardId(prev => prev === card.id ? null : prev)}
                        onDrop={e => {
                          e.preventDefault();
                          const from = dragCardRef.current;
                          if (!from || from === card.id) return;
                          setHubCardOrder(prev => {
                            const arr = [...prev];
                            const fi = arr.indexOf(from);
                            const ti = arr.indexOf(card.id);
                            if (fi === -1 || ti === -1) return prev;
                            arr.splice(fi, 1);
                            arr.splice(ti, 0, from);
                            try { localStorage.setItem("settings:hubCardOrder", JSON.stringify(arr)); } catch {}
                            return arr;
                          });
                          setDragCardId(null);
                          setDropCardId(null);
                          dragCardRef.current = null;
                        }}
                        onMouseEnter={e => {
                          if (dragCardId) return;
                          e.currentTarget.style.boxShadow = "0 8px 22px rgba(16,24,40,0.13)";
                          e.currentTarget.style.transform = "translateY(-2px)";
                        }}
                        onMouseLeave={e => {
                          e.currentTarget.style.boxShadow = isDropTarget
                            ? "0 0 0 2px hsl(var(--primary))"
                            : "0 1px 2px rgba(16,24,40,0.05)";
                          e.currentTarget.style.transform = "none";
                        }}
                        style={{
                          background: "hsl(var(--card))",
                          border: isDropTarget ? "2px dashed hsl(var(--primary))" : "1px solid hsl(var(--border))",
                          borderRadius: 14, overflow: "hidden", cursor: "grab",
                          display: "flex", flexDirection: "column",
                          boxShadow: isDropTarget ? "0 0 0 2px hsl(var(--primary) / 0.15)" : "0 1px 2px rgba(16,24,40,0.05)",
                          transition: "box-shadow .15s ease, transform .15s ease, opacity .15s ease, border-color .15s ease",
                          outline: "none",
                          opacity: isDragging ? 0.45 : 1,
                        }}
                      >
                        {/* Colored header band — RM ONE brand color + diagonal texture */}
                        <div style={{
                          position: "relative", background: c.hex,
                          backgroundImage: "repeating-linear-gradient(135deg, rgba(255,255,255,0.08) 0px, rgba(255,255,255,0.08) 2px, transparent 2px, transparent 11px)",
                          padding: "14px 16px", display: "flex", alignItems: "flex-start",
                          justifyContent: "space-between", gap: 10, minHeight: 84, boxSizing: "border-box",
                        }}>
                          {/* Drag handle — top-left corner of the header */}
                          <div
                            title="Drag to reorder"
                            onMouseDown={e => e.stopPropagation()}
                            onClick={e => e.stopPropagation()}
                            style={{
                              position: "absolute", top: 7, left: 7,
                              width: 22, height: 22, borderRadius: 5,
                              display: "flex", alignItems: "center", justifyContent: "center",
                              background: "rgba(255,255,255,0.18)",
                              cursor: "grab", flexShrink: 0, zIndex: 2,
                            }}
                          >
                            <GripVertical style={{ width: 13, height: 13, color: "rgba(255,255,255,0.85)" }} />
                          </div>
                          <div style={{ display: "flex", alignItems: "center", gap: 10, minWidth: 0, paddingLeft: 20 }}>
                            <div style={{
                              width: 44, height: 44, borderRadius: 12, background: "rgba(255,255,255,0.95)",
                              display: "flex", alignItems: "center", justifyContent: "center",
                              boxShadow: "0 2px 6px rgba(0,0,0,0.18)", flexShrink: 0, position: "relative",
                            }}>
                              <Icon style={{ width: 20, height: 20, color: c.hex }} />
                              {customized && (
                                <span style={{
                                  position: "absolute", left: -6, bottom: -6, width: 18, height: 18, borderRadius: 9,
                                  background: "#fff", display: "flex", alignItems: "center", justifyContent: "center",
                                  boxShadow: "0 1px 4px rgba(0,0,0,0.25)",
                                }}>
                                  <CheckCircle2 style={{ width: 13, height: 13, color: "#16a34a" }} />
                                </span>
                              )}
                            </div>
                            <span style={{ fontSize: 11, fontWeight: 700, color: "rgba(255,255,255,0.95)", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                              {card.title}
                            </span>
                          </div>
                          <div style={{ textAlign: "right", color: "#fff", flexShrink: 0 }}>
                            <div style={{ fontSize: 18, fontWeight: 800, lineHeight: 1 }}>{stat.big}</div>
                            <div style={{ fontSize: 10, color: "rgba(255,255,255,0.78)", marginTop: 3 }}>{stat.sub}</div>
                          </div>
                        </div>

                        {/* Body */}
                        <div style={{ padding: "14px 16px", display: "flex", flexDirection: "column", flex: 1 }}>
                          <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
                            <h3 style={{ fontSize: 15, fontWeight: 700, margin: 0, color: "hsl(var(--foreground))" }}>{card.title}</h3>
                            {customized && (
                              <span style={{
                                fontSize: 10.5, fontWeight: 600, padding: "2px 8px", borderRadius: 999,
                                background: "#16a34a15", color: "#16a34a", border: "1px solid #16a34a30",
                                display: "inline-flex", alignItems: "center", gap: 4,
                              }}>
                                <CheckCircle2 style={{ width: 11, height: 11 }} /> Customized
                              </span>
                            )}
                          </div>
                          {/* minHeight = 2 lines so the link lists start at the same
                              height on every card in a row, even when the description
                              wraps differently */}
                          <p style={{ fontSize: 12.5, color: "hsl(var(--muted-foreground))", margin: "6px 0 0", lineHeight: 1.45, minHeight: 37 }}>{card.desc}</p>
                          {/* Clickable section links — each is its own bordered row */}
                          {(() => {
                            const BULLET_LIMIT = 3;
                            const shown = card.bullets.slice(0, BULLET_LIMIT);
                            const hiddenCount = card.bullets.length - shown.length;
                            return (
                              <div style={{
                                border: "1px solid hsl(var(--border))", borderRadius: 8,
                                overflow: "hidden", marginTop: 14,
                              }}>
                                {shown.map((b, bi) => (
                                  <button
                                    key={b.label}
                                    type="button"
                                    onClick={e => { e.stopPropagation(); openCard(card.id, b.sub); }}
                                    onMouseEnter={e => {
                                      e.currentTarget.style.background = `${c.hex}12`;
                                      const arr = e.currentTarget.querySelector<HTMLElement>(".ba");
                                      if (arr) arr.style.transform = "translateX(3px)";
                                    }}
                                    onMouseLeave={e => {
                                      e.currentTarget.style.background = "transparent";
                                      const arr = e.currentTarget.querySelector<HTMLElement>(".ba");
                                      if (arr) arr.style.transform = "translateX(0)";
                                    }}
                                    style={{
                                      display: "flex", alignItems: "center",
                                      justifyContent: "space-between",
                                      width: "100%", textAlign: "left",
                                      background: "transparent",
                                      border: "none",
                                      borderTop: bi > 0 ? "1px solid hsl(var(--border))" : "none",
                                      padding: "9px 12px", cursor: "pointer",
                                      transition: "background .12s",
                                    }}
                                  >
                                    <div style={{ display: "flex", alignItems: "center", gap: 8, minWidth: 0 }}>
                                      <span style={{
                                        width: 6, height: 6, borderRadius: "50%",
                                        background: c.bodyVar, flexShrink: 0,
                                      }} />
                                      <span style={{
                                        fontSize: 12.5, fontWeight: 600,
                                        color: c.bodyVar,
                                        overflow: "hidden", textOverflow: "ellipsis",
                                        whiteSpace: "nowrap",
                                      }}>{b.label}</span>
                                    </div>
                                    <ChevronRight className="ba" style={{
                                      width: 13, height: 13, color: c.bodyVar,
                                      flexShrink: 0, transition: "transform .12s",
                                    }} />
                                  </button>
                                ))}
                                {hiddenCount > 0 && (
                                  <div style={{
                                    borderTop: "1px solid hsl(var(--border))",
                                    padding: "7px 12px",
                                    fontSize: 11.5, color: "hsl(var(--muted-foreground))",
                                    fontWeight: 500, letterSpacing: "0.01em",
                                  }}>
                                    ··· {hiddenCount} more section{hiddenCount !== 1 ? "s" : ""}
                                  </div>
                                )}
                              </div>
                            );
                          })()}
                          <div style={{ marginTop: "auto", paddingTop: 14, fontSize: 12.5, fontWeight: 700, color: c.bodyVar, display: "flex", alignItems: "center", gap: 3 }}>
                            Configure <ChevronRight style={{ width: 13, height: 13 }} />
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
                {visibleCards.length === 0 && (
                  <div style={{ padding: "48px 0", textAlign: "center", color: "hsl(var(--muted-foreground))", fontSize: 13 }}>
                    No settings match "{search.trim()}". Try a different word, or clear the search.
                  </div>
                )}
              </>
            )}
          </div>
        </main>
      )}

      {/* ── Organization view — full-height, no padding wrapper ── */}
      {activeCat === "org" && (
        <main style={{ flex: 1, overflow: "hidden", minWidth: 0, display: "flex", flexDirection: "column" }}>
          {backBar}
          <div style={{ flex: 1, overflow: "hidden" }}>
            <Suspense fallback={<div className="flex items-center justify-center py-20"><Loader2 className="w-6 h-6 animate-spin text-muted-foreground" /></div>}>
              <ManageOrganizationPage
                embedded
                tenantId={superadmin ? (scope === "client" && clientName.trim() ? clientName.trim() : null) : undefined}
              />
              {/* Offices live on their own /offices page, but a superadmin
                  managing a CLIENT has no other client-scoped surface, so
                  embed the offices manager here in that context only. */}
              {superadmin && scope === "client" && clientName.trim() && (
                <div style={{ padding: "0 24px 24px" }}>
                  <OfficesPage embedded tenantId={clientName.trim()} />
                </div>
              )}
            </Suspense>
          </div>
        </main>
      )}

      {/* ── Billing Rates view — scrollable, embedded ── */}
      {activeCat === "billing" && (
        <main style={{ flex: 1, overflowY: "auto", minWidth: 0 }}>
          {backBar}
          <Suspense fallback={<div className="flex items-center justify-center py-20"><Loader2 className="w-6 h-6 animate-spin text-muted-foreground" /></div>}>
            <BillingRatesPage embedded />
          </Suspense>
        </main>
      )}

      {/* ── Display Defaults view — company-wide fields/columns/view mode ── */}
      {activeCat === "display" && (
        <main style={{ flex: 1, overflowY: "auto", minWidth: 0 }}>
          {backBar}
          <div style={{ padding: "24px 32px 60px" }}>
            <DisplayDefaultsSettings
              tenantId={superadmin ? (scope === "client" && clientName.trim() ? clientName.trim() : null) : undefined}
            />
          </div>
        </main>
      )}

      {/* ── Navigation view — show/hide + order + rename menu items ─────── */}
      {activeCat === "navigation" && (
        <main style={{ flex: 1, overflow: "hidden", minWidth: 0, display: "flex", flexDirection: "column" }}>
          {backBar}
          <div style={{
            // Navigation is a full-width editor. Keep the comfortable left
            // gutter, but let the settings panel run all the way to the
            // scroll area's right edge instead of leaving a dead strip.
            padding: "24px 0 0 32px",
            boxSizing: "border-box",
            flex: "1 1 auto",
            minHeight: 0,
            overflow: "hidden",
          }}>
            <NavigationSettings
              tenantId={superadmin ? (scope === "client" && clientName.trim() ? clientName.trim() : null) : undefined}
            />
          </div>
        </main>
      )}

      {/* ── Per-stage "Set rules" drawer host — mounts with the schedule
             cards so the badges have live counts and the drawer opens over
             whichever schedule list the button was clicked on. The key forces
             a FULL remount on tenant-scope change: the host's rules document
             belongs to one tenant, and carrying state across a scope switch
             could save company A's rules into company B. */}
      {activeCat === "projects" && (() => {
        const hostTid = superadmin ? (scope === "client" && clientName.trim() ? clientName.trim() : null) : undefined;
        return (
          <ScheduleStageRulesHost
            key={hostTid === undefined ? "own" : hostTid === null ? "none" : `t:${hostTid}`}
            tenantId={hostTid}
            open={ruleTarget}
            onOpenChange={setRuleTarget}
            onCountsChange={onRuleCountsChange}
            onPhaseColorChange={(stage, color, mod) => colorChangeFnsRef.current[mod]?.(stage, color)}
          />
        );
      })()}

      {/* ── One defaults category (Projects / Schedule / Staff / Forecast) ── */}
      {isFormCat(activeCat) && (() => {
        const cat = CATS.find(c => c.id === activeCat)!;
        const subs = SUBS.filter(s => s.cat === activeCat);
        // Ensure the active sub is always one that belongs to this category.
        const activeSubId = subs.some(s => s.id === openSub) ? openSub! : subs[0]?.id ?? null;
        const activeSub = subs.find(s => s.id === activeSubId) ?? subs[0];
        return (
          <main style={{ flex: 1, overflow: "hidden", minWidth: 0, display: "flex", flexDirection: "column" }}>
            {backBar}

            {/* Tab strip + save indicator — no separate header, tabs are the page identity */}
            <div style={{ padding: "16px 32px 0", flexShrink: 0 }}>
              {/* Active-sub description sits above the tab strip as a single quiet line */}
              {activeSub?.desc && (
                <p style={{ fontSize: 12, color: "hsl(var(--muted-foreground))", margin: "0 0 10px", lineHeight: 1.5 }}>
                  {activeSub.desc}
                </p>
              )}
              {/* Save status — sits ABOVE the tab strip, right-aligned */}
              {form && !DELEGATED_STAFF_SUBS.has(activeSubId ?? "") && (
                <div style={{ display: "flex", justifyContent: "flex-end", marginBottom: 6 }}>
                  {(activeSubId ?? "") in AUTO_SAVE_TABS ? (
                    <div style={{
                      display: "inline-flex", alignItems: "center", gap: 7,
                      fontSize: 12, fontWeight: 600,
                      color: "hsl(var(--muted-foreground))", whiteSpace: "nowrap",
                    }}>
                      {autoSave.kind === "saving" ? (
                        <><Loader2 className="w-3.5 h-3.5 animate-spin" /> Saving…</>
                      ) : autoSave.kind === "error" ? (
                        <>
                          <span style={{ color: "#dc2626", display: "inline-flex", alignItems: "center", gap: 5 }}>
                            <AlertTriangle style={{ width: 13, height: 13 }} /> Couldn&apos;t save
                          </span>
                          <button type="button"
                            onClick={() => {
                              if (autoTimerRef.current) clearTimeout(autoTimerRef.current);
                              void autoSaveFnRef.current(Object.keys(AUTO_SAVE_TABS), scopeTokRef.current);
                            }}
                            style={{ border: "1px solid #dc2626", color: "#dc2626", background: "transparent",
                              borderRadius: 6, padding: "2px 8px", fontSize: 11.5, fontWeight: 700, cursor: "pointer" }}>
                            Retry
                          </button>
                        </>
                      ) : autoSave.kind === "saved" ? (
                        <><CheckCircle2 className="w-3.5 h-3.5" style={{ color: "#059669" }} /> Saved</>
                      ) : (
                        <>Changes save automatically</>
                      )}
                    </div>
                  ) : (
                    <Button
                      size="sm"
                      disabled={saving || savingSection === cat.id}
                      onClick={() => void save(cat.id)}
                    >
                      {savingSection === cat.id
                        ? <Loader2 className="w-4 h-4 mr-1.5 animate-spin" />
                        : <Save className="w-4 h-4 mr-1.5" />}
                      Save
                    </Button>
                  )}
                </div>
              )}
              {/* Tab strip — equal-width grid, fills full available width */}
              <div style={{
                display: "grid",
                gridTemplateColumns: `repeat(${subs.length}, 1fr)`,
                background: "hsl(var(--muted) / 0.6)",
                borderRadius: "10px 10px 0 0",
                 border: "1px solid hsl(var(--foreground) / 0.38)",
                 borderBottom: "1px solid hsl(var(--foreground) / 0.52)",
                overflow: "hidden",
              }}>
                {subs.map((sub, i) => {
                  const active = sub.id === activeSubId;
                  return (
                    <button key={sub.id} type="button" onClick={() => setOpenSub(sub.id)}
                      style={{
                        padding: "11px 6px",
                        fontSize: 11.5,
                        fontFamily: "inherit",
                        fontWeight: active ? 700 : 500,
                        cursor: "pointer",
                        border: "none",
                         borderRight: i < subs.length - 1 ? "1px solid hsl(var(--foreground) / 0.38)" : "none",
                         borderBottom: active ? `3px solid ${cat.color}` : "3px solid hsl(var(--foreground) / 0.52)",
                        outline: "none",
                        color: active ? "hsl(var(--foreground))" : "hsl(var(--muted-foreground))",
                        background: active ? "hsl(var(--background))" : "transparent",
                        transition: "color .15s, background .15s",
                        whiteSpace: "nowrap",
                        overflow: "hidden",
                        textOverflow: "ellipsis",
                        textAlign: "center",
                      }}>
                      {sub.title}
                    </button>
                  );
                })}
              </div>
            </div>

            {/* Tab panel — scrollable body.
                Delegated tabs (Manage Staff, Access Levels, User Groups,
                Staffing Templates) load and save their own docs — they never
                read `form`, so they must NOT wait on the page-wide settings
                fetch. Rendering them immediately lets their own instant-paint
                seeds do their job; only form-backed tabs (Working Week,
                Utilization, Colors…) still gate on the settings load. */}
            <div style={{ flex: 1, overflowY: "auto" }}>
              {activeSubId && DELEGATED_STAFF_SUBS.has(activeSubId) ? (
                superadmin && scope === "client" && !clientName.trim() ? (
                  <div style={{ padding: "24px 32px" }}>
                    <Card><CardContent className="py-10 text-center text-sm text-muted-foreground">
                      Choose a client on the All Settings page to view or customize their defaults.
                    </CardContent></Card>
                  </div>
                ) : (
                  <div style={{ padding: "24px 32px 60px" }}>
                    {renderSub(activeSubId)}
                  </div>
                )
              ) : (
                <>
                  {loading && (
                    <div className="flex items-center justify-center py-16 text-muted-foreground">
                      <Loader2 className="w-5 h-5 animate-spin mr-2" /> Loading…
                    </div>
                  )}

                  {!loading && scope === "client" && !clientName.trim() && (
                    <div style={{ padding: "24px 32px" }}>
                      <Card><CardContent className="py-10 text-center text-sm text-muted-foreground">
                        Choose a client on the All Settings page to view or customize their defaults.
                      </CardContent></Card>
                    </div>
                  )}

                  {!loading && form && activeSubId && (
                    <div style={{ padding: "24px 32px 60px" }}>
                      {renderSub(activeSubId)}
                    </div>
                  )}
                </>
              )}
            </div>
          </main>
        );
      })()}
    </div>
  );
}
