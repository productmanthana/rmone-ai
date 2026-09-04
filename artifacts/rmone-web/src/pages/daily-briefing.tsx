import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useLocation } from "wouter";
import { motion, AnimatePresence, useReducedMotion } from "framer-motion";
import {
  Zap,
  TrendingUp,
  TrendingDown,
  AlertCircle,
  AlertTriangle,
  Lightbulb,
  ChevronRight,
  Loader2,
  RefreshCw,
  WifiOff,
  Sparkles,
  HardHat,
  Briefcase,
  Bell,
  ArrowUpRight,
  CheckCircle2,
} from "lucide-react";
import { markBriefingSeen } from "@/lib/briefingGate";
import { markHomeOverlayReady } from "@/components/CommandCentreLoader";
import { useAuth } from "@/lib/useAuth";
import {
  resolveActiveRole,
  rolePersonaBadge,
  getJobTitleOverride,
  type RolePersona,
} from "@/lib/roleResolver";
import { setInboxUser } from "@/lib/inboxStore";
import {
  composeDailyBriefing,
  readBriefingSeed,
  readSavedBriefing,
  BRIEFING_WINDOW_KEYS,
  BRIEFING_WINDOW_LABEL,
  type BriefingChange,
  type BriefingHero,
  type BriefingKpi,
  type BriefingNotification,
  type BriefingWindow,
  type DailyBriefingData,
} from "@/lib/dailyBriefing";
import { authHeaders } from "@/lib/api";

const BRIEFING_WINDOW_STORAGE_KEY = "rmone:briefing:window";
function isBriefingWindow(v: unknown): v is BriefingWindow {
  return v === "7d" || v === "30d" || v === "60d" || v === "90d";
}
import { RiskSidePanel } from "@/components/RiskSidePanel";
import { useStaffingQuickActions } from "@/hooks/useStaffingQuickActions";
import { SplashOverlay } from "@/components/SplashScreen";
import type { ActionDetail } from "@/lib/homeIntelligence";
import { setChatPrompt } from "@/lib/chatBridge";
import { effectiveIssueLink, classifyIssueTarget, extractTicketIds } from "@/lib/issueLink";
import { classifyRisk, PLAIN_WORDS, whyItMatters } from "@/lib/plainLanguage";
import { Z } from "@/lib/zLayers";

// ── Topographic Mesh palette ──
// Dark deep-navy ground with lime/green topographic accents and
// monospace eyebrows. Matches the mockup at
// artifacts/mockup-sandbox/src/components/mockups/briefing-bg/TopographicMesh.tsx.
const BRAND = {
  bg: "#1B2B38",
  bgDeeper: "#0F1A24",
  green: "#6BA539",
  greenLight: "#A9C23F",
  slate: "#1B2B38",
  slateRaised: "#22384A",
  border: "rgba(169,194,63,0.18)",
  borderStrong: "rgba(169,194,63,0.30)",
  innerHi: "rgba(169,194,63,0.35)",
  text: "#E7EEF2",
  muted: "rgba(231,238,242,0.6)",
  dim: "rgba(231,238,242,0.4)",
  amber: "#F4A261",
  amberBg: "rgba(244,162,97,0.10)",
  amberBorder: "rgba(244,162,97,0.40)",
  red: "#F87171",
  redDeep: "#DC2626",
  redBg: "rgba(248,113,113,0.10)",
  redBorder: "rgba(248,113,113,0.40)",
  greenBg: "rgba(107,165,57,0.12)",
  greenBorder: "rgba(169,194,63,0.40)",
  rowBg: "rgba(15,26,36,0.55)",
  cardBg: "#FFFFFF",
  cardText: "#1B2B38",
  cardMuted: "rgba(27,43,56,0.65)",
  cardMutedDim: "rgba(27,43,56,0.45)",
  cardBorder: "rgba(27,43,56,0.10)",
  cardBorderSoft: "rgba(27,43,56,0.06)",
  cardInnerBg: "rgba(27,43,56,0.05)",
  cardTickLime: "rgba(107,165,57,0.85)",
};

const SANS = `Inter, ui-sans-serif, system-ui, -apple-system, 'Segoe UI', sans-serif`;
const MONO = `ui-monospace, SFMono-Regular, Menlo, monospace`;

function CornerTick({
  pos,
  label,
  fixed = false,
}: {
  pos: "tl" | "tr" | "bl" | "br";
  label: string;
  fixed?: boolean;
}) {
  const base: React.CSSProperties = {
    position: fixed ? "fixed" : "absolute",
    fontFamily: MONO,
    fontSize: fixed ? 9 : 11,
    fontWeight: fixed ? 500 : 800,
    letterSpacing: "0.16em",
    color: fixed ? "rgba(169,194,63,0.55)" : BRAND.green,
    pointerEvents: "none",
    zIndex: fixed ? 5 : undefined,
  };
  const map: Record<string, React.CSSProperties> = {
    tl: { top: 10, left: 12 },
    tr: { top: 10, right: 12 },
    bl: { bottom: 10, left: 12 },
    br: { bottom: 10, right: 12 },
  };
  return <div style={{ ...base, ...map[pos] }}>{label}</div>;
}

function Pill({
  children,
  bg,
  fg,
  border,
}: {
  children: React.ReactNode;
  bg?: string;
  fg?: string;
  border?: string;
}) {
  return (
    <span
      className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[10px] font-bold tracking-[0.08em]"
      style={{
        backgroundColor: bg ?? "rgba(34,56,74,0.7)",
        color: fg ?? BRAND.muted,
        border: border ? `1px solid ${border}` : `1px solid ${BRAND.border}`,
      }}
    >
      {children}
    </span>
  );
}

function SectionCard({
  children,
  ticks,
  style,
}: {
  children: React.ReactNode;
  ticks?: { tl?: string; tr?: string; bl?: string; br?: string };
  style?: React.CSSProperties;
}) {
  return (
    <div
      className="relative rounded-lg"
      style={{
        background: BRAND.cardBg,
        border: `1px solid ${BRAND.cardBorder}`,
        boxShadow:
          "inset 0 0 0 1px rgba(27,43,56,0.04), 0 2px 0 rgba(0,0,0,0.18), 0 12px 30px rgba(0,0,0,0.30)",
        padding: 22,
        paddingBottom: ticks?.br || ticks?.bl ? 32 : 22,
        paddingTop: ticks?.tr || ticks?.tl ? 32 : 22,
        color: BRAND.cardText,
        ...style,
      }}
    >
      {ticks?.tl && <CornerTick pos="tl" label={ticks.tl} />}
      {ticks?.tr && <CornerTick pos="tr" label={ticks.tr} />}
      {ticks?.bl && <CornerTick pos="bl" label={ticks.bl} />}
      {ticks?.br && <CornerTick pos="br" label={ticks.br} />}
      {children}
    </div>
  );
}

function SectionHeader({
  eyebrow,
  title,
  right,
  icon,
}: {
  eyebrow?: string;
  title: string;
  right?: React.ReactNode;
  icon?: React.ReactNode;
}) {
  return (
    <div className="flex items-center justify-between mb-3 gap-3">
      <div className="flex items-center gap-2 min-w-0">
        {icon}
        <div className="min-w-0">
          {eyebrow ? (
            <div
              className="text-[10px] font-semibold"
              style={{
                color: BRAND.green,
                letterSpacing: "0.22em",
                fontFamily: MONO,
              }}
            >
              {eyebrow}
            </div>
          ) : null}
          <div
            className="text-[15px] font-semibold"
            style={{ color: BRAND.cardText, letterSpacing: "0.02em" }}
          >
            {title}
          </div>
        </div>
      </div>
      {right}
    </div>
  );
}

function tierStyle(tier: BriefingNotification["tier"]) {
  if (tier === "CRITICAL") {
    return {
      fg: BRAND.red,
      chipBg: "rgba(248,113,113,0.15)",
      chipBorder: BRAND.redBorder,
      icon: AlertCircle,
    };
  }
  if (tier === "WARNING") {
    return {
      fg: BRAND.amber,
      chipBg: "rgba(244,162,97,0.15)",
      chipBorder: BRAND.amberBorder,
      icon: AlertTriangle,
    };
  }
  return {
    fg: BRAND.greenLight,
    chipBg: "rgba(107,165,57,0.15)",
    chipBorder: BRAND.greenBorder,
    icon: Lightbulb,
  };
}

function heroSeverity(severity: "critical" | "warning" | "clear") {
  if (severity === "critical") {
    return {
      fg: BRAND.red,
      border: BRAND.redBorder,
      pillBg: "rgba(248,113,113,0.15)",
      tagLabel: "CRITICAL",
    };
  }
  if (severity === "warning") {
    return {
      fg: BRAND.amber,
      border: BRAND.amberBorder,
      pillBg: BRAND.amberBg,
      tagLabel: "WARNING",
    };
  }
  return {
    fg: BRAND.greenLight,
    border: BRAND.greenBorder,
    pillBg: BRAND.greenBg,
    tagLabel: "ROUTINE",
  };
}

function changeColor(tone: BriefingChange["tone"]) {
  if (tone === "good")
    return {
      color: BRAND.greenLight,
      bg: "rgba(107,165,57,0.15)",
      border: BRAND.greenBorder,
      Icon: TrendingUp,
    };
  if (tone === "bad")
    return {
      color: BRAND.amber,
      bg: "rgba(244,162,97,0.15)",
      border: BRAND.amberBorder,
      Icon: TrendingDown,
    };
  return {
    color: "rgba(169,194,63,0.7)",
    bg: "rgba(107,165,57,0.10)",
    border: BRAND.border,
    Icon: TrendingUp,
  };
}

function kpiColor(tone: BriefingKpi["tone"]): string {
  if (tone === "critical") return BRAND.red;
  if (tone === "good") return BRAND.greenLight;
  return BRAND.text;
}

/** Tiny animated sparkline for the Overnight Scan KPIs. Draws the real
 *  historical series (oldest→newest) as a line that "grows" in on mount via
 *  a stroke-dashoffset transition, with a soft gradient area beneath and an
 *  end dot. Renders nothing for <2 points (REAL-DATA-ONLY — never a flat or
 *  fabricated trend). */
function KpiSparkline({ points, color }: { points: number[]; color: string }) {
  const [drawn, setDrawn] = useState(false);
  const gradId = useMemo(
    () => `spark-${Math.random().toString(36).slice(2)}`,
    [],
  );
  useEffect(() => {
    const raf = requestAnimationFrame(() => setDrawn(true));
    return () => cancelAnimationFrame(raf);
  }, []);
  if (!points || points.length < 2) return null;

  const w = 104;
  const h = 28;
  const pad = 3;
  const min = Math.min(...points);
  const max = Math.max(...points);
  const span = max - min || 1;
  const stepX = (w - pad * 2) / (points.length - 1);
  const coords = points.map((v, i) => {
    const x = pad + i * stepX;
    const y = pad + (h - pad * 2) * (1 - (v - min) / span);
    return [x, y] as const;
  });
  const line = coords
    .map(([x, y], i) => `${i === 0 ? "M" : "L"} ${x.toFixed(1)} ${y.toFixed(1)}`)
    .join(" ");
  const area = `${line} L ${coords[coords.length - 1][0].toFixed(1)} ${h - pad} L ${coords[0][0].toFixed(1)} ${h - pad} Z`;
  const [endX, endY] = coords[coords.length - 1];

  return (
    <svg
      width={w}
      height={h}
      viewBox={`0 0 ${w} ${h}`}
      className="mt-2 overflow-visible"
      aria-hidden="true"
      focusable="false"
      preserveAspectRatio="none"
    >
      <defs>
        <linearGradient id={gradId} x1="0" x2="0" y1="0" y2="1">
          <stop offset="0%" stopColor={color} stopOpacity={0.22} />
          <stop offset="100%" stopColor={color} stopOpacity={0} />
        </linearGradient>
      </defs>
      <path
        d={area}
        fill={`url(#${gradId})`}
        stroke="none"
        style={{ opacity: drawn ? 1 : 0, transition: "opacity 0.9s ease 0.3s" }}
      />
      <path
        d={line}
        fill="none"
        stroke={color}
        strokeWidth={1.75}
        strokeLinecap="round"
        strokeLinejoin="round"
        pathLength={1}
        style={{
          strokeDasharray: 1,
          strokeDashoffset: drawn ? 0 : 1,
          transition: "stroke-dashoffset 1.1s cubic-bezier(0.16,1,0.3,1)",
        }}
      />
      <circle
        cx={endX}
        cy={endY}
        r={2.4}
        fill={color}
        style={{ opacity: drawn ? 1 : 0, transition: "opacity 0.4s ease 1s" }}
      />
    </svg>
  );
}

function firstName(full: string | undefined): string {
  if (!full) return "there";
  // Email-style usernames (e.g. "samtender12@gmail.com") have no spaces —
  // use the local part before "@" so we don't greet with a full address.
  const local = full.trim().split("@")[0];
  const token = local.split(/[\s._-]+/)[0] || "there";
  return token.charAt(0).toUpperCase() + token.slice(1);
}

export default function DailyBriefingPage() {
  const [, navigate] = useLocation();
  const { user } = useAuth();
  const [now, setNow] = useState<Date>(() => new Date());
  // Instant render: seed from the last fully-live briefing for this
  // tenant+user (lib/dailyBriefing readBriefingSeed — ≤48h, role/window
  // matched). The live compose still runs on mount and swaps in; while it
  // runs the pulse shows SYNCING, so the seed is never passed off as live.
  const [data, setData] = useState<DailyBriefingData | null>(() =>
    readBriefingSeed(resolveActiveRole(user?.userRoles, user?.username), "1d"),
  );
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);

  // Active persona — same resolver the Home screen uses. Drives which
  // alert/KPIs lead and the header greeting. Repaints the moment the
  // user switches roles from anywhere in the chrome, matching Home.
  const [role, setRole] = useState<RolePersona>(() =>
    resolveActiveRole(user?.userRoles, user?.username),
  );
  useEffect(() => {
    setRole(resolveActiveRole(user?.userRoles, user?.username));
    const onChange = () =>
      setRole(resolveActiveRole(user?.userRoles, user?.username));
    window.addEventListener("rmone:roleOverrideChanged", onChange);
    return () => window.removeEventListener("rmone:roleOverrideChanged", onChange);
  }, [user?.userRoles, user?.username]);
  const [modalDetail, setModalDetail] = useState<ActionDetail | null>(null);
  const [modalOpen, setModalOpen] = useState(false);
  // Hero whose "Resolve now" options picker is open. Each option deep-links
  // to the page where the problem can be fixed; AI chat is the last option.
  const [resolveHero, setResolveHero] = useState<BriefingHero | null>(null);
  // Staffing quick actions shared with the home page's alert panels:
  // demand-coverage → Add Team Member (consumes the SELECTED open slot),
  // over-allocation → Edit Allocation.
  const staffingQA = useStaffingQuickActions({ onNavigate: (to) => navigate(to) });
  const [chipPopover, setChipPopover] = useState<{ title: string; chips: string[] } | null>(null);
  const prefersReducedMotion = useReducedMotion();
  // Phones/tablets: the three fixed, oversized, infinitely-animated backdrop
  // layers (conic sweep + two topo SVGs, one with mix-blend-mode) force huge
  // GPU compositing layers at DPR 3 and crash the tab on iOS while scrolling
  // ("Can't open this page"). Detect once, synchronously, so the heavy layers
  // never mount on touch devices — only the cheap static gradients render.
  const [liteBackdrop] = useState(
    () =>
      typeof window !== "undefined" &&
      (window.matchMedia?.("(pointer: coarse)")?.matches ||
        window.innerWidth < 768),
  );

  // Did a data import (success/partial) finish TODAY for this tenant?
  // When yes, the Overnight Scan card carries a notice so nobody mistakes an
  // upload-driven jump (e.g. +300 projects) for real overnight business
  // activity. Fails silent/false — the notice is advisory, never blocking.
  const [importedToday, setImportedToday] = useState(false);
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(
          `/api/onboarding/history${user?.tenant ? `?tenantId=${encodeURIComponent(user.tenant)}` : ""}`,
          { headers: authHeaders() },
        );
        if (!res.ok) return;
        const j = await res.json();
        const rows: Array<{ status?: string; createdAt?: string }> =
          Array.isArray(j) ? j : (j.jobs || j.history || []);
        const todayKey = (() => {
          const d = new Date();
          return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
        })();
        const hit = rows.some((r) => {
          if (r.status !== "success" && r.status !== "partial") return false;
          if (!r.createdAt) return false;
          const c = new Date(r.createdAt);
          if (isNaN(c.getTime())) return false;
          const key = `${c.getFullYear()}-${String(c.getMonth() + 1).padStart(2, "0")}-${String(c.getDate()).padStart(2, "0")}`;
          return key === todayKey;
        });
        if (!cancelled) setImportedToday(hit);
      } catch {
        /* advisory only — never surface an error for this */
      }
    })();
    return () => { cancelled = true; };
  }, [user?.tenant]);

  const BRIEFING_INTRO_PENDING_KEY = "rmone_briefing_intro_pending";
  // Always play the animated intro splash every time the briefing page
  // mounts (i.e. whenever the user navigates into Daily Briefing), unless
  // the user prefers reduced motion. The session-storage flag is still
  // cleared if present so it doesn't double-trigger.
  const [introPlaying, setIntroPlaying] = useState<boolean>(() => {
    if (typeof window === "undefined") return false;
    if (prefersReducedMotion) return false;
    try { sessionStorage.removeItem(BRIEFING_INTRO_PENDING_KEY); } catch { /* noop */ }
    return true;
  });
  useEffect(() => {
    if (!introPlaying) return;
    const t = setTimeout(() => setIntroPlaying(false), 1600);
    return () => clearTimeout(t);
  }, [introPlaying]);

  useEffect(() => {
    const prevBody = document.body.style.background;
    const prevHtml = document.documentElement.style.background;
    document.body.style.background = BRAND.bgDeeper;
    document.documentElement.style.background = BRAND.bgDeeper;
    return () => {
      document.body.style.background = prevBody;
      document.documentElement.style.background = prevHtml;
    };
  }, []);

  const openDetail = useCallback((detail: ActionDetail | null | undefined) => {
    if (!detail) return;
    setModalDetail(detail);
    setModalOpen(true);
  }, []);

  const handleAskAI = useCallback(
    (payload?: { selectedIndexes: number[]; note: string }) => {
      if (!modalDetail) return;
      const idx = payload?.selectedIndexes?.[0] ?? 0;
      const row = modalDetail.rows?.[idx] as Record<string, unknown> | undefined;
      const cols = modalDetail.columns ?? [];
      const colKeys = cols.map((c) => c.key);
      const rowFacts = row && cols.length > 0
        ? cols
            .map((c) => {
              const isProjects = c.key === "Projects";
              const fullProjects = isProjects
                ? (row as Record<string, unknown>)._projectsAll
                : undefined;
              const v = (fullProjects ?? row[c.key]) as unknown;
              if (v == null || v === "") return null;
              return `- ${c.label}: ${String(v)}`;
            })
            .filter(Boolean)
            .join("\n")
        : "";
      const projectsAll = (row as Record<string, unknown> | undefined)
        ?._projectsAll as string | undefined;
      const projectIds = projectsAll
        ? projectsAll.split(",").map((s) => s.trim()).filter(Boolean)
        : [];

      // Ticket/aggregate guard: rows synthesized for the hero "Resolve
      // now" panel (and some live detail rows) carry a hidden _ticket or
      // _aggregate marker. Pass the exact ID to the AI when there is one;
      // stop it from hunting for a nonexistent project when the row is a
      // portfolio-level aggregate.
      const rowTicket = row ? String(row._ticket ?? "").trim() : "";
      const rowIsAggregate = row ? String(row._aggregate ?? "") === "true" : false;
      const ticketGuard = rowTicket
        ? `TICKET ID: ${rowTicket} — use this exact ID when calling any RM ONE lookup tool. Do NOT alter or substitute any other ID.\n\n`
        : rowIsAggregate
          ? `NOTE: This item is a portfolio-level metric, not a single project record. Do NOT call search_projects for it — there is no project name to look up. Answer using only the figures already given above; recommend general next steps instead of naming a specific project.\n\n`
          : "";

      const isAllocation = colKeys.includes("Utilization");
      const isOpportunity =
        colKeys.includes("Stage") ||
        colKeys.includes("Win") ||
        colKeys.includes("Weighted");
      const isDemand =
        colKeys.includes("Title") && colKeys.includes("Value");

      let protocol = "";
      let pickerLine = "";

      if (isAllocation && projectIds.length > 0) {
        pickerLine = `[BUTTONS:${projectIds.join(",")}]`;
        protocol =
          `Protocol:\n` +
          `1. Call get_weekly_utilization for THIS resource to read real ` +
          `weekly hours and capacity.\n` +
          `2. For EACH unique project ID, call get_project_details.\n` +
          `3. Report the EXACT situation in 3-5 short bullets with real ` +
          `numbers (hours over capacity, which weeks, which projects ` +
          `collide, who else on the team has slack).\n` +
          `4. Recommend ONE concrete headline fix that brings the resource ` +
          `to ≤100% utilization. Trim a few hours from SEVERAL projects ` +
          `(prefer ones where a teammate has slack on the same role); state ` +
          `per-project deltas, e.g. "-5h/wk on PMM-...-000167 → Alexander, ` +
          `-3h/wk on PMM-...-000220 → Peter; new util 99%". Always show the ` +
          `resulting total utilization %.\n` +
          `5. End with EXACTLY this picker line and nothing after it:\n` +
          `${pickerLine}\n\n` +
          `When I click a project ID button, open the weekly-allocation ` +
          `editor for that specific project EXACTLY ONCE and STOP. Render ` +
          `a single [WEEKLY_ALLOC:...] block and nothing else. Do NOT call ` +
          `edit_weekly_allocation, edit_phase_hours, update_allocations or ` +
          `execute_update — wait for me to make the change in the editor.`;
      } else if (isOpportunity) {
        pickerLine =
          `[BUTTONS:Draft outreach email,Recommend best-fit team,Show risks & blockers]`;
        protocol =
          `Protocol:\n` +
          `1. Call get_opportunities_by_status / get_awarded_opportunities ` +
          `as needed to confirm stage, owner, weighted value and last ` +
          `activity date for THIS pursuit.\n` +
          `2. Call get_workforce_summary and find_staff_for_project to ` +
          `identify 2-3 best-fit team members for the work this opportunity ` +
          `would generate.\n` +
          `3. Report the EXACT situation in 3-5 short bullets: stage, ` +
          `weighted $, days in stage, decision-maker / next milestone, and ` +
          `whether we have the team to deliver if we win.\n` +
          `4. Recommend ONE concrete next move (e.g. "Send proposal-` +
          `revision email to <decision-maker> by <date>; staff with ` +
          `<person A>, <person B>"), naming people and dates.\n` +
          `5. End with EXACTLY this picker line and nothing after it:\n` +
          `${pickerLine}\n\n` +
          `🛑 HARD STOP after step 5. Do NOT continue with "Draft outreach ` +
          `email", "Recommend best-fit team", or "Show risks & blockers" ` +
          `output until the user actually clicks the corresponding button ` +
          `in a follow-up turn. The conditional rules below describe what ` +
          `to do in those FUTURE turns — they are NOT part of this reply.\n\n` +
          `When I click "Draft outreach email", draft the actual email ` +
          `body. When I click "Recommend best-fit team", produce a ` +
          `DETAILED recommendation with these sections in order:\n` +
          `  • For EACH discipline the project actually needs (Plumbing ` +
          `Engineer, Mechanical Engineer, Senior Project Manager, ` +
          `Architect, etc.) call find_staff_for_project / ` +
          `get_workforce_summary and produce TWO sub-lists:\n` +
          `      ▸ "Top picks (best-fit)" — up to 3 names, each with: ` +
          `current title/role, current utilization %, years of relevant ` +
          `experience, 1–2 sentence reason explaining WHY they're a fit ` +
          `(matching past projects, sector experience, certifications, ` +
          `geography, etc.).\n` +
          `      ▸ "Bench (available capacity)" — EVERY OTHER person in ` +
          `that discipline who has spare capacity (utilization < 100%), ` +
          `as a compact comma-separated list "Name (role, util%)". Do ` +
          `NOT truncate this bench list — include all of them so the ` +
          `user sees the full pool.\n` +
          `  • End with a 1-line "Why these picks" summary explaining ` +
          `the selection criteria you used (utilization, sector match, ` +
          `recent similar work).\n` +
          `🔴 ABSOLUTE RULE: your reply MUST END with EXACTLY ONE ` +
          `consolidated picker line and nothing after it: ` +
          `[BUTTONS:Assign <Name1>,Assign <Name2>,Assign <Name3>,...] ` +
          `containing every TOP-PICK name across all discipline ` +
          `sections (max 9 buttons, comma-separated, each prefixed with ` +
          `"Assign "). Bench names go in the prose only, NOT in the ` +
          `button row. Without that picker line, the user has no way to ` +
          `assign anyone — re-output your reply if you forgot it. ` +
          `When I then click "Assign <Name>", prepare an assign_person call (project_id from the ` +
          `record, role from the candidate's recommended role, pct=100, ` +
          `start/end from project dates), summarize in 2 lines and end ` +
          `with [BUTTONS:CONFIRM,Cancel]. Call assign_person ONLY after I ` +
          `click CONFIRM. When I click "Show risks & blockers", list the ` +
          `top 3 risks (stalled stage, missing decision-maker, capacity ` +
          `gaps, competitor activity) with the mitigation for each.`;
      } else if (isDemand) {
        pickerLine =
          `[BUTTONS:Suggest top candidates,Draft role brief,Defer demand]`;
        protocol =
          `Protocol:\n` +
          `1. Call find_staff_for_project / get_workforce_summary to ` +
          `identify 3 best-fit candidates (right role, current util ≤80%).\n` +
          `2. Call get_project_details for the related project to confirm ` +
          `dates, role mix and contract value.\n` +
          `3. Report the EXACT situation in 3-5 short bullets: role, hours ` +
          `needed, start date, contract value, top 3 candidates with their ` +
          `current utilization.\n` +
          `4. Recommend ONE concrete fill plan (e.g. "Assign <Person> at ` +
          `<X>h/wk starting <date>; backup <Person>"), naming people and ` +
          `dates.\n` +
          `5. End with EXACTLY this picker line and nothing after it:\n` +
          `${pickerLine}\n\n` +
          `When I click "Suggest top candidates", show a ranked roster of ` +
          `up to 3 candidates with names, roles and utilization, then end ` +
          `with EXACTLY: [BUTTONS:Assign <Name1>,Assign <Name2>,Assign ` +
          `<Name3>]. When I then click "Assign <Name>", prepare an ` +
          `assign_person call (project_id from the record, role from the ` +
          `demand, pct=100, start/end from the demand dates), summarize ` +
          `in 2 lines and end with [BUTTONS:CONFIRM,Cancel]. Call ` +
          `assign_person ONLY after I click CONFIRM. When I click "Draft ` +
          `role brief", draft a short JD I can post. When I click "Defer ` +
          `demand", explain the impact and confirm.`;
      } else {
        pickerLine = `[BUTTONS:Show next steps,Open related record]`;
        protocol =
          `Protocol:\n` +
          `1. Use the appropriate tools (get_workforce_summary, ` +
          `get_project_details, get_resource_demands, etc.) to read the ` +
          `real data behind THIS record.\n` +
          `2. Report the EXACT situation in 3-5 short bullets with real ` +
          `numbers and names.\n` +
          `3. Recommend ONE concrete next move, naming people, dates and ` +
          `amounts.\n` +
          `4. End with EXACTLY this picker line and nothing after it:\n` +
          `${pickerLine}`;
      }

      const prompt =
        `Resolve a specific record from today's Daily Briefing.\n\n` +
        (rowFacts ? `Selected record:\n${rowFacts}\n\n` : "") +
        `Briefing section: ${modalDetail.title}` +
        (modalDetail.subtitle ? ` — ${modalDetail.subtitle}` : "") +
        `\n\nHARD RULES:\n` +
        `• No generic advice. Cite real numbers from tool calls.\n` +
        `• NEVER narrate what you are about to do ("The current context ` +
        `does not include...", "Let me retrieve...", "I'll first check..."). ` +
        `Call the tools silently, then answer with the result only.\n` +
        `• NEVER emit placeholder brackets like [Specific Details Needed], ` +
        `[Proposed Date: TBD], [Not specified], [Not listed], [TBD], or any ` +
        `other [bracketed] stand-in text. If a value is unknown, CALL THE ` +
        `TOOL to fetch it (get_workforce_summary for utilization, ` +
        `get_project_details for dates/contract values, ` +
        `find_staff_for_project for candidates). If the tool returns ` +
        `nothing, OMIT that bullet entirely — do not write a placeholder.\n` +
        `• Your FIRST reply MUST end with the picker line and MUST NOT ` +
        `contain any [WEEKLY_ALLOC:...], [SCHEDULE_TABLE:...], ` +
        `[ALLOC_FORM:...] or [LIFECYCLE_PICKER:...] block — the user picks ` +
        `the action.\n\n` +
        ticketGuard +
        protocol;
      setChatPrompt(prompt, { newSession: true, autoSend: true });
      setModalOpen(false);
      navigate("/chat");
    },
    [modalDetail, navigate],
  );

  // "Resolve now" opens the same side-panel drill-down used everywhere
  // else in the app (explanation card + paginated affected-records
  // table). The hero's live records back the table; heroes without
  // records get a single synthesized row so the AI hand-off still works.
  const handleResolve = useCallback((hero: BriefingHero) => {
    if (!hero.resolveRef) return;
    setModalOpen(false);
    setModalDetail(heroResolveDetail(hero));
    setResolveHero(hero);
  }, []);

  const windowKey: BriefingWindow = "1d";

  const loadIdRef = useRef(0);
  const load = useCallback(async (forceRefresh = false) => {
    const myId = ++loadIdRef.current;
    setError(null);
    try {
      if (!forceRefresh) {
        const saved = await readSavedBriefing(role, windowKey);
        if (saved && loadIdRef.current === myId) {
          setData(saved);
          setLoading(false);
          setRefreshing(false);
          // Paint the saved overnight result first, then quietly produce the
          // next saved result while the user reads it. A manual refresh still
          // uses the normal loading treatment and bypasses this fast path.
          void composeDailyBriefing({ forceRefresh: true, window: windowKey, role })
            .then((fresh) => {
              if (loadIdRef.current === myId) setData(fresh);
            })
            .catch((e) => {
              console.warn("[DailyBriefing] background refresh failed:", String(e));
            });
          return;
        }
      }
      const next = await composeDailyBriefing({ forceRefresh, window: "1d", role });
      if (loadIdRef.current !== myId) return;
      setData(next);
    } catch (e) {
      if (loadIdRef.current !== myId) return;
      console.warn("[DailyBriefing] composer failed:", String(e));
      const raw = String(e);
      if (raw.includes("401") || raw.includes("Unauthorized")) {
        setError("Your session has expired. Please log in again.");
      } else if (raw.includes("Network") || raw.includes("fetch")) {
        setError("Unable to connect. Please check your network and try again.");
      } else {
        setError("We couldn't pull your briefing just now. Try refreshing.");
      }
    } finally {
      if (loadIdRef.current !== myId) return;
      setLoading(false);
      setRefreshing(false);
    }
  }, [role]);

  useEffect(() => {
    if (!user?.username) return;
    setInboxUser(user.username, user.userRoles);
    load();
  }, [user?.username, user?.userRoles, load]);

  // Mark today's briefing as seen the moment the page opens for this
  // account. The once-per-day login gate (lib/briefingGate.ts) checks this
  // marker, so opening the briefing — via the post-login redirect or the
  // avatar menu — counts as "shown for today" even if the user navigates
  // away without pressing "Open command center".
  useEffect(() => {
    markBriefingSeen();
    // Release the post-login splash: its only ready-gate is RoleHome's
    // overlay signal, but on the first login of the day the post-login
    // route is /briefing — RoleHome never mounts, the signal never fires,
    // and the splash stranded every briefing login on the full 20s
    // MAX_HOLD cap. The briefing page has its own loading treatment
    // (SYNCING pulse + intro overlay), so the splash can hand off as
    // soon as this page mounts.
    markHomeOverlayReady();
  }, []);

  const dateLabel = useMemo(() => {
    const tz = "America/Los_Angeles";
    const weekday = now.toLocaleDateString("en-US", { weekday: "long", timeZone: tz });
    const month = now.toLocaleDateString("en-US", { month: "short", timeZone: tz });
    const day = now.toLocaleDateString("en-US", { day: "numeric", timeZone: tz });
    const year = now.toLocaleDateString("en-US", { year: "numeric", timeZone: tz });
    return `${weekday.toUpperCase()} · ${month.toUpperCase()} ${day}, ${year}`;
  }, [now]);

  const greeting = `Good morning, ${firstName(user?.username)}`;

  function handleOpenCommand() {
    markBriefingSeen();
    navigate("/");
  }

  function handleRefresh() {
    setRefreshing(true);
    setNow(new Date());
    load(true);
  }

  const fetchedAtTick = useMemo(() => {
    if (!data) return "";
    return new Date(data.fetchedAt).toLocaleTimeString("en-US", {
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
      timeZone: "America/Los_Angeles",
    }) + " PT";
  }, [data]);

  const livePulseLabel = loading
    ? "SYNCING"
    : data
    ? `AS OF ${fetchedAtTick}`
    : "LIVE PULSE";

  const activeProjectsCount = data
    ? (() => {
        const kpi = data.scan.kpis.find((k) =>
          /project|active/i.test(`${k.labelTop} ${k.labelBottom}`),
        );
        return kpi ? kpi.number : "—";
      })()
    : "—";
  const alertCount = data ? data.notifications.length : 0;

  return (
    <div
      className="w-full overflow-y-auto relative"
      style={{
        background: BRAND.bgDeeper,
        color: BRAND.text,
        fontFamily: SANS,
        position: "relative",
        overflowX: "hidden",
      }}
    >
      <style>{`
        @keyframes topo-drift {
          0%   { transform: translate3d(0, 0, 0); }
          50%  { transform: translate3d(-30px, -18px, 0); }
          100% { transform: translate3d(0, 0, 0); }
        }
        @keyframes topo-drift-slow {
          0%   { transform: translate3d(0, 0, 0) scale(1); }
          50%  { transform: translate3d(20px, 12px, 0) scale(1.02); }
          100% { transform: translate3d(0, 0, 0) scale(1); }
        }
        @keyframes conic-pulse {
          0%, 100% { opacity: 0.55; }
          50% { opacity: 0.8; }
        }
        .topo-layer-a { animation: topo-drift 38s ease-in-out infinite; }
        .topo-layer-b { animation: topo-drift-slow 64s ease-in-out infinite; }
        .conic-sweep { animation: conic-pulse 14s ease-in-out infinite; }
        @media (prefers-reduced-motion: reduce) {
          .topo-layer-a, .topo-layer-b, .conic-sweep { animation: none !important; }
        }
      `}</style>

      {/* ── Backdrop layers (fixed to viewport so they fill the screen even when content is short) ──
          On touch devices only the cheap static gradients render (see liteBackdrop). */}
      {!liteBackdrop && (
        <div
          className="conic-sweep"
          aria-hidden
          style={{
            position: "fixed",
            inset: 0,
            background:
              "conic-gradient(from 220deg at 100% 0%, rgba(107,165,57,0.18) 0deg, rgba(107,165,57,0.08) 45deg, transparent 110deg, transparent 360deg)",
            pointerEvents: "none",
            zIndex: 0,
          }}
        />
      )}
      <div
        aria-hidden
        style={{
          position: "fixed",
          inset: 0,
          background:
            "radial-gradient(900px 600px at 92% -8%, rgba(169,194,63,0.10), transparent 60%), radial-gradient(700px 500px at 0% 100%, rgba(107,165,57,0.07), transparent 65%)",
          pointerEvents: "none",
          zIndex: 0,
        }}
      />

      {/* SVG topographic contours */}
      <svg
        aria-hidden
        className="topo-layer-a"
        style={{
          position: "fixed",
          inset: "-10% -10%",
          width: "120%",
          height: "120%",
          pointerEvents: "none",
          opacity: 0.55,
          zIndex: 0,
          display: liteBackdrop ? "none" : undefined,
        }}
        viewBox="0 0 1200 900"
        preserveAspectRatio="xMidYMid slice"
      >
        <defs>
          <radialGradient id="topoFadeA" cx="60%" cy="40%" r="70%">
            <stop offset="0%" stopColor="#A9C23F" stopOpacity="0.55" />
            <stop offset="60%" stopColor="#6BA539" stopOpacity="0.18" />
            <stop offset="100%" stopColor="#6BA539" stopOpacity="0" />
          </radialGradient>
        </defs>
        <g fill="none" stroke="url(#topoFadeA)" strokeWidth="1">
          {Array.from({ length: 18 }).map((_, i) => {
            const r = 70 + i * 38;
            return (
              <ellipse
                key={i}
                cx="780"
                cy="320"
                rx={r}
                ry={r * 0.62}
                transform={`rotate(${-12 + i * 0.6} 780 320)`}
              />
            );
          })}
        </g>
        <g fill="none" stroke="rgba(169,194,63,0.18)" strokeWidth="1">
          {Array.from({ length: 14 }).map((_, i) => {
            const r = 60 + i * 44;
            return (
              <ellipse
                key={i}
                cx="220"
                cy="700"
                rx={r * 0.9}
                ry={r * 0.55}
                transform={`rotate(${20 - i * 0.8} 220 700)`}
              />
            );
          })}
        </g>
      </svg>

      <svg
        aria-hidden
        className="topo-layer-b"
        style={{
          position: "fixed",
          inset: "-15% -15%",
          width: "130%",
          height: "130%",
          pointerEvents: "none",
          opacity: 0.35,
          mixBlendMode: "screen",
          zIndex: 0,
          display: liteBackdrop ? "none" : undefined,
        }}
        viewBox="0 0 1200 900"
        preserveAspectRatio="xMidYMid slice"
      >
        <g fill="none" stroke="rgba(169,194,63,0.22)" strokeWidth="0.8">
          {Array.from({ length: 22 }).map((_, i) => {
            const r = 30 + i * 30;
            const cx = 480 + Math.sin(i * 0.7) * 60;
            const cy = 480 + Math.cos(i * 0.5) * 40;
            return (
              <path
                key={i}
                d={`M ${cx - r} ${cy}
                    C ${cx - r} ${cy - r * 0.7}, ${cx + r * 0.4} ${cy - r * 0.9}, ${cx + r} ${cy}
                    C ${cx + r} ${cy + r * 0.7}, ${cx - r * 0.4} ${cy + r * 0.95}, ${cx - r} ${cy} Z`}
              />
            );
          })}
        </g>
      </svg>

      {/* Vignette */}
      <div
        aria-hidden
        style={{
          position: "fixed",
          inset: 0,
          background:
            "radial-gradient(120% 90% at 50% 40%, transparent 50%, rgba(15,26,36,0.85) 100%)",
          pointerEvents: "none",
          zIndex: 0,
        }}
      />

      {/* Wrapper to lift content above the backdrop */}
      <div className="relative" style={{ zIndex: 1 }}>
      {/* Window-change splash — branded RM ONE agents-evaluating overlay.
       *  Three concentric rings (counter-rotating outer, mid orbit dot,
       *  pulsing core) over a frosted dark backdrop. Used when the user
       *  changes the time horizon and we re-pull the briefing. */}
      <AnimatePresence>
        {refreshing && (
          <motion.div
            key="briefing-window-splash"
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
            data-testid="briefing-window-splash"
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
                background:
                  "linear-gradient(180deg, rgba(34,56,74,0.96) 0%, rgba(27,43,56,0.96) 100%)",
                border: `1px solid ${BRAND.borderStrong}`,
                padding: "32px 44px",
                minWidth: 340,
                boxShadow:
                  "inset 0 0 0 1px rgba(169,194,63,0.08), 0 18px 48px rgba(0,0,0,0.55)",
              }}
            >
              {/* Triple-ring agent processing animation */}
              <div
                className="relative flex items-center justify-center"
                style={{ width: 76, height: 76, marginBottom: 18 }}
              >
                {/* Outer ring — counter-rotating tick marks */}
                <motion.div
                  aria-hidden
                  animate={prefersReducedMotion ? undefined : { rotate: -360 }}
                  transition={prefersReducedMotion ? undefined : { duration: 6, repeat: Infinity, ease: "linear" }}
                  style={{
                    position: "absolute",
                    inset: 0,
                    borderRadius: "50%",
                    border: `1px dashed ${BRAND.borderStrong}`,
                  }}
                />
                {/* Mid orbiting arc */}
                <motion.div
                  aria-hidden
                  animate={prefersReducedMotion ? undefined : { rotate: 360 }}
                  transition={prefersReducedMotion ? undefined : { duration: 1.6, repeat: Infinity, ease: "linear" }}
                  style={{
                    position: "absolute",
                    inset: 8,
                    borderRadius: "50%",
                    border: `2px solid ${BRAND.border}`,
                    borderTopColor: BRAND.greenLight,
                    borderRightColor: BRAND.green,
                  }}
                />
                {/* Pulsing core */}
                <motion.div
                  aria-hidden
                  animate={prefersReducedMotion ? undefined : { scale: [1, 1.18, 1], opacity: [0.85, 1, 0.85] }}
                  transition={prefersReducedMotion ? undefined : { duration: 1.4, repeat: Infinity, ease: "easeInOut" }}
                  style={{
                    width: 18,
                    height: 18,
                    borderRadius: "50%",
                    backgroundColor: BRAND.green,
                    boxShadow: "0 0 20px rgba(107,165,57,0.75), inset 0 0 0 2px rgba(255,255,255,0.18)",
                  }}
                />
              </div>
              <div
                style={{
                  fontFamily: MONO,
                  fontSize: 10,
                  letterSpacing: "0.26em",
                  color: BRAND.greenLight,
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
                  color: BRAND.text,
                  letterSpacing: "-0.01em",
                  lineHeight: 1.3,
                }}
              >
                Evaluating your daily briefing
              </div>
              <div
                className="text-center"
                style={{
                  fontFamily: MONO,
                  fontSize: 11,
                  color: BRAND.muted,
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

      {/* Briefing intro overlay — reuses the app-wide animated RM ONE splash
       *  (logo, wordmark, orbiting dots, grid, loader bar). Plays on every
       *  Daily Briefing mount so the user gets a consistent branded entry. */}
      <SplashOverlay
        show={introPlaying}
        reduceMotion={!!prefersReducedMotion}
        testId="briefing-intro-overlay"
        label="Preparing today's briefing"
        tagline="Daily Briefing · Preparing"
      />

      <div
        className="mx-auto flex flex-col relative"
        style={{
          maxWidth: 760,
          paddingTop: 40,
          paddingLeft: 32,
          paddingRight: 32,
          paddingBottom: "calc(82px + env(safe-area-inset-bottom))",
          zIndex: 1,
          gap: 24,
        }}
      >
        {/* ── Header (TopographicMesh masthead) ── */}
        <motion.header
          initial={{ opacity: 0, y: -8 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.6, ease: [0.16, 1, 0.3, 1] }}
          data-testid="briefing-banner"
          className="flex items-start justify-between flex-wrap gap-4"
        >
          <div>
            <div className="flex items-center gap-2">
              <img
                src={`${import.meta.env.BASE_URL}rmone-logo.png`}
                alt="RM ONE"
                style={{
                  width: 26,
                  height: 26,
                  objectFit: "contain",
                  display: "block",
                }}
              />
              <div
                className="text-[15px] font-extrabold tracking-[0.08em]"
                style={{ color: BRAND.greenLight }}
              >
                RM ONE
              </div>
              <div
                className="text-[13px] font-semibold tracking-[0.06em] ml-2"
                style={{ color: BRAND.text, fontFamily: SANS }}
              >
                — Daily Briefing
              </div>
            </div>
            <h1
              className="mt-4 text-[38px] font-semibold leading-[1.05]"
              style={{ color: BRAND.text, letterSpacing: "-0.02em", margin: "16px 0 0 0" }}
            >
              {greeting}
            </h1>
            <div className="mt-2 flex items-center gap-2 flex-wrap">
              <span
                className="text-[10px] font-extrabold uppercase tracking-[0.08em] px-2 py-[3px] rounded"
                style={{
                  color: BRAND.greenLight,
                  fontFamily: SANS,
                  background: `${BRAND.greenLight}1F`,
                  border: `1px solid ${BRAND.greenLight}55`,
                }}
              >
                {(() => {
                  const _raw = (getJobTitleOverride(user?.username) || user?.userRoles || "").trim();
                  return (_raw && !_raw.includes(",") && _raw.length <= 50)
                    ? _raw.toUpperCase()
                    : rolePersonaBadge(role);
                })()}
              </span>
            </div>
            <div
              className="mt-1 text-[13px]"
              style={{
                color: BRAND.muted,
                fontFamily: MONO,
                letterSpacing: "0.06em",
              }}
            >
              {dateLabel}
            </div>
          </div>
        </motion.header>


        {/* ── Loading state — RM ONE agents evaluating the briefing ── */}
        {loading && !data ? (
          <div
            className="flex flex-col items-center justify-center"
            style={{ padding: "72px 0", gap: 16 }}
            role="status"
            aria-live="polite"
          >
            {/* Triple-ring agent processing animation (matches the
             *  window-change splash so the language is consistent). */}
            <div
              className="relative flex items-center justify-center"
              style={{ width: 72, height: 72 }}
            >
              <motion.div
                aria-hidden
                animate={prefersReducedMotion ? undefined : { rotate: -360 }}
                transition={prefersReducedMotion ? undefined : { duration: 6, repeat: Infinity, ease: "linear" }}
                style={{
                  position: "absolute",
                  inset: 0,
                  borderRadius: "50%",
                  border: `1px dashed ${BRAND.borderStrong}`,
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
                  border: `2px solid ${BRAND.border}`,
                  borderTopColor: BRAND.greenLight,
                  borderRightColor: BRAND.green,
                }}
              />
              <motion.div
                aria-hidden
                animate={prefersReducedMotion ? undefined : { scale: [1, 1.18, 1], opacity: [0.85, 1, 0.85] }}
                transition={prefersReducedMotion ? undefined : { duration: 1.4, repeat: Infinity, ease: "easeInOut" }}
                style={{
                  width: 16,
                  height: 16,
                  borderRadius: "50%",
                  backgroundColor: BRAND.green,
                  boxShadow: "0 0 18px rgba(107,165,57,0.7), inset 0 0 0 2px rgba(255,255,255,0.18)",
                }}
              />
            </div>
            <div
              style={{
                fontFamily: MONO,
                fontSize: 10,
                letterSpacing: "0.26em",
                color: BRAND.greenLight,
                fontWeight: 700,
              }}
            >
              RM ONE AGENTS · WORKING
            </div>
            <div
              className="text-center"
              style={{
                fontSize: 16,
                fontWeight: 600,
                color: BRAND.text,
                letterSpacing: "-0.01em",
                lineHeight: 1.3,
                maxWidth: 360,
              }}
            >
              Evaluating your daily briefing
            </div>
            <div
              className="text-center"
              style={{
                fontFamily: MONO,
                fontSize: 11,
                color: BRAND.muted,
                letterSpacing: "0.08em",
                marginTop: -8,
              }}
            >
              Synthesising live RM ONE signals
            </div>
          </div>
        ) : null}

        {/* ── Stale notice — live refresh failed, showing the saved seed ── */}
        {!loading && error && data ? (
          <div
            className="flex items-center gap-2 rounded-lg px-3 py-2"
            style={{
              backgroundColor: BRAND.amberBg,
              border: `1px solid ${BRAND.amberBorder}`,
              marginBottom: 16,
            }}
            role="status"
          >
            <WifiOff size={13} style={{ color: BRAND.amber, flexShrink: 0 }} />
            <span
              style={{
                fontFamily: MONO,
                fontSize: 10,
                letterSpacing: "0.12em",
                color: BRAND.amber,
                fontWeight: 700,
              }}
            >
              LIVE REFRESH FAILED — SHOWING YOUR LAST SAVED BRIEFING
            </span>
          </div>
        ) : null}

        {/* ── Error state (no data) ── */}
        {!loading && error && !data ? (
          <SectionCard
            ticks={{ tl: "ERR", br: "RETRY" }}
            style={{
              borderColor: BRAND.redBorder,
              boxShadow:
                "inset 0 0 0 1px rgba(248,113,113,0.06), 0 12px 30px rgba(0,0,0,0.35)",
            }}
          >
            <div className="flex flex-col items-center text-center gap-2">
              <WifiOff className="h-7 w-7" style={{ color: BRAND.redDeep }} />
              <div className="text-[15px] font-bold" style={{ color: BRAND.cardText }}>
                Briefing unavailable
              </div>
              <div className="text-[12px]" style={{ color: BRAND.cardMuted, lineHeight: 1.5 }}>
                {error}
              </div>
              <button
                onClick={() => { setLoading(true); load(); }}
                className="mt-2 rounded flex items-center justify-center transition-transform hover:scale-[1.01] active:scale-[0.99]"
                style={{
                  backgroundColor: BRAND.green,
                  color: "#0F1A24",
                  padding: "10px 22px",
                  fontSize: 13,
                  fontWeight: 700,
                }}
              >
                Try again
              </button>
            </div>
          </SectionCard>
        ) : null}

        {/* ── Degraded data banner ── */}
        {data && data.degraded ? (
          <div
            className="flex items-center gap-2 rounded-lg"
            style={{
              backgroundColor: BRAND.amberBg,
              border: `1px solid ${BRAND.amberBorder}`,
              padding: "9px 12px",
            }}
          >
            <AlertTriangle className="h-3.5 w-3.5 shrink-0" style={{ color: BRAND.amber }} />
            <div
              className="text-[11.5px] leading-snug"
              style={{ color: BRAND.text }}
            >
              {`Partial briefing — ${data.degradedSources.join(", ")} feed${data.degradedSources.length === 1 ? "" : "s"} offline. Some numbers may be incomplete.`}
            </div>
          </div>
        ) : null}

        {/* ── Pinned Critical Hero Card ── */}
        {data ? (() => {
          const sev = heroSeverity(data.hero.severity);
          return (
            <div
              className="relative rounded-lg"
              style={{
                background: BRAND.cardBg,
                border: `1.5px solid ${sev.border}`,
                boxShadow:
                  "inset 0 0 0 1px rgba(27,43,56,0.04), 0 12px 30px rgba(0,0,0,0.35)",
                padding: 20,
                paddingTop: 32,
                paddingBottom: 32,
              }}
            >
              <CornerTick pos="tl" label="HERO · 00" />
              <CornerTick pos="br" label={data.hero.agoLabel || "JUST NOW"} />
              <div className="flex items-center gap-2 mb-3 mt-1">
                <Pill bg={sev.pillBg} fg={sev.fg} border={sev.border}>
                  <span
                    className="rounded-full"
                    style={{
                      width: 6,
                      height: 6,
                      backgroundColor: sev.fg,
                      display: "inline-block",
                      marginRight: 2,
                    }}
                  />
                  {data.hero.tagLabel}
                </Pill>
                <Pill bg={BRAND.cardInnerBg} fg={BRAND.cardMuted} border={BRAND.cardBorder}>
                  {data.hero.windowLabel}
                </Pill>
              </div>

              <div
                className="leading-snug mb-2"
                style={{
                  color: BRAND.cardText,
                  fontSize: 24,
                  fontWeight: 600,
                  letterSpacing: "-0.015em",
                }}
              >
                {data.hero.headline}
              </div>
              <div
                className="text-[13.5px] leading-relaxed mb-4"
                style={{ color: BRAND.cardMuted }}
              >
                {data.hero.subline}
              </div>

              {/* All-clear (or nothing actionable): show a positive note
                  instead of greyed-out "Resolve now" / "View" buttons. */}
              {data.hero.severity === "clear" ||
              (!data.hero.resolveRef && !data.hero.detail) ? (
                <div
                  className="flex items-center gap-2 rounded px-3"
                  style={{
                    height: 46,
                    backgroundColor: "rgba(107,165,57,0.10)",
                    border: `1px solid ${BRAND.greenBorder}`,
                    color: BRAND.green,
                    fontSize: 13.5,
                    fontWeight: 600,
                  }}
                >
                  <CheckCircle2 size={16} strokeWidth={2.25} />
                  Nothing to resolve here — no action needed.
                </div>
              ) : (
                <div className="flex items-stretch gap-2">
                  {data.hero.resolveRef ? (
                    <button
                      onClick={() => handleResolve(data.hero)}
                      className="flex-1 rounded flex items-center justify-center transition-transform hover:scale-[1.01] active:scale-[0.99]"
                      style={{
                        backgroundColor: BRAND.green,
                        color: "#0F1A24",
                        height: 46,
                        fontSize: 14,
                        fontWeight: 700,
                        letterSpacing: "0.02em",
                        boxShadow: "0 2px 6px rgba(107,165,57,0.30)",
                      }}
                    >
                      Resolve now
                    </button>
                  ) : null}
                  {data.hero.detail ? (
                    <button
                      onClick={() => openDetail(data.hero.detail)}
                      className={`rounded flex items-center justify-center transition-colors ${
                        data.hero.resolveRef ? "" : "flex-1"
                      }`}
                      style={{
                        ...(data.hero.resolveRef ? { width: 88 } : {}),
                        height: 46,
                        backgroundColor: BRAND.cardInnerBg,
                        border: `1px solid ${BRAND.cardBorder}`,
                        color: BRAND.cardText,
                        fontSize: 14,
                        fontWeight: 600,
                      }}
                    >
                      View
                    </button>
                  ) : null}
                </div>
              )}
            </div>
          );
        })() : null}

        {/* ── Overnight Scan ── */}
        {data ? (
          <SectionCard ticks={{ br: fetchedAtTick || "LIVE" }}>
            <SectionHeader
              title="Overnight Scan"
              icon={
                <span
                  className="inline-flex items-center justify-center rounded shrink-0"
                  style={{
                    width: 22,
                    height: 22,
                    background: "rgba(107,165,57,0.15)",
                    border: `1px solid ${BRAND.greenBorder}`,
                  }}
                >
                  <Zap size={12} color={BRAND.green} strokeWidth={2} />
                </span>
              }
              right={
                <span
                  style={{
                    fontFamily: MONO,
                    fontSize: 10,
                    letterSpacing: "0.14em",
                    color: BRAND.dim,
                  }}
                >
                  {data.scan.subStat}
                </span>
              }
            />
            {importedToday && (
              <div
                style={{
                  margin: "0 12px 10px",
                  padding: "8px 12px",
                  borderRadius: 8,
                  backgroundColor: "rgba(232,119,34,0.10)",
                  border: "1px solid rgba(232,119,34,0.35)",
                  fontSize: 12,
                  lineHeight: 1.45,
                  color: BRAND.cardText,
                  display: "flex",
                  gap: 8,
                  alignItems: "flex-start",
                }}
              >
                <span style={{ fontWeight: 800, color: "#E87722", whiteSpace: "nowrap" }}>
                  DATA IMPORT TODAY
                </span>
                <span style={{ color: BRAND.cardMuted }}>
                  A data upload ran today — day-over-day changes below reflect
                  the import, not overnight business activity.
                </span>
              </div>
            )}
            <div className="flex">
              {data.scan.kpis.map((kpi, i) => {
                const long = kpi.number.length > 4;
                const numberColor =
                  kpi.tone === "critical"
                    ? BRAND.redDeep
                    : kpi.tone === "good"
                      ? BRAND.green
                      : BRAND.cardText;
                const captionColor =
                  kpi.tone === "critical"
                    ? BRAND.redDeep
                    : kpi.tone === "good"
                      ? BRAND.green
                      : BRAND.cardMuted;
                return (
                  <button
                    type="button"
                    key={`${kpi.labelTop}-${i}`}
                    onClick={() => openDetail(kpi.detail)}
                    disabled={!kpi.detail}
                    className="flex-1 min-w-0 px-3 py-1 text-left transition-transform hover:scale-[1.02] active:scale-[0.98] disabled:cursor-not-allowed disabled:hover:scale-100"
                    style={{
                      borderLeft: i === 0 ? "none" : `1px solid ${BRAND.cardBorder}`,
                    }}
                  >
                    <div
                      className="leading-none tabular-nums truncate"
                      style={{
                        color: numberColor,
                        fontWeight: 700,
                        fontSize: long ? 22 : 28,
                        letterSpacing: "-0.01em",
                      }}
                    >
                      {kpi.number}
                    </div>
                    <div
                      className="text-[10px] font-extrabold uppercase mt-2"
                      style={{
                        color: BRAND.cardMuted,
                        letterSpacing: "0.14em",
                        fontFamily: MONO,
                        lineHeight: 1.3,
                      }}
                    >
                      {kpi.labelTop}
                    </div>
                    <div
                      className="text-[10px] font-extrabold uppercase"
                      style={{
                        color: BRAND.cardMuted,
                        letterSpacing: "0.14em",
                        fontFamily: MONO,
                        lineHeight: 1.3,
                      }}
                    >
                      {kpi.labelBottom}
                    </div>
                    <div
                      className="text-[11px] mt-1.5 truncate"
                      style={{ color: captionColor }}
                    >
                      {kpi.caption}
                    </div>
                  </button>
                );
              })}
            </div>
          </SectionCard>
        ) : null}

        {/* ── What Changed ── */}
        {data ? (
          <SectionCard>
            <SectionHeader
              title={data.changesHeading}
              right={
                data.changesAreSample ? (
                  <Pill bg={BRAND.amberBg} fg={BRAND.amber} border={BRAND.amberBorder}>
                    SAMPLE
                  </Pill>
                ) : (
                  <span
                    style={{
                      fontFamily: MONO,
                      fontSize: 11,
                      fontWeight: 800,
                      letterSpacing: "0.16em",
                      color: BRAND.green,
                    }}
                  >
                    {data.changesBadge}
                  </span>
                )
              }
            />

            {data.changes.length === 0 ? (
              <div
                className="text-center py-4"
                style={{
                  color: BRAND.muted,
                  fontSize: 13,
                  lineHeight: 1.5,
                }}
              >
                No movement detected — your operations were quiet overnight.
              </div>
            ) : (
              <div className="flex flex-col">
                {data.changes.map((r, i) => {
                  const c = changeColor(r.tone);
                  return (
                    <button
                      type="button"
                      key={`${r.label}-${i}`}
                      onClick={() => openDetail(r.detail)}
                      disabled={!r.detail}
                      className="flex items-center gap-3 px-1 py-3 text-left transition-colors hover:bg-black/[0.02] disabled:cursor-not-allowed"
                      style={{
                        borderBottom:
                          i < data.changes.length - 1
                            ? `1px solid ${BRAND.cardBorderSoft}`
                            : "none",
                      }}
                    >
                      <span
                        className="inline-flex items-center justify-center rounded-lg shrink-0"
                        style={{
                          width: 30,
                          height: 30,
                          background: c.bg,
                          border: `1px solid ${c.border}`,
                        }}
                      >
                        <c.Icon size={15} color={c.color} strokeWidth={2} />
                      </span>
                      <div className="flex-1 min-w-0">
                        <div
                          className="text-[14px] font-bold truncate"
                          style={{ color: BRAND.cardText }}
                        >
                          {r.label}
                        </div>
                        <div
                          className="text-[12px] mt-0.5 truncate"
                          style={{ color: BRAND.cardMuted, fontFamily: MONO, letterSpacing: "0.02em" }}
                        >
                          {r.context}
                        </div>
                      </div>
                      <div
                        className="tabular-nums shrink-0"
                        style={{
                          color: c.color,
                          fontFamily: MONO,
                          fontSize: 15,
                          fontWeight: 800,
                          letterSpacing: "-0.01em",
                        }}
                      >
                        {r.delta}
                      </div>
                    </button>
                  );
                })}
              </div>
            )}
          </SectionCard>
        ) : null}

        {/* ── Critical Notifications ── */}
        {data ? (
          <SectionCard>
            <SectionHeader
              title="Critical Notifications"
              right={
                <span
                  style={{
                    fontFamily: MONO,
                    fontSize: 11,
                    fontWeight: 800,
                    letterSpacing: "0.16em",
                    color: data.notificationsBadge === "NO ALERTS" ? BRAND.green : BRAND.red,
                  }}
                >
                  {data.notificationsBadge}
                </span>
              }
            />

            {data.notifications.length === 0 ? (
              <div
                className="text-center py-4"
                style={{ color: BRAND.muted, fontSize: 13, lineHeight: 1.5 }}
              >
                No critical notifications in this window — nothing needs your attention right now.
              </div>
            ) : null}
            <div className="flex flex-col gap-2">
              {data.notifications.map((n) => {
                const t = tierStyle(n.tier);
                const Icon = t.icon;
                return (
                  <div
                    key={n.id}
                    role={n.detail ? "button" : undefined}
                    tabIndex={n.detail ? 0 : undefined}
                    onClick={n.detail ? () => openDetail(n.detail) : undefined}
                    onKeyDown={n.detail ? (e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); openDetail(n.detail); } } : undefined}
                    className="flex items-center gap-3 px-3 py-2.5 rounded-md"
                    style={{
                      background: BRAND.cardInnerBg,
                      border: `1px solid ${BRAND.cardBorder}`,
                      cursor: n.detail ? "pointer" : "default",
                    }}
                  >
                    <span
                      className="inline-flex items-center justify-center rounded shrink-0"
                      style={{
                        width: 28,
                        height: 28,
                        background: t.chipBg,
                        border: `1px solid ${t.chipBorder}`,
                      }}
                      aria-hidden
                    >
                      <Icon size={14} color={t.fg} strokeWidth={2} />
                    </span>
                    <div className="flex-1 min-w-0 flex flex-col gap-1.5">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span
                          style={{
                            fontFamily: MONO,
                            fontSize: 9,
                            fontWeight: 700,
                            letterSpacing: "0.22em",
                            textTransform: "uppercase",
                            color: t.fg,
                          }}
                        >
                          {n.tier}
                        </span>
                        <span
                          style={{
                            fontFamily: MONO,
                            fontSize: 10,
                            color: BRAND.cardMutedDim,
                            letterSpacing: "0.06em",
                          }}
                        >
                          · {n.ago}
                        </span>
                      </div>
                      <div
                        className="leading-snug"
                        style={{
                          color: BRAND.cardText,
                          fontSize: 14,
                          fontWeight: 700,
                        }}
                      >
                        {n.description}
                      </div>
                      {n.chips && n.chips.length > 0 && (() => {
                        const MAX = 2;
                        const visible = n.chips.slice(0, MAX);
                        const overflow = n.chips.length - visible.length;
                        const chipStyle: React.CSSProperties = {
                          fontFamily: MONO,
                          fontSize: 9,
                          fontWeight: 700,
                          letterSpacing: "0.1em",
                          textTransform: "uppercase",
                          color: "#0F1A24",
                          border: "1px solid rgba(0,0,0,0.18)",
                          backgroundColor: "#FFFFFF",
                          padding: "2px 6px",
                          borderRadius: 3,
                          maxWidth: 140,
                          overflow: "hidden",
                          textOverflow: "ellipsis",
                          whiteSpace: "nowrap",
                        };
                        return (
                          <div className="flex flex-wrap items-center gap-1">
                            {visible.map((c, i) => (
                              <span key={`${n.id}-chip-${i}`} title={c} style={chipStyle}>
                                {c}
                              </span>
                            ))}
                            {overflow > 0 && (
                              <button
                                type="button"
                                onClick={() => setChipPopover({ title: n.description, chips: n.chips || [] })}
                                style={{ ...chipStyle, cursor: "pointer" }}
                                aria-label={`Show ${overflow} more`}
                              >
                                +{overflow}
                              </button>
                            )}
                          </div>
                        );
                      })()}
                    </div>
                    <div className="flex items-center gap-3 shrink-0">
                      {(() => {
                        const link = n.detail
                          ? effectiveIssueLink(n.detail, null, null)
                          : null;
                        if (!link) return null;
                        return (
                          <button
                            type="button"
                            onClick={(e) => {
                              e.stopPropagation();
                              navigate(link.to);
                            }}
                            onKeyDown={(e) => e.stopPropagation()}
                            className="hidden sm:inline-flex items-center gap-1 rounded transition-colors"
                            style={{
                              fontFamily: MONO,
                              fontSize: 10,
                              fontWeight: 800,
                              letterSpacing: "0.1em",
                              textTransform: "uppercase",
                              color: BRAND.green,
                              border: `1px solid ${BRAND.green}`,
                              backgroundColor: "transparent",
                              padding: "4px 8px",
                              cursor: "pointer",
                            }}
                            title={link.label}
                            data-testid={`briefing-goto-${n.id}`}
                          >
                            <ArrowUpRight size={12} strokeWidth={2.5} />
                            Go to issue
                          </button>
                        );
                      })()}
                      {n.metric && (
                        <div className="hidden md:flex items-baseline gap-1.5">
                          <span
                            style={{
                              fontFamily: MONO,
                              fontSize: 16,
                              fontWeight: 800,
                              letterSpacing: "-0.01em",
                              color:
                                n.metric.tone === "good"
                                  ? BRAND.green
                                  : n.metric.tone === "warn"
                                  ? "#FF9425"
                                  : n.metric.tone === "bad"
                                  ? "#FF4D2E"
                                  : BRAND.cardText,
                              lineHeight: 1,
                            }}
                          >
                            {n.metric.value}
                          </span>
                          <span
                            style={{
                              fontFamily: MONO,
                              fontSize: 9,
                              fontWeight: 700,
                              letterSpacing: "0.18em",
                              textTransform: "uppercase",
                              color: "#0F1A24",
                            }}
                          >
                            {n.metric.label}
                          </span>
                        </div>
                      )}
                      <span
                        className="rounded"
                        style={{
                          fontFamily: MONO,
                          fontSize: 11,
                          fontWeight: 800,
                          letterSpacing: "0.14em",
                          textTransform: "uppercase",
                          color: "#0F1A24",
                          border: "1px solid rgba(0,0,0,0.18)",
                          backgroundColor: "#FFFFFF",
                          padding: "4px 10px",
                        }}
                      >
                        {n.chip}
                      </span>
                    </div>
                  </div>
                );
              })}
            </div>
          </SectionCard>
        ) : null}

      </div>

      {/* ── Sticky bottom CTA (fixed to viewport) ── */}
      <div
        className="fixed bottom-0 left-0 right-0"
        style={{
          backgroundColor: "rgba(15,26,36,0.92)",
          borderTop: `1px solid ${BRAND.borderStrong}`,
          paddingTop: 14,
          paddingBottom: "max(16px, env(safe-area-inset-bottom))",
          paddingLeft: 18,
          paddingRight: 18,
          backdropFilter: "blur(10px)",
          WebkitBackdropFilter: "blur(10px)",
          zIndex: 30,
        }}
      >
        <div className="mx-auto" style={{ maxWidth: 760 }}>
          <button
            onClick={handleOpenCommand}
            className="w-full flex items-center justify-center gap-2 transition-transform hover:scale-[1.005] active:scale-[0.99] rounded"
            style={{
              backgroundColor: BRAND.green,
              color: "#0F1A24",
              height: 50,
              fontFamily: SANS,
              fontSize: 14,
              fontWeight: 700,
              letterSpacing: "0.08em",
              textTransform: "uppercase",
              boxShadow: "0 4px 12px rgba(107,165,57,0.30)",
              border: `1px solid ${BRAND.green}`,
            }}
          >
            Open command center
            <ChevronRight className="h-4 w-4" />
          </button>
        </div>
      </div>

      {/* Detail drill-down ("View" buttons, scan rows) — same side-panel
          format as the home page and alerts feed. */}
      <RiskSidePanel
        open={modalOpen}
        title={modalDetail?.title ?? "Details"}
        subtitle={modalDetail?.subtitle}
        tier={{ label: "LIVE", color: "#A9C23F" }}
        kindLabel="Daily briefing"
        explanation={briefingDetailExplanation(modalDetail)}
        detail={modalDetail}
        askLabel="Resolve with AI"
        onClose={() => setModalOpen(false)}
        onAskAI={(payload) => handleAskAI({ ...payload, note: "" })}
        onNavigate={(to) => navigate(to)}
        quickAction={staffingQA.quickActionsFor(
          classifyRisk(undefined, modalDetail?.title ?? "", modalDetail?.subtitle ?? ""),
          () => setModalOpen(false),
        )}
      />

      {/* Hero "Resolve now" — same side-panel drill-down format. The
          records table (modalDetail) is set when the panel opens. */}
      {resolveHero?.resolveRef && (
        <RiskSidePanel
          open
          title={resolveHero.resolveRef.label}
          subtitle={resolveHero.resolveRef.sub}
          tier={
            resolveHero.resolveRef.level === "critical"
              ? { label: "CRITICAL", color: "#DC2626" }
              : { label: "WARNING", color: "#E87722" }
          }
          kindLabel="Daily briefing · Pinned"
          explanation={(() => {
            const hk = classifyRisk(
              undefined,
              resolveHero.resolveRef.label ?? resolveHero.headline,
              `${resolveHero.subline ?? ""} ${resolveHero.resolveRef.sub ?? ""}`,
            );
            return {
              what: [resolveHero.headline, resolveHero.subline].filter(Boolean),
              why: whyItMatters(
                hk,
                resolveHero.resolveRef.level === "critical" ? "high" : "med",
              ),
              plain: PLAIN_WORDS[hk],
            };
          })()}
          detail={modalDetail}
          askLabel="Resolve with AI"
          onClose={() => setResolveHero(null)}
          onAskAI={(payload) => {
            setResolveHero(null);
            handleAskAI({ ...payload, note: "" });
          }}
          goTo={classifyIssueTarget({
            title: resolveHero.resolveRef.label,
            subtitle: resolveHero.resolveRef.sub,
            detail: modalDetail ?? undefined,
          })}
          onNavigate={(to) => {
            setResolveHero(null);
            navigate(to);
          }}
          quickAction={staffingQA.quickActionsFor(
            classifyRisk(
              undefined,
              resolveHero.resolveRef.label ?? resolveHero.headline,
              `${resolveHero.subline ?? ""} ${resolveHero.resolveRef.sub ?? ""}`,
            ),
            () => setResolveHero(null),
          )}
        />
      )}

      {staffingQA.modals}

      {chipPopover && (
        <div
          onClick={() => setChipPopover(null)}
          style={{
            position: "fixed", inset: 0, zIndex: Z.MODAL,
            background: "rgba(15,26,36,0.65)",
            display: "flex", alignItems: "center", justifyContent: "center",
            padding: 16,
          }}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            style={{
              background: "var(--rm-panel)", color: "var(--rm-text)", borderRadius: 12,
              maxWidth: 480, width: "100%", maxHeight: "70vh", overflow: "auto",
              boxShadow: "0 12px 48px rgba(0,0,0,0.5)",
              border: "1px solid var(--rm-panel-border)",
            }}
          >
            <div style={{ padding: "14px 18px", borderBottom: "1px solid var(--rm-panel-border)", display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12 }}>
              <div style={{ fontSize: 13, fontWeight: 700, lineHeight: 1.35 }}>
                {chipPopover.title}
              </div>
              <button
                onClick={() => setChipPopover(null)}
                style={{ background: "transparent", border: "none", fontSize: 20, cursor: "pointer", color: "var(--rm-text)", lineHeight: 1, padding: 4 }}
                aria-label="Close"
              >
                ×
              </button>
            </div>
            <div style={{ padding: "14px 18px", display: "flex", flexWrap: "wrap", gap: 6 }}>
              {chipPopover.chips.map((c, i) => (
                <span
                  key={`pop-chip-${i}`}
                  style={{
                    fontFamily: MONO, fontSize: 11, fontWeight: 700,
                    letterSpacing: "0.08em", textTransform: "uppercase",
                    color: "var(--rm-text)", border: "1px solid var(--rm-panel-border)",
                    backgroundColor: "var(--rm-panel-soft)", padding: "4px 8px", borderRadius: 4,
                  }}
                >
                  {c}
                </span>
              ))}
            </div>
          </div>
        </div>
      )}
      </div>
    </div>
  );
}

// ── Side-panel content helpers ──────────────────────────────────────

// Explanation copy for the generic detail drill-down ("View" buttons,
// overnight-scan rows, KPI tiles). Derived from the detail payload so
// the "What's happening / Why it matters" card always reflects the data.
function briefingDetailExplanation(detail: ActionDetail): {
  what: string;
  why: string;
} {
  const n = detail?.rows?.length ?? 0;
  const records = `${n.toLocaleString()} record${n === 1 ? "" : "s"}`;
  return {
    what: detail?.subtitle
      ? `${detail.subtitle} — ${records} listed below.`
      : `${records} behind this signal, listed below.`,
    why: "Review the records, then pick one to jump straight to it or hand it to the AI for a concrete fix plan.",
  };
}

// Records table for the hero "Resolve now" panel. Prefers the hero's
// live detail table; heroes without records get a single synthesized
// row so the pick-1 AI hand-off still works.
function heroResolveDetail(hero: BriefingHero): ActionDetail {
  if (hero.detail) return hero.detail;
  const ref = hero.resolveRef;
  const cols = [
    { key: "record", label: "Record" },
    { key: "issue", label: "Issue" },
  ];
  const title = ref?.label ?? hero.headline;
  const issueText = ref?.sub ?? hero.subline;
  // No single ticket ref — but the copy may enumerate several projects
  // ("OPM-00195, OPM-00424 … on hold"). Split into one selectable row
  // per project so the user never gets a bundled multi-project row.
  if (!ref?.ticketId) {
    const ids = extractTicketIds(`${title} ${issueText}`);
    if (ids.length > 0) {
      // Per-row issue copy: prefer whichever text does NOT itself
      // enumerate the IDs, so each row doesn't repeat the full list.
      const rowIssue =
        extractTicketIds(title).length === 0
          ? title
          : extractTicketIds(issueText).length === 0
            ? issueText
            : title;
      return {
        title,
        subtitle: ref?.sub,
        columns: cols,
        rows: ids.map((rid) => ({ record: rid, issue: rowIssue, _ticket: rid })),
      };
    }
  }
  return {
    title,
    subtitle: ref?.sub,
    columns: cols,
    rows: [
      {
        record: title,
        issue: issueText,
        ...(ref?.ticketId
          ? { _ticket: String(ref.ticketId) }
          : { _aggregate: "true" }),
      },
    ],
  };
}
