// Curated per-role home data for the mobile app. Mirrors
// artifacts/rmone-web/src/lib/roleHomeData.ts — same multi-window
// structure (7d / 30d / 60d / 90d) and same values, but icon names
// target the mobile @expo/vector-icons Feather set rather than
// lucide-react. Keep the two files in sync so the same role+window
// renders the same content on both surfaces.

import type { RolePersona } from "./roleResolver";
import type { Feather } from "@expo/vector-icons";
import { ALL_TIME_DAYS, type ActionDetail } from "./homeIntelligence";

export type SubDriver = {
  label: string;
  value: number;
  tone: "good" | "warn";
  isLive?: boolean;
};
export type RiskTone = "high" | "med" | "info";
export type RiskItem = {
  tone: RiskTone;
  title: string;
  sub?: string;
  isLive?: boolean;
  alertKey?: string;
  records?: ActionDetail;
};
export type FeatherName = React.ComponentProps<typeof Feather>["name"];
export type ActionItem = {
  icon: FeatherName;
  kind: string;
  title: string;
  cta: string;
  emphasis?: boolean;
  isLive?: boolean;
};

// The home screen no longer has a day-window picker — every persona
// aggregates the entire tenant regardless of date. WindowKey/WINDOW_KEYS
// are kept only as an internal bucket key for the curated-fallback data
// below; every real day count now points at ALL_TIME_DAYS. These label
// maps are deliberately blank — there is no time-window concept left to
// label, and we never want a "window" phrase reappearing in the UI.
export type WindowKey = "7d" | "30d" | "60d" | "90d";
export const WINDOW_KEYS: WindowKey[] = ["7d", "30d", "60d", "90d"];
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
export const WINDOW_DAYS: Record<WindowKey, number> = {
  "7d": ALL_TIME_DAYS,
  "30d": ALL_TIME_DAYS,
  "60d": ALL_TIME_DAYS,
  "90d": ALL_TIME_DAYS,
};

export type RoleWindowSlice = {
  horizon: string;
  health: { score: number; label: string; trend: string; subs: SubDriver[] };
  risks: RiskItem[];
  actions: ActionItem[];
};

export type RoleHomeData = {
  greeting: string;
  defaultWindow: WindowKey;
  windows: Record<WindowKey, RoleWindowSlice>;
};

export const ROLE_HOME_DATA: Record<RolePersona, RoleHomeData> = {
  // ──────────────────────────────────────────────────────────────────
  // COO — operational health. Default = 30 days.
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
          trend: "\u22124 vs last wk",
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
          { icon: "repeat", kind: "Re-deploy", title: "Re-deploy 2 PMs to Phoenix today", cta: "Apply", emphasis: true },
          { icon: "edit-3", kind: "Push brief", title: "Push site brief to East team", cta: "Send" },
          { icon: "user-plus", kind: "Approve hire", title: "Approve Sr. PM offer (Phoenix)", cta: "Approve" },
          { icon: "clock", kind: "Cap OT", title: "Cap site OT at 50h/wk", cta: "Cap" },
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
            { label: "Demand data coverage", value: 89, tone: "good" },
          ],
        },
        risks: [
          { tone: "high", title: "3 projects under-resourced \u00b7 30 days", sub: "PMM-25-000167, PMM-25-000212, +1" },
          { tone: "med", title: "Phoenix utilization projected 104%", sub: "Peak week of May 18" },
          { tone: "med", title: "2 PMs approaching burnout", sub: "Tom R. 91h/wk \u00b7 Ana D. 87h/wk" },
        ],
        actions: [
          { icon: "repeat", kind: "Move resources", title: "Move 4 FTE Boston \u2192 Phoenix", cta: "Apply", emphasis: true },
          { icon: "calendar", kind: "Delay pursuits", title: "Delay 3 non-critical proposals 2 wks", cta: "Defer" },
          { icon: "user-plus", kind: "Hire role", title: "Open 2 senior PM reqs \u00b7 Healthcare", cta: "Hire" },
          { icon: "clock", kind: "Shift schedule", title: "Shift Tom R. off PMM-25-000212", cta: "Shift" },
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
            { label: "Pipeline \u2194 resource match", value: 73, tone: "warn" },
            { label: "Cross-region balance", value: 78, tone: "warn" },
            { label: "Hiring runway", value: 86, tone: "good" },
          ],
        },
        risks: [
          { tone: "med", title: "Healthcare segment +18% demand", sub: "Drives Sr. PM gap by Jul 1" },
          { tone: "med", title: "4 PM seats unbacked at 60-day forecast", sub: "Phoenix + East regions" },
          { tone: "info", title: "Boston bench thinning", sub: "From 14 \u2192 9 designers in 60 days" },
        ],
        actions: [
          { icon: "repeat", kind: "Plan move", title: "Plan 6 FTE Boston \u2192 Phoenix wave 2", cta: "Plan", emphasis: true },
          { icon: "user-plus", kind: "Open reqs", title: "Open 4 PM reqs \u00b7 60-day fill", cta: "Open" },
          { icon: "calendar", kind: "Defer pursuits", title: "Defer 2 East pursuits to Q3", cta: "Defer" },
          { icon: "edit-3", kind: "Lock offers", title: "Lock 2 Sr. PM offers before lapse", cta: "Lock" },
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
            { label: "Capacity vs plan", value: 88, tone: "good" },
            { label: "Talent retention", value: 81, tone: "good" },
          ],
        },
        risks: [
          { tone: "high", title: "Q3 pursuit ramp needs +12 FTE", sub: "Vs current 90-day hire plan of 8" },
          { tone: "med", title: "Senior bench gap \u00b7 East region", sub: "Director + 2 Sr. PMs unfilled" },
          { tone: "info", title: "Cap-ex commitments outpace cash", sub: "Q3 lease + tech spend" },
        ],
        actions: [
          { icon: "user-plus", kind: "Approve plan", title: "Approve FY hire plan \u2014 18 roles", cta: "Approve", emphasis: true },
          { icon: "briefcase", kind: "Sign partner", title: "Sign 2 healthcare delivery partnerships", cta: "Sign" },
          { icon: "repeat", kind: "Restructure", title: "Restructure East region PM team", cta: "Plan" },
          { icon: "edit-3", kind: "Lock office", title: "Lock office expansion \u00b7 Phoenix", cta: "Lock" },
        ],
      },
    },
  },

  // ──────────────────────────────────────────────────────────────────
  // CFO — financial health. Default = 90d.
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
          trend: "\u22122 vs last wk",
          subs: [
            { label: "AR collected this wk", value: 58, tone: "warn" },
            { label: "Cash on hand", value: 84, tone: "good" },
            { label: "Invoices to send", value: 47, tone: "warn" },
            { label: "Spend vs daily plan", value: 78, tone: "warn" },
          ],
        },
        risks: [
          { tone: "high", title: "$620K AR aging past 90d", sub: "Top 2 clients \u00b7 escalation needed" },
          { tone: "med", title: "3 invoices not sent \u00b7 Castle Hill", sub: "Cycle delay 4 days" },
          { tone: "med", title: "Phoenix daily spend +6% vs plan", sub: "Drives weekly burn variance" },
        ],
        actions: [
          { icon: "dollar-sign", kind: "Escalate AR", title: "Push 3 AR escalations today", cta: "Send", emphasis: true },
          { icon: "edit-3", kind: "Send invoices", title: "Send Castle Hill invoice batch", cta: "Send" },
          { icon: "trending-down", kind: "Approve draws", title: "Approve $180K weekly draws", cta: "Approve" },
          { icon: "calendar", kind: "Block POs", title: "Block 2 non-critical POs this wk", cta: "Block" },
        ],
      },
      "30d": {
        horizon: WINDOW_HORIZON["30d"],
        health: {
          score: 73,
          label: "WATCH",
          trend: "\u22120.8 vs last 30d",
          subs: [
            { label: "Margin to plan", value: 64, tone: "warn" },
            { label: "AR > 30 days", value: 61, tone: "warn" },
            { label: "Pipeline coverage", value: 86, tone: "good" },
            { label: "Capex burn", value: 70, tone: "warn" },
          ],
        },
        risks: [
          { tone: "high", title: "Castle Hill margin trending \u22122.4%", sub: "Approved budget vs run-rate" },
          { tone: "med", title: "AR > 30 days at $2.3M", sub: "3 clients account for 71%" },
          { tone: "med", title: "Houston run-rate +4% over plan", sub: "Drives May margin slip" },
        ],
        actions: [
          { icon: "edit-3", kind: "Re-baseline", title: "Re-baseline Castle Hill mid-month", cta: "Open", emphasis: true },
          { icon: "dollar-sign", kind: "Drive AR", title: "Drive AR < 30d below $1.8M", cta: "Push" },
          { icon: "calendar", kind: "Defer capex", title: "Defer $180K capex 30 days", cta: "Defer" },
          { icon: "trending-down", kind: "Approve change", title: "Approve change order #14 \u00b7 Phoenix", cta: "Approve" },
        ],
      },
      "60d": {
        horizon: WINDOW_HORIZON["60d"],
        health: {
          score: 75,
          label: "STEADY",
          trend: "+0.4 vs last 60d",
          subs: [
            { label: "Forecast revenue", value: 82, tone: "good" },
            { label: "Q-to-date margin", value: 60, tone: "warn" },
            { label: "AR > 60 days", value: 55, tone: "warn" },
            { label: "Cash forecast", value: 88, tone: "good" },
          ],
        },
        risks: [
          { tone: "high", title: "AR > 60 days at $3.2M", sub: "Top 3 clients = 62%" },
          { tone: "med", title: "Q2 EBITDA at risk by $480K", sub: "Driven by Houston + Castle Hill" },
          { tone: "med", title: "2 large change orders pending", sub: "$2.8M combined \u00b7 Phoenix + Boston" },
        ],
        actions: [
          { icon: "edit-3", kind: "Lock forecast", title: "Lock Q2 forecast Friday", cta: "Lock", emphasis: true },
          { icon: "dollar-sign", kind: "Collections", title: "Push 6 collections cases", cta: "Send" },
          { icon: "trending-down", kind: "Approve change", title: "Approve Phoenix change order ($2.1M)", cta: "Approve" },
          { icon: "calendar", kind: "Hold capex", title: "Hold $480K capex pending Q2 close", cta: "Hold" },
        ],
      },
      "90d": {
        horizon: WINDOW_HORIZON["90d"],
        health: {
          score: 74,
          label: "WATCH",
          trend: "\u22121.2 vs last wk",
          subs: [
            { label: "Pipeline coverage", value: 84, tone: "good" },
            { label: "Delivery margin", value: 56, tone: "warn" },
            { label: "Margin vs plan", value: 67, tone: "warn" },
            { label: "Cash collection", value: 59, tone: "warn" },
          ],
        },
        risks: [
          { tone: "high", title: "NYCHA Castle Hill margin \u22123.2%", sub: "Delivery \u00b7 approved budget vs run-rate" },
          { tone: "high", title: "AR > 60 days at $4.1M", sub: "Cash flow \u00b7 top 3 clients = 62%" },
          { tone: "med", title: "Houston burn +5% vs plan", sub: "Margin \u00b7 drives Q2 EBITDA risk" },
        ],
        actions: [
          { icon: "edit-3", kind: "Re-baseline", title: "Re-baseline NYCHA Castle Hill margin", cta: "Open", emphasis: true },
          { icon: "dollar-sign", kind: "Collections", title: "Push 4 AR escalations \u00b7 cash flow", cta: "Send" },
          { icon: "trending-down", kind: "Approve change", title: "Approve $2.1M change order \u00b7 Phoenix", cta: "Approve" },
          { icon: "calendar", kind: "Defer capex", title: "Defer $480K Q2 capex to Q3", cta: "Defer" },
        ],
      },
    },
  },

  // ──────────────────────────────────────────────────────────────────
  // RESOURCE MANAGER — capacity health. Default = 30d.
  // ──────────────────────────────────────────────────────────────────
  RESOURCE_MANAGER: {
    greeting: "Capacity health",
    defaultWindow: "30d",
    windows: {
      "7d": {
        horizon: WINDOW_HORIZON["7d"],
        health: {
          score: 64,
          label: "TIGHT",
          trend: "\u22126 vs last wk",
          subs: [
            { label: "This-wk overload roles", value: 48, tone: "warn" },
            { label: "Open swaps", value: 40, tone: "warn" },
            { label: "Today's attendance", value: 92, tone: "good" },
            { label: "Weekly bench", value: 56, tone: "warn" },
          ],
        },
        risks: [
          { tone: "high", title: "Phoenix W19 peak at 117%", sub: "PM + Sr. Designer over-allocated" },
          { tone: "med", title: "Tom R. requested swap off PMM-25-000212", sub: "Awaiting cover" },
          { tone: "med", title: "2 callouts uncovered today", sub: "Boston site + Houston PM" },
        ],
        actions: [
          { icon: "repeat", kind: "Pull staff", title: "Pull 1 PM Boston \u2192 Phoenix this wk", cta: "Apply", emphasis: true },
          { icon: "clock", kind: "Cap hours", title: "Cap Ana D. at 50h this wk", cta: "Cap" },
          { icon: "user-plus", kind: "Approve contractor", title: "Approve 2 contractor day-rates", cta: "Approve" },
          { icon: "briefcase", kind: "Cover gap", title: "Cover Healthcare PMM-25-000167", cta: "Assign" },
        ],
      },
      "30d": {
        horizon: WINDOW_HORIZON["30d"],
        health: {
          score: 68,
          label: "TIGHT",
          trend: "\u22124 vs last wk",
          subs: [
            { label: "Bench coverage", value: 62, tone: "warn" },
            { label: "Overload roles", value: 35, tone: "warn" },
            { label: "Open requisitions", value: 58, tone: "warn" },
            { label: "Time to fill", value: 81, tone: "good" },
          ],
        },
        risks: [
          { tone: "high", title: "Phoenix overload W19\u2013W21", sub: "PM + Sr. Designer \u00b7 117% load" },
          { tone: "high", title: "3 senior PM gaps \u00b7 Healthcare", sub: "Required by June 1" },
          { tone: "med", title: "Ana D. 87h/wk \u00b7 3rd week", sub: "Burnout risk threshold breached" },
        ],
        actions: [
          { icon: "repeat", kind: "Reassign", title: "Move Tom R. off PMM-25-000212", cta: "Apply", emphasis: true },
          { icon: "user-plus", kind: "Open req", title: "Open 2 Sr. PM reqs \u2014 Healthcare", cta: "Open" },
          { icon: "clock", kind: "Pull staff", title: "Pull 1 PM from Boston \u2192 Phoenix", cta: "Shift" },
          { icon: "calendar", kind: "Cap hours", title: "Cap Ana D. at 50h/wk \u2014 next 2 wks", cta: "Cap" },
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
            { label: "Forecast utilization", value: 82, tone: "good" },
            { label: "Open requisitions", value: 52, tone: "warn" },
            { label: "Hire pipeline", value: 75, tone: "warn" },
          ],
        },
        risks: [
          { tone: "high", title: "4 senior PM gaps \u00b7 Healthcare by Jul 1", sub: "Drives 60-day delivery risk" },
          { tone: "med", title: "Phoenix overload extends to W23", sub: "Sr. Designer + Mech lead" },
          { tone: "med", title: "2 PM offers expiring this month", sub: "Risk losing both candidates" },
        ],
        actions: [
          { icon: "user-plus", kind: "Open reqs", title: "Open 4 Sr. PM reqs \u2014 60-day fill", cta: "Open", emphasis: true },
          { icon: "edit-3", kind: "Lock offers", title: "Lock 2 outstanding PM offers", cta: "Lock" },
          { icon: "repeat", kind: "Plan wave", title: "Plan Boston \u2192 Phoenix wave 2", cta: "Plan" },
          { icon: "clock", kind: "Cap OT", title: "Cap firm-wide OT at 55h/wk", cta: "Cap" },
        ],
      },
      "90d": {
        horizon: WINDOW_HORIZON["90d"],
        health: {
          score: 76,
          label: "STEADY",
          trend: "+8 vs prior qtr",
          subs: [
            { label: "Hire plan progress", value: 84, tone: "good" },
            { label: "Forecast bench", value: 78, tone: "good" },
            { label: "Attrition risk", value: 71, tone: "warn" },
            { label: "Org structure", value: 80, tone: "good" },
          ],
        },
        risks: [
          { tone: "med", title: "FY hire plan 12/18 filled", sub: "6 roles slipping past 90d" },
          { tone: "med", title: "Senior designer gap \u00b7 East region", sub: "Drives Q3 delivery risk" },
          { tone: "info", title: "Director backfill open \u00b7 Boston", sub: "Search firm engaged" },
        ],
        actions: [
          { icon: "user-plus", kind: "Approve plan", title: "Approve FY26 hire plan \u2014 18 roles", cta: "Approve", emphasis: true },
          { icon: "repeat", kind: "Restructure", title: "Restructure East PM team", cta: "Plan" },
          { icon: "edit-3", kind: "Sign retention", title: "Sign 2 retention agreements", cta: "Sign" },
          { icon: "briefcase", kind: "Open Director", title: "Open Director req \u00b7 Boston", cta: "Open" },
        ],
      },
    },
  },

  // ──────────────────────────────────────────────────────────────────
  // PROJECT MANAGER — my portfolio. Default = 7d.
  // ──────────────────────────────────────────────────────────────────
  PROJECT_MANAGER: {
    greeting: "My portfolio",
    defaultWindow: "7d",
    windows: {
      "7d": {
        horizon: WINDOW_HORIZON["7d"],
        health: {
          score: 86,
          label: "ON TRACK",
          trend: "+2 vs last wk",
          subs: [
            { label: "On-track projects", value: 92, tone: "good" },
            { label: "RFIs response time", value: 78, tone: "warn" },
            { label: "Schedule adherence", value: 88, tone: "good" },
            { label: "Approvals due", value: 60, tone: "warn" },
          ],
        },
        risks: [
          { tone: "high", title: "PMM-25-000167 \u2014 RFI overdue 4d", sub: "Sub-grade waterproofing detail" },
          { tone: "med", title: "PMM-25-000212 \u2014 schedule slip 4d", sub: "Steel delivery delayed" },
          { tone: "med", title: "2 approvals due by Friday", sub: "Change orders \u2014 $812K total" },
        ],
        actions: [
          { icon: "edit-3", kind: "Resolve RFIs", title: "Reply to 7 outstanding RFIs", cta: "Open", emphasis: true },
          { icon: "dollar-sign", kind: "Submit", title: "Submit Change Order #14 \u2014 Phoenix", cta: "Send" },
          { icon: "briefcase", kind: "Confirm", title: "Confirm subcontractor for Castle Hill", cta: "Confirm" },
          { icon: "calendar", kind: "Reschedule", title: "Reschedule steel pour to May 14", cta: "Update" },
        ],
      },
      "30d": {
        horizon: WINDOW_HORIZON["30d"],
        health: {
          score: 82,
          label: "ON TRACK",
          trend: "+1 vs last 30d",
          subs: [
            { label: "30-day milestones", value: 88, tone: "good" },
            { label: "RFI burn-down", value: 74, tone: "warn" },
            { label: "Change orders pending", value: 65, tone: "warn" },
            { label: "Schedule float", value: 86, tone: "good" },
          ],
        },
        risks: [
          { tone: "high", title: "4 milestones at risk in May", sub: "PMM-25-000167, PMM-25-000212, +2" },
          { tone: "med", title: "12 RFIs trending overdue", sub: "Across Phoenix + Castle Hill" },
          { tone: "med", title: "$2.1M change order pending \u00b7 Phoenix", sub: "Owner approval 12 days out" },
        ],
        actions: [
          { icon: "calendar", kind: "Recovery plan", title: "Build May milestone recovery plan", cta: "Plan", emphasis: true },
          { icon: "edit-3", kind: "Resolve RFIs", title: "Resolve 12 RFIs by 30th", cta: "Open" },
          { icon: "dollar-sign", kind: "Submit COs", title: "Submit 4 change orders this month", cta: "Send" },
          { icon: "briefcase", kind: "Re-sequence", title: "Re-sequence Castle Hill pour", cta: "Update" },
        ],
      },
      "60d": {
        horizon: WINDOW_HORIZON["60d"],
        health: {
          score: 80,
          label: "STEADY",
          trend: "\u00b10 vs last 60d",
          subs: [
            { label: "60-day milestones", value: 84, tone: "good" },
            { label: "Schedule confidence", value: 76, tone: "warn" },
            { label: "Subcontractor commits", value: 68, tone: "warn" },
            { label: "Submittals approved", value: 82, tone: "good" },
          ],
        },
        risks: [
          { tone: "high", title: "Steel package late by 2 wks", sub: "Phoenix \u00b7 pour cascade impact" },
          { tone: "med", title: "3 subs not committed for June pour", sub: "Castle Hill" },
          { tone: "med", title: "Permit hold-up \u00b7 Boston site", sub: "Appeal pending 18 days" },
        ],
        actions: [
          { icon: "edit-3", kind: "Lock sub", title: "Lock steel subcontractor by Friday", cta: "Lock", emphasis: true },
          { icon: "calendar", kind: "Owner reviews", title: "Schedule 60-day owner reviews", cta: "Schedule" },
          { icon: "briefcase", kind: "Permit appeal", title: "Submit Boston permit appeal", cta: "Submit" },
          { icon: "edit-3", kind: "Approve submittals", title: "Approve mech-elec submittals", cta: "Approve" },
        ],
      },
      "90d": {
        horizon: WINDOW_HORIZON["90d"],
        health: {
          score: 78,
          label: "STEADY",
          trend: "\u22122 vs prior qtr",
          subs: [
            { label: "Quarter milestones", value: 82, tone: "good" },
            { label: "Buyout complete", value: 70, tone: "warn" },
            { label: "Long-lead items", value: 65, tone: "warn" },
            { label: "Owner satisfaction", value: 88, tone: "good" },
          ],
        },
        risks: [
          { tone: "high", title: "Long-lead steel/glass arrival risk", sub: "Drives Q3 hand-over date" },
          { tone: "med", title: "Q3 buyout 70% complete", sub: "8 packages outstanding" },
          { tone: "med", title: "2 owner change requests pending", sub: "Castle Hill + Phoenix" },
        ],
        actions: [
          { icon: "edit-3", kind: "Approve buyout", title: "Approve Q3 buyout slate", cta: "Approve", emphasis: true },
          { icon: "briefcase", kind: "Long-lead", title: "Lock long-lead PO release", cta: "Release" },
          { icon: "calendar", kind: "Re-baseline", title: "Schedule owner re-baseline review", cta: "Schedule" },
          { icon: "user-plus", kind: "Plan staffing", title: "Plan punch-list staffing", cta: "Plan" },
        ],
      },
    },
  },

  // ──────────────────────────────────────────────────────────────────
  // EXECUTIVE — firm health. Default = 90d.
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
          trend: "\u00b10 vs last wk",
          subs: [
            { label: "Wins this wk", value: 75, tone: "warn" },
            { label: "Open critical issues", value: 84, tone: "good" },
            { label: "Cash position", value: 92, tone: "good" },
            { label: "Headcount today", value: 78, tone: "warn" },
          ],
        },
        risks: [
          { tone: "high", title: "2 RFP responses due Friday", sub: "Healthcare + Federal pursuits" },
          { tone: "med", title: "Phoenix MD candidate awaiting offer", sub: "Risk losing if past Wed" },
          { tone: "med", title: "NYC client escalation \u00b7 Castle Hill", sub: "Margin slip + schedule" },
        ],
        actions: [
          { icon: "user-plus", kind: "Approve offer", title: "Approve Phoenix MD offer", cta: "Approve", emphasis: true },
          { icon: "edit-3", kind: "Sign RFP", title: "Sign 2 RFP responses", cta: "Sign" },
          { icon: "briefcase", kind: "Client call", title: "Call NYC client today (Castle Hill)", cta: "Call" },
          { icon: "calendar", kind: "All-hands", title: "Issue all-hands update", cta: "Send" },
        ],
      },
      "30d": {
        horizon: WINDOW_HORIZON["30d"],
        health: {
          score: 80,
          label: "STEADY",
          trend: "+1 vs last 30d",
          subs: [
            { label: "Bookings vs plan", value: 82, tone: "good" },
            { label: "Operating margin", value: 68, tone: "warn" },
            { label: "Hire velocity", value: 75, tone: "warn" },
            { label: "Client NPS", value: 86, tone: "good" },
          ],
        },
        risks: [
          { tone: "high", title: "May bookings tracking \u2212$4M", sub: "Healthcare segment shortfall" },
          { tone: "med", title: "2 leadership offers pending close", sub: "Phoenix MD + East Dir." },
          { tone: "med", title: "Houston margin slip \u00b7 \u22121.8%", sub: "Drives May P&L variance" },
        ],
        actions: [
          { icon: "trending-down", kind: "Bookings push", title: "Approve May bookings push plan", cta: "Approve", emphasis: true },
          { icon: "edit-3", kind: "Lock offers", title: "Lock 2 leadership offers", cta: "Lock" },
          { icon: "briefcase", kind: "Intervene", title: "Approve Houston margin intervention", cta: "Approve" },
          { icon: "calendar", kind: "Brief board", title: "Brief board on May results", cta: "Brief" },
        ],
      },
      "60d": {
        horizon: WINDOW_HORIZON["60d"],
        health: {
          score: 79,
          label: "STEADY",
          trend: "+0.5 vs last 60d",
          subs: [
            { label: "60-day pipeline", value: 84, tone: "good" },
            { label: "Margin trend", value: 67, tone: "warn" },
            { label: "Hire pipeline", value: 73, tone: "warn" },
            { label: "Strategic initiatives", value: 81, tone: "good" },
          ],
        },
        risks: [
          { tone: "high", title: "60-day pipeline gap \u2212$8M", sub: "Healthcare + Education" },
          { tone: "med", title: "4 leadership seats open", sub: "Phoenix MD, East Dir., +2" },
          { tone: "med", title: "2 strategic initiatives at risk", sub: "AI rollout + East expansion" },
        ],
        actions: [
          { icon: "briefcase", kind: "Pursuit list", title: "Approve 60-day pursuit list", cta: "Approve", emphasis: true },
          { icon: "user-plus", kind: "Open reqs", title: "Open 4 leadership reqs", cta: "Open" },
          { icon: "edit-3", kind: "Re-baseline", title: "Re-baseline strategic plan", cta: "Open" },
          { icon: "repeat", kind: "Restructure", title: "Approve East region restructure", cta: "Approve" },
        ],
      },
      "90d": {
        horizon: WINDOW_HORIZON["90d"],
        health: {
          score: 79,
          label: "STEADY",
          trend: "+1 vs last wk",
          subs: [
            { label: "Pipeline coverage", value: 88, tone: "good" },
            { label: "Win rate (TTM)", value: 64, tone: "warn" },
            { label: "Hire velocity", value: 72, tone: "warn" },
            { label: "Client NPS", value: 84, tone: "good" },
          ],
        },
        risks: [
          { tone: "high", title: "Q3 pipeline gap \u2014 $14M short", sub: "Healthcare + Education segments" },
          { tone: "med", title: "Win rate dropped to 31%", sub: "Down from 38% trailing quarter" },
          { tone: "med", title: "2 key leadership hires delayed", sub: "Phoenix MD + East Region Dir." },
        ],
        actions: [
          { icon: "user-plus", kind: "Approve plan", title: "Approve FY26 hire plan \u2014 18 roles", cta: "Approve", emphasis: true },
          { icon: "briefcase", kind: "Review", title: "Review Q3 pipeline pursuit list", cta: "Open" },
          { icon: "edit-3", kind: "Sign", title: "Sign Phoenix office lease renewal", cta: "Sign" },
          { icon: "trending-down", kind: "Reset target", title: "Reset Q3 win-rate target to 35%", cta: "Set" },
        ],
      },
    },
  },
};

export function getRoleWindowSlice(role: RolePersona, win: WindowKey): RoleWindowSlice {
  const data = ROLE_HOME_DATA[role];
  return data.windows[win] ?? data.windows[data.defaultWindow];
}
