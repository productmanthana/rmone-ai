// Role-aware home screen. Re-skins the same template across all five
// personas — only the role badge, the four KPIs, the three risk items,
// and the four recommended actions change between roles. The visual
// shell (gauge, KPI tiles, risk rows, action rows) is the same for all
// roles, sourced from the mockup-sandbox visual spec at
// artifacts/mockup-sandbox/src/components/mockups/rmone-p5-nav/RoleHome.tsx.

import { compactUsd } from "../lib/money";
import React, { useEffect, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useLocation } from "wouter";
import { fmtPct } from "@/lib/utils";
import { ChevronRight, AlertTriangle, Sparkles, BarChart2, Users, FolderOpen, Zap, TrendingUp, Briefcase, DollarSign as DollarSignIcon, Building2 } from "lucide-react";
import { motion, AnimatePresence, useReducedMotion } from "framer-motion";
import { useAuth } from "@/lib/useAuth";
import {
  resolveActiveRole,
  rolePersonaBadge,
  rolePersonaFullName,
  getJobTitleOverride,
  type RolePersona,
} from "@/lib/roleResolver";
import {
  ROLE_HOME_DATA,
  getRoleWindowSlice,
  type ActionItem,
  type RiskItem,
  type SubDriver,
  type WindowKey,
} from "@/lib/roleHomeData";
import type { ActionDetail } from "@/lib/homeIntelligence";
import { loadDismissed, alertDismissKey } from "@/lib/alertDismiss";
import { effStart } from "@/lib/projectDates";
import { RiskSidePanel } from "@/components/RiskSidePanel";
import { KpiFormulaPanel } from "@/components/KpiFormulaPanel";
import { setChatPrompt } from "@/lib/chatBridge";
import { fetchHomeOverlay, fetchHomeOverlayPatient, type LiveOverlay, type LiveActionRecords } from "@/lib/homeLiveData";
import { readOverlayCache, writeOverlayCache, hasAnyCachedOverlay, readFallbackOverlay, noteOverlayShown, currentUserScope, CODE_VER } from "@/lib/overlayCache";
import { markHomeOverlayReady, splashElapsed } from "@/components/CommandCentreLoader";
import { getBusinessRules, useBusinessRulesVersion, whenBusinessRulesSettled } from "@/lib/businessRules";
import { setDashboardSnapshot } from "@/lib/dashboardSnapshot";
import { InfoTicker, type InfoTickerItem } from "@/components/InfoTicker";
import { AnimatedNumber } from "@/components/AnimatedNumber";
import { WhyInfo } from "@/components/WhyInfo";
import { HomeSkeleton } from "@/components/HomeSkeleton";
import { classifyIssueTarget, extractTicketIds, stripLeadingTicket } from "@/lib/issueLink";
import { classifyRisk, PLAIN_WORDS, whyItMatters, plainTermFor } from "@/lib/plainLanguage";
import { AddOpenPositionModal } from "@/components/AddOpenPositionModal";
import { AddTeamMemberModal } from "@/components/AddTeamMemberModal";
import { QuickActionsTeamModal } from "@/components/QuickActionsTeamModal";
import type { ResourceProjectWeekEdit, ResourceProjectWeeksEdit } from "@/components/ResourcesTimelineGrid";
import { saveMemberWeeklyHours } from "@/lib/saveMemberWeeklyHours";
import { getProjectDetails, getProjectTeam, getTaskData, getResourceAllocations, type LiveResourceProxy } from "@/lib/api";
import { subscribeDataChanged } from "@/lib/dataSync";
import { derivePlannerSchedule } from "@/lib/phaseHours";
import { firstQuickString, quickExistingAllocations } from "@/lib/quickActions";
import { getMyCapabilities, usePermissionsVersion } from "@/lib/permissions";
import { lazy as lazyLoad, Suspense as LazySuspense } from "react";

// StaffUtilModal lives in the (huge) resources page module. Lazy-load it so
// this eagerly-bundled home dashboard doesn't drag the entire resources page
// into the startup chunk — the modal only renders after a click, and the
// resources chunk is prefetched right after login anyway (see App.tsx).
const StaffUtilModal = lazyLoad(() =>
  import("@/pages/resources").then((m) => ({ default: m.StaffUtilModal })),
);

// Drill-down record tables must show the FULL matching set (panels paginate/scroll).
// Runaway-safety cap only, never a display subset.
const MAX_DETAIL_ROWS = 500;

function asRoleHomeRecordFields(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  const record = value as Record<string, unknown>;
  if (record.Status === true && record.Data && typeof record.Data === "object" && !Array.isArray(record.Data)) {
    return record.Data as Record<string, unknown>;
  }
  return record;
}

function demandRaId(value: unknown): number | null {
  const id = Number(value);
  return Number.isInteger(id) && id > 0 ? id : null;
}

/** Recover an exact open-slot ID only for alert cards cached before they began
 * carrying _raId. More than one matching role is deliberately left untouched:
 * the user must choose a particular slot rather than silently retiring a
 * different position with the same label. */
function recoverUniqueOpenSlotRaIds(
  openRoles: readonly { role?: string; title?: string; raIds?: number[] }[] | undefined,
  role: string,
): number[] | undefined {
  const normalized = role.trim().toLowerCase().replace(/\s*\(\d+\)$/, "").replace(/\s+/g, " ");
  if (!normalized || !openRoles) return undefined;
  const matches = openRoles.filter((slot) =>
    [slot.role, slot.title].some((label) =>
      String(label ?? "").trim().toLowerCase().replace(/\s*\(\d+\)$/, "").replace(/\s+/g, " ") === normalized,
    ) && (slot.raIds?.length ?? 0) > 0,
  );
  return matches.length === 1 ? matches[0].raIds : undefined;
}
const BG = "var(--rm-bg)";
const CARD = "var(--rm-panel)";
const GREEN = "#6BA539";
const LIGHT_GREEN = "#A9C23F";
const ORANGE = "#E87722";
const ORANGE_WARM = "#FF9425";
const RED = "#FF4D2E";

type TickerItem = InfoTickerItem;


function CompositeGauge({ score }: { score: number | null }) {
  const size = 220;
  const stroke = 14;
  const r = (size - stroke) / 2;
  const c = Math.PI * r;
  // REAL-DATA-ONLY: when there is no live score we draw an empty arc with a
  // neutral "—" readout — never a fabricated 0 that reads as real data.
  const hasData = score != null;
  const v = Math.max(0, Math.min(100, score ?? 0));
  const offset = c - (v / 100) * c;
  const h = size / 2 + 8;
  // Extra room below the arc for the 0/50/100 axis ticks. The arc endpoints
  // (and the tip marker dot at high scores) extend to roughly cy + stroke/2
  // + marker radius, so the tick row must clear that band or the "100" label
  // visually merges into the green end of the gauge.
  const tickRowH = 22;
  const cx = size / 2;
  const cy = size / 2;
  // Position the marker at the tip of the filled arc. The arc starts at
  // the left (180°) and sweeps clockwise to the right (0°), so the angle
  // for value v is 180° - (v/100 * 180°), measured from the positive x-axis.
  const angleDeg = 180 - (v / 100) * 180;
  const angleRad = (angleDeg * Math.PI) / 180;
  const tipX = cx + r * Math.cos(angleRad);
  const tipY = cy - r * Math.sin(angleRad);
  // Tone for the score chip — match the band coloring used on KPI tiles.
  const tipColor = !hasData ? "rgba(27,43,56,0.35)" : v < 60 ? "#DC2626" : v < 80 ? "#E87722" : "#15803D";
  return (
    <div className="relative" style={{ width: size, height: h + tickRowH }}>
      <svg width={size} height={h} viewBox={`0 0 ${size} ${h}`} className="overflow-visible" aria-hidden="true" focusable="false">
        <defs>
          <linearGradient id="composite-gauge-grad" x1="0" x2="1" y1="0" y2="0">
            <stop offset="0%" stopColor="#F59E0B" />
            <stop offset="55%" stopColor="#6BA539" />
            <stop offset="100%" stopColor="#15803D" />
          </linearGradient>
        </defs>
        <path
          d={`M ${stroke / 2} ${cy} A ${r} ${r} 0 0 1 ${size - stroke / 2} ${cy}`}
          fill="none"
          stroke="#E2E8F0"
          strokeWidth={stroke}
          strokeLinecap="round"
        />
        <path
          d={`M ${stroke / 2} ${cy} A ${r} ${r} 0 0 1 ${size - stroke / 2} ${cy}`}
          fill="none"
          stroke="url(#composite-gauge-grad)"
          strokeWidth={stroke}
          strokeLinecap="round"
          strokeDasharray={c}
          strokeDashoffset={offset}
        />
        {/* Marker dot at the tip of the filled arc — only rendered when
            there is live data, so the empty state shows no fabricated point. */}
        {hasData ? (
          <>
            <circle cx={tipX} cy={tipY} r={stroke / 2 + 4} fill="#FFFFFF" stroke={tipColor} strokeWidth={3} />
            <circle cx={tipX} cy={tipY} r={3} fill={tipColor} />
          </>
        ) : null}
      </svg>
      {/* Score readout. Always sits in the visual centre of the arc bowl as
          one large number, so it reads cleanly at any value and never
          collides with the moving arc-tip marker or the "0 / 50 / 100" axis
          ticks below (the prior chip-pinned-to-tip placement made the score
          and the "100" axis tick overlap at high values). */}
      <div
        className="absolute tabular-nums"
        style={{
          left: size / 2,
          top: cy - 24,
          transform: "translate(-50%, -50%)",
          fontSize: hasData ? 38 : 30,
          fontWeight: 800,
          color: tipColor,
          letterSpacing: "-0.02em",
          whiteSpace: "nowrap",
          lineHeight: 1,
        }}
      >
        {hasData ? Math.round(v) : "—"}
      </div>
      {/* Axis ticks live in their own row BELOW the arc (not overlaid on its
          bottom edge) so "0" and "100" never collide with the arc endpoints
          or the tip marker dot. Each end tick is centred under its arc
          endpoint (x = stroke/2 and x = size - stroke/2). */}
      <div className="absolute inset-x-0 bottom-0 text-[10px] font-semibold tabular-nums" style={{ height: tickRowH, color: "var(--rm-text-muted, #94A3B8)" }}>
        <span className="absolute bottom-0" style={{ left: stroke / 2, transform: "translateX(-50%)" }}>0</span>
        <span className="absolute bottom-0" style={{ left: "50%", transform: "translateX(-50%)" }}>50</span>
        <span className="absolute bottom-0" style={{ left: size - stroke / 2, transform: "translateX(-50%)" }}>100</span>
      </div>
    </div>
  );
}

// Build the popup detail for a KPI sub-driver. REAL-DATA-ONLY: home KPI
// tiles are live signals and we have no per-record breakdown for them in
// the overlay, so the detail shows the single live value/status (no
// fabricated supporting rows). The side panel falls back to its honest
// "no detail" empty state when rows are empty.
function buildKpiDetail(role: RolePersona, fullName: string, sub: SubDriver): ActionDetail {
  // Prefer the live underlying-records table the overlay attached for this
  // KPI driver (e.g. the actual projects behind "Schedule float") so the
  // popup shows real data, not just a one-line restatement of the number.
  if (sub.records && sub.records.rows.length > 0) {
    return sub.records;
  }
  const status = sub.tone === "good" ? "On track" : "Watch";
  const cols = [
    { key: "metric", label: "Signal" },
    { key: "current", label: "Live value", align: "right" as const },
    { key: "status", label: "Status" },
  ];
  const rows = [{ metric: sub.label, current: `${sub.value}`, status }];
  return {
    title: sub.label,
    subtitle: `${fullName} · ${sub.value} — ${status} (live RM ONE signal)`,
    columns: cols,
    rows,
  };
}

// Build a popup detail table for an Operational Risk Feed row. We try to
// extract any record IDs (PMM-25-####, OPM-25-####) from the sub line so
// each affected record renders as its own row, otherwise fall back to a
// single-row summary built from the title/sub copy.
function buildRiskDetail(role: RolePersona, fullName: string, risk: RiskItem): ActionDetail {
  // Prefer the live underlying-records table the overlay attached to this
  // risk (e.g. the 14 open staffing demands, the bench resources, the
  // projects an over-allocated person sits on). That IS the end-user
  // detail — fall through to the summary only when no records were attached
  // (curated SAMPLE rows or backend alert-feed rows that ship none).
  if (risk.records && risk.records.rows.length > 0) {
    return risk.records;
  }
  // REAL-DATA-ONLY: rows are derived solely from the live risk's own
  // title/sub copy — we do NOT fabricate owners or due dates we don't have.
  const cols = [
    { key: "record", label: "Record / Item" },
    { key: "issue", label: "Issue" },
  ];
  // Extract EVERY ticket ID (both PMM-26-001234 and OPM-00195 formats)
  // so an alert that bundles several projects renders one selectable
  // row per project — never a single row listing them all. Each row
  // carries its own _ticket so Go-to-issue / Ask AI target THAT record.
  const ids = extractTicketIds(`${risk.title} ${risk.sub}`);
  const issue = stripLeadingTicket(risk.title);
  let rows: Record<string, string>[];
  if (ids.length > 0) {
    rows = ids.map((rid) => ({
      record: rid,
      issue,
      _ticket: rid,
    }));
  } else {
    // No real ticket ID can be extracted — this is a portfolio-level
    // metric or a curated/sample row, not a single addressable project.
    // Tag it so the chat hand-off never sends the AI hunting for a
    // project that doesn't exist (see _aggregate check in handleModalConfirm).
    rows = [{ record: risk.title, issue: risk.sub, _aggregate: "true" }];
  }
  const tier = risk.tone === "high" ? "CRITICAL" : risk.tone === "info" ? "INFO" : "WARNING";
  return {
    title: risk.title,
    subtitle: `${tier} · ${fullName} · ${risk.sub}`,
    columns: cols,
    rows,
  };
}

// When a risk card has a backend-attached records table the raw `sub` text
// contains a dump of ticket IDs (e.g. "…currently On Hold: OPM-00195, OPM-00424…").
// Those IDs are already in the drill-down — showing them on the card face just
// adds noise. Return a clean count-based line instead.
const TICKET_LIST_RE = /[,\s]*\b[A-Z]{2,5}-\d{2,8}(?:-\d{2,8})?(?:\s*,\s*[A-Z]{2,5}-\d{2,8}(?:-\d{2,8})?)*(?:\s+and\s+\d+\s+more)?/g;
function cardSubText(risk: RiskItem): string {
  const n = risk.records?.rows?.length ?? 0;
  if (n > 0) {
    // Strip the colon+ID list from the AI summary and keep any leading prose,
    // then append a clean "N records — open to view" hint.
    const prose = (risk.sub ?? "")
      .replace(TICKET_LIST_RE, "")          // strip ticket-ID runs
      .replace(/:\s*$/, "")                 // strip trailing colon
      .trim();
    const hint = `${n} record${n === 1 ? "" : "s"} — open to view`;
    return prose ? `${prose} · ${hint}` : hint;
  }
  return risk.sub ?? "";
}

// Build a popup detail table for a recommended action. For LIVE actions we
// render the underlying RM ONE records (demand rows, bench resources, etc).
// For SAMPLE actions we render an illustrative single-row stub so the user
// still gets a confirmation view before the AI hand-off.
function buildActionDetail(
  role: RolePersona,
  fullName: string,
  action: ActionItem,
  records: LiveActionRecords | undefined,
): ActionDetail {
  const tierLabel = action.isLive ? "LIVE" : "SAMPLE";
  const subtitle = `${tierLabel} · ${fullName} · ${action.kind}`;

  // Prefer the per-decision detail table built by buildHomeIntelligence.
  // It carries exactly the records behind that specific decision (e.g. the
  // projects at revenue risk for a CFO PRIORITIZE, the near-close pursuits
  // for an ACCELERATE). Fall through to the category-switch only for legacy
  // overlay kinds that don't carry their own detail.
  if (action.isLive && action.detail) {
    return action.detail;
  }

  if (action.isLive && records) {
    if (action.kind === "Staff") {
      const cols = [
        { key: "ticket", label: "Ticket" },
        { key: "title", label: "Project" },
        { key: "role", label: "Role needed" },
        { key: "pct", label: "Allocation %", align: "right" as const },
        { key: "start", label: "Target start" },
      ];
      const rows = records.demands.slice(0, MAX_DETAIL_ROWS).map((d) => {
        // Carry the exact demand row id so the demand-coverage "Add Team
        // Member" quick action retires THIS position on save instead of
        // falling back to role-based recovery.
        const raId = Number((d as { RaId?: unknown })?.RaId);
        return {
          _ticket: String(d.TicketId ?? "").trim(),
          ...(Number.isInteger(raId) && raId > 0 ? { _raId: raId } : {}),
          ticket: d.TicketId,
          title: d.Title || "—",
          role: d.Role || "—",
          pct: d.PctAllocation != null ? `${Math.round(d.PctAllocation)}%` : "—",
          start: d.AllocationStartDate ? d.AllocationStartDate.slice(0, 10) : (effStart(d)?.toISOString().slice(0, 10) ?? "—"),
        };
      });
      return { title: action.title, subtitle, columns: cols, rows };
    }
    if (action.kind === "Reassign") {
      const cols = [
        { key: "name", label: "Resource" },
        { key: "user", label: "User" },
        { key: "role", label: "Role" },
        { key: "pct", label: "Current %", align: "right" as const },
        { key: "lastActive", label: "Last active" },
      ];
      const rows = records.benchResources.slice(0, MAX_DETAIL_ROWS).map((r) => ({
        name: r.name || "—",
        user: r.username || "—",
        role: r.role || "—",
        pct: fmtPct(r.currentPct ?? 0),
        lastActive: r.lastActiveDate ? r.lastActiveDate.slice(0, 10) : "—",
      }));
      return { title: action.title, subtitle, columns: cols, rows };
    }
    if (action.kind === "Rebalance") {
      const cols = [
        { key: "name", label: "Resource" },
        { key: "user", label: "User" },
        { key: "role", label: "Role" },
        { key: "pct", label: "Current %", align: "right" as const },
        { key: "projects", label: "Total Projects", align: "right" as const },
      ];
      const rows = records.overAllocatedResources.slice(0, MAX_DETAIL_ROWS).map((r) => ({
        name: r.name || "—",
        user: r.username || "—",
        role: r.role || "—",
        pct: fmtPct(r.currentPct ?? 0),
        projects: String(r.totalProjects ?? r.activeProjects?.length ?? 0),
      }));
      return { title: action.title, subtitle, columns: cols, rows };
    }
    if (action.kind === "Review") {
      const cols = [
        { key: "ticket", label: "Project" },
        { key: "title", label: "Title" },
        { key: "status", label: "Status" },
      ];
      const rows = records.atRiskProjects.slice(0, MAX_DETAIL_ROWS).map((p) => {
        const rec = p as Record<string, unknown>;
        return {
          ticket: String(rec.TicketId ?? rec.ShortName ?? "—"),
          title: String(rec.Title ?? rec.ShortName ?? "—"),
          status: String(
            rec.CRMProjectStatusChoice ?? rec.LeadStatus ?? rec.Status ?? "—",
          ),
        };
      });
      return { title: action.title, subtitle, columns: cols, rows };
    }
    if (action.kind === "Pursue") {
      const cols = [
        { key: "ticket", label: "Pursuit" },
        { key: "title", label: "Title" },
        { key: "status", label: "Status" },
      ];
      const rows = records.atRiskPursuits.slice(0, MAX_DETAIL_ROWS).map((p) => {
        const rec = p as Record<string, unknown>;
        return {
          ticket: String(rec.TicketId ?? rec.ShortName ?? "—"),
          title: String(rec.Title ?? rec.ShortName ?? "—"),
          status: String(
            rec.CRMOpportunityStatusChoice ?? rec.LeadStatus ?? rec.Status ?? "—",
          ),
        };
      });
      return { title: action.title, subtitle, columns: cols, rows };
    }
  }

  // REAL-DATA-ONLY fallback: home actions are live-only, but if a live
  // action arrives with a kind we have no record table for, show an honest
  // "no live detail" row rather than any fabricated owner/due placeholder.
  void role;
  return {
    title: action.title,
    subtitle,
    columns: [
      { key: "action", label: "Action" },
      { key: "note", label: "Detail" },
    ],
    rows: [
      {
        action: action.title,
        note: "No live record detail available for this action.",
      },
    ],
  };
}

// AI-style analysis: explain WHY this is the pinned critical risk in
// 2-3 short bullets the operator can scan in under 5 seconds.
function buildPinnedAnalysis(
  pinned: RiskItem,
  allRisks: RiskItem[],
): string[] {
  const reasons: string[] = [];
  const kind = classifyRisk(pinned.kind, pinned.title, pinned.sub);
  const pctMatch = pinned.title.match(/(\d{2,3})\s*%/);
  const pct = pctMatch ? Number(pctMatch[1]) : null;
  const projMatch = pinned.sub?.match(/across\s+(\d+)\s+project/i);
  const projCount = projMatch ? Number(projMatch[1]) : null;

  // The utilization wording only applies to genuine workload risks. A "%"
  // in a concentration or pipeline title (e.g. "Client X at 45% of active
  // work") used to produce nonsense like "Projected 45% utilization…" —
  // those kinds now get their plain-words explanation instead.
  if (kind === "over-allocation" && pct !== null && pct > 100) {
    const over = pct - 100;
    reasons.push(
      pct > 130
        ? `Projected ${pct}% utilization is ${over} pts over capacity — burnout and slip risk are immediate, not theoretical.`
        : `Projected ${pct}% utilization keeps this resource ${over} pts over capacity for the chosen window.`,
    );
  } else {
    reasons.push(PLAIN_WORDS[kind]);
  }
  if (projCount !== null && projCount > 0) {
    reasons.push(
      projCount >= 10
        ? `Cascade exposure: a single re-plan touches ${projCount} active projects — schedule, billing and client comms all move with it.`
        : `Cascade exposure across ${projCount} active project${projCount === 1 ? "" : "s"} — any slip propagates to those teams.`,
    );
  }
  const otherHigh = allRisks.filter(
    (r) => r.tone === "high" && r.title !== pinned.title,
  ).length;
  if (otherHigh > 0) {
    reasons.push(
      `${otherHigh} other critical risk${otherHigh === 1 ? "" : "s"} in the feed share this driver — resolving here unblocks the rest.`,
    );
  } else if (reasons.length < 2) {
    reasons.push(
      "No other critical risks competing for attention — fixing this one clears the board for the window.",
    );
  }
  return reasons.slice(0, 3);
}

// AI-style per-row rationale: one short sentence explaining WHY this
// action is recommended. Keyed off the action's `kind` with sensible
// fallbacks so SAMPLE rows also get useful context.
function buildActionRationale(a: ActionItem): string {
  const kind = (a.kind || "").toLowerCase();
  const metricVal = a.metric?.value;
  const has = (...needles: string[]) => needles.some((n) => kind.includes(n));

  if (a.isLive) {
    if (has("rebalance", "re-deploy", "move resources", "plan move", "pull staff", "reassign", "shift")) {
      return `${metricVal ?? "Several"} team members are projected to be overloaded — shifting work now prevents missed deadlines and burnout.`;
    }
    if (has("resolve rfis", "rfi")) {
      return `${metricVal ?? "Open"} information requests are taking too long to resolve — every extra day increases the risk of rework on site.`;
    }
    if (has("at risk", "pursuit", "follow-up", "follow up")) {
      return `${metricVal ?? "Several"} bids have stalled — a quick follow-up this week could keep them moving and protect potential revenue.`;
    }
    if (has("bench", "idle")) {
      return `${metricVal ?? "Some"} staff are available but not yet placed on a project — matching them to open positions now keeps work on track.`;
    }
    if (has("open demand", "demand")) {
      return `${metricVal ?? "Open"} staffing requests have no one assigned yet — filling these now keeps project start dates on schedule.`;
    }
    return `Flagged from current project and workforce data — recommended to act on this week.`;
  }

  // SAMPLE rows: explain the playbook rationale even without live data.
  if (has("rfi")) return `Tip: unresolved information requests tend to delay projects — clearing them early avoids rework.`;
  if (has("submit", "change order")) return `Tip: unsubmitted change orders leave revenue on the table — submitting them starts the approval clock.`;
  if (has("confirm", "subcontractor", "sub")) return `Tip: confirming subcontractors early is a key milestone — delays push every date that follows.`;
  if (has("approve", "hire", "offer", "req")) return `Tip: approving the hire now gives enough time to fill the role before the project needs the person.`;
  if (has("escalate ar", "collections", "drive ar", "ar ")) return `Tip: following up on overdue invoices improves cash flow this period.`;
  if (has("invoice", "send invoices")) return `Tip: sending invoices in batches brings in cash faster than billing one at a time.`;
  if (has("draw", "approve draws")) return `Tip: weekly draws keep the money coming in at the same pace the project is spending.`;
  if (has("block", "hold", "defer", "capex", "po ")) return `Tip: holding off on optional spending now protects the budget until the forecast is confirmed.`;
  if (has("re-baseline", "baseline", "lock forecast", "lock")) return `Tip: updating the plan now prevents surprises on costs and margins at quarter end.`;
  if (has("cap ot", "cap hours", "cap ", "shift schedule")) return `Tip: capping extra hours keeps labour costs inside the approved budget.`;
  if (has("cover gap", "cover", "assign")) return `Tip: filling the open role now keeps the project from falling behind to the next phase.`;
  if (has("partner", "sign")) return `Tip: locking in delivery partners early builds capacity before demand arrives.`;
  if (has("restructure", "lock office")) return `Tip: structural changes take time — starting now gives the best chance of hitting this year's targets.`;
  return `Best-practice recommendation for this role — connect live project data to trigger this automatically.`;
}

// Module-level flag: once RoleHome has rendered real content (overlay
// loaded) in this browser session, never show the initial-load skeleton
// again — even if the component unmounts on navigation and remounts.
let homeHasRenderedOnce = false;

// Modal/side-panel state shape. Exactly one variant or null at a time.
type ModalCtx =
  | { kind: "kpi"; sub: SubDriver; detail: ActionDetail }
  | { kind: "risk"; risk: RiskItem; detail: ActionDetail }
  | { kind: "action"; action: ActionItem; detail: ActionDetail }
  | null;

// ── Side-panel content helpers ───────────────────────────────────────
// Compute the title/subtitle/tier/explanation for the unified
// RiskSidePanel from any modal kind. Kept at module scope so the JSX
// stays compact and the explanation copy lives in one place per kind.

function panelTitle(m: NonNullable<ModalCtx>): string {
  if (m.kind === "kpi") return m.sub.label;
  if (m.kind === "risk") return m.risk.title;
  return m.action.title;
}

function panelSubtitle(m: NonNullable<ModalCtx>, fullName: string): string {
  if (m.kind === "kpi") return `${fullName} · ${m.sub.value}% of target`;
  if (m.kind === "risk") return m.risk.sub;
  return `${m.action.kind} · ${fullName}`;
}

function panelKindLabel(m: NonNullable<ModalCtx>): string {
  if (m.kind === "kpi") return "Portfolio · KPI driver";
  if (m.kind === "risk") return "Operational risk";
  return "Recommended action";
}

function panelTier(m: NonNullable<ModalCtx>): { label: string; color: string } | undefined {
  if (m.kind === "risk") {
    if (m.risk.tone === "high") return { label: "CRITICAL", color: "#DC2626" };
    if (m.risk.tone === "info") return { label: "INFO", color: "#A9C23F" };
    return { label: "WARNING", color: "#E87722" };
  }
  if (m.kind === "kpi") {
    return m.sub.tone === "good"
      ? { label: "ON TRACK", color: "#A9C23F" }
      : { label: "WATCH", color: "#E87722" };
  }
  // action
  return m.action.isLive
    ? { label: "LIVE", color: "#A9C23F" }
    : { label: "SAMPLE", color: "#E87722" };
}

function panelExplanation(m: NonNullable<ModalCtx>): {
  what: string | string[];
  why: string;
  plain?: string;
} {
  if (m.kind === "risk") return buildRiskExplanation(m.risk, m.detail);
  if (m.kind === "kpi") return buildKpiExplanation(m.sub, m.detail);
  return buildActionExplanation(m.action, m.detail);
}

// ── Row-summary helpers ──────────────────────────────────────────────
// Inspect the actual records the panel is about to show and pull out
// concrete numbers (totals, top offender, % spread, $ value) so the
// "What's happening / Why it matters" copy describes THIS data, not a
// generic "pick a row below" instruction.

type RowSummary = {
  count: number;
  nameCol: string | null;
  pctCol: string | null;
  countCol: string | null;
  moneyCol: string | null;
  topName: string | null;
  topPct: number | null;
  topCount: number | null;
  pctValues: number[];
  countValues: number[];
  moneyValues: number[];
  topThree: { name: string; pct?: number; count?: number; money?: number }[];
};

function summarizeRows(detail: ActionDetail | undefined): RowSummary | null {
  const rows = detail?.rows;
  const cols = detail?.columns;
  if (!rows || !cols || rows.length === 0) return null;

  // Pick best column for each role by label/key keyword.
  const findCol = (...kw: string[]) => {
    const c = cols.find((c) => {
      const s = `${c.key} ${c.label}`.toLowerCase();
      return kw.some((k) => s.includes(k));
    });
    return c?.key ?? null;
  };
  const nameCol =
    findCol("resource", "name", "person", "user") ??
    findCol("project", "title", "client", "role") ??
    cols[0]?.key ??
    null;
  const pctCol = findCol("%", "percent", "alloc", "util");
  const countCol = findCol("project", "count", "demand", "req");
  const moneyCol = findCol("value", "amount", "$", "cost", "fee");

  const num = (v: unknown): number | null => {
    if (v == null) return null;
    const s = String(v).replace(/[$,%\s,]/g, "");
    if (!s || s === "—" || s === "-") return null;
    let mult = 1;
    if (/[Mm]$/.test(s)) mult = 1_000_000;
    else if (/[Kk]$/.test(s)) mult = 1_000;
    const n = Number(s.replace(/[^0-9.\-]/g, ""));
    return Number.isFinite(n) ? n * mult : null;
  };

  const pctValues: number[] = [];
  const countValues: number[] = [];
  const moneyValues: number[] = [];
  const enriched = rows.map((r) => {
    const name = nameCol ? String(r[nameCol] ?? "").trim() : "";
    const pct = pctCol ? num(r[pctCol]) : null;
    const count = pctCol !== countCol && countCol ? num(r[countCol]) : null;
    const money = moneyCol ? num(r[moneyCol]) : null;
    if (pct != null) pctValues.push(pct);
    if (count != null) countValues.push(count);
    if (money != null) moneyValues.push(money);
    return { name, pct, count, money };
  });

  // Rank rows by pct (if present) else money else count, descending.
  const ranked = [...enriched].sort((a, b) => {
    const av = a.pct ?? a.money ?? a.count ?? 0;
    const bv = b.pct ?? b.money ?? b.count ?? 0;
    return bv - av;
  });
  const top = ranked[0];

  return {
    count: rows.length,
    nameCol,
    pctCol,
    countCol: countCol === pctCol ? null : countCol,
    moneyCol,
    topName: top?.name || null,
    topPct: top?.pct ?? null,
    topCount: top?.count ?? null,
    pctValues,
    countValues,
    moneyValues,
    topThree: ranked.slice(0, 3).map((r) => ({
      name: r.name,
      pct: r.pct ?? undefined,
      count: r.count ?? undefined,
      money: r.money ?? undefined,
    })),
  };
}

function fmtMoneyShort(n: number): string {
  if (n >= 1_000_000_000) return compactUsd(n);
  if (n >= 1_000_000) return `$${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `$${(n / 1_000).toFixed(0)}K`;
  return `$${n.toFixed(0)}`;
}

function describeRow(
  r: { name: string; pct?: number; count?: number; money?: number },
  s: RowSummary,
): string {
  const parts: string[] = [];
  if (r.pct != null) parts.push(`${Math.round(r.pct)}%`);
  if (r.count != null && s.countCol)
    parts.push(`${Math.round(r.count)} ${labelFor(s.countCol)}`);
  if (r.money != null && s.moneyCol) parts.push(fmtMoneyShort(r.money));
  return parts.length ? `${r.name} (${parts.join(", ")})` : r.name;
}

function topThreeSentence(s: RowSummary): string {
  if (s.topThree.length === 0) return "";
  if (s.topThree.length === 1) return `Top: ${describeRow(s.topThree[0], s)}.`;
  const others = s.topThree
    .slice(1)
    .map((r) => describeRow(r, s))
    .join(", and ");
  return `The largest is ${describeRow(s.topThree[0], s)}, followed by ${others}.`;
}

function labelFor(key: string): string {
  const k = key.toLowerCase();
  if (k.includes("project")) return "projects";
  if (k.includes("demand")) return "demands";
  if (k.includes("count")) return "items";
  return "items";
}

export function buildRiskExplanation(
  risk: RiskItem,
  detail?: ActionDetail,
): { what: string | string[]; why: string; plain?: string } {
  const title = risk.title;
  const sub = risk.sub ?? "";
  const rkind = classifyRisk(risk.kind, title, sub);
  const plain = PLAIN_WORDS[rkind];
  const pctMatch = title.match(/(\d{2,3})\s*%/);
  const pct = pctMatch ? Number(pctMatch[1]) : null;
  const projMatch = sub.match(/across\s+(\d+)\s+project/i);
  const projCount = projMatch ? Number(projMatch[1]) : null;
  const nameMatch = title.match(/^([A-Z][a-zA-Z.]+(?:\s+[A-Z][a-zA-Z.]+)+)/);
  const name = nameMatch ? nameMatch[1] : null;

  const s = summarizeRows(detail);

  // The utilization branches only apply to genuine workload risks — a "%"
  // plus a capitalised name in a concentration title ("Acme Corp · 45% of
  // active work") used to read as a person's utilization.
  if (rkind === "over-allocation" && pct && pct > 100 && name) {
    const over = pct - 100;
    const bullets: string[] = [
      `${name} — allocated at ${pct}% of capacity (${over}+ pts over the 95% safe limit)`,
      projCount ? `Concurrent on ${projCount} projects simultaneously` : "",
      s && s.count > 1 ? `${s.count} affected assignments — see table below` : "",
    ].filter(Boolean);
    return {
      what: bullets,
      why:
        over >= 20
          ? `At this level, burnout, missed deliverables, and quality issues are very likely within 1–2 weeks. One or more projects will slip unless load is rebalanced now.`
          : `Sustained overload risks burnout and small schedule slips. Acting this week keeps it from cascading into delivery dates.`,
      plain,
    };
  }

  if ((rkind === "over-allocation" || rkind === "bench") && pct && pct < 70 && name) {
    return {
      what: [
        `${name} — utilization at ${pct}% (target band: 80–95%)`,
        `Well below target, meaning bench time is going unbilled`,
      ],
      why: `Unbilled bench time directly hits margin. Reassigning to a pursuit, demand, or open requisition recovers revenue this quarter.`,
      plain,
    };
  }

  // Generic risk: build a clean bullet list from actual record data.
  if (s) {
    const totalMoney = s.moneyValues.reduce((a, b) => a + b, 0);
    const bullets: string[] = [
      `${s.count} record${s.count === 1 ? "" : "s"} affected${
        totalMoney > 0 ? ` — ${fmtMoneyShort(totalMoney)} combined exposure` : ""
      }`,
      ...s.topThree.map((r, i) =>
        i === 0
          ? `Largest: ${describeRow(r, s)}`
          : `Also: ${describeRow(r, s)}`
      ),
    ];
    return {
      what: bullets,
      why: whyItMatters(rkind, risk.tone),
      plain,
    };
  }

  return {
    what: `${title}${sub ? ` — ${sub}` : ""}`,
    why: whyItMatters(rkind, risk.tone),
    plain,
  };
}

function buildKpiExplanation(
  sub: SubDriver,
  detail?: ActionDetail,
): { what: string | string[]; why: string; plain?: string } {
  const v = sub.value;
  const s = summarizeRows(detail);
  const status = sub.tone === "good" ? "on track" : "off target";
  // Glossary line for shorthand KPI names ("Demand coverage", "Bench", …).
  const glossary = plainTermFor(sub.label);
  const plain = glossary
    ? `"${sub.label}" means: ${glossary.plain}`
    : undefined;

  const bullets: string[] = [
    `${sub.label} — ${v}% of target (${status})`,
  ];

  if (s) {
    const totalMoney = s.moneyValues.reduce((a, b) => a + b, 0);
    bullets.push(
      `${s.count} record${s.count === 1 ? "" : "s"} make up this metric${
        totalMoney > 0 ? ` — ${fmtMoneyShort(totalMoney)} combined value` : ""
      }`,
    );
    s.topThree.forEach((r, i) => {
      bullets.push(i === 0 ? `Largest: ${describeRow(r, s)}` : `Also: ${describeRow(r, s)}`);
    });
  }

  if (sub.tone === "good") {
    return {
      what: bullets,
      why: `Healthy KPIs free attention for higher-leverage work. Use the records here to confirm no single line is quietly dragging the average down before it slips.`,
      plain,
    };
  }
  return {
    what: bullets,
    why:
      v < 50
        ? `At under half of target, this driver is materially hurting overall portfolio health. The largest one or two records above are where the leverage is — act there first.`
        : `Acting this week is materially cheaper than waiting. The top record above is the highest-leverage move — start there.`,
    plain,
  };
}

function buildActionExplanation(
  action: ActionItem,
  detail?: ActionDetail,
): { what: string | string[]; why: string } {
  const tag = action.isLive ? "live RM ONE signal" : "sample playbook";
  const s = summarizeRows(detail);

  if (!s) {
    return {
      what: [
        action.title,
        `${action.kind} action · triggered by a ${tag}`,
      ],
      why: action.isLive
        ? `The records below are the actual underlying data this action targets.`
        : `This is an illustrative recommendation based on role best-practice. The AI can convert it to a live action plan once you connect the underlying data.`,
    };
  }

  const totalMoney = s.moneyValues.reduce((a, b) => a + b, 0);
  const totalCount = s.countValues.reduce((a, b) => a + b, 0);
  const avgPct =
    s.pctValues.length > 0
      ? Math.round(s.pctValues.reduce((a, b) => a + b, 0) / s.pctValues.length)
      : null;
  const maxPct = s.pctValues.length > 0 ? Math.max(...s.pctValues) : null;
  const minPct = s.pctValues.length > 0 ? Math.min(...s.pctValues) : null;

  const noun =
    s.nameCol && /resource|user|person|name/i.test(s.nameCol)
      ? s.count === 1 ? "person" : "people"
      : `record${s.count === 1 ? "" : "s"}`;

  const bullets: string[] = [
    // Line 1: count + value
    `${s.count} ${noun} affected${
      totalMoney > 0 ? ` — ${fmtMoneyShort(totalMoney)} combined` : ""
    }`,
  ];

  // Line 2: allocation spread
  const spreadParts: string[] = [];
  if (maxPct != null && minPct != null) {
    if (maxPct === minPct) spreadParts.push(`all at ${maxPct}%`);
    else {
      spreadParts.push(`${minPct}%–${maxPct}%`);
      if (avgPct != null && minPct !== maxPct) spreadParts.push(`avg ${avgPct}%`);
    }
  }
  if (totalCount > 0 && s.countCol)
    spreadParts.push(`${totalCount} ${labelFor(s.countCol)}`);
  if (spreadParts.length > 0) bullets.push(spreadParts.join(" · "));

  // Lines 3+: top offenders
  s.topThree.forEach((r, i) => {
    bullets.push(i === 0 ? `Largest: ${describeRow(r, s)}` : `Also: ${describeRow(r, s)}`);
  });

  let why: string;
  if (!action.isLive) {
    why = `Sample data — illustrative of the kind of records this action would target once connected to live data.`;
  } else if (maxPct != null && maxPct > 100 && s.topName) {
    why = `${s.topName} is the most over capacity at ${Math.round(maxPct)}%, so handling that first removes the most immediate risk of burnout or schedule slip. Then work down the list.`;
  } else if (maxPct != null && maxPct < 70 && s.topName) {
    why = `${s.topName} has the largest unbilled gap at ${Math.round(maxPct)}%, so reassigning there recovers the most revenue fastest.`;
  } else if (s.topName) {
    why = `Start with ${s.topName} — it's the largest line, so handling it removes the most exposure for the least effort.`;
  } else {
    why = `Pick a record below to ask the AI to walk you through executing it concretely with owners, dates, and dollars.`;
  }

  return { what: bullets, why };
}

export function RoleHome() {
  const { user } = useAuth();
  const permissionsVersion = usePermissionsVersion();
  const capabilitiesQuery = useQuery({
    queryKey: ["my-capabilities", "role-home", user?.username ?? "", permissionsVersion],
    enabled: !!user,
    staleTime: 0,
    refetchOnMount: "always",
    queryFn: () => getMyCapabilities({ fresh: true }),
  });
  const canEditData = capabilitiesQuery.data?.caps.editData === true;
  const canManageStaff = capabilitiesQuery.data?.caps.manageStaff === true;
  const [, setLocation] = useLocation();
  const [role, setRole] = useState<RolePersona>(() =>
    resolveActiveRole(user?.userRoles, user?.username),
  );
  // Re-runs the overlay effect when the async business-rules load resolves
  // AFTER this component mounted. The overlay cache key embeds the rules
  // fingerprint, so a mount-before-rules-load reads under the default-rules
  // key (miss); once the real rules land the effect re-runs and the read
  // hits the correct key — cached data appears instantly instead of waiting
  // out a full cold fetch.
  const businessRulesVer = useBusinessRulesVersion();

  // Quick-action modal state — opened from risk-panel row selection.
  const [qaOpenPos, setQaOpenPos] = useState<{ projectId: string; projectName: string; role: string } | null>(null);
  const [qaAddMember, setQaAddMember] = useState<{
    projectId: string;
    projectName: string;
    role: string;
    consumeRaIds?: number[];
  } | null>(null);
  const qaAddMemberPrepQuery = useQuery({
    queryKey: ["role-home", "add-member-prep", qaAddMember?.projectId ?? ""],
    enabled: qaAddMember !== null,
    staleTime: 0,
    refetchOnMount: "always",
    queryFn: async () => {
      const target = qaAddMember;
      if (!target) throw new Error("No project selected for adding a team member.");
      const module = /^OPM(?:[-_]|$)/i.test(target.projectId) ? "OPM" : "PMM";
      const [details, team, tasks] = await Promise.all([
        getProjectDetails(target.projectId, { module, fresh: true }),
        getProjectTeam(target.projectId, true),
        getTaskData(target.projectId, "0").catch(() => null),
      ]);
      const fields = asRoleHomeRecordFields(details);
      let scheduleBounds = { start: "", end: "" };
      if (tasks) {
        const schedule = derivePlannerSchedule(tasks);
        if (schedule.state === "ready" && schedule.phases.length > 0) {
          scheduleBounds = {
            start: schedule.phases.reduce(
              (earliest, phase) => phase.start && phase.start < earliest ? phase.start : earliest,
              schedule.phases[0].start,
            ),
            end: schedule.phases.reduce(
              (latest, phase) => phase.end && phase.end > latest ? phase.end : latest,
              schedule.phases[0].end,
            ),
          };
        }
      }
      return {
        team,
        openRoles: team.openRoles,
        scheduleBounds,
        targetStart: firstQuickString(fields.TargetStartDate).slice(0, 10),
        targetEnd: firstQuickString(fields.TargetCompletionDate).slice(0, 10),
      };
    },
  });
  // New alert rows carry an explicit ID. This narrowly supports an alert that
  // was already in memory before that payload shape was introduced.
  const qaAddMemberConsumeRaIds = qaAddMember?.consumeRaIds
    ?? recoverUniqueOpenSlotRaIds(qaAddMemberPrepQuery.data?.openRoles, qaAddMember?.role ?? "");

  // Team-modal state — "Edit Allocation" from alert panel opens this instead
  // of navigating into the project.
  const [qaTeamModal, setQaTeamModal] = useState<{
    projectId: string; projectName: string; module: "PMM" | "OPM";
  } | null>(null);
  const qaTeamModalQuery = useQuery({
    queryKey: ["role-home", "team-modal", qaTeamModal?.projectId ?? ""],
    enabled: qaTeamModal !== null,
    staleTime: 0,
    refetchOnMount: "always",
    queryFn: async () => {
      const target = qaTeamModal;
      if (!target) throw new Error("No project selected for team modal.");
      const [team, tasks] = await Promise.all([
        getProjectTeam(target.projectId, true),
        getTaskData(target.projectId, "0").catch(() => null),
      ]);
      let scheduleBounds = { start: "", end: "" };
      if (tasks) {
        const schedule = derivePlannerSchedule(tasks);
        if (schedule.state === "ready" && schedule.phases.length > 0) {
          scheduleBounds = {
            start: schedule.phases.reduce(
              (e, p) => p.start && p.start < e ? p.start : e,
              schedule.phases[0].start,
            ),
            end: schedule.phases.reduce(
              (l, p) => p.end && p.end > l ? p.end : l,
              schedule.phases[0].end,
            ),
          };
        }
      }
      return { team, scheduleBounds };
    },
  });

  // Role-switch popup state.
  const [roleChanging, setRoleChanging] = useState(false);
  const [roleSwitchStep, setRoleSwitchStep] = useState(0);
  const [switchingToRole, setSwitchingToRole] = useState<RolePersona | null>(null);
  // Ref mirrors windowChangeRef: set true when a role switch fires, cleared
  // by the overlay fetch effect once new data arrives (not by a fixed timer).
  const roleChangeRef = useRef(false);
  // Tracks current role in a ref so the event handler always sees the latest value
  // without a stale closure (the handler is registered once per user-change).
  const currentRoleRef = useRef<RolePersona>(resolveActiveRole(user?.userRoles, user?.username));

  // Re-resolve when the user changes OR when the avatar menu fires the
  // override-changed event so the home repaints the moment the user
  // switches roles from anywhere in the chrome.
  useEffect(() => {
    const resolved = resolveActiveRole(user?.userRoles, user?.username);
    setRole(resolved);
    currentRoleRef.current = resolved;
    const onChange = () => {
      const next = resolveActiveRole(user?.userRoles, user?.username);
      if (next !== currentRoleRef.current) {
        // Show the role-switch popup and progress the step animation on
        // staggered timers. The popup itself stays until the overlay fetch
        // completes (roleChangeRef cleared in the overlay effect below) so
        // it never disappears before real data is on screen.
        roleChangeRef.current = true;
        setSwitchingToRole(next);
        setRoleSwitchStep(0);
        setRoleChanging(true);
        const t1 = setTimeout(() => setRoleSwitchStep(1), 350);
        const t2 = setTimeout(() => setRoleSwitchStep(2), 850);
        const t3 = setTimeout(() => setRoleSwitchStep(3), 1500);
        // Safety fallback: dismiss after 12s if the fetch never resolves.
        const tSafe = setTimeout(() => {
          if (roleChangeRef.current) {
            roleChangeRef.current = false;
            setRoleChanging(false);
          }
        }, 12000);
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (onChange as any)._timers = [t1, t2, t3, tSafe];
      }
      currentRoleRef.current = next;
      setRole(next);
    };
    window.addEventListener("rmone:roleOverrideChanged", onChange);
    return () => {
      window.removeEventListener("rmone:roleOverrideChanged", onChange);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      ((onChange as any)._timers ?? []).forEach(clearTimeout);
    };
  }, [user?.userRoles, user?.username]);

  const data = ROLE_HOME_DATA[role];

  // The home screen no longer has a day-window picker — every persona
  // always sees all-time, whole-tenant data. `currentWindow` is kept only
  // as an internal key into the curated-fallback/cache structures (which
  // are still keyed by WindowKey), pinned to the role's default bucket.
  const currentWindow: WindowKey = data.defaultWindow;

  // Kept as a stable no-op ref so the (now unused) window-change splash
  // path never fires; overlay loading still uses its own splash below.
  const windowChangeRef = useRef(false);
  const [windowChanging] = useState(false);
  const prefersReducedMotion = useReducedMotion();

  const slice = getRoleWindowSlice(role, currentWindow);

  // Live-data overlay. Fetched on (role, window) change. While it's
  // loading or unavailable the curated slice is shown unchanged but
  // every tile/row carries a "SAMPLE" badge. Once the overlay arrives,
  // any sub-driver label or risk row that the adapter produced gets
  // replaced with the live value and the badge is removed.
  // Seed from the cache so a revisit / in-session reload renders the last
  // good payload instantly (no "preparing your home" splash) while a fresh
  // fetch refreshes it in the background — stale-while-revalidate.
  // A cached overlay is only useful as a seed if it has real live data.
  // An overlay with empty liveSubs (e.g. written when resources were 0)
  // would show every sub-driver as "NOT AVAILABLE YET" immediately and
  // dismiss the loading state — treat it as "no cache" instead so we wait
  // for the fresh fetch before revealing the card.
  const hasMeaningfulCache = (o: LiveOverlay | null) =>
    o != null && Object.keys(o.liveSubs ?? {}).length > 0;
  const [overlay, setOverlay] = useState<LiveOverlay | null>(() => {
    // Exact-key read first; when it misses (role default not yet resolved,
    // rules fingerprint drift, or the only in-session payload was partial and
    // therefore never exact-key cached) fall back to the last overlay this
    // user actually SAW, so returning to home never regresses to a several-
    // second "Loading live data…" state. Revalidation still runs below.
    const o = readOverlayCache(role, currentWindow, user?.username) ?? readFallbackOverlay(user?.username);
    return hasMeaningfulCache(o) ? o : null;
  });
  const [overlayLoading, setOverlayLoading] = useState(
    // Use hasAnyCachedOverlay for the lazy init: the exact role/window/rules-
    // version key isn't reliable at this point (userRoles from the profile API
    // isn't in the sync auth store, so role often resolves to a default that
    // doesn't match the cache key). Checking for ANY entry for this user is
    // enough to safely skip the HomeSkeleton on return visits.
    () => !hasAnyCachedOverlay(user?.username),
  );
  // Capture the "any cache" state once at mount. Used in the fetch effect to
  // prevent re-showing the skeleton on exact-key misses for returning users.
  // A returning user (hadAnyCachedAtMount=true) should always see the home
  // frame immediately — the overlay fills in when the fresh fetch completes.
  const hadAnyCachedAtMount = useRef(hasAnyCachedOverlay(user?.username));
  // True while a fresh overlay fetch is in flight AND there is no cached
  // seed on screen. Returning users skip the full skeleton, so without this
  // flag the frame renders "No live data" placeholders during the fetch —
  // misleading (data exists, it just isn't here yet). The render below uses
  // it to show "Loading live data…" instead.
  const [overlayPending, setOverlayPending] = useState(false);
  // Re-run the overlay when ANY data write lands — hours/allocation saves,
  // team adds/removes, open-position changes, record status/field edits,
  // staff changes — via the unified data-sync bus (lib/dataSync.ts). The
  // subscription covers both this tab (rmone:dataChanged) and sibling tabs
  // (scope-only storage marker), so the risk feed, demand count and decision
  // support never wait for the normal mount/role refresh cycle or a manual
  // browser refresh.
  const [allocationRevision, setAllocationRevision] = useState(0);
  useEffect(() => {
    return subscribeDataChanged("any", () => setAllocationRevision((revision) => revision + 1));
  }, []);
  useEffect(() => {
    let alive = true;
    let retryTimer: ReturnType<typeof setTimeout> | null = null;
    // Wait (capped at 3 s) for the company's business-rules load to settle
    // BEFORE reading the overlay cache or building: the cache key embeds the
    // rules fingerprint, so building against default rules would first miss
    // the cache and then rebuild once the real rules landed moments later.
    // This wait used to live in signIn(), where it held the "Signing in…"
    // button spinner for seconds — here it runs behind the post-login splash
    // (or the already-rendered cached frame), so sign-in completes instantly.
    void (async () => {
    await whenBusinessRulesSettled(3000);
    if (!alive) return;
    // Same exact-then-fallback order as the lazy init. During a DELIBERATE
    // role switch the fallback is skipped: it holds the previous role's
    // payload, and the switch popup should resolve into fresh data for the
    // new role rather than flashing the old role's numbers.
    const cached =
      readOverlayCache(role, currentWindow, user?.username) ??
      (roleChangeRef.current ? null : readFallbackOverlay(user?.username));
    // Capture whether we already have meaningful cached data BEFORE the
    // background fetch runs. Used below to prevent a "good → bad" downgrade
    // where a fresh fetch returns generatedAt > 0 but empty liveSubs, which
    // would replace the sub-drivers the user was already seeing with
    // "NOT AVAILABLE YET" until the next full page refresh.
    const hadGoodCache = hasMeaningfulCache(cached);
    console.log(
      `[splash] RoleHome overlay effect start at +${splashElapsed()}ms (role=${role}, cachedHit=${hadGoodCache})`,
    );
    if (hadGoodCache) {
      // Show cached data immediately and revalidate silently in the
      // background — no loading state, no blank flash.
      setOverlay(cached);
      setOverlayLoading(false);
      setOverlayPending(false);
      // Signal the post-login splash that the overlay is ready so it can
      // dismiss. Idempotent — safe to call on background revalidations.
      markHomeOverlayReady();
      // If a role-switch popup is showing and we already have cached data,
      // let the step animation finish (step 3 fires at 1500ms) then dismiss.
      if (roleChangeRef.current) {
        setTimeout(() => {
          if (roleChangeRef.current) {
            roleChangeRef.current = false;
            setRoleChanging(false);
          }
        }, 1800);
      }
    } else {
      // Nothing cached (or cached overlay has no live data) — reset so a
      // stale/empty prior overlay can't keep showing while the fetch runs.
      setOverlay(null);
      setOverlayPending(true);
      // Only engage the full-screen skeleton if this user has NEVER loaded
      // the home page before. If they have any prior cached overlay
      // (hadAnyCachedAtMount=true), keep overlayLoading=false so the home
      // frame renders immediately while the fresh fetch fills in the data.
      // This prevents the skeleton re-appearing on every page reload even
      // after many successful visits.
      if (!hadAnyCachedAtMount.current) {
        setOverlayLoading(true);
      }
    }

    // Small helper — dismiss loading and signal both locally and to the
    // CommandCentreLoader splash that the overlay is done.
    function doneLoading() {
      if (!alive) return;
      setOverlayLoading(false);
      setOverlayPending(false);
      markHomeOverlayReady();
      if (roleChangeRef.current) {
        roleChangeRef.current = false;
        setRoleChanging(false);
      }
    }

    // Snapshot the signed-in identity scope BEFORE the fetch chain starts.
    // Every writeOverlayCache below passes it so a slow fetch that resolves
    // after a same-browser login as a different user/tenant is dropped
    // instead of persisting the old identity's data under the new key.
    const scopeAtStart = currentUserScope(user?.username);
    fetchHomeOverlay(role, currentWindow, { username: user?.username })
      .then((o) => {
        if (!alive) return;
        console.log(
          `[splash] overlay first fetch resolved at +${splashElapsed()}ms (generatedAt=${o.generatedAt > 0 ? "set" : "0"}, partial=${o.partial === true}, subs=${Object.keys(o.liveSubs ?? {}).length})`,
        );
        // Only replace / persist if the new overlay is meaningfully better,
        // OR if we had no good cached data to begin with. This prevents a
        // silent downgrade: e.g. a fast first-fetch with generatedAt > 0 but
        // empty liveSubs was overwriting the good stale cache and showing
        // "NOT AVAILABLE YET" for every sub-driver until a hard refresh.
        // A PARTIAL overlay (some source calls failed) never replaces good
        // cached data — it is only shown when there was nothing better.
        if ((hasMeaningfulCache(o) && !o.partial) || !hadGoodCache) {
          writeOverlayCache(role, currentWindow, user?.username, o, scopeAtStart);
          // Record what actually went on screen — including PARTIAL overlays,
          // which the exact-key cache rejects. Without this a single transient
          // source failure meant nothing was cached and every later visit to
          // home showed "Loading live data…" from scratch.
          noteOverlayShown(user?.username, o, scopeAtStart);
          setOverlay(o);
        }

        if (o.generatedAt === 0) {
          // Cold-start: first fetch returned no data (API server still booting).
          // Keep overlayLoading=true so the skeleton stays visible — it will
          // be cleared by the retry below. The user goes straight from the
          // loading card to a populated home instead of seeing a blank flash.
          retryTimer = setTimeout(() => {
            if (!alive) return;
            fetchHomeOverlay(role, currentWindow, { username: user?.username })
              .then((retried) => {
                if (!alive) return;
                if (retried.generatedAt > 0 && ((hasMeaningfulCache(retried) && !retried.partial) || !hadGoodCache)) {
                  writeOverlayCache(role, currentWindow, user?.username, retried, scopeAtStart);
                  noteOverlayShown(user?.username, retried, scopeAtStart);
                  setOverlay(retried);
                } else if (retried.generatedAt === 0) {
                  // Both quick attempts returned empty — keep the loading
                  // spinner visible and fire a patient 45 s fetch. Only
                  // dismiss the skeleton once it resolves (with or without
                  // data) so the user never sees "NO LIVE DATA" while real
                  // data is still on its way from a slow RDS connection.
                  fetchHomeOverlayPatient(role, currentWindow, { username: user?.username })
                    .then((bg) => {
                      if (!alive) return;
                      if (bg.generatedAt > 0 && ((hasMeaningfulCache(bg) && !bg.partial) || !hadGoodCache)) {
                        writeOverlayCache(role, currentWindow, user?.username, bg, scopeAtStart);
                        noteOverlayShown(user?.username, bg, scopeAtStart);
                        setOverlay(bg);
                      }
                      doneLoading();
                    })
                    .catch(() => { doneLoading(); });
                  // Do NOT call doneLoading() here — the patient fetch owns it.
                  return;
                }
                // Always stop loading after the retry, whether it has data or not.
                doneLoading();
              })
              .catch(() => { doneLoading(); });
          }, 3_000);
        } else if (!hasMeaningfulCache(o) && !hadGoodCache) {
          // First fetch returned real data (generatedAt > 0) but no sub-drivers
          // yet — the overlay likely computed before the pipeline cache was warm.
          // Fire one 2.5-second retry so we get populated data rather than
          // immediately showing "NO LIVE DATA". If the retry also returns empty,
          // accept it as the genuine tenant state and dismiss loading.
          retryTimer = setTimeout(() => {
            if (!alive) return;
            fetchHomeOverlay(role, currentWindow, { username: user?.username })
              .then((retried) => {
                if (!alive) return;
                if (hasMeaningfulCache(retried) && (!retried.partial || !hadGoodCache)) {
                  writeOverlayCache(role, currentWindow, user?.username, retried, scopeAtStart);
                  noteOverlayShown(user?.username, retried, scopeAtStart);
                  setOverlay(retried);
                }
                doneLoading();
              })
              .catch(() => { doneLoading(); });
          }, 2_500);
        } else {
          // Real data with sub-drivers arrived on the first try — dismiss immediately.
          doneLoading();
          if (o.partial) {
            // The overlay is showing but was computed from incomplete data
            // (some source calls failed — usually cold server caches). Retry
            // silently after the server has had time to warm; only replace
            // with a COMPLETE overlay so the page upgrades, never downgrades.
            retryTimer = setTimeout(() => {
              if (!alive) return;
              fetchHomeOverlay(role, currentWindow, { username: user?.username })
                .then((retried) => {
                  if (!alive) return;
                  if (!retried.partial && hasMeaningfulCache(retried)) {
                    writeOverlayCache(role, currentWindow, user?.username, retried, scopeAtStart);
                    noteOverlayShown(user?.username, retried, scopeAtStart);
                    setOverlay(retried);
                  }
                })
                .catch(() => { /* keep showing the partial overlay */ });
            }, 8_000);
          }
        }
      })
      .catch(() => {
        if (!alive) return;
        setOverlayLoading(false);
        setOverlayPending(false);
        markHomeOverlayReady();
        // Dismiss on error too so the popup never gets stuck.
        if (roleChangeRef.current) {
          roleChangeRef.current = false;
          setRoleChanging(false);
        }
      });
    })();
    // Safety escape hatch: if the fetch chain never resolves (hung backend),
    // force the skeleton off after 75 s (12s quick + 3s delay + 12s retry +
    // 45s patient + 3s margin) so the user isn't stuck forever.
    const bail = setTimeout(() => {
      if (!alive) return;
      setOverlayLoading(false);
      // Clear the pending flag too, or a hung backend would leave the
      // "Loading live data…" placeholders showing forever instead of the
      // honest "No live data" state.
      setOverlayPending(false);
      if (roleChangeRef.current) {
        roleChangeRef.current = false;
        setRoleChanging(false);
      }
    }, 75_000);
    return () => {
      alive = false;
      clearTimeout(bail);
      if (retryTimer != null) clearTimeout(retryTimer);
    };
  }, [role, currentWindow, user?.username, CODE_VER, businessRulesVer, allocationRevision]);

  // REAL-DATA-ONLY: the home dashboard renders exclusively live RM ONE
  // signals. Curated / illustrative ("SAMPLE") values are never shown —
  // any sub-driver, risk, or action without a live source is omitted and
  // the surface falls back to an explicit empty state instead. The
  // curated slice is used ONLY to decide WHICH sub-driver labels are
  // relevant to each role/window, never for values.
  const liveSubs = overlay?.liveSubs ?? {};
  const liveSubRecords = overlay?.liveSubRecords ?? {};
  const liveRisks = overlay?.liveRisks ?? [];
  // Every role-relevant sub-driver, flagged live or not. Non-live tiles are
  // kept on the card and rendered as "NOT AVAILABLE YET" (no fabricated
  // value) instead of being dropped — the curated slice supplies only the
  // label set, never values.
  const displaySubs: SubDriver[] = slice.health.subs.map((s): SubDriver => {
    const live = liveSubs[s.label];
    return live
      ? {
          ...s,
          value: live.value,
          tone: live.tone,
          isLive: true,
          records: liveSubRecords[s.label],
          formulaDetail: live.formulaDetail,
        }
      : { ...s, isLive: false };
  });
  // Live-only subset: drives the health score, counts, ticker and the
  // dashboard snapshot sent to chat — never the non-live placeholders.
  const mergedSubs: SubDriver[] = displaySubs.filter((s) => s.isLive);
  // Risks & actions: live only, no curated backfill. Respect alerts the user
  // dismissed on the Alerts page (shared localStorage store) so a dismissal
  // there immediately disappears from the home risk feed too.
  const dismissedAlerts = loadDismissed();
  const riskSeen = new Set<string>();
  const mergedRisks: RiskItem[] = liveRisks
    .filter((r) => !dismissedAlerts[alertDismissKey(r)])
    .filter((r) => {
      // Never show the exact same signal twice in one feed.
      const k = `${r.title}|${r.sub ?? ""}`;
      if (riskSeen.has(k)) return false;
      riskSeen.add(k);
      return true;
    })
    .slice(0, 7);
  // Pinned Critical surfaces the top high-tone risk as its own card, so
  // the Operational Risk Feed below must NOT repeat it — one signal, one
  // surface. Feed rows = everything except the pinned item.
  const pinnedRisk: RiskItem | null =
    mergedRisks.find((r) => r.tone === "high") ?? null;
  const feedRisks: RiskItem[] = mergedRisks.filter((r) => r !== pinnedRisk);
  const liveActions = overlay?.liveActions ?? [];
  const mergedActions: ActionItem[] = liveActions.slice();
  const liveCount = mergedSubs.length + mergedRisks.length + mergedActions.length;

  // Home risk links for a person-level over-allocation should open the same
  // all-projects allocation popup used by the Resources timeline. Keep the
  // original URL as a fail-safe if the live resource cannot be resolved.
  const [homeAllocationTarget, setHomeAllocationTarget] = useState<{
    person: string;
    fallback: string;
  } | null>(null);
  const homeAllocationQuery = useQuery<LiveResourceProxy | null>({
    queryKey: ["role-home", "allocation-popup", user?.username ?? "", homeAllocationTarget?.person ?? ""],
    enabled: homeAllocationTarget !== null,
    staleTime: 0,
    queryFn: async () => {
      const target = homeAllocationTarget;
      if (!target) return null;
      const key = target.person.trim().toLowerCase();
      const matches = (r: LiveResourceProxy) =>
        (r.id || "").toLowerCase() === key ||
        (r.username || "").toLowerCase() === key ||
        (r.name || "").trim().toLowerCase() === key;
      const cached = overlay?.records.overAllocatedResources.find(matches);
      if (cached) return cached;
      const fresh = await getResourceAllocations();
      return fresh.resources.find(matches) ?? null;
    },
  });
  useEffect(() => {
    const target = homeAllocationTarget;
    if (!target || !homeAllocationQuery.isFetched || homeAllocationQuery.isFetching || homeAllocationQuery.data !== null) return;
    setHomeAllocationTarget(null);
    setLocation(target.fallback);
  }, [homeAllocationQuery.data, homeAllocationQuery.isFetched, homeAllocationQuery.isFetching, homeAllocationTarget, setLocation]);

  // Overall health score derived from the live sub-driver tones shown,
  // NOT a curated constant. We average a per-sub health contribution
  // (good = 100, warn = 50) rather than the raw values, because some live
  // sub-drivers are count-style/inverted (e.g. "Open requisitions",
  // "Overload roles") where a high value means WORSE — their tone already
  // encodes health correctly, the raw value does not. Null when there are
  // no live sub-drivers, in which case the gauge shows a "no data" state.
  const liveScore: number | null =
    mergedSubs.length > 0
      ? Math.round(
          mergedSubs.reduce((sum, s) => sum + (s.tone === "good" ? 100 : 50), 0) /
            mergedSubs.length,
        )
      : null;
  // True while the first fetch is still in flight with nothing on screen —
  // render "Loading live data…" placeholders instead of the misleading
  // "No live data" (which is reserved for a COMPLETED fetch with no data).
  const overlayFetching = overlayPending && overlay == null;
  const liveLabel =
    liveScore == null
      ? overlayFetching
        ? "Loading live data…"
        : "No live data"
      : liveScore >= 80
        ? "On Track"
        : liveScore >= 60
          ? "Watch"
          : "At Risk";

  // Publish the current home view to the dashboard-snapshot store so
  // /chat can forward it to api-server as `dashboardContext` on every
  // message send. This lets the assistant ground answers like
  // "Phoenix overload forecast" in the exact tile/risk/action text the
  // user is currently looking at, instead of returning a generic
  // "I'm not aware of that".
  useEffect(() => {
    const lines: string[] = [];
    lines.push(`Role: ${rolePersonaFullName(role)} (${role})`);
    lines.push("Data scope: whole tenant, every project (no date filter)");
    lines.push(`Overall health score: ${liveScore == null ? "no live data" : `${liveScore}%`}`);
    lines.push("");
    lines.push("Sub-driver tiles visible on home (every value is live RM ONE data):");
    if (mergedSubs.length === 0) {
      lines.push("  - (no live sub-driver data for this role/window)");
    }
    for (const s of mergedSubs) {
      lines.push(`  - "${s.label}" ${s.value}% (${s.tone})`);
    }
    lines.push("");
    lines.push("Risk feed (live operational signals shown to the user):");
    if (mergedRisks.length === 0) {
      lines.push("  - (no live risks for this role/window)");
    }
    for (const r of mergedRisks) {
      lines.push(`  - [${r.tone.toUpperCase()}] ${r.title} — ${r.sub}`);
    }
    lines.push("");
    lines.push("Recommended actions visible on home (live):");
    if (mergedActions.length === 0) {
      lines.push("  - (no live recommended actions for this role/window)");
    }
    for (const a of mergedActions) {
      lines.push(`  - ${a.kind}: ${a.title} (CTA: ${a.cta})`);
    }
    lines.push("");
    lines.push(
      "Every row above is real RM ONE data for the current role and time window. When the user asks about anything in this list (by tile name, risk title, action verb, project name, city, or any other phrase that appears above), reference these exact rows by name. If a section is empty, say there is no live data for this role/window rather than inventing values.",
    );
    setDashboardSnapshot(lines.join("\n"));
  }, [role, currentWindow, liveScore, mergedSubs, mergedRisks, mergedActions]);

  // Build the role-specific top ticker — 3 bite-sized items only:
  //   1) Health score (good/warn/bad)
  //   2) Top risk (severity + first few words)
  //   3) Top recommended action
  const tickerItems: TickerItem[] = (() => {
    const items: TickerItem[] = [];
    // Pick the most-concerning sub-driver to open when "Health" is clicked
    // (first warn, else first sub).
    const focusSub =
      mergedSubs.find((s) => s.tone === "warn") ?? mergedSubs[0] ?? null;
    items.push({
      label: "Health",
      value: liveScore == null ? liveLabel : `${liveScore}% · ${liveLabel}`,
      tone:
        liveScore == null
          ? "info"
          : liveScore >= 80
            ? "good"
            : liveScore >= 60
              ? "warn"
              : "bad",
      onClick: focusSub ? () => handleSubClick(focusSub) : undefined,
    });
    const topRisk = mergedRisks[0];
    if (topRisk) {
      const short =
        topRisk.title.length > 56 ? topRisk.title.slice(0, 53) + "…" : topRisk.title;
      items.push({
        label: topRisk.tone === "high" ? "Top risk" : topRisk.tone === "med" ? "Watch" : "Signal",
        value: short,
        tone: topRisk.tone === "high" ? "bad" : topRisk.tone === "med" ? "warn" : "info",
        onClick: () => handleRisk(topRisk),
      });
    }
    const topAction = mergedActions[0];
    if (topAction) {
      const short =
        topAction.title.length > 56 ? topAction.title.slice(0, 53) + "…" : topAction.title;
      items.push({
        label: "Next action",
        value: short,
        tone: topAction.emphasis ? "warn" : "info",
        onClick: () => handleAction(topAction),
      });
    }
    return items;
  })();

  const initials = (user?.displayName || user?.username || "  ").slice(0, 2).toUpperCase();
  const displayName = user?.displayName || user?.username || "User";
  const companyLabel = (user?.tenant || "").replace(/[_-]+/g, " ").trim().toUpperCase();
  const fullName = rolePersonaFullName(role);
  const _rawTitle = (getJobTitleOverride(user?.username) || user?.userRoles || "").trim();
  const badge = (_rawTitle && !_rawTitle.includes(",") && _rawTitle.length <= 50)
    ? _rawTitle.toUpperCase()
    : rolePersonaBadge(role);

  // Action-modal state. Exactly one of these is non-null at a time. Each
  // carries enough context for the modal's "Ask AI about selection" CTA
  // to build the right hand-off prompt and route to /chat.
  const [modal, setModal] = useState<ModalCtx>(null);

  function handleAction(action: ActionItem) {
    setModal({
      kind: "action",
      action,
      detail: buildActionDetail(role, fullName, action, overlay?.records),
    });
  }

  function handleSubClick(sub: SubDriver) {
    setModal({ kind: "kpi", sub, detail: buildKpiDetail(role, fullName, sub) });
  }

  function handleRisk(risk: RiskItem) {
    setModal({ kind: "risk", risk, detail: buildRiskDetail(role, fullName, risk) });
  }

  function handleRiskFeedHeader() {
    setLocation("/alerts");
  }

  function openHomeAllocationFromLink(to: string): boolean {
    try {
      const url = new URL(to, window.location.origin);
      if (url.pathname !== "/resources" || url.searchParams.get("view") !== "Timeline") return false;
      const person = (url.searchParams.get("q") ?? url.searchParams.get("openTimeline") ?? "").trim();
      if (!person) return false;
      setModal(null);
      setHomeAllocationTarget({ person, fallback: to });
      return true;
    } catch {
      return false;
    }
  }

  async function saveHomeAllocationWeek(edit: ResourceProjectWeekEdit): Promise<void> {
    if (!canManageStaff) throw new Error("Your access level doesn't include staffing changes.");
    if (!edit.personId) {
      throw new Error(`Could not identify ${edit.personName}. Refresh Home and try again.`);
    }
    await saveMemberWeeklyHours({
      projectId: edit.projectId,
      memberId: edit.personId,
      memberName: edit.personName,
      memberRole: edit.role,
      weekPatch: { week: edit.week, hours: edit.hours },
      onAccepted: () => edit.onAccepted?.(),
    });
    // The popup owns the immediate cell update. Refresh Home in the
    // background so its risk count and live overlay catch up as well.
    setAllocationRevision((revision) => revision + 1);
  }

  async function saveHomeAllocationWeeks(edit: ResourceProjectWeeksEdit): Promise<void> {
    if (!canManageStaff) throw new Error("Your access level doesn't include staffing changes.");
    if (!edit.personId) {
      throw new Error(`Could not identify ${edit.personName}. Refresh Home and try again.`);
    }
    await saveMemberWeeklyHours({
      projectId: edit.projectId,
      memberId: edit.personId,
      memberName: edit.personName,
      memberRole: edit.role,
      weekPatches: edit.weeks,
      onAccepted: () => edit.onAccepted?.(),
    });
    setAllocationRevision((revision) => revision + 1);
  }

  // Modal "Ask AI about selection" handler. Builds a focused prompt from
  // the picked row (or the first row if nothing was selected) and routes
  // into AI Chat — same hand-off pattern as the recommended-action CTAs.
  function handleModalConfirm(payload?: { selectedIndexes: number[]; note: string }) {
    if (!modal) return;
    const detail = modal.detail;
    const idx = payload?.selectedIndexes?.[0] ?? 0;
    const row = detail?.rows?.[idx];

    // Extract the hidden ticket ID (_ticket or _id) that the data layer attaches
    // to every project row. Build rowSummary from the remaining visible fields only.
    const ticketId: string = row
      ? String((row as Record<string, unknown>)._ticket ?? (row as Record<string, unknown>)._id ?? "").trim()
      : "";
    // Rows without a resolvable ticket ID are flagged _aggregate by the
    // detail builders (buildRiskDetail / buildKpiDetail / buildActionDetail)
    // when they represent a portfolio-level metric or curated/sample row
    // rather than a single project — never worth a search_projects call.
    const isAggregate = row
      ? String((row as Record<string, unknown>)._aggregate ?? "") === "true"
      : false;
    const rowSummary = row
      ? Object.entries(row)
          .filter(([k]) => !k.startsWith("_"))
          .map(([k, v]) => `${k}: ${v}`)
          .join(" · ")
      : "";

    // Universal anti-hallucination guard injected into every chat prompt.
    // If a real ticket ID is available, instruct the AI to use it directly;
    // otherwise instruct it to call search_projects(name) and use the returned ID.
    const ticketGuard = ticketId
      ? `TICKET ID: ${ticketId} — use this exact ID when calling any RM ONE lookup tool (get_project_details / get_project_team / get_person_allocations). Do NOT alter, reformat, or substitute any other ID.`
      : isAggregate
      ? `NOTE: This item is a portfolio-level metric, not a single project record. Do NOT call search_projects for it — there is no project name to look up. Answer using only the figures already given above; recommend general next steps instead of naming a specific project.`
      : `IMPORTANT: If you need to look up a specific project by name, call search_projects with the name first and use the TicketId returned — NEVER guess or construct a ticket ID.`;

    const noPlaceholders = `Use ONLY real names, project IDs, and figures you can verify from RM ONE tool results. NEVER output square-bracket placeholders like "[Project Name]", "[Owner]", or "[Date]". Omit a bullet entirely if the data isn't available after a tool lookup.`;

    let prompt: string;
    if (modal.kind === "kpi") {
      prompt = [
        `Acting as ${fullName}: dig into the "${modal.sub.label}" KPI (currently ${modal.sub.value}%).`,
        rowSummary ? `Focus on this driver — ${rowSummary}.` : "",
        `Explain what's behind the number, name the records or people involved, and recommend the next 1–3 actions with owners and deadlines.`,
        ticketGuard,
        noPlaceholders,
      ].filter(Boolean).join(" ");
    } else if (modal.kind === "risk") {
      prompt = [
        `Acting as ${fullName}: there's an active risk on the operational risk feed — "${modal.risk.title}" (${modal.risk.sub}).`,
        rowSummary ? `Focus on this affected record — ${rowSummary}.` : "",
        `Spell out the risk in one sentence, list who is affected by name, and recommend 2–3 specific mitigation steps with owners and deadlines.`,
        ticketGuard,
        noPlaceholders,
      ].filter(Boolean).join(" ");
    } else {
      prompt = [
        `Acting as ${fullName}: ${modal.action.title}.`,
        rowSummary ? `Focus on this specific record — ${rowSummary}.` : "",
        `Walk me through how to take this action concretely. Reference the record's owner, dates, and any amounts. Recommend the next 1–3 steps and confirm before anything irreversible is saved back to RM ONE.`,
        ticketGuard,
        noPlaceholders,
      ].filter(Boolean).join(" ");
    }
    setModal(null);
    setChatPrompt(prompt, { newSession: true, autoSend: true });
    setLocation("/chat");
  }

  // Initial-load skeleton. Replaces the prior full-page splash with a
  // structural shimmer that mirrors the home layout, so content
  // materializes in place instead of flashing through a blank state.
  // Shown only on the very first overlay fetch in this browser session.
  // We use a module-level flag (not a ref) so navigating away and back
  // to "/" — which unmounts and remounts RoleHome — does NOT re-show the
  // skeleton; subsequent role / window changes keep the cached layout.
  if (overlayLoading && !homeHasRenderedOnce) {
    return <HomeSkeleton />;
  }
  homeHasRenderedOnce = true;

  return (
    <div className="min-h-full w-full overflow-x-hidden" style={{ backgroundColor: BG, color: "var(--rm-text)" }}>
      {/* Loading popup — small centered card while home intelligence is being fetched.
          Gated on !homeHasRenderedOnce for the same reason as the full skeleton above:
          once real content has rendered in this session, background refetches on revisit
          must run silently without flashing a loading overlay over existing content. */}
      <AnimatePresence>
        {overlayLoading && !homeHasRenderedOnce && (
          <motion.div
            key="home-loading-popup"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.2 }}
            className="fixed inset-0 z-[85] flex items-center justify-center pointer-events-none"
          >
            <motion.div
              initial={{ scale: 0.94, y: 6, opacity: 0 }}
              animate={{ scale: 1, y: 0, opacity: 1 }}
              exit={{ scale: 0.96, opacity: 0 }}
              transition={{ duration: 0.28, ease: [0.16, 1, 0.3, 1] }}
              className="flex flex-col items-center gap-3 rounded-xl pointer-events-auto"
              style={{
                background: "linear-gradient(180deg, rgba(34,56,74,0.97) 0%, rgba(27,43,56,0.97) 100%)",
                border: "1px solid rgba(169,194,63,0.28)",
                padding: "22px 36px",
                minWidth: 220,
                boxShadow: "0 12px 40px rgba(0,0,0,0.45), inset 0 0 0 1px rgba(169,194,63,0.06)",
              }}
            >
              {/* Spinner ring */}
              <div className="relative flex items-center justify-center" style={{ width: 36, height: 36 }}>
                <motion.div
                  aria-hidden
                  animate={prefersReducedMotion ? undefined : { rotate: 360 }}
                  transition={prefersReducedMotion ? undefined : { duration: 1.4, repeat: Infinity, ease: "linear" }}
                  style={{
                    position: "absolute",
                    inset: 0,
                    borderRadius: "50%",
                    border: "2px solid rgba(169,194,63,0.18)",
                    borderTopColor: LIGHT_GREEN,
                    borderRightColor: GREEN,
                  }}
                />
                <div
                  style={{
                    width: 8,
                    height: 8,
                    borderRadius: "50%",
                    background: `radial-gradient(circle, ${LIGHT_GREEN} 0%, ${GREEN} 100%)`,
                    opacity: 0.9,
                  }}
                />
              </div>
              {/* Shimmer progress bar */}
              <div style={{ width: 140, height: 3, borderRadius: 2, backgroundColor: `${LIGHT_GREEN}22`, overflow: "hidden" }}>
                <motion.div
                  initial={{ x: "-110%" }}
                  animate={{ x: "220%" }}
                  transition={{ duration: 1.6, repeat: Infinity, ease: "easeInOut", repeatDelay: 0.1 }}
                  style={{
                    width: "55%",
                    height: "100%",
                    background: `linear-gradient(90deg, transparent 0%, ${LIGHT_GREEN}CC 40%, ${GREEN} 55%, ${LIGHT_GREEN}CC 70%, transparent 100%)`,
                    borderRadius: 2,
                  }}
                />
              </div>
              <span
                className="text-[11px] font-semibold tracking-wider uppercase"
                style={{ color: "rgba(255,255,255,0.55)", letterSpacing: "0.08em" }}
              >
                Loading live data…
              </span>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
      {/* Window-change splash — RM ONE agents evaluating overlay.
       *  Triple-ring orbit animation + branded copy. Mirrors the daily
       *  briefing window splash so the language and motion are consistent
       *  across surfaces. Only shown on explicit user window changes
       *  (not initial mount). */}
      <AnimatePresence>
        {windowChanging && (
          <motion.div
            key="home-window-splash"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.25, ease: "easeOut" }}
            className="fixed inset-0 z-[90] flex items-center justify-center"
            style={{
              backgroundColor: "rgba(15,26,36,0.86)",
              backdropFilter: "blur(8px)",
              WebkitBackdropFilter: "blur(8px)",
            }}
            data-testid="home-window-splash"
            role="status"
            aria-live="polite"
          >
            <motion.div
              initial={{ scale: 0.96, y: 8, opacity: 0 }}
              animate={{ scale: 1, y: 0, opacity: 1 }}
              exit={{ scale: 0.98, opacity: 0 }}
              transition={{ duration: 0.35, ease: [0.16, 1, 0.3, 1] }}
              className="relative flex flex-col items-center justify-center rounded-xl"
              style={{
                background: "linear-gradient(180deg, rgba(34,56,74,0.96) 0%, rgba(27,43,56,0.96) 100%)",
                border: "1px solid rgba(169,194,63,0.30)",
                padding: "32px 44px",
                minWidth: 340,
                boxShadow: "inset 0 0 0 1px rgba(169,194,63,0.08), 0 18px 48px rgba(0,0,0,0.55)",
              }}
            >
              <div className="relative flex items-center justify-center" style={{ width: 76, height: 76, marginBottom: 18 }}>
                <motion.div
                  aria-hidden
                  animate={prefersReducedMotion ? undefined : { rotate: -360 }}
                  transition={prefersReducedMotion ? undefined : { duration: 6, repeat: Infinity, ease: "linear" }}
                  style={{
                    position: "absolute",
                    inset: 0,
                    borderRadius: "50%",
                    border: "1px dashed rgba(169,194,63,0.30)",
                  }}
                />
                <motion.div
                  aria-hidden
                  animate={prefersReducedMotion ? undefined : { rotate: 360 }}
                  transition={prefersReducedMotion ? undefined : { duration: 1.6, repeat: Infinity, ease: "linear" }}
                  style={{
                    position: "absolute",
                    inset: 8,
                    borderRadius: "50%",
                    border: "2px solid rgba(169,194,63,0.18)",
                    borderTopColor: LIGHT_GREEN,
                    borderRightColor: GREEN,
                  }}
                />
                <motion.div
                  aria-hidden
                  animate={prefersReducedMotion ? undefined : { scale: [1, 1.18, 1], opacity: [0.85, 1, 0.85] }}
                  transition={prefersReducedMotion ? undefined : { duration: 1.4, repeat: Infinity, ease: "easeInOut" }}
                  style={{
                    width: 18,
                    height: 18,
                    borderRadius: "50%",
                    backgroundColor: GREEN,
                    boxShadow: "0 0 20px rgba(107,165,57,0.75), inset 0 0 0 2px rgba(255,255,255,0.18)",
                  }}
                />
              </div>
              <div
                style={{
                  fontFamily: 'ui-monospace, SFMono-Regular, "SF Mono", Menlo, monospace',
                  fontSize: 10,
                  letterSpacing: "0.26em",
                  color: LIGHT_GREEN,
                  fontWeight: 700,
                }}
              >
                RM ONE AGENTS · WORKING
              </div>
              <div
                className="text-center mt-2"
                style={{
                  fontSize: 17,
                  fontWeight: 600,
                  color: "#FFFFFF",
                  letterSpacing: "-0.01em",
                  lineHeight: 1.3,
                }}
              >
                Evaluating your outlook
              </div>
              <div
                className="text-center"
                style={{
                  fontFamily: 'ui-monospace, SFMono-Regular, "SF Mono", Menlo, monospace',
                  fontSize: 11,
                  color: "rgba(255,255,255,0.6)",
                  marginTop: 6,
                  letterSpacing: "0.08em",
                }}
              >
                Synthesising live RM ONE signals
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Role-switch popup — "Switching to X view…" with step checklist.
          Shows whenever the user changes persona from the avatar menu.
          Steps progress on a staggered timer; the whole popup auto-dismisses
          after the final step so the dashboard is never permanently obscured. */}
      <AnimatePresence>
        {roleChanging && switchingToRole && (
          <motion.div
            key="role-switch-popup"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.2, ease: "easeOut" }}
            className="fixed inset-0 z-[95] flex items-center justify-center"
            style={{
              backgroundColor: "rgba(15,26,36,0.72)",
              backdropFilter: "blur(6px)",
              WebkitBackdropFilter: "blur(6px)",
            }}
          >
            <motion.div
              initial={{ scale: 0.94, y: 10, opacity: 0 }}
              animate={{ scale: 1, y: 0, opacity: 1 }}
              exit={{ scale: 0.97, opacity: 0 }}
              transition={{ duration: 0.3, ease: [0.16, 1, 0.3, 1] }}
              style={{
                background: "linear-gradient(160deg, #253440 0%, #1e2d39 100%)",
                border: "1px solid rgba(169,194,63,0.22)",
                borderRadius: 16,
                padding: "28px 32px 24px",
                minWidth: 320,
                maxWidth: 400,
                boxShadow: "0 24px 64px rgba(0,0,0,0.60)",
              }}
            >
              {/* Header row: role avatar + title */}
              <div className="flex items-center gap-3 mb-5">
                <div
                  style={{
                    width: 44,
                    height: 44,
                    borderRadius: "50%",
                    backgroundColor: GREEN,
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    fontWeight: 700,
                    fontSize: 13,
                    color: "#fff",
                    flexShrink: 0,
                    boxShadow: "0 0 0 2px rgba(169,194,63,0.35)",
                  }}
                >
                  {initials}
                </div>
                <div>
                  <div style={{ fontSize: 16, fontWeight: 700, color: "#fff", letterSpacing: "-0.01em" }}>
                    Switching to {rolePersonaFullName(switchingToRole)} view…
                  </div>
                  <div style={{ fontSize: 12, color: "rgba(255,255,255,0.50)", marginTop: 2 }}>
                    Loading live data
                  </div>
                </div>
              </div>

              {/* Step checklist */}
              {(
                [
                  "Applying role context",
                  `Loading ${rolePersonaFullName(switchingToRole)} metrics`,
                  "Building intelligence feed",
                  "Rendering dashboard",
                ] as const
              ).map((label, idx) => {
                const done = roleSwitchStep > idx;
                const active = roleSwitchStep === idx;
                return (
                  <div
                    key={label}
                    className="flex items-center gap-3 mb-3 last:mb-0"
                  >
                    {/* Icon: green check when done, spinner ring when active, hollow circle when pending */}
                    <div style={{ width: 22, height: 22, flexShrink: 0, position: "relative" }}>
                      {done ? (
                        <svg viewBox="0 0 22 22" width="22" height="22">
                          <circle cx="11" cy="11" r="11" fill={GREEN} />
                          <polyline
                            points="6,11.5 9.5,15 16,8"
                            fill="none"
                            stroke="#fff"
                            strokeWidth="2"
                            strokeLinecap="round"
                            strokeLinejoin="round"
                          />
                        </svg>
                      ) : active ? (
                        <motion.div
                          animate={prefersReducedMotion ? undefined : { rotate: 360 }}
                          transition={{ duration: 0.9, repeat: Infinity, ease: "linear" }}
                          style={{
                            width: 22,
                            height: 22,
                            borderRadius: "50%",
                            border: "2.5px solid rgba(169,194,63,0.25)",
                            borderTopColor: LIGHT_GREEN,
                          }}
                        />
                      ) : (
                        <svg viewBox="0 0 22 22" width="22" height="22">
                          <circle cx="11" cy="11" r="10" fill="none" stroke="rgba(255,255,255,0.18)" strokeWidth="1.5" />
                        </svg>
                      )}
                    </div>
                    <span
                      style={{
                        fontSize: 14,
                        fontWeight: done ? 500 : active ? 600 : 400,
                        color: done ? "#fff" : active ? LIGHT_GREEN : "rgba(255,255,255,0.42)",
                        letterSpacing: "-0.01em",
                      }}
                    >
                      {label}
                    </span>
                  </div>
                );
              })}

              {/* Progress bar */}
              <div
                style={{
                  marginTop: 20,
                  height: 3,
                  borderRadius: 2,
                  background: "rgba(255,255,255,0.10)",
                  overflow: "hidden",
                }}
              >
                <motion.div
                  animate={{ width: `${(Math.min(roleSwitchStep, 3) / 3) * 100}%` }}
                  transition={{ duration: 0.4, ease: "easeOut" }}
                  style={{ height: "100%", background: `linear-gradient(90deg, ${GREEN}, ${LIGHT_GREEN})`, borderRadius: 2 }}
                />
              </div>
              <div
                style={{
                  marginTop: 6,
                  fontSize: 9,
                  letterSpacing: "0.22em",
                  color: "rgba(255,255,255,0.38)",
                  fontFamily: 'ui-monospace, SFMono-Regular, "SF Mono", Menlo, monospace',
                  fontWeight: 700,
                  textTransform: "uppercase",
                }}
              >
                {(["APPLYING ROLE CONTEXT", `LOADING ${rolePersonaFullName(switchingToRole).toUpperCase()} METRICS`, "BUILDING INTELLIGENCE FEED", "RENDERING DASHBOARD"] as const)[Math.min(roleSwitchStep, 3)]}
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* md:pr-24 reserves right-side breathing room for the floating
          top-right ThemeToggle + AvatarMenu (Shell.tsx places them at
          right:24, ~32px each + 8px gap ≈ 96px). Applied on the outer
          wrapper so ALL cards share the same right edge. */}
      <div className="w-full max-w-[1280px] mx-auto px-4 md:px-6 md:pr-24 pt-4 md:pt-5 pb-6 font-sans">
        <div className="mb-3"><InfoTicker items={tickerItems} companyLabel={companyLabel || undefined} /></div>
        {/* Profile heading — "Welcome back" style matching the web home design */}
        <div className="mb-5">
          <div className="flex items-center justify-between gap-2 flex-wrap mb-1">
            <div className="flex items-center gap-2 flex-wrap">
              <h1 className="text-[22px] font-bold leading-tight" style={{ color: "var(--rm-text)" }}>
                Welcome back, {displayName}
              </h1>
              <span
                className="text-[10px] font-bold px-2 py-0.5 rounded uppercase tracking-wider"
                style={{ backgroundColor: LIGHT_GREEN, color: "#253746" }}
                data-testid="role-badge"
              >
                {badge}
              </span>
            </div>
          </div>
          <p className="text-[13px] mt-1" style={{ color: "var(--rm-text-muted)" }}>
            Live snapshot of your pipeline, projects and staffing demand.
          </p>
        </div>

        {/* Health score card */}
        <section
          className="rounded-2xl p-4 md:p-5 mb-3"
          style={{ backgroundColor: CARD, border: "2px solid var(--rm-panel-border)", boxShadow: "0 2px 12px rgba(0,0,0,0.18)" }}
        >
          <div className="flex justify-between items-center mb-3 gap-2 flex-wrap">
            <span className="text-[11px] font-semibold uppercase tracking-wider flex items-center gap-2" style={{ color: "var(--rm-text-faint)" }}>
              {data.greeting}
              {/* Live indicator. Green "LIVE · n" once any live values are available;
                  amber "NO LIVE DATA" if the overlay returned with nothing.
                  While loading, nothing shows here — the popup handles that. */}
              {!overlayLoading && liveCount > 0 ? (
                <span
                  className="inline-flex items-center gap-1 text-[9px] font-extrabold tracking-wider px-1.5 py-0.5 rounded normal-case"
                  style={{ color: "#FFFFFF", backgroundColor: GREEN }}
                  data-testid="home-live-indicator"
                  title={`${liveCount} item${liveCount === 1 ? "" : "s"} from live RM ONE data`}
                >
                  <span className="w-1.5 h-1.5 rounded-full inline-block animate-pulse" style={{ backgroundColor: "#FFFFFF" }} />
                  LIVE · {liveCount}
                </span>
              ) : overlayFetching ? (
                <span
                  className="inline-flex items-center gap-1 text-[9px] font-extrabold tracking-wider px-1.5 py-0.5 rounded normal-case"
                  style={{ color: "var(--rm-text-muted, #94A3B8)", backgroundColor: "var(--rm-panel-border)", border: "1px solid var(--rm-panel-border)" }}
                  data-testid="home-live-indicator"
                  title="Fetching live RM ONE data"
                >
                  <span className="w-1.5 h-1.5 rounded-full inline-block animate-pulse" style={{ backgroundColor: "var(--rm-text-muted, #94A3B8)" }} />
                  LOADING LIVE DATA
                </span>
              ) : (
                <span
                  className="inline-flex items-center gap-1 text-[9px] font-extrabold tracking-wider px-1.5 py-0.5 rounded normal-case"
                  style={{ color: ORANGE_WARM, backgroundColor: `${ORANGE}1F`, border: `1px solid ${ORANGE_WARM}55` }}
                  data-testid="home-live-indicator"
                  title="No live RM ONE data available for this role and time window"
                >
                  NO LIVE DATA
                </span>
              )}
            </span>
            <div className="flex items-center gap-2">
              {false && (() => {
                const s = liveScore;
                const tone =
                  s == null
                    ? { fg: ORANGE_WARM, bg: `${ORANGE}1F`, bd: `${ORANGE_WARM}55` }
                    : (s ?? 0) >= 80
                      ? { fg: "#15803D", bg: `${GREEN}14`, bd: `${GREEN}55` }
                      : (s ?? 0) >= 60
                        ? { fg: "#B45309", bg: "rgba(232,119,34,0.12)", bd: "rgba(232,119,34,0.45)" }
                        : { fg: "#DC2626", bg: "rgba(220,38,38,0.10)", bd: "rgba(220,38,38,0.45)" };
                return (
                  <span
                    className="text-[10px] font-bold tracking-wider px-2 py-0.5 rounded border uppercase"
                    style={{ color: tone.fg, backgroundColor: tone.bg, borderColor: tone.bd }}
                    data-testid="home-status-badge"
                  >
                    {liveLabel}
                  </span>
                );
              })()}
            </div>
          </div>
          <div className="flex flex-col md:flex-row md:items-center" style={{ gap: "28px" }}>
            {/* Gauge column — composite score arc with the in-arc value chip,
                a forecast caption and a "how is this calculated" affordance. */}
            <div className="flex flex-col items-center shrink-0 self-center">
              <CompositeGauge score={liveScore} />
              <div className="flex flex-col items-center gap-1.5" style={{ marginTop: 2 }}>
                <span className="text-[11px] font-bold tracking-wide" style={{ color: "var(--rm-text-muted, #94A3B8)" }}>
                  / 100 · {liveScore == null ? (overlayFetching ? "LOADING" : "NO DATA") : "FORECAST"}
                  {liveScore != null && mergedSubs.length < displaySubs.length
                    ? ` · ${mergedSubs.length} OF ${displaySubs.length} SIGNALS`
                    : ""}
                </span>
                <div className="inline-flex items-center gap-1">
                  <WhyInfo
                    title="How is this calculated?"
                    body={`The portfolio score is the mean health of the ${mergedSubs.length} live RM ONE signal${mergedSubs.length === 1 ? "" : "s"} below, measured across the whole tenant. Non-live drivers are excluded — never estimated.`}
                    bullets={[
                      "Healthy band: 80 and above (green)",
                      "Watch band: 60 – 79 (orange)",
                      "Critical band: under 60 (red)",
                    ]}
                    size={12}
                    align="left"
                  />
                  <span className="text-[11px] font-semibold" style={{ color: "#15803D" }}>
                    How is this calculated?
                  </span>
                </div>
              </div>
            </div>

            {/* Sub-driver rows — each role-relevant signal as a labelled
                progress row. Live rows show a 0-100 score + window; non-live
                rows show an explicit "NOT AVAILABLE YET" (never a fabricated
                value) with an empty track. Laid out in a 2-column grid so all
                6 signals are visible at a glance without scrolling. */}
            <div
              className="flex-1 min-w-0"
              style={{
                display: "grid",
                gridTemplateColumns: "1fr 1fr",
                gap: "14px 24px",
                alignContent: "center",
              }}
            >
              {displaySubs.map((s) => {
                const barColor = !s.isLive
                  ? "rgba(27,43,56,0.18)"
                  : s.value < 60
                    ? "#DC2626"
                    : s.tone === "good"
                      ? GREEN
                      : ORANGE;
                const valueColor = s.value < 60 ? "#DC2626" : "var(--rm-text)";
                return (
                  <button
                    key={s.label}
                    type="button"
                    onClick={() => s.isLive && handleSubClick(s)}
                    disabled={!s.isLive}
                    className="text-left w-full focus:outline-none focus-visible:ring-2 focus-visible:ring-[#A9C23F]/60 rounded-md disabled:cursor-default"
                    data-testid={`kpi-${s.label}`}
                    aria-label={
                      s.isLive
                        ? `${s.label} — live RM ONE data — open detail`
                        : `${s.label} — not available yet`
                    }
                  >
                    <div className="flex items-end justify-between gap-3 mb-2">
                      <span className="text-[12.5px] font-bold leading-snug truncate" style={{ color: "var(--rm-text)" }}>
                        {s.label}
                      </span>
                      {s.isLive ? (
                        <span className="inline-flex items-baseline gap-1.5 shrink-0">
                          <span className="tabular-nums" style={{ fontSize: "17px", fontWeight: 700, lineHeight: 1, color: valueColor }}>
                            <AnimatedNumber value={s.value} />
                          </span>
                        </span>
                      ) : (
                        <span className="text-[10px] font-extrabold uppercase tracking-wide shrink-0" style={{ color: "var(--rm-text-faint)" }}>
                          Not available yet
                        </span>
                      )}
                    </div>
                    {s.isLive ? (
                      <div style={{ height: 6, borderRadius: 999, backgroundColor: "var(--rm-panel-soft)", overflow: "hidden" }}>
                        <div
                          style={{
                            height: "100%",
                            width: `${Math.min(100, Math.max(0, s.value))}%`,
                            backgroundColor: barColor,
                            borderRadius: 999,
                            transition: "width 0.7s cubic-bezier(0.16,1,0.3,1)",
                          }}
                        />
                      </div>
                    ) : (
                      <div
                        style={{
                          height: 6,
                          borderRadius: 999,
                          border: "1px dashed rgba(27,43,56,0.22)",
                          backgroundColor: "rgba(27,43,56,0.02)",
                        }}
                      />
                    )}
                  </button>
                );
              })}
            </div>
          </div>
        </section>

        {/* Pinned Critical — surfaces the most urgent high-tone risk
            in the merged feed as a prominent white card with a red
            badge. Mirrors the mobile home's PINNED CRITICAL surface
            so both platforms lead with the same item. */}
        {(() => {
          const pinned = pinnedRisk;
          if (!pinned) {
            // Never show an empty/disabled critical slot. Only show the
            // positive note once live data has actually loaded — while
            // fetching, after a failed fetch, or on a bail timeout the
            // overlay is null and we must not claim "all clear".
            if (overlayFetching || overlay == null) return null;
            return (
              <section className="mb-3">
                <div
                  className="w-full relative overflow-hidden"
                  style={{
                    backgroundColor: CARD,
                    border: "1px solid rgba(107,165,57,0.35)",
                    borderRadius: "16px",
                  }}
                  data-testid="pinned-all-clear"
                >
                  <div style={{ position: "absolute", top: 0, left: 0, bottom: 0, width: "6px", backgroundColor: LIGHT_GREEN }} />
                  <div style={{ paddingLeft: "32px", paddingRight: "20px", paddingTop: "12px", paddingBottom: "12px" }}>
                    <div
                      className="inline-flex items-center gap-1.5 px-2 py-1 rounded-md mb-1.5"
                      style={{
                        backgroundColor: "rgba(107,165,57,0.15)",
                        border: "1px solid rgba(107,165,57,0.35)",
                      }}
                    >
                      <span className="text-[10px] font-extrabold uppercase tracking-[0.16em]" style={{ color: LIGHT_GREEN }}>
                        All clear
                      </span>
                    </div>
                    <div className="text-[15px] font-bold leading-snug" style={{ color: "var(--rm-text)" }}>
                      No critical risks right now
                    </div>
                    <div className="text-[12.5px] mt-0.5" style={{ color: "var(--rm-text-muted)" }}>
                      Nothing needs urgent attention. Anything lower-priority appears in the risk feed below.
                    </div>
                  </div>
                </div>
              </section>
            );
          }
          return (
            <section className="mb-3">
              <button
                type="button"
                onClick={() => handleRisk(pinned)}
                className="w-full text-left relative overflow-hidden transition-shadow hover:shadow-md"
                style={{
                  backgroundColor: CARD,
                  border: "1px solid rgba(220,38,38,0.30)",
                  borderRadius: "16px",
                  boxShadow: "0 10px 30px -12px rgba(0,0,0,0.40)",
                }}
                data-testid="pinned-critical-resolve"
              >
                <div style={{ position: "absolute", top: 0, left: 0, bottom: 0, width: "6px", backgroundColor: "#DC2626" }} />
                <div style={{ paddingLeft: "32px", paddingRight: "20px", paddingTop: "10px", paddingBottom: "10px" }}>
                  <div className="flex items-start justify-between gap-3 mb-1.5">
                    <div className="flex items-center gap-2 flex-wrap">
                      <div
                        className="inline-flex items-center gap-1.5 px-2 py-1 rounded-md"
                        style={{ backgroundColor: "#DC2626" }}
                      >
                        <AlertTriangle size={11} color="#FFFFFF" strokeWidth={2.75} />
                        <span className="text-[10px] font-extrabold uppercase tracking-[0.16em] text-white">
                          Pinned Critical
                        </span>
                      </div>
                    </div>
                    <span onClick={(e) => e.stopPropagation()} className="inline-flex shrink-0">
                      <WhyInfo
                        title="Pinned Critical"
                        body="This card surfaces the highest-tone risk in the merged feed for the active window. It's pinned because the AI judged it the single most consequential signal you should act on first."
                        bullets={[
                          "Selection rule: first risk with tone = high",
                          "Refreshes when the role or window changes",
                          "Resolve now opens the affected records so you can act or hand one to the AI",
                        ]}
                        size={11}
                      />
                    </span>
                  </div>
                  <div className="flex items-start justify-between gap-3">
                    <div className="flex-1 min-w-0">
                      <div className="text-[17px] font-bold leading-snug" style={{ color: "var(--rm-text)" }}>
                        {pinned.title}
                      </div>
                      {pinned.sub ? (
                        <div className="text-[12.5px] mt-0.5" style={{ color: "var(--rm-text-muted)" }}>
                          {cardSubText(pinned)}
                        </div>
                      ) : null}
                    </div>
                    <span
                      className="inline-flex items-center gap-1.5 text-[12.5px] font-bold px-3 py-1.5 rounded-lg text-white shrink-0"
                      style={{ backgroundColor: GREEN }}
                    >
                      Resolve now
                      <ChevronRight size={14} color="#FFFFFF" strokeWidth={2.5} />
                    </span>
                  </div>
                  {(() => {
                    const reasons = buildPinnedAnalysis(pinned, mergedRisks);
                    if (reasons.length === 0) return null;
                    return (
                      <div
                        className="mt-2 rounded-lg p-2"
                        style={{
                          backgroundColor: "rgba(220,38,38,0.04)",
                          border: "1px solid rgba(220,38,38,0.14)",
                        }}
                      >
                        <div className="flex items-center gap-1.5 mb-1">
                          <Sparkles size={11} color="#DC2626" strokeWidth={2.5} />
                          <span
                            className="text-[9.5px] font-extrabold uppercase tracking-[0.16em]"
                            style={{ color: "#DC2626" }}
                          >
                            AI analysis · why this is critical
                          </span>
                        </div>
                        <ul className="flex flex-col gap-1.5">
                          {reasons.map((r, i) => (
                            <li
                              key={i}
                              className="text-[11.5px] leading-snug flex gap-1.5 items-start"
                              style={{ color: "var(--rm-text-muted)" }}
                            >
                              <span
                                className="mt-1.5 w-1 h-1 rounded-full shrink-0"
                                style={{ backgroundColor: "#DC2626" }}
                              />
                              <span>{r}</span>
                            </li>
                          ))}
                        </ul>
                      </div>
                    );
                  })()}
                </div>
              </button>
            </section>
          );
        })()}

        {/* Risk Feed */}
        <section className="mb-3">
          <div className="flex justify-between items-center px-1 mb-2">
            <span className="text-[11px] font-bold uppercase tracking-wider" style={{ color: "var(--rm-text-muted)" }}>
              Operational risk feed
            </span>
            <button
              onClick={handleRiskFeedHeader}
              className="flex items-center gap-1.5 text-[11px] font-semibold tracking-wider hover:opacity-80 transition-opacity"
              style={{ color: LIGHT_GREEN }}
            >
              <span className="w-1.5 h-1.5 rounded-full inline-block animate-pulse" style={{ backgroundColor: LIGHT_GREEN }} />
              VIEW ALL
            </button>
          </div>
          {feedRisks.length === 0 ? (
            pinnedRisk ? (
              <HomeEmptyState
                title="No additional risks"
                body="The pinned critical above is the only live risk flagged right now."
              />
            ) : overlayFetching ? (
              <HomeEmptyState
                title="Loading live data…"
                body="Fetching live RM ONE risk signals."
              />
            ) : (
              <HomeEmptyState
                title="No live operational risks"
                body="No live RM ONE risk signals — nothing flagged for attention right now."
              />
            )
          ) : (
          <div
            className="grid gap-2"
            style={{
              // A lone risk stretches across the full row instead of
              // leaving an empty half-width gap next to it.
              gridTemplateColumns:
                feedRisks.length === 1 ? "minmax(0, 1fr)" : "repeat(2, minmax(0, 1fr))",
              alignItems: "stretch",
            }}
          >
            {feedRisks.map((r, i) => (
              <RiskRow key={i} r={r} onClick={() => handleRisk(r)} />
            ))}
          </div>
          )}
        </section>

        {/* Recommended Actions */}
        <section className="mb-2">
          <div className="flex justify-between items-center px-1 mb-2">
            <span className="text-[11px] font-bold uppercase tracking-wider" style={{ color: "var(--rm-text-muted)" }}>
              Recommended actions
            </span>
            <span className="text-[10px] font-bold tracking-widest" style={{ color: LIGHT_GREEN }}>
              AI · {mergedActions.length}
            </span>
          </div>
          {(mergedActions as ActionItem[]).length === 0 ? (
            overlayFetching ? (
              <HomeEmptyState
                title="Loading live data…"
                body="Fetching live RM ONE recommended actions."
              />
            ) : (
              <HomeEmptyState
                title="No live recommended actions"
                body="No live RM ONE actions right now."
              />
            )
          ) : (
          <div
            className="rounded-xl overflow-hidden divide-y"
            style={{
              backgroundColor: CARD,
              border: "2px solid var(--rm-panel-border)",
              borderColor: "var(--rm-panel-border)",
              boxShadow: "0 2px 12px rgba(0,0,0,0.18)",
            }}
          >
            {mergedActions.map((a, i) => {
              const Icon = a.Icon;
              return (
                <div
                  key={i}
                  role="button"
                  tabIndex={0}
                  onClick={() => handleAction(a)}
                  onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); handleAction(a); } }}
                  className="flex items-center gap-3 px-4 py-3 cursor-pointer transition-colors hover:bg-white/[0.04]"
                  style={{ borderColor: "rgba(255,255,255,0.08)" }}
                  data-testid={`action-${i}`}
                >
                  <div
                    className="w-10 h-10 rounded-lg flex items-center justify-center shrink-0"
                    style={{
                      backgroundColor: a.emphasis ? `${ORANGE}26` : `${GREEN}1F`,
                    }}
                  >
                    <Icon size={17} color={a.emphasis ? ORANGE_WARM : "#15803D"} strokeWidth={2.2} />
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-1.5 mb-1">
                      <div className="text-[10px] font-bold uppercase tracking-wider leading-none" style={{ color: "var(--rm-text-muted)" }}>
                        {a.kind}
                      </div>
                    </div>
                    <div className="text-[13px] font-semibold leading-tight" style={{ color: "var(--rm-text)" }}>{a.title}</div>
                    {(() => {
                      const rationale = buildActionRationale(a);
                      if (!rationale) return null;
                      return (
                        <div className="flex items-start gap-1 mt-1">
                          <Sparkles size={9} color="#15803D" strokeWidth={2.5} className="shrink-0 mt-0.5" />
                          <span className="text-[10px] font-extrabold uppercase tracking-wider shrink-0" style={{ color: "#15803D" }}>
                            AI
                          </span>
                          <span className="text-[11.5px] font-medium leading-snug" style={{ color: "var(--rm-text)" }}>
                            {rationale}
                          </span>
                        </div>
                      );
                    })()}
                  </div>
                  <button
                    onClick={(e) => { e.stopPropagation(); handleAction(a); }}
                    className="text-[11px] font-bold px-3 py-1.5 rounded-lg shrink-0 transition-transform hover:scale-105"
                    style={{
                      backgroundColor: a.emphasis ? GREEN : "var(--rm-panel-soft)",
                      color: a.emphasis ? "#FFFFFF" : "var(--rm-text)",
                      border: a.emphasis ? "none" : "2px solid var(--rm-panel-border)",
                    }}
                  >
                    {a.cta}
                  </button>
                </div>
              );
            })}
          </div>
          )}
        </section>

      </div>

      {/* Single side-panel drill-down used for all three modal kinds:
          risk-feed rows, KPI/portfolio sub-drivers, recommended actions,
          and the Pinned Critical "Resolve now" — the one drill-down
          format shared across the whole app. */}
      {modal && modal.kind === "kpi" && modal.sub.formulaDetail ? (
        <KpiFormulaPanel
          open={true}
          title={modal.sub.label}
          valuePct={modal.sub.value}
          eyebrow={modal.sub.formulaDetail?.eyebrow ?? "FIRM HEALTH · LIVE SIGNAL"}
          formula={modal.sub.formulaDetail}
          detail={modal.detail}
          onClose={() => setModal(null)}
          goTo={classifyIssueTarget({
            title: modal.sub.label,
            detail: modal.detail,
          })}
          onNavigate={(to) => {
            if (!openHomeAllocationFromLink(to)) setLocation(to);
          }}
        />
      ) : modal ? (
        <RiskSidePanel
          open={true}
          title={panelTitle(modal)}
          subtitle={panelSubtitle(modal, fullName)}
          tier={panelTier(modal)}
          kindLabel={panelKindLabel(modal)}
          explanation={panelExplanation(modal)}
          detail={modal.detail}
          askLabel={
            modal.kind === "action"
              ? `Ask AI to plan: ${modal.action.cta}`
              : "Ask AI"
          }
          onClose={() => setModal(null)}
          onAskAI={(payload) =>
            handleModalConfirm({ ...payload, note: "" })
          }
          goTo={classifyIssueTarget({
            title: panelTitle(modal),
            subtitle: modal.kind === "risk" ? modal.risk.sub : undefined,
            detail: modal.detail,
          })}
          onNavigate={(to) => {
            if (!openHomeAllocationFromLink(to)) setLocation(to);
          }}
          quickAction={(() => {
            if (!modal) return null;
            const riskKind = modal.kind === "risk"
              ? classifyRisk(modal.risk.kind, modal.risk.title ?? "", modal.risk.sub ?? "")
              : null;
            // Demand-coverage risks & Hire/Staff actions offer two paths for
            // the selected staffing gap: create a slot or add an existing
            // team member.
            const isDemand =
              riskKind === "demand-coverage" ||
              (modal.kind === "action" && ["Staff", "STAFF", "Hire", "HIRE"].includes(modal.action.kind));
            if (isDemand) {
              if (!canManageStaff) return null;
              // Older in-memory alert cards predate the hidden row role/RA-ID
              // fields. Keep a narrow header fallback so an already-open
              // "Hire 1 Junior Engineer" panel still pre-fills Junior Engineer
              // after an app hot reload; new rows always carry the exact data.
              const roleFromActionHeader = () => {
                if (modal.kind !== "action") return "";
                const text = String(modal.action.title ?? "").trim();
                const match = text.match(/^(?:Hire|Budget|Approve)\s+\d+\s+(.+?)(?:\s+hires?)?(?:\s+·|$)/i);
                return match?.[1]?.trim() ?? "";
              };
              const selectedProject = (row: Record<string, string | number> | null) => {
                const raId = demandRaId(row?.["_raId"])
                  ?? demandRaId(row?.["RaId"])
                  ?? demandRaId(row?.["RAId"]);
                return {
                  projectId: String(row?.ticket ?? row?.["_ticket"] ?? "").trim(),
                  projectName: String(row?.title ?? row?.record ?? "").trim(),
                  role: String(row?.role ?? row?.["Role"] ?? "").trim() || roleFromActionHeader(),
                  // The operator selected this exact demand row. Preserve its
                  // ID all the way through save instead of later matching the
                  // newly-added member's role against open positions.
                  ...(raId !== null ? { consumeRaIds: [raId] } : {}),
                };
              };
              return [
                {
                  label: "Add Team Member",
                  onClick: (row: Record<string, string | number> | null) => {
                    const target = selectedProject(row);
                    if (!target.projectId || target.projectId === "—") {
                      // Role-aggregate rows spanning several projects carry
                      // no single position id. Never no-op: send the user to
                      // the demand book to pick the exact position there.
                      setModal(null);
                      setLocation("/resources?view=Demand");
                      return;
                    }
                    // The add-member workspace is its own modal. Close the
                    // alert panel first so the chooser is never nested behind
                    // a dimmed risk popup.
                    setModal(null);
                    setQaAddMember(target);
                  },
                },
              ];
            }
            // Over-allocation risks → Edit Allocation. Single-project rows use
            // _ticket; multi-project rows use _firstTicket so their person-level
            // timeline link remains intact. Keep the label parser only as a
            // compatibility fallback for older/custom row payloads.
            if (riskKind === "over-allocation") {
              if (!canManageStaff) return null;
              return {
                label: "Edit Allocation",
                onClick: (row: Record<string, string | number> | null) => {
                  if (!row) return;
                  // A person over-allocated across SEVERAL projects can't be
                  // rebalanced inside one project's team grid — open their
                  // full timeline popup instead (all projects side by side,
                  // over weeks highlighted). Single-project rows keep the
                  // direct team-grid popup.
                  const singleTicket = String(row["_ticket"] ?? "").trim();
                  const person = String(row["_person"] ?? row["person"] ?? "").trim();
                  if ((!singleTicket || singleTicket === "—") && person && person !== "—") {
                    setModal(null);
                    setLocation(`/resources?view=Timeline&openTimeline=${encodeURIComponent(person)}`);
                    return;
                  }
                  let projectId = singleTicket || String(row["_firstTicket"] ?? "").trim();
                  if (!projectId || projectId === "—") {
                    const m = String(row["projects"] ?? "").match(/([A-Z]{2,6}-\d{2,4}-\d{1,8})/);
                    projectId = m?.[1] ?? "";
                  }
                  if (!projectId) return;
                  const module = /^OPM(?:[-_]|$)/i.test(projectId) ? "OPM" : "PMM";
                  const projectName = String(row["title"] ?? row["record"] ?? row["project"] ?? projectId).trim();
                  setModal(null);
                  setQaTeamModal({ projectId, projectName, module });
                },
              };
            }
            return null;
          })()}
        />
      ) : null}

      {qaOpenPos && (
        <AddOpenPositionModal
          open
          onClose={() => setQaOpenPos(null)}
          projectId={qaOpenPos.projectId}
          projectName={qaOpenPos.projectName}
          defaultStartDate=""
          defaultEndDate=""
          onCreated={() => setQaOpenPos(null)}
        />
      )}

      {qaTeamModal && (
        <QuickActionsTeamModal
          open
          projectId={qaTeamModal.projectId}
          projectName={qaTeamModal.projectName || qaTeamModal.projectId}
          module={qaTeamModal.module}
          projectStartDate={
            qaTeamModalQuery.data?.scheduleBounds.start ||
            new Date().toISOString().slice(0, 10)
          }
          projectEndDate={
            qaTeamModalQuery.data?.scheduleBounds.end ||
            new Date(new Date().setFullYear(new Date().getFullYear() + 1)).toISOString().slice(0, 10)
          }
          scheduleStart={qaTeamModalQuery.data?.scheduleBounds.start || undefined}
          scheduleEnd={qaTeamModalQuery.data?.scheduleBounds.end || undefined}
          team={qaTeamModalQuery.data?.team.team ?? []}
          openRoles={qaTeamModalQuery.data?.team.openRoles ?? []}
          existingAllocations={quickExistingAllocations(qaTeamModalQuery.data?.team.team ?? [])}
          canEdit={canEditData}
          canManageStaff={canManageStaff}
          onClose={() => setQaTeamModal(null)}
          onOpenProject={() => {
            const projectId = qaTeamModal.projectId;
            setQaTeamModal(null);
            setLocation(`/project/${encodeURIComponent(projectId)}`);
          }}
          onReload={() => { void qaTeamModalQuery.refetch(); }}
          onAddMember={(seed) => {
            // The full member picker is a child workspace, not an overlay on
            // top of the team-grid popup. Close the grid before opening it.
            setQaTeamModal(null);
            setQaAddMember({
              projectId: qaTeamModal.projectId,
              projectName: qaTeamModal.projectName,
              role: seed?.title ?? "",
            });
          }}
          onMemberAdded={() => { void qaTeamModalQuery.refetch(); }}
          onAddOpenPosition={() => {
            setQaOpenPos({
              projectId: qaTeamModal.projectId,
              projectName: qaTeamModal.projectName,
              role: "",
            });
          }}
        />
      )}

      {homeAllocationQuery.data && homeAllocationTarget && (() => {
        const resource = homeAllocationQuery.data;
        const rules = getBusinessRules();
        const status =
          resource.currentPct >= rules.overCapacityPct
            ? { label: "Overloaded", color: ORANGE }
            : resource.currentPct >= rules.targetUtilizationPct
              ? { label: "Optimal", color: GREEN }
              : { label: "Under-used", color: RED };
        const pName = (projectId: string) => {
          const key = projectId.trim().toLowerCase();
          const allocation = [...(resource.activeAllocations ?? []), ...(resource.allAllocations ?? [])]
            .find((a) => a.projectId.trim().toLowerCase() === key);
          return allocation?.projectName || projectId;
        };
        return (
          <LazySuspense fallback={null}>
            <StaffUtilModal
              r={resource}
              status={status}
              pName={pName}
              mode="all"
              onClose={() => setHomeAllocationTarget(null)}
              onProjectClick={(projectId) => {
                setHomeAllocationTarget(null);
                setLocation(`/project/${encodeURIComponent(projectId)}`);
              }}
              canEditHours={canManageStaff}
              onSaveProjectWeek={saveHomeAllocationWeek}
              onSaveProjectWeeks={saveHomeAllocationWeeks}
            />
          </LazySuspense>
        );
      })()}

      {qaAddMember && (
        <AddTeamMemberModal
          key={`${qaAddMember.projectId}:${qaAddMember.consumeRaIds?.join(",") ?? qaAddMember.role}`}
          open
          onClose={() => setQaAddMember(null)}
          projectId={qaAddMember.projectId}
          // Same OPM-vs-PMM inference this flow already uses for its prep
          // fetch of this exact record.
          module={/^OPM(?:[-_]|$)/i.test(qaAddMember.projectId) ? "OPM" : "PMM"}
          projectName={qaAddMember.projectName || qaAddMember.projectId}
          projectStartDate={
            qaAddMemberPrepQuery.data?.scheduleBounds.start ||
            qaAddMemberPrepQuery.data?.targetStart ||
            new Date().toISOString().slice(0, 10)
          }
          projectEndDate={
            qaAddMemberPrepQuery.data?.scheduleBounds.end ||
            qaAddMemberPrepQuery.data?.targetEnd ||
            new Date(new Date().setFullYear(new Date().getFullYear() + 1)).toISOString().slice(0, 10)
          }
          scheduleStart={qaAddMemberPrepQuery.data?.scheduleBounds.start || undefined}
          scheduleEnd={qaAddMemberPrepQuery.data?.scheduleBounds.end || undefined}
          existingAllocations={quickExistingAllocations(qaAddMemberPrepQuery.data?.team.team ?? [])}
          openRoles={qaAddMemberPrepQuery.data?.openRoles}
          prefillRole={qaAddMember.role || undefined}
          consumeRaIds={qaAddMemberConsumeRaIds}
          onAssigned={() => {
            const consumedRaIds = qaAddMemberConsumeRaIds ?? [];
            if (consumedRaIds.length > 0) {
              setOverlay((current) => retireOpenPositionFromOverlay(current, consumedRaIds));
              setModal((current) => current
                ? { ...current, detail: retireOpenPositionRows(current.detail, new Set(consumedRaIds)) ?? null }
                : current);
            }
            setQaAddMember(null);
          }}
          onOpenProject={(projectId) => {
            setQaAddMember(null);
            setModal(null);
            setLocation(`/project/${encodeURIComponent(projectId)}`);
          }}
          onSetupSchedule={() => {
            const projectId = qaAddMember.projectId;
            setQaAddMember(null);
            setModal(null);
            setLocation(`/project/${encodeURIComponent(projectId)}#schedule-section`);
          }}
        />
      )}

    </div>
  );
}

export function RiskRow({ r, onClick }: { r: RiskItem; onClick?: () => void }) {
  const isHigh = r.tone === "high";
  const isInfo = r.tone === "info";
  const dotColor = isHigh ? RED : isInfo ? LIGHT_GREEN : ORANGE;
  const chipFg = isHigh ? RED : isInfo ? LIGHT_GREEN : ORANGE_WARM;
  const chipBg = `${dotColor}26`;
  const chipBorder = `${dotColor}66`;
  const chipLabel = isHigh ? "CRIT" : isInfo ? "INFO" : "WARN";
  // Critical rows keep a soft red-tinted white background so they still
  // read as "needs attention" when surrounding rows are plain white.
  const bg = isHigh ? "rgba(220,38,38,0.12)" : CARD;
  const border = isHigh ? `${RED}55` : "var(--rm-panel-border)";
  const titleColor = isHigh ? "var(--rm-health-bad)" : "var(--rm-text)";
  const subColor = isHigh ? "var(--rm-text-muted)" : "var(--rm-text-muted)";
  return (
    <button
      onClick={onClick}
      className="rounded-xl px-3 py-3 flex items-center gap-3 text-left w-full transition-colors hover:brightness-[0.98]"
      style={{
        backgroundColor: bg,
        border: `2px solid ${border}`,
        boxShadow: "0 2px 12px rgba(0,0,0,0.18)",
      }}
      data-testid="risk-row"
    >
      <div className="w-2 h-2 rounded-full shrink-0" style={{ backgroundColor: dotColor }} />
      <div className="flex-1 min-w-0">
        <div className="text-[13px] font-bold leading-tight truncate flex items-center gap-1.5" style={{ color: titleColor }}>
          <span className="truncate">{r.title}</span>
          {!r.isLive && (
            <span
              className="text-[8px] font-extrabold tracking-wider px-1 py-px rounded shrink-0"
              style={{ color: "#B45309", backgroundColor: `${ORANGE}1F`, border: `1px solid ${ORANGE_WARM}55` }}
              title="No live RM ONE data for this risk — row is a curated sample"
            >
              SAMPLE
            </span>
          )}
        </div>
        <div className="text-[12px] font-medium leading-tight truncate mt-0.5" style={{ color: "var(--rm-text)" }}>{cardSubText(r)}</div>
      </div>
      {(r.metric || (r.chips && r.chips.length > 0)) && (
        <div
          className="hidden md:flex flex-col items-end shrink-0"
          style={{ gap: 3, maxWidth: 220 }}
        >
          {r.metric && (
            <div className="flex items-baseline gap-1">
              <span
                className="text-[15px] font-extrabold leading-none"
                style={{
                  color:
                    r.metric.tone === "good"
                      ? "#15803D"
                      : r.metric.tone === "warn"
                      ? ORANGE_WARM
                      : r.metric.tone === "bad"
                      ? RED
                      : "var(--rm-text)",
                  letterSpacing: "-0.01em",
                  fontVariantNumeric: "tabular-nums",
                }}
              >
                {r.metric.value}
              </span>
              <span
                className="text-[8px] font-bold uppercase tracking-wider"
                style={{ color: "rgba(27,43,56,0.55)" }}
              >
                {r.metric.label}
              </span>
            </div>
          )}
          {r.chips && r.chips.length > 0 && (
            <div className="flex items-center gap-1 justify-end flex-wrap">
              {r.chips.slice(0, 3).map((c, i) => (
                <span
                  key={`${i}-${c}`}
                  title={c}
                  className="text-[8.5px] font-bold uppercase tracking-wider px-1.5 py-px rounded border"
                  style={{
                    color: "var(--rm-text-muted)",
                    borderColor: "var(--rm-panel-border)",
                    backgroundColor: "var(--rm-panel-soft)",
                    maxWidth: 110,
                    overflow: "hidden",
                    textOverflow: "ellipsis",
                    whiteSpace: "nowrap",
                  }}
                >
                  {c}
                </span>
              ))}
            </div>
          )}
        </div>
      )}
      <span
        className="text-[9px] font-extrabold tracking-wider px-1.5 py-0.5 rounded border shrink-0"
        style={{ color: chipFg, backgroundColor: chipBg, borderColor: chipBorder }}
      >
        {chipLabel}
      </span>
      <ChevronRight size={14} className="shrink-0" style={{ color: "rgba(27,43,56,0.45)" }} />
    </button>
  );
}

// Explicit empty state shown when a home section has NO live RM ONE data
// for the active role/window. Real-data-only home never falls back to
// curated/sample values — it renders this honest placeholder instead.
function HomeEmptyState({ title, body }: { title: string; body: string }) {
  return (
    <div
      className="rounded-2xl p-6 flex flex-col items-center justify-center text-center"
      style={{
        backgroundColor: "var(--rm-panel-soft)",
        border: "1px dashed var(--rm-panel-border)",
      }}
      data-testid="home-empty-state"
    >
      <div className="text-[13px] font-semibold" style={{ color: "var(--rm-text)" }}>
        {title}
      </div>
      <div
        className="text-[11.5px] mt-1 leading-snug"
        style={{ color: "var(--rm-text-muted)", maxWidth: 460 }}
      >
        {body}
      </div>
    </div>
  );
}

/** Remove an explicitly-filled demand row from display-only home state. The
 * server remains the source of truth; this prevents its subsequent refresh
 * from being the first time the user sees the completed action. */
function retireOpenPositionRows(
  detail: ActionDetail | null | undefined,
  retiredRaIds: ReadonlySet<number>,
): ActionDetail | null | undefined {
  if (!detail) return detail;
  const rows = detail.rows.filter((row) => {
    const demandRow = row as Record<string, unknown>;
    const raId = demandRaId(demandRow["_raId"] ?? demandRow["RaId"] ?? demandRow["RAId"]);
    return raId === null || !retiredRaIds.has(raId);
  });
  return rows.length === detail.rows.length ? detail : { ...detail, rows };
}

function retireOpenPositionFromOverlay(
  current: LiveOverlay | null,
  raIds: readonly number[],
): LiveOverlay | null {
  if (!current || raIds.length === 0) return current;
  const retiredRaIds = new Set(raIds);
  const demands = current.records.demands.filter(
    (d) => !retiredRaIds.has(demandRaId(d.RaId) ?? -1),
  );
  const liveSubRecords = Object.fromEntries(
    Object.entries(current.liveSubRecords).map(([key, detail]) => [
      key,
      retireOpenPositionRows(detail, retiredRaIds),
    ]),
  ) as LiveOverlay["liveSubRecords"];
  const liveRisks = current.liveRisks.map((risk) => ({
    ...risk,
    records: retireOpenPositionRows(risk.records, retiredRaIds),
  }));
  const liveActions = current.liveActions.map((action) => ({
    ...action,
    detail: retireOpenPositionRows(action.detail, retiredRaIds),
  }));
  if (
    demands.length === current.records.demands.length &&
    Object.values(liveSubRecords).every((detail, index) =>
      detail === Object.values(current.liveSubRecords)[index],
    ) &&
    liveRisks.every((risk, index) => risk.records === current.liveRisks[index]?.records) &&
    liveActions.every((action, index) => action.detail === current.liveActions[index]?.detail)
  ) {
    return current;
  }
  return {
    ...current,
    records: { ...current.records, demands },
    liveSubRecords,
    liveRisks,
    liveActions,
  };
}
