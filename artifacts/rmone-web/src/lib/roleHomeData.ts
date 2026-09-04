// Curated per-role home data. Each role has four time-window slices
// (7 / 30 / 60 / 90 days) so the home screen's KPIs, risk feed, and
// recommended actions all swap when the user changes the horizon chip
// in the header. The `defaultWindow` per role is the natural horizon
// for that persona (PM = this week, COO = month, CFO/Exec = quarter,
// etc.) so the home opens to a sensible default before any user
// preference is read from localStorage.
//
// Live data binding remains a follow-up — these datasets are curated
// mock content matching the visual spec from
// artifacts/mockup-sandbox/src/components/mockups/rmone-p5-nav/RoleHome.tsx.

import {
  ArrowRightLeft,
  CalendarClock,
  UserPlus,
  Clock,
  DollarSign,
  FileSignature,
  TrendingDown,
  Briefcase,
  type LucideIcon,
} from "lucide-react";
import type { RolePersona } from "./roleResolver";
import type { ActionDetail } from "./homeIntelligence";

export type SubDriver = {
  label: string;
  value: number;
  tone: "good" | "warn";
  // true → value/tone came from a live RM ONE API call. Undefined/false →
  // curated sample shown with a "SAMPLE" badge so the user can tell at a
  // glance which numbers are real vs illustrative.
  isLive?: boolean;
  // Optional table of underlying records that produced this KPI value.
  // When present, clicking the driver shows one row per record (e.g. the
  // projects behind "Schedule float") instead of a one-line summary.
  records?: ActionDetail;
  /**
   * Rich "how this number is calculated" detail for KPIs that have been
   * redesigned to match the pixel-exact Firm Health drill-down mock
   * (current reading / formula / impact boxes). See homeIntelligence's
   * SubDriver.formulaDetail — same shape, kept in lockstep here so the
   * live overlay mapping can pass it straight through.
   */
  formulaDetail?: {
    currentReading: string;
    howCalculated: string;
    formula: string;
    /** e.g. "PMM (active book) + OPM (pipeline)" — rendered as DATA SOURCE pills */
    dataSource?: string;
    impact: string;
    tableTitle: string;
    /** Badge label in the current-reading card (default "score"). */
    scoreLabel?: string;
    /** When set, replaces the `valuePct%` badge display (e.g. "5.58×" for a ratio metric). */
    scoreFormatted?: string;
    /** Eyebrow override for this sub-driver (e.g. "FINANCIAL HEALTH · LIVE CALCULATION"). */
    eyebrow?: string;
  };
};
export type RiskTone = "high" | "med" | "info";
export type RiskItem = {
  tone: RiskTone;
  title: string;
  sub: string;
  /** Stable driver key from homeIntelligence ("concentration",
   *  "demand-coverage", "data-quality", ...) — lets the UI explain the risk
   *  in plain language instead of guessing from the title text. */
  kind?: string;
  /** Optional headline metric shown in the row's middle column. */
  metric?: { label: string; value: string; tone?: "good" | "warn" | "bad" };
  /** Optional context chips (e.g. role, project codes, count). */
  chips?: string[];
  // true → row was derived from live records. Undefined/false → curated
  // sample (rendered with a "SAMPLE" badge).
  isLive?: boolean;
  // Stable key emitted by the api-server alerts feed (e.g.
  // "exec-approval:OPM:OPM-9999"). Present only on rows from
  // /api/alerts/feed; the resolve/dismiss UI uses it when calling
  // setAlertState. Curated sample rows leave this undefined.
  alertKey?: string;
  // Optional table of underlying records that produced this risk.
  // When present, the alert popup renders one row per record (e.g.
  // 44 bench resources) instead of a single fallback summary row.
  records?: ActionDetail;
};
export type ActionItem = {
  Icon: LucideIcon;
  kind: string;
  title: string;
  cta: string;
  emphasis?: boolean;
  /** Optional headline metric shown in the row's middle column. */
  metric?: { label: string; value: string; tone?: "good" | "warn" | "bad" };
  /** Optional context chips (e.g. "this wk", project tag). */
  chips?: string[];
  // true → derived from a live RM ONE API call. Undefined/false → curated
  // sample shown with a "SAMPLE" badge so the user can tell at a glance
  // which recommended actions are real vs illustrative.
  isLive?: boolean;
  // Per-decision detail table from buildHomeIntelligence. When present,
  // the action modal renders this directly instead of the category-switch
  // fallback so every decision shows its own supporting records.
  detail?: ActionDetail;
};

export type WindowKey = "7d" | "30d" | "60d" | "90d";

export const WINDOW_KEYS: WindowKey[] = ["7d", "30d", "60d", "90d"];

// The home screen no longer has a day-window picker — every persona
// aggregates the entire tenant regardless of date. These maps are no
// longer rendered anywhere (RoleHome.tsx dropped its window-label
// strings); kept only so the curated-fallback slice shape below still
// type-checks. Deliberately blank — there is no time-window concept to
// label any more, and we never want a "window" phrase reappearing here.
export const WINDOW_LABEL: Record<WindowKey, string> = {
  "7d": "",
  "30d": "",
  "60d": "",
  "90d": "",
};

export const WINDOW_HORIZON: Record<WindowKey, string> = {
  "7d": "",
  "30d": "",
  "60d": "",
  "90d": "",
};

export type RoleWindowSlice = {
  horizon: string;
  health: { score: number; label: string; trend: string; subs: SubDriver[] };
  risks: RiskItem[];
  actions: ActionItem[];
};

export type RoleHomeData = {
  greeting: string;
  // The natural horizon for this persona — used as the initial chip
  // selection before localStorage is hydrated.
  defaultWindow: WindowKey;
  windows: Record<WindowKey, RoleWindowSlice>;
};

export const ROLE_HOME_DATA: Record<RolePersona, RoleHomeData> = {
  // ──────────────────────────────────────────────────────────────────
  // COO — operational health. Default = next 30 days.
  // ──────────────────────────────────────────────────────────────────
  COO: {
    greeting: "Operational health",
    defaultWindow: "30d",
    windows: {
      "7d": {
        horizon: WINDOW_HORIZON["7d"],
        health: {
          score: 78,
          label: "WATCH",
          trend: "−4 vs last wk",
          subs: [
            { label: "Daily attendance", value: 91, tone: "good" },
            { label: "Open RFIs", value: 64, tone: "warn" },
            { label: "Site safety", value: 96, tone: "good" },
            { label: "This-week milestones", value: 72, tone: "warn" },
          ],
        },
        risks: [
          { tone: "high", title: "2 sites understaffed today", sub: "PMM-25-000167, PMM-25-000212" },
          { tone: "med", title: "RFI backlog at 11 across 3 PMs", sub: "Tom R., Ana D., Jordan F." },
          { tone: "med", title: "Phoenix milestone slipping", sub: "Steel pour W19 at risk" },
        ],
        actions: [
          { Icon: ArrowRightLeft, kind: "Re-deploy", title: "Re-deploy 2 PMs to Phoenix today", cta: "Apply", emphasis: true },
          { Icon: FileSignature, kind: "Push brief", title: "Push site brief to East team", cta: "Send" },
          { Icon: UserPlus, kind: "Approve hire", title: "Approve Sr. PM offer (Phoenix)", cta: "Approve" },
          { Icon: Clock, kind: "Cap OT", title: "Cap site OT at 50h/wk", cta: "Cap" },
        ],
      },
      "30d": {
        horizon: WINDOW_HORIZON["30d"],
        health: {
          score: 82,
          label: "STABLE",
          trend: "+3 vs last wk",
          subs: [
            { label: "Staffing balance", value: 88, tone: "good" },
            { label: "Utilization stability", value: 76, tone: "warn" },
            { label: "Proposal coverage", value: 71, tone: "warn" },
            { label: "Demand-data coverage", value: 89, tone: "good" },
          ],
        },
        risks: [
          { tone: "high", title: "3 projects under-resourced · 30 days", sub: "PMM-25-000167, PMM-25-000212, +1" },
          { tone: "med", title: "Phoenix utilization projected 104%", sub: "Peak week of May 18" },
          { tone: "med", title: "2 PMs approaching burnout", sub: "Tom R. 91h/wk · Ana D. 87h/wk" },
        ],
        actions: [
          { Icon: ArrowRightLeft, kind: "Move resources", title: "Move 4 FTE Boston → Phoenix", cta: "Apply", emphasis: true },
          { Icon: CalendarClock, kind: "Delay pursuits", title: "Delay 3 non-critical proposals 2 wks", cta: "Defer" },
          { Icon: UserPlus, kind: "Hire role", title: "Open 2 senior PM reqs · Healthcare", cta: "Hire" },
          { Icon: Clock, kind: "Shift schedule", title: "Shift Tom R. off PMM-25-000212", cta: "Shift" },
        ],
      },
      "60d": {
        horizon: WINDOW_HORIZON["60d"],
        health: {
          score: 84,
          label: "STABLE",
          trend: "+1 vs last 30d",
          subs: [
            { label: "Forecast load", value: 81, tone: "good" },
            { label: "Pipeline ↔ resource match", value: 73, tone: "warn" },
            { label: "Cross-region balance", value: 78, tone: "warn" },
            { label: "Hiring runway", value: 86, tone: "good" },
          ],
        },
        risks: [
          { tone: "med", title: "Healthcare segment +18% demand", sub: "Drives Sr. PM gap by Jul 1" },
          { tone: "med", title: "4 PM seats unbacked at 60-day forecast", sub: "Phoenix + East regions" },
          { tone: "info", title: "Boston bench thinning", sub: "From 14 → 9 designers in 60 days" },
        ],
        actions: [
          { Icon: ArrowRightLeft, kind: "Plan move", title: "Plan 6 FTE Boston → Phoenix wave 2", cta: "Plan", emphasis: true },
          { Icon: UserPlus, kind: "Open reqs", title: "Open 4 PM reqs · 60-day fill", cta: "Open" },
          { Icon: CalendarClock, kind: "Defer pursuits", title: "Defer 2 East pursuits to Q3", cta: "Defer" },
          { Icon: FileSignature, kind: "Lock offers", title: "Lock 2 Sr. PM offers before lapse", cta: "Lock" },
        ],
      },
      "90d": {
        horizon: WINDOW_HORIZON["90d"],
        health: {
          score: 86,
          label: "STRONG",
          trend: "+5 vs prior qtr",
          subs: [
            { label: "Pipeline coverage", value: 92, tone: "good" },
            { label: "Forecast utilization", value: 79, tone: "warn" },
            { label: "Delivery Rate", value: 88, tone: "good" },
            { label: "Talent retention", value: 81, tone: "good" },
          ],
        },
        risks: [
          { tone: "high", title: "Q3 pursuit ramp needs +12 FTE", sub: "Vs current 90-day hire plan of 8" },
          { tone: "med", title: "Senior bench gap · East region", sub: "Director + 2 Sr. PMs unfilled" },
          { tone: "info", title: "Cap-ex commitments outpace cash", sub: "Q3 lease + tech spend" },
        ],
        actions: [
          { Icon: UserPlus, kind: "Approve plan", title: "Approve FY hire plan — 18 roles", cta: "Approve", emphasis: true },
          { Icon: Briefcase, kind: "Sign partner", title: "Sign 2 healthcare delivery partnerships", cta: "Sign" },
          { Icon: ArrowRightLeft, kind: "Restructure", title: "Restructure East region PM team", cta: "Plan" },
          { Icon: FileSignature, kind: "Lock office", title: "Lock office expansion · Phoenix", cta: "Lock" },
        ],
      },
    },
  },

  // ──────────────────────────────────────────────────────────────────
  // CFO — financial health. Default = this quarter (90d).
  // ──────────────────────────────────────────────────────────────────
  CFO: {
    greeting: "Financial health",
    defaultWindow: "90d",
    windows: {
      "7d": {
        horizon: WINDOW_HORIZON["7d"],
        health: {
          score: 71,
          label: "WATCH",
          trend: "−2 vs last wk",
          subs: [
            { label: "Pipeline coverage",  value: 68, tone: "warn" },
            { label: "Labor margin",       value: 72, tone: "warn" },
            { label: "Hours on plan",      value: 80, tone: "good" },
            { label: "Labor completion",   value: 55, tone: "warn" },
            { label: "Cost coverage",      value: 75, tone: "warn" },
            { label: "Alloc on plan",      value: 62, tone: "warn" },
          ],
        },
        risks: [
          { tone: "high", title: "$620K AR aging past 90d", sub: "Top 2 clients · escalation needed" },
          { tone: "med", title: "3 invoices not sent · Castle Hill", sub: "Cycle delay 4 days" },
          { tone: "med", title: "Phoenix daily spend +6% vs plan", sub: "Drives weekly burn variance" },
        ],
        actions: [
          { Icon: DollarSign, kind: "Escalate AR", title: "Push 3 AR escalations today", cta: "Send", emphasis: true },
          { Icon: FileSignature, kind: "Send invoices", title: "Send Castle Hill invoice batch", cta: "Send" },
          { Icon: TrendingDown, kind: "Approve draws", title: "Approve $180K weekly draws", cta: "Approve" },
          { Icon: CalendarClock, kind: "Block POs", title: "Block 2 non-critical POs this wk", cta: "Block" },
        ],
      },
      "30d": {
        horizon: WINDOW_HORIZON["30d"],
        health: {
          score: 73,
          label: "WATCH",
          trend: "−0.8 vs last 30d",
          subs: [
            { label: "Pipeline coverage",  value: 72, tone: "good" },
            { label: "Labor margin",       value: 64, tone: "warn" },
            { label: "Hours on plan",      value: 79, tone: "warn" },
            { label: "Labor completion",   value: 58, tone: "warn" },
            { label: "Cost coverage",      value: 70, tone: "warn" },
            { label: "Alloc on plan",      value: 65, tone: "warn" },
          ],
        },
        risks: [
          { tone: "high", title: "Castle Hill margin trending −2.4%", sub: "Approved budget vs run-rate" },
          { tone: "med", title: "AR > 30 days at $2.3M", sub: "3 clients account for 71%" },
          { tone: "med", title: "Houston run-rate +4% over plan", sub: "Drives May margin slip" },
        ],
        actions: [
          { Icon: FileSignature, kind: "Re-baseline", title: "Re-baseline Castle Hill mid-month", cta: "Open", emphasis: true },
          { Icon: DollarSign, kind: "Drive AR", title: "Drive AR < 30d below $1.8M", cta: "Push" },
          { Icon: CalendarClock, kind: "Defer capex", title: "Defer $180K capex 30 days", cta: "Defer" },
          { Icon: TrendingDown, kind: "Approve change", title: "Approve change order #14 · Phoenix", cta: "Approve" },
        ],
      },
      "60d": {
        horizon: WINDOW_HORIZON["60d"],
        health: {
          score: 75,
          label: "STEADY",
          trend: "+0.4 vs last 60d",
          subs: [
            { label: "Pipeline coverage",  value: 80, tone: "good" },
            { label: "Labor margin",       value: 68, tone: "warn" },
            { label: "Hours on plan",      value: 82, tone: "good" },
            { label: "Labor completion",   value: 62, tone: "warn" },
            { label: "Cost coverage",      value: 74, tone: "warn" },
            { label: "Alloc on plan",      value: 70, tone: "warn" },
          ],
        },
        risks: [
          { tone: "high", title: "AR > 60 days at $3.2M", sub: "Top 3 clients = 62%" },
          { tone: "med", title: "Q2 EBITDA at risk by $480K", sub: "Driven by Houston + Castle Hill" },
          { tone: "med", title: "2 large change orders pending", sub: "$2.8M combined · Phoenix + Boston" },
        ],
        actions: [
          { Icon: FileSignature, kind: "Lock forecast", title: "Lock Q2 forecast Friday", cta: "Lock", emphasis: true },
          { Icon: DollarSign, kind: "Collections", title: "Push 6 collections cases", cta: "Send" },
          { Icon: TrendingDown, kind: "Approve change", title: "Approve Phoenix change order ($2.1M)", cta: "Approve" },
          { Icon: CalendarClock, kind: "Hold capex", title: "Hold $480K capex pending Q2 close", cta: "Hold" },
        ],
      },
      "90d": {
        horizon: WINDOW_HORIZON["90d"],
        health: {
          score: 74,
          label: "WATCH",
          trend: "−1.2 vs last wk",
          subs: [
            { label: "Pipeline coverage",  value: 84, tone: "good" },
            { label: "Labor margin",       value: 63, tone: "warn" },
            { label: "Hours on plan",      value: 79, tone: "warn" },
            { label: "Labor completion",   value: 58, tone: "warn" },
            { label: "Cost coverage",      value: 64, tone: "warn" },
            { label: "Alloc on plan",      value: 59, tone: "warn" },
          ],
        },
        risks: [
          { tone: "high", title: "NYCHA Castle Hill margin −3.2%", sub: "Delivery · approved budget vs run-rate" },
          { tone: "high", title: "AR > 60 days at $4.1M", sub: "Cash flow · top 3 clients = 62%" },
          { tone: "med", title: "Houston burn +5% vs plan", sub: "Margin · drives Q2 EBITDA risk" },
        ],
        actions: [
          { Icon: FileSignature, kind: "Re-baseline", title: "Re-baseline NYCHA Castle Hill margin", cta: "Open", emphasis: true },
          { Icon: DollarSign, kind: "Collections", title: "Push 4 AR escalations · cash flow", cta: "Send" },
          { Icon: TrendingDown, kind: "Approve change", title: "Approve $2.1M change order · Phoenix", cta: "Approve" },
          { Icon: CalendarClock, kind: "Defer capex", title: "Defer $480K Q2 capex to Q3", cta: "Defer" },
        ],
      },
    },
  },

  // ──────────────────────────────────────────────────────────────────
  // RESOURCE MANAGER — capacity health. Default = next 30 days.
  // ──────────────────────────────────────────────────────────────────
  RESOURCE_MANAGER: {
    greeting: "Capacity health",
    defaultWindow: "90d",
    windows: {
      "7d": {
        horizon: WINDOW_HORIZON["7d"],
        health: {
          score: 64,
          label: "TIGHT",
          trend: "−6 vs last wk",
          subs: [
            { label: "Bench coverage", value: 48, tone: "warn" },
            { label: "Overload roles", value: 40, tone: "warn" },
            { label: "Open positions", value: 92, tone: "good" },
            { label: "Demand-data coverage", value: 56, tone: "warn" },
          ],
        },
        risks: [
          { tone: "high", title: "Phoenix W19 peak at 117%", sub: "PM + Sr. Designer over-allocated" },
          { tone: "med", title: "Tom R. requested swap off PMM-25-000212", sub: "Awaiting cover" },
          { tone: "med", title: "2 callouts uncovered today", sub: "Boston site + Houston PM" },
        ],
        actions: [
          { Icon: ArrowRightLeft, kind: "Pull staff", title: "Pull 1 PM Boston → Phoenix this wk", cta: "Apply", emphasis: true },
          { Icon: Clock, kind: "Cap hours", title: "Cap Ana D. at 50h this wk", cta: "Cap" },
          { Icon: UserPlus, kind: "Approve contractor", title: "Approve 2 contractor day-rates", cta: "Approve" },
          { Icon: Briefcase, kind: "Cover gap", title: "Cover Healthcare PMM-25-000167", cta: "Assign" },
        ],
      },
      "30d": {
        horizon: WINDOW_HORIZON["30d"],
        health: {
          score: 68,
          label: "TIGHT",
          trend: "−4 vs last wk",
          subs: [
            { label: "Bench coverage", value: 62, tone: "warn" },
            { label: "Overload roles", value: 35, tone: "warn" },
            { label: "Open positions", value: 58, tone: "warn" },
            { label: "Demand-data coverage", value: 81, tone: "good" },
          ],
        },
        risks: [
          { tone: "high", title: "Phoenix overload W19–W21", sub: "PM + Sr. Designer · 117% load" },
          { tone: "high", title: "3 senior PM gaps · Healthcare", sub: "Required by June 1" },
          { tone: "med", title: "Ana D. 87h/wk · 3rd week", sub: "Burnout risk threshold breached" },
        ],
        actions: [
          { Icon: ArrowRightLeft, kind: "Reassign", title: "Move Tom R. off PMM-25-000212", cta: "Apply", emphasis: true },
          { Icon: UserPlus, kind: "Open req", title: "Open 2 Sr. PM reqs — Healthcare", cta: "Open" },
          { Icon: Clock, kind: "Pull staff", title: "Pull 1 PM from Boston → Phoenix", cta: "Shift" },
          { Icon: CalendarClock, kind: "Cap hours", title: "Cap Ana D. at 50h/wk — next 2 wks", cta: "Cap" },
        ],
      },
      "60d": {
        horizon: WINDOW_HORIZON["60d"],
        health: {
          score: 71,
          label: "STEADY",
          trend: "+3 vs last 60d",
          subs: [
            { label: "Bench coverage", value: 70, tone: "warn" },
            { label: "Overload roles", value: 82, tone: "good" },
            { label: "Open positions", value: 52, tone: "warn" },
            { label: "Demand-data coverage", value: 75, tone: "warn" },
          ],
        },
        risks: [
          { tone: "high", title: "4 senior PM gaps · Healthcare by Jul 1", sub: "Drives 60-day delivery risk" },
          { tone: "med", title: "Phoenix overload extends to W23", sub: "Sr. Designer + Mech lead" },
          { tone: "med", title: "2 PM offers expiring this month", sub: "Risk losing both candidates" },
        ],
        actions: [
          { Icon: UserPlus, kind: "Open reqs", title: "Open 4 Sr. PM reqs — 60-day fill", cta: "Open", emphasis: true },
          { Icon: FileSignature, kind: "Lock offers", title: "Lock 2 outstanding PM offers", cta: "Lock" },
          { Icon: ArrowRightLeft, kind: "Plan wave", title: "Plan Boston → Phoenix wave 2", cta: "Plan" },
          { Icon: Clock, kind: "Cap OT", title: "Cap firm-wide OT at 55h/wk", cta: "Cap" },
        ],
      },
      "90d": {
        horizon: WINDOW_HORIZON["90d"],
        health: {
          score: 76,
          label: "STEADY",
          trend: "+8 vs prior qtr",
          subs: [
            { label: "Bench coverage", value: 84, tone: "good" },
            { label: "Overload roles", value: 78, tone: "good" },
            { label: "Open positions", value: 71, tone: "warn" },
            { label: "Demand-data coverage", value: 80, tone: "good" },
          ],
        },
        risks: [
          { tone: "med", title: "FY hire plan 12/18 filled", sub: "6 roles slipping past 90d" },
          { tone: "med", title: "Senior designer gap · East region", sub: "Drives Q3 delivery risk" },
          { tone: "info", title: "Director backfill open · Boston", sub: "Search firm engaged" },
        ],
        actions: [
          { Icon: UserPlus, kind: "Approve plan", title: "Approve FY26 hire plan — 18 roles", cta: "Approve", emphasis: true },
          { Icon: ArrowRightLeft, kind: "Restructure", title: "Restructure East PM team", cta: "Plan" },
          { Icon: FileSignature, kind: "Sign retention", title: "Sign 2 retention agreements", cta: "Sign" },
          { Icon: Briefcase, kind: "Open Director", title: "Open Director req · Boston", cta: "Open" },
        ],
      },
    },
  },

  // ──────────────────────────────────────────────────────────────────
  // PROJECT MANAGER — my portfolio. Default = this week (7d).
  // ──────────────────────────────────────────────────────────────────
  PROJECT_MANAGER: {
    greeting: "My portfolio",
    defaultWindow: "90d",
    windows: {
      "7d": {
        horizon: WINDOW_HORIZON["7d"],
        health: {
          score: 86,
          label: "ON TRACK",
          trend: "+2 vs last wk",
          subs: [
            { label: "Schedule Health", value: 38, tone: "warn" },
            { label: "Budget Coverage", value: 42, tone: "warn" },
            { label: "Delivery Readiness", value: 55, tone: "warn" },
            { label: "Milestone Readiness", value: 72, tone: "warn" },
          ],
        },
        risks: [
          { tone: "high", title: "PMM-25-000167 — RFI overdue 4d", sub: "Sub-grade waterproofing detail" },
          { tone: "med", title: "PMM-25-000212 — schedule slip 4d", sub: "Steel delivery delayed" },
          { tone: "med", title: "2 approvals due by Friday", sub: "Change orders — $812K total" },
        ],
        actions: [
          { Icon: FileSignature, kind: "Resolve RFIs", title: "Reply to 7 outstanding RFIs", cta: "Open", emphasis: true },
          { Icon: DollarSign, kind: "Submit", title: "Submit Change Order #14 — Phoenix", cta: "Send" },
          { Icon: Briefcase, kind: "Confirm", title: "Confirm subcontractor for Castle Hill", cta: "Confirm" },
          { Icon: CalendarClock, kind: "Reschedule", title: "Reschedule steel pour to May 14", cta: "Update" },
        ],
      },
      "30d": {
        horizon: WINDOW_HORIZON["30d"],
        health: {
          score: 82,
          label: "ON TRACK",
          trend: "+1 vs last 30d",
          subs: [
            { label: "Schedule Health", value: 35, tone: "warn" },
            { label: "Budget Coverage", value: 38, tone: "warn" },
            { label: "Delivery Readiness", value: 52, tone: "warn" },
            { label: "Milestone Readiness", value: 68, tone: "warn" },
          ],
        },
        risks: [
          { tone: "high", title: "4 milestones at risk in May", sub: "PMM-25-000167, PMM-25-000212, +2" },
          { tone: "med", title: "12 RFIs trending overdue", sub: "Across Phoenix + Castle Hill" },
          { tone: "med", title: "$2.1M change order pending · Phoenix", sub: "Owner approval 12 days out" },
        ],
        actions: [
          { Icon: CalendarClock, kind: "Recovery plan", title: "Build May milestone recovery plan", cta: "Plan", emphasis: true },
          { Icon: FileSignature, kind: "Resolve RFIs", title: "Resolve 12 RFIs by 30th", cta: "Open" },
          { Icon: DollarSign, kind: "Submit COs", title: "Submit 4 change orders this month", cta: "Send" },
          { Icon: Briefcase, kind: "Re-sequence", title: "Re-sequence Castle Hill pour", cta: "Update" },
        ],
      },
      "60d": {
        horizon: WINDOW_HORIZON["60d"],
        health: {
          score: 80,
          label: "STEADY",
          trend: "±0 vs last 60d",
          subs: [
            { label: "Schedule Health", value: 32, tone: "warn" },
            { label: "Budget Coverage", value: 35, tone: "warn" },
            { label: "Delivery Readiness", value: 48, tone: "warn" },
            { label: "Milestone Readiness", value: 65, tone: "warn" },
          ],
        },
        risks: [
          { tone: "high", title: "Steel package late by 2 wks", sub: "Phoenix · pour cascade impact" },
          { tone: "med", title: "3 subs not committed for June pour", sub: "Castle Hill" },
          { tone: "med", title: "Permit hold-up · Boston site", sub: "Appeal pending 18 days" },
        ],
        actions: [
          { Icon: FileSignature, kind: "Lock sub", title: "Lock steel subcontractor by Friday", cta: "Lock", emphasis: true },
          { Icon: CalendarClock, kind: "Owner reviews", title: "Schedule 60-day owner reviews", cta: "Schedule" },
          { Icon: Briefcase, kind: "Permit appeal", title: "Submit Boston permit appeal", cta: "Submit" },
          { Icon: FileSignature, kind: "Approve submittals", title: "Approve mech-elec submittals", cta: "Approve" },
        ],
      },
      "90d": {
        horizon: WINDOW_HORIZON["90d"],
        health: {
          score: 78,
          label: "STEADY",
          trend: "−2 vs prior qtr",
          subs: [
            { label: "Schedule Health", value: 30, tone: "warn" },
            { label: "Budget Coverage", value: 32, tone: "warn" },
            { label: "Delivery Readiness", value: 45, tone: "warn" },
            { label: "Milestone Readiness", value: 60, tone: "warn" },
          ],
        },
        risks: [
          { tone: "high", title: "Long-lead steel/glass arrival risk", sub: "Drives Q3 hand-over date" },
          { tone: "med", title: "Q3 buyout 70% complete", sub: "8 packages outstanding" },
          { tone: "med", title: "2 owner change requests pending", sub: "Castle Hill + Phoenix" },
        ],
        actions: [
          { Icon: FileSignature, kind: "Approve buyout", title: "Approve Q3 buyout slate", cta: "Approve", emphasis: true },
          { Icon: Briefcase, kind: "Long-lead", title: "Lock long-lead PO release", cta: "Release" },
          { Icon: CalendarClock, kind: "Re-baseline", title: "Schedule owner re-baseline review", cta: "Schedule" },
          { Icon: UserPlus, kind: "Plan staffing", title: "Plan punch-list staffing", cta: "Plan" },
        ],
      },
    },
  },

  // ──────────────────────────────────────────────────────────────────
  // EXECUTIVE — firm health. Default = this quarter (90d).
  // ──────────────────────────────────────────────────────────────────
  EXECUTIVE: {
    greeting: "Firm health",
    defaultWindow: "90d",
    windows: {
      "7d": {
        horizon: WINDOW_HORIZON["7d"],
        health: {
          score: 81,
          label: "STEADY",
          trend: "±0 vs last wk",
          subs: [
            { label: "Win Rate", value: 80, tone: "good" },
            { label: "Delivery Rate", value: 75, tone: "warn" },
            { label: "Open Positions", value: 87, tone: "good" },
            { label: "Execution Readiness", value: 55, tone: "warn" },
          ],
        },
        risks: [
          { tone: "high", title: "2 RFP responses due Friday", sub: "Healthcare + Federal pursuits" },
          { tone: "med", title: "Phoenix MD candidate awaiting offer", sub: "Risk losing if past Wed" },
          { tone: "med", title: "NYC client escalation · Castle Hill", sub: "Margin slip + schedule" },
        ],
        actions: [
          { Icon: UserPlus, kind: "Approve offer", title: "Approve Phoenix MD offer", cta: "Approve", emphasis: true },
          { Icon: FileSignature, kind: "Sign RFP", title: "Sign 2 RFP responses", cta: "Sign" },
          { Icon: Briefcase, kind: "Client call", title: "Call NYC client today (Castle Hill)", cta: "Call" },
          { Icon: CalendarClock, kind: "All-hands", title: "Issue all-hands update", cta: "Send" },
        ],
      },
      "30d": {
        horizon: WINDOW_HORIZON["30d"],
        health: {
          score: 80,
          label: "STEADY",
          trend: "+1 vs last 30d",
          subs: [
            { label: "Win Rate", value: 80, tone: "good" },
            { label: "Delivery Rate", value: 75, tone: "warn" },
            { label: "Open Positions", value: 85, tone: "good" },
            { label: "Execution Readiness", value: 52, tone: "warn" },
          ],
        },
        risks: [
          { tone: "high", title: "May bookings tracking −$4M", sub: "Healthcare segment shortfall" },
          { tone: "med", title: "2 leadership offers pending close", sub: "Phoenix MD + East Dir." },
          { tone: "med", title: "Houston margin slip · −1.8%", sub: "Drives May P&L variance" },
        ],
        actions: [
          { Icon: TrendingDown, kind: "Bookings push", title: "Approve May bookings push plan", cta: "Approve", emphasis: true },
          { Icon: FileSignature, kind: "Lock offers", title: "Lock 2 leadership offers", cta: "Lock" },
          { Icon: Briefcase, kind: "Intervene", title: "Approve Houston margin intervention", cta: "Approve" },
          { Icon: CalendarClock, kind: "Brief board", title: "Brief board on May results", cta: "Brief" },
        ],
      },
      "60d": {
        horizon: WINDOW_HORIZON["60d"],
        health: {
          score: 79,
          label: "STEADY",
          trend: "+0.5 vs last 60d",
          subs: [
            { label: "Win Rate", value: 80, tone: "good" },
            { label: "Delivery Rate", value: 75, tone: "warn" },
            { label: "Open Positions", value: 83, tone: "good" },
            { label: "Execution Readiness", value: 48, tone: "warn" },
          ],
        },
        risks: [
          { tone: "high", title: "60-day pipeline gap −$8M", sub: "Healthcare + Education" },
          { tone: "med", title: "4 leadership seats open", sub: "Phoenix MD, East Dir., +2" },
          { tone: "med", title: "2 strategic initiatives at risk", sub: "AI rollout + East expansion" },
        ],
        actions: [
          { Icon: Briefcase, kind: "Pursuit list", title: "Approve 60-day pursuit list", cta: "Approve", emphasis: true },
          { Icon: UserPlus, kind: "Open reqs", title: "Open 4 leadership reqs", cta: "Open" },
          { Icon: FileSignature, kind: "Re-baseline", title: "Re-baseline strategic plan", cta: "Open" },
          { Icon: ArrowRightLeft, kind: "Restructure", title: "Approve East region restructure", cta: "Approve" },
        ],
      },
      "90d": {
        horizon: WINDOW_HORIZON["90d"],
        health: {
          score: 79,
          label: "STEADY",
          trend: "+1 vs last wk",
          subs: [
            { label: "Win Rate", value: 80, tone: "good" },
            { label: "Delivery Rate", value: 75, tone: "warn" },
            { label: "Open Positions", value: 81, tone: "good" },
            { label: "Execution Readiness", value: 45, tone: "warn" },
          ],
        },
        risks: [
          { tone: "high", title: "Q3 pipeline gap — $14M short", sub: "Healthcare + Education segments" },
          { tone: "med", title: "Win rate dropped to 31%", sub: "Down from 38% trailing quarter" },
          { tone: "med", title: "2 key leadership hires delayed", sub: "Phoenix MD + East Region Dir." },
        ],
        actions: [
          { Icon: UserPlus, kind: "Approve plan", title: "Approve FY26 hire plan — 18 roles", cta: "Approve", emphasis: true },
          { Icon: Briefcase, kind: "Review", title: "Review Q3 pipeline pursuit list", cta: "Open" },
          { Icon: FileSignature, kind: "Sign", title: "Sign Phoenix office lease renewal", cta: "Sign" },
          { Icon: TrendingDown, kind: "Reset target", title: "Reset Q3 win-rate target to 35%", cta: "Set" },
        ],
      },
    },
  },
};

// Resolve the slice for a (role, window) — guards against an out-of-band
// window key by falling back to the role's natural default.
export function getRoleWindowSlice(role: RolePersona, win: WindowKey): RoleWindowSlice {
  const data = ROLE_HOME_DATA[role];
  return data.windows[win] ?? data.windows[data.defaultWindow];
}
