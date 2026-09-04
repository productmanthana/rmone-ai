// DEPRECATED — no longer routed. The home route ("/") now renders the
// role-based dashboard from @/components/RoleHome (see App.tsx), which
// mirrors the mobile Home. This legacy tile-based ExecSnapshot page is
// kept for reference only. Do NOT re-wire it to "/" without removing
// RoleHome from the route first.
import { compactUsd } from "../lib/money";
import { Fragment, useEffect, useMemo, useState } from "react";
import { Link, useLocation } from "wouter";
import { setChatPrompt } from "@/lib/chatBridge";
import { useDraggable } from "@/lib/useDraggable";
import { peekCached } from "@/lib/api";
import { subscribeDataChanged } from "@/lib/dataSync";
import { getBusinessRules, useBusinessRulesVersion } from "@/lib/businessRules";
import { markCommandCentreDataReady } from "@/components/CommandCentreLoader";
import {
  Loader2,
  AlertTriangle,
  TrendingUp,
  Briefcase,
  Target,
  Users,
  ArrowRight,
  BarChart3,
  Sparkles,
  FolderKanban,
  Building2,
} from "lucide-react";
import { useAuth } from "@/lib/useAuth";
import { useTheme } from "@/lib/theme";
import { Sun, Moon } from "lucide-react";
import {
  getModuleRecords,
  getResourceDemands,
  getResourceAllocations,
  type DemandItem,
  type LiveResourceProxy,
  type ResourceAllocationsResponse,
} from "@/lib/api";
import { Z } from "@/lib/zLayers";

/* Theme toggle pill — lives only on Home, but flips the global theme so
   every page (and the sidebar/header chrome) re-renders accordingly. */
function HomeThemeToggle() {
  const { mode, toggle } = useTheme();
  const isDark = mode === "dark";
  return (
    <button
      type="button"
      onClick={toggle}
      title={isDark ? "Switch to light mode" : "Switch to dark mode"}
      aria-label="Toggle light/dark mode"
      data-testid="home-theme-toggle"
      style={{
        display: "inline-flex",
        alignItems: "center",
        justifyContent: "center",
        width: 36,
        height: 36,
        borderRadius: 10,
        backgroundColor: "var(--rm-panel)",
        border: "1px solid var(--rm-panel-border)",
        color: "var(--rm-text)",
        cursor: "pointer",
        flexShrink: 0,
        alignSelf: "center",
      }}
    >
      {isDark ? <Sun size={16} /> : <Moon size={16} />}
    </button>
  );
}

/* ─────────────────  helpers (kept in sync with mobile)  ───────────────── */

const GREEN = "#6BA539";
const ORANGE = "#E87722";
const BLUE = "#6B7FF0";
const PURPLE = "#9B6BF0";
const NAVY = "var(--rm-bg)";
const PANEL = "var(--rm-panel)";
const PANEL_BORDER = "1px solid var(--rm-panel-border)";

function fmtM(v: number): string {
  if (v >= 1_000_000_000) return compactUsd(v);
  if (v >= 1_000_000) return `$${(v / 1_000_000).toFixed(1)}M`;
  if (v >= 1_000) return `$${(v / 1_000).toFixed(0)}K`;
  return `$${Math.round(v)}`;
}

function getProjectValue(p: any): number {
  const n = Number(p?.ApproxContractValue);
  return Number.isFinite(n) && n > 0 ? n : 0;
}

/** OPM-only value extractor.
 *
 * For construction OPM opportunities, RM ONE rarely has ApproxContractValue
 * (revenue) populated this early in the pursuit — the project team enters
 * ForecastedProjectCost (internal cost estimate) and/or LaborContractAmount
 * instead. Per user direction (May 2026), surface ForecastedProjectCost as
 * the primary OPM "Value" so the Home Opp Pipeline tile, ExecSnapshotModal
 * opp totals, and any other OPM roll-up reflect real numbers. Falls back to
 * ApproxContractValue then LaborContractAmount for rows where the revenue
 * side happens to be filled in. Mirrors mapOPM in pages/projects.tsx.
 */
function getOppValue(o: any): number {
  const fc = Number(o?.ForecastedProjectCost);
  if (Number.isFinite(fc) && fc > 0) return fc;
  const apx = Number(o?.ApproxContractValue);
  if (Number.isFinite(apx) && apx > 0) return apx;
  const labor = Number(o?.LaborContractAmount);
  if (Number.isFinite(labor) && labor > 0) return labor;
  return 0;
}

const GUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const GUID_RE_GLOBAL = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi;

const KEY_PERSONNEL_FIELDS = new Set([
  "OwnerUser",
  "ProjectManagerUser",
  "SeniorProjectManagerUser",
  "ProgramManagerUser",
  "SeniorMEPManagerUser",
  "SeniorEstimatorUser",
  "EstimatorUser",
  "SuperintendentUser",
  "SeniorSuperintendentUser",
  "ProjectLeadUser",
  "BusinessLeadUser",
  "PreconLeadUser",
  "PrincipalUser",
  "ProjectExecutiveUser",
  "PhaseOwnerUser",
  "OwnerUserName",
  "OwnerUserEmail",
  "ProjectManagerUserName",
  "ProjectManagerUserEmail",
  "SeniorProjectManagerUserName",
  "SeniorProjectManagerUserEmail",
]);

function collectAssignedUserGuids(r: any): string {
  const tokens: string[] = [];
  for (const [k, v] of Object.entries(r ?? {})) {
    if (typeof v !== "string" || !v) continue;
    if (!KEY_PERSONNEL_FIELDS.has(k)) continue;
    const found = String(v).match(GUID_RE_GLOBAL);
    if (found)
      for (const g of found) {
        if (g === "00000000-0000-0000-0000-000000000000") continue;
        tokens.push(g.toLowerCase());
      }
    tokens.push(String(v).toLowerCase());
  }
  return tokens.join("|");
}

function cleanLabel(v: any): string | null {
  if (v === null || v === undefined) return null;
  const s = String(v).trim();
  if (!s || s === "0" || s === "None" || GUID_RE.test(s)) return null;
  return s;
}

function getProjectClient(p: any): string | null {
  return (
    cleanLabel(p?.CRMCompanyLookupName) ||
    cleanLabel(p?.ClientName) ||
    cleanLabel(p?.CompanyName) ||
    cleanLabel(p?.OwnerName) ||
    cleanLabel(p?.CompanyLookup) ||
    cleanLabel(p?.CRMCompanyLookup)
  );
}

const LEM_CLOSED = new Set([
  "Lost",
  "Cancelled",
  "Declined",
  "Dead",
  "Closed",
  "Awarded",
]);

/* ─────────────────  small visual primitives  ───────────────── */

function Panel({
  children,
  style,
}: {
  children: React.ReactNode;
  style?: React.CSSProperties;
}) {
  return (
    <div
      style={{
        backgroundColor: PANEL,
        borderRadius: 18,
        border: PANEL_BORDER,
        padding: 18,
        boxShadow: "0 8px 16px rgba(0,0,0,0.25)",
        ...style,
      }}
    >
      {children}
    </div>
  );
}

function SectionHeader({
  icon: Icon,
  title,
  color,
  right,
}: {
  icon: React.ComponentType<{ size?: number; color?: string }>;
  title: string;
  color: string;
  right?: React.ReactNode;
}) {
  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        marginBottom: 14,
      }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
        <div
          style={{
            width: 30,
            height: 30,
            borderRadius: 9,
            backgroundColor: `${color}22`,
            border: `1px solid ${color}44`,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
          }}
        >
          <Icon size={15} color={color} />
        </div>
        <div
          style={{
            color: "var(--rm-text)",
            fontWeight: 700,
            fontSize: 15,
            letterSpacing: "-0.005em",
          }}
        >
          {title}
        </div>
      </div>
      {right}
    </div>
  );
}

function StatTile({
  label,
  value,
  sub,
  color,
  onClick,
}: {
  label: string;
  value: string;
  sub?: string;
  color: string;
  onClick?: () => void;
}) {
  const clickable = !!onClick;
  return (
    <div
      onClick={onClick}
      role={clickable ? "button" : undefined}
      tabIndex={clickable ? 0 : undefined}
      onKeyDown={
        clickable
          ? (e) => {
              if (e.key === "Enter" || e.key === " ") {
                e.preventDefault();
                onClick?.();
              }
            }
          : undefined
      }
      style={{
        flex: 1,
        minWidth: 0,
        padding: 16,
        borderRadius: 14,
        background: `linear-gradient(180deg, ${color}1A 0%, rgba(15,25,35,0.4) 100%)`,
        border: `1px solid ${color}33`,
        cursor: clickable ? "pointer" : "default",
        transition: "transform 80ms ease, box-shadow 80ms ease, border-color 80ms ease",
      }}
      onMouseEnter={
        clickable
          ? (e) => {
              e.currentTarget.style.borderColor = `${color}AA`;
              e.currentTarget.style.transform = "translateY(-1px)";
            }
          : undefined
      }
      onMouseLeave={
        clickable
          ? (e) => {
              e.currentTarget.style.borderColor = `${color}33`;
              e.currentTarget.style.transform = "translateY(0)";
            }
          : undefined
      }
    >
      <div
        style={{
          color: "var(--rm-text-muted)",
          fontSize: 11,
          fontWeight: 700,
          textTransform: "uppercase",
          letterSpacing: "0.06em",
          marginBottom: 6,
        }}
      >
        {label}
      </div>
      <div
        style={{
          color: "var(--rm-text)",
          fontSize: 24,
          fontWeight: 800,
          letterSpacing: "-0.01em",
          lineHeight: 1.1,
        }}
      >
        {value}
      </div>
      {sub && (
        <div style={{ color: "var(--rm-text-muted)", fontSize: 11, marginTop: 4 }}>
          {sub}
        </div>
      )}
    </div>
  );
}

function ProjectsTabBtn({
  label,
  count,
  active,
  onClick,
}: {
  label: string;
  count: number;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      style={{
        flex: 1,
        padding: "10px 12px",
        borderRadius: 10,
        border: active ? `1px solid ${GREEN}66` : "1px solid var(--rm-panel-border)",
        backgroundColor: active ? `${GREEN}22` : "var(--rm-panel-soft)",
        color: active ? "var(--rm-text)" : "var(--rm-text-muted)",
        fontWeight: 700,
        fontSize: 12,
        cursor: "pointer",
        display: "flex",
        flexDirection: "column",
        alignItems: "flex-start",
        gap: 2,
      }}
    >
      <span style={{ textTransform: "uppercase", letterSpacing: "0.05em", fontSize: 10 }}>
        {label}
      </span>
      <span style={{ fontSize: 18, fontWeight: 800, color: "var(--rm-text)" }}>{count}</span>
    </button>
  );
}

/* ─────────────────  page  ───────────────── */

interface ProjectsBuckets {
  allOpen: any[];
  myOpen: any[];
  closed: any[];
}

interface ClientLoad {
  client: string;
  count: number;
  value: number;
}

export default function HomePage() {
  const { user } = useAuth();
  const [, navigate] = useLocation();
  const rulesVersion = useBusinessRulesVersion();
  const userGuid = (user?.userId ?? "").toLowerCase();
  const displayName = user?.displayName || user?.username || "";

  // Hydrate from the shared sessionStorage-backed cache so revisiting the
  // page (or arriving via in-app navigation after another page already
  // fetched the same modules) renders instantly with no spinner. We still
  // refresh in the background below.
  const cachedPmm = peekCached<{ data: any[] }>("module:PMM")?.data ?? null;
  const cachedOpm = peekCached<{ data: any[] }>("module:OPM")?.data ?? null;
  const cachedLem = peekCached<{ data: any[] }>("module:LEM")?.data ?? null;
  const cachedDemands = peekCached<{ data: DemandItem[] }>("resource-demands")?.data ?? null;
  const hasAnyCached = !!(cachedPmm || cachedOpm || cachedLem || cachedDemands);

  const [pmm, setPmm] = useState<any[]>(cachedPmm ?? []);
  const [opm, setOpm] = useState<any[]>(cachedOpm ?? []);
  const [lem, setLem] = useState<any[]>(cachedLem ?? []);
  const [demands, setDemands] = useState<DemandItem[]>(cachedDemands ?? []);
  const [loading, setLoading] = useState(!hasAnyCached);
  const [error, setError] = useState<string | null>(null);
  const [tab, setTab] = useState<"all" | "mine" | "closed">("all");
  // Open Requests / Roles in Demand stat tiles open a fullscreen modal
  // listing every underlying demand record so the user can scan the raw
  // data and hand it off to the AI in one click.
  const [demandsModal, setDemandsModal] = useState<null | "requests" | "roles">(null);
  // Executive Snapshot tiles (PMM Total / My Projects / Opp Pipeline /
  // Open Leads) open a fullscreen modal listing every underlying record so
  // the user can drill in or hand the list to the AI.
  const [execModal, setExecModal] = useState<
    null | "pmm" | "mine" | "opp" | "leads" | "closed"
  >(null);
  const [clientModal, setClientModal] = useState<string | null>(null);
  // Unified data-sync bus revision — any write anywhere in the app (hours,
  // team membership, open positions, record status/fields, staff) re-runs
  // the pipeline load below, so this page never shows pre-write numbers
  // until a manual browser refresh. Bus-triggered re-runs refresh silently
  // (no full-page spinner) because rows are already on screen.
  const [syncRevision, setSyncRevision] = useState(0);
  useEffect(() => subscribeDataChanged("any", () => setSyncRevision((r) => r + 1)), []);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      // Only show the loading spinner when we have nothing to render yet.
      // If we hydrated from cache, the refresh runs silently in the background.
      // Data-sync re-runs (syncRevision > 0) are always silent: the busts that
      // preceded the event emptied peekCached, but rows are still on screen.
      if (!hasAnyCached && syncRevision === 0) setLoading(true);
      setError(null);
      // Hoisted so the finally block can inspect outcomes for the
      // post-login splash "ready" signal.
      let results: PromiseSettledResult<{ data?: any[] }>[] = [];
      const tPipeline = Date.now();
      try {
        const labels = ["PMM", "OPM", "LEM", "Resource demands"] as const;
        results = await Promise.allSettled([
          getModuleRecords("PMM"),
          getModuleRecords("OPM"),
          getModuleRecords("LEM"),
          getResourceDemands(),
        ]);
        console.log(`[splash] home pipeline queries settled: ${Date.now() - tPipeline}ms`);
        if (cancelled) return;
        setPmm(results[0].status === "fulfilled" ? results[0].value.data ?? [] : []);
        setOpm(results[1].status === "fulfilled" ? results[1].value.data ?? [] : []);
        setLem(results[2].status === "fulfilled" ? results[2].value.data ?? [] : []);
        setDemands(results[3].status === "fulfilled" ? results[3].value.data ?? [] : []);

        // Surface failures explicitly so empty/zero metrics aren't mistaken
        // for real data. The three pipeline modules drive every tile on this
        // page — if all three fail we treat it as a hard error; if some
        // succeed we show a non-blocking warning banner naming what failed.
        const failed = results
          .map((r, i) => (r.status === "rejected" ? labels[i] : null))
          .filter((x): x is NonNullable<typeof x> => x !== null);
        const pipelineFailed =
          results[0].status === "rejected" &&
          results[1].status === "rejected" &&
          results[2].status === "rejected";
        if (pipelineFailed) {
          setError(
            "Couldn't load live pipeline data (PMM / OPM / LEM). Check your connection or try again.",
          );
        } else if (failed.length > 0) {
          setError(
            `Some live data couldn't load: ${failed.join(", ")}. Numbers below may be incomplete.`,
          );
        }
      } catch (e: any) {
        if (!cancelled) setError(String(e?.message || e));
      } finally {
        if (!cancelled) setLoading(false);
        // Defer the splash "ready" signal until React has had a chance
        // to commit the new state and paint a frame with real numbers.
        // Without this double-rAF, the splash can begin its 600ms fade
        // while the dashboard is still rendering zero placeholders,
        // producing the "splash gone but page is still 0s" flash.
        requestAnimationFrame(() => {
          requestAnimationFrame(() => {
            if (!cancelled) markCommandCentreDataReady();
          });
        });
      }
    })();
    return () => {
      cancelled = true;
    };
    // syncRevision: unified data-sync bus tick — re-runs this load after any
    // write anywhere so the tiles/demand figures converge without a refresh.
  }, [syncRevision]);

  const exec = useMemo(() => {
    let pmmTotal = 0;
    let mineCount = 0;
    let opmTotal = 0;
    let openLeads = 0;
    // Track data-quality counts so the PMM tile can disclose how many of
    // the open projects actually contributed a Contract Value to the total
    // (vs how many are sitting at $0 because ApproxContractValue is empty
    // upstream). Per user direction (May 2026), we don't fall back to
    // ForecastedProjectCost for PMM — instead we surface the gap.
    let pmmOpen = 0;
    let pmmWithValue = 0;
    for (const p of pmm) {
      if (!p || typeof p !== "object") continue;
      if (p.Closed === true) continue;
      pmmOpen++;
      const v = getProjectValue(p);
      if (v > 0) pmmWithValue++;
      pmmTotal += v;
      const guids = collectAssignedUserGuids(p);
      if (userGuid && guids.includes(userGuid)) mineCount++;
    }
    for (const o of opm) {
      if (!o || typeof o !== "object") continue;
      opmTotal += getOppValue(o);
    }
    for (const l of lem) {
      if (!l || typeof l !== "object") continue;
      if (l.Closed === true) continue;
      const status = String((l as any).LeadStatus ?? "").trim();
      if (LEM_CLOSED.has(status)) continue;
      openLeads++;
    }
    const pmmEmpty = pmmOpen - pmmWithValue;
    return { pmmTotal, mineCount, opmTotal, openLeads, pmmOpen, pmmWithValue, pmmEmpty };
  }, [pmm, opm, lem, userGuid]);

  const buckets: ProjectsBuckets = useMemo(() => {
    const allOpen: any[] = [];
    const myOpen: any[] = [];
    const closed: any[] = [];
    for (const p of pmm) {
      if (!p || typeof p !== "object") continue;
      if (p.Closed === true) {
        closed.push(p);
      } else {
        allOpen.push(p);
        const guids = collectAssignedUserGuids(p);
        if (userGuid && guids.includes(userGuid)) myOpen.push(p);
      }
    }
    return { allOpen, myOpen, closed };
  }, [pmm, userGuid]);

  const visibleProjects = useMemo(() => {
    const list =
      tab === "all" ? buckets.allOpen : tab === "mine" ? buckets.myOpen : buckets.closed;
    return list
      .slice()
      .sort((a, b) => getProjectValue(b) - getProjectValue(a))
      .slice(0, 6);
  }, [buckets, tab]);

  const roleDemand = useMemo(() => {
    // Aggregate twice from the same dataset:
    //  - `roleCount`  → how many distinct ROLES are open (used in the
    //    stat tile at the top of the panel).
    //  - `top`        → list rows. We bucket by ROLE + PROJECT so even
    //    when the API returns only 2 unique role names (the real-world
    //    case here — "Plumbing Engineer" + "Mechanical Engineer") we
    //    still get a meaningful list of rows, one per project the role
    //    is needed on.
    const roleSet = new Set<string>();
    const map = new Map<string, { role: string; project: string; count: number; pct: number }>();
    let totalRequests = 0;
    for (const d of demands) {
      if (d.IsLocked) continue;
      const role = (d.Role || "").trim() || getBusinessRules().unassignedLabel;
      const project = (d.Title || "").trim() || "Unspecified project";
      roleSet.add(role);
      const key = `${role}__${project}`;
      const cur = map.get(key) ?? { role, project, count: 0, pct: 0 };
      cur.count += 1;
      cur.pct += Number(d.PctAllocation) || 0;
      map.set(key, cur);
      totalRequests += 1;
    }
    const top = Array.from(map.values())
      .sort((a, b) => b.count - a.count)
      // Show top 5 role-project combos — enough to fill the panel
      // without overwhelming it.
      .slice(0, 5);
    return { top, totalRequests, roleCount: roleSet.size };
  }, [demands, rulesVersion]);

  const clientLoad: ClientLoad[] = useMemo(() => {
    const map = new Map<string, ClientLoad>();
    for (const p of buckets.allOpen) {
      const client = getProjectClient(p);
      if (!client) continue;
      const cur = map.get(client) ?? { client, count: 0, value: 0 };
      cur.count += 1;
      cur.value += getProjectValue(p);
      map.set(client, cur);
    }
    return Array.from(map.values())
      .sort((a, b) => b.value - a.value)
      .slice(0, 6);
  }, [buckets]);

  const maxClientValue = clientLoad[0]?.value || 1;

  // Note: we no longer block the entire page on a centered spinner. The
  // dashboard layout renders immediately (with empty/zero tiles when there
  // is no cached data yet) and a small inline indicator next to the title
  // tells the user a refresh is in progress. This makes the page feel
  // instant even on a cold cache.

  return (
    <div
      style={{
        minHeight: "100%",
        background: "var(--rm-bg)",
        // Extra right padding reserves space for the fixed user-avatar
        // pill in the top-right corner so the inline Analytics CTA never
        // sits underneath it.
        padding: "20px 72px 20px 20px",
      }}
    >
      <div style={{ maxWidth: 1280, margin: "0 auto" }}>
        {/* Greeting + inline Analytics CTA */}
        <div
          style={{
            display: "flex",
            alignItems: "flex-start",
            justifyContent: "space-between",
            gap: 16,
            marginBottom: 16,
            flexWrap: "wrap",
          }}
        >
          <div style={{ minWidth: 0 }}>
            <div
              style={{
                color: "var(--rm-text-muted)",
                fontSize: 12,
                fontWeight: 700,
                textTransform: "uppercase",
                letterSpacing: "0.08em",
              }}
            >
              Home
            </div>
            <h1
              style={{
                display: "flex",
                alignItems: "center",
                gap: 10,
                color: "var(--rm-text)",
                fontSize: 26,
                fontWeight: 800,
                margin: "4px 0 2px",
                letterSpacing: "-0.01em",
              }}
            >
              <span>{displayName ? `Welcome back, ${displayName}` : "Welcome back"}</span>
              {loading && (
                <span
                  style={{
                    display: "inline-flex",
                    alignItems: "center",
                    gap: 6,
                    fontSize: 11,
                    fontWeight: 600,
                    color: "var(--rm-text-muted)",
                    textTransform: "uppercase",
                    letterSpacing: "0.06em",
                  }}
                >
                  <Loader2 className="h-3 w-3 animate-spin" style={{ color: GREEN }} />
                  Refreshing
                </span>
              )}
            </h1>
            <div style={{ color: "var(--rm-text-muted)", fontSize: 13 }}>
              Live snapshot of your pipeline, projects and staffing demand.
            </div>
          </div>

          {/* Compact Analytics CTA — moved out of the big green bar and
              tucked next to the welcome line per user request. */}
          <Link
            href="/analytics"
            data-testid="link-analytics-dashboard"
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: 8,
              padding: "8px 14px",
              borderRadius: 10,
              backgroundColor: `${GREEN}22`,
              border: `1px solid ${GREEN}66`,
              color: "var(--rm-text)",
              fontSize: 12,
              fontWeight: 700,
              textTransform: "uppercase",
              letterSpacing: "0.05em",
              textDecoration: "none",
              flexShrink: 0,
              alignSelf: "flex-end",
              marginBottom: 2,
            }}
          >
            <BarChart3 size={14} style={{ color: GREEN }} />
            Analytics Dashboard
            <ArrowRight size={14} />
          </Link>
        </div>

        {error && (
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: 10,
              padding: 14,
              marginBottom: 16,
              color: "#FFB36B",
              backgroundColor: "rgba(232,119,34,0.10)",
              border: "1px solid rgba(232,119,34,0.35)",
              borderRadius: 12,
              fontSize: 13,
            }}
          >
            <AlertTriangle className="h-4 w-4" />
            {error}
          </div>
        )}

        {/* Executive Snapshot */}
        <Panel style={{ marginBottom: 14 }}>
          <SectionHeader icon={TrendingUp} color={GREEN} title="Executive Snapshot" />
          <div
            style={{
              // Responsive: on a phone-width viewport (≈ <600px) the four
              // tiles wrap to a 2×2 grid so the value text ($7.8M, $57.0M…)
              // doesn't get crushed and overlap the next tile. On wider
              // viewports it falls back to a single 4-column row.
              display: "grid",
              gridTemplateColumns: "repeat(auto-fit, minmax(120px, 1fr))",
              // Force all rows to share the same height so the 2×2 grid on
              // phone widths looks aligned even when the sub text wraps to
              // a different number of lines per tile.
              gridAutoRows: "1fr",
              alignItems: "stretch",
              gap: 12,
            }}
          >
            <StatTile
              label="PMM Total"
              value={fmtM(exec.pmmTotal)}
              sub={`${exec.pmmWithValue} of ${exec.pmmOpen} have value · ${exec.pmmEmpty} empty · click to view`}
              color={GREEN}
              onClick={() => setExecModal("pmm")}
            />
            <StatTile
              label="My Projects"
              value={String(exec.mineCount)}
              sub="Where you're staffed · click to view"
              color={BLUE}
              onClick={() => setExecModal("mine")}
            />
            <StatTile
              label="Opp Pipeline"
              value={fmtM(exec.opmTotal)}
              sub={`Forecasted · ${opm.length} opportunities · click to view`}
              color={ORANGE}
              onClick={() => setExecModal("opp")}
            />
            <StatTile
              label="Open Leads"
              value={String(exec.openLeads)}
              sub="Awaiting qualification · click to view"
              color={PURPLE}
              onClick={() => setExecModal("leads")}
            />
          </div>
        </Panel>

        <div
          style={{
            display: "grid",
            gridTemplateColumns: "1fr 1fr",
            gap: 14,
            marginBottom: 14,
          }}
        >
          {/* Projects */}
          <Panel>
            <SectionHeader
              icon={FolderKanban}
              color={GREEN}
              title="Projects"
              right={
                <Link
                  href="/projects"
                  className="text-[11px] font-bold uppercase tracking-wider"
                  style={{ color: GREEN, textDecoration: "none" }}
                >
                  View all →
                </Link>
              }
            />
            <div style={{ display: "flex", gap: 8, marginBottom: 12 }}>
              <ProjectsTabBtn
                label="All Open"
                count={buckets.allOpen.length}
                active={tab === "all"}
                onClick={() => { setTab("all"); setExecModal("pmm"); }}
              />
              <ProjectsTabBtn
                label="My Open"
                count={buckets.myOpen.length}
                active={tab === "mine"}
                onClick={() => { setTab("mine"); setExecModal("mine"); }}
              />
              <ProjectsTabBtn
                label="Closed"
                count={buckets.closed.length}
                active={tab === "closed"}
                onClick={() => { setTab("closed"); setExecModal("closed"); }}
              />
            </div>
            <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
              {visibleProjects.length === 0 && (
                <div
                  style={{
                    color: "var(--rm-text-faint)",
                    fontSize: 13,
                    padding: "16px 4px",
                    textAlign: "center",
                  }}
                >
                  No projects in this list.
                </div>
              )}
              {visibleProjects.map((p: any) => {
                const id = p.TicketId || p.RecordId || p.Id;
                const title = p.Title || p.ProjectName || p.Name || "Untitled";
                const client = getProjectClient(p) || "—";
                const value = getProjectValue(p);
                return (
                  <Link
                    key={id || title}
                    href={id ? `/project/${id}` : "/projects"}
                    style={{
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "space-between",
                      padding: "10px 12px",
                      borderRadius: 10,
                      backgroundColor: "var(--rm-panel-soft)",
                      border: "1px solid var(--rm-panel-hover)",
                      textDecoration: "none",
                      color: "var(--rm-text)",
                    }}
                  >
                    <div style={{ minWidth: 0, flex: 1 }}>
                      <div
                        style={{
                          fontSize: 13,
                          fontWeight: 700,
                          color: "var(--rm-text)",
                          overflow: "hidden",
                          textOverflow: "ellipsis",
                          whiteSpace: "nowrap",
                        }}
                      >
                        {title}
                      </div>
                      <div
                        style={{
                          fontSize: 11,
                          color: "var(--rm-text-muted)",
                          overflow: "hidden",
                          textOverflow: "ellipsis",
                          whiteSpace: "nowrap",
                        }}
                      >
                        {client}
                      </div>
                    </div>
                    <div
                      style={{
                        fontSize: 12,
                        fontWeight: 800,
                        color: value > 0 ? GREEN : "var(--rm-text-faint)",
                        marginLeft: 12,
                      }}
                    >
                      {value > 0 ? fmtM(value) : "—"}
                    </div>
                  </Link>
                );
              })}
            </div>
          </Panel>

          {/* Staffing Demands */}
          <Panel>
            <SectionHeader
              icon={Users}
              color={ORANGE}
              title="Staffing Demands"
              right={
                <button
                  type="button"
                  onClick={() => {
                    // Build a short, friendly user-visible prompt and stash
                    // the per-role breakdown in `context` so it goes to the
                    // AI as system context (NOT as a raw bullet-dump in the
                    // user's chat message).
                    const roleCounts = new Map<string, number>();
                    for (const d of demands) {
                      roleCounts.set(d.Role, (roleCounts.get(d.Role) ?? 0) + 1);
                    }
                    const totalOpen = demands.length;
                    const sorted = [...roleCounts.entries()].sort(
                      (a, b) => b[1] - a[1],
                    );
                    const allRoles = sorted
                      .map(([role, count]) => `- ${role}: ${count} open`)
                      .join("\n");
                    const prompt =
                      `Analyze the open staffing demands on the Home dashboard ` +
                      `(${totalOpen} open requests across ${roleCounts.size} distinct roles). ` +
                      `List the top roles in demand, total open requests, and recommend a hiring plan ` +
                      `with named projects, target start dates, and sourcing options.`;
                    const context =
                      `STAFFING DEMAND BY ROLE — snapshot from the Home dashboard\n` +
                      `Totals: ${totalOpen} open requests across ${roleCounts.size} distinct roles.\n\n` +
                      `Per-role breakdown:\n${allRoles}`;
                    // Hand the prompt to the chat page via the in-memory bridge
                    // (the chat page does NOT read ?prompt= from the URL — it
                    // listens for chatBridge payloads), then navigate.
                    setChatPrompt(prompt, { newSession: true, autoSend: true, context });
                    navigate("/chat");
                  }}
                  data-testid="link-analyze-staffing"
                  style={{
                    display: "inline-flex",
                    alignItems: "center",
                    gap: 5,
                    padding: "6px 10px",
                    borderRadius: 8,
                    backgroundColor: `${ORANGE}22`,
                    border: `1px solid ${ORANGE}55`,
                    color: ORANGE,
                    fontSize: 11,
                    fontWeight: 700,
                    textTransform: "uppercase",
                    letterSpacing: "0.04em",
                    cursor: "pointer",
                  }}
                >
                  <Sparkles size={12} />
                  Analyze with AI
                </button>
              }
            />
            <div
              style={{
                display: "grid",
                gridTemplateColumns: "1fr 1fr",
                gap: 10,
                marginBottom: 12,
              }}
            >
              <StatTile
                label="Open Requests"
                value={String(roleDemand.totalRequests)}
                sub="Across all roles · click to view"
                color={ORANGE}
                onClick={() => setDemandsModal("requests")}
              />
              <StatTile
                label="Roles in Demand"
                value={String(roleDemand.roleCount)}
                sub="Distinct positions · click to view"
                color={BLUE}
                onClick={() => setDemandsModal("roles")}
              />
            </div>
            <div
              style={{
                color: "var(--rm-text-muted)",
                fontSize: 11,
                fontWeight: 700,
                textTransform: "uppercase",
                letterSpacing: "0.06em",
                marginBottom: 8,
              }}
            >
              Top roles in demand
            </div>
            {/*
              Roles list grows to fill the remaining panel height. When the
              user only has 2 distinct roles in the data (a common real-world
              case), each row stretches via `flex: 1` so the panel never looks
              half-empty. A progress bar inside each row visualises that
              role's share of total open requests so the extra height carries
              real information instead of just whitespace.
            */}
            <div
              style={{
                display: "flex",
                flexDirection: "column",
                gap: 8,
              }}
            >
              {roleDemand.top.length === 0 && (
                <div style={{ color: "var(--rm-text-faint)", fontSize: 13, padding: "10px 0" }}>
                  No open staffing demands right now.
                </div>
              )}
              {roleDemand.top.map((r) => {
                const share = roleDemand.totalRequests > 0
                  ? Math.min(100, Math.round((r.count / roleDemand.totalRequests) * 100))
                  : 0;
                return (
                  <div
                    key={`${r.role}__${r.project}`}
                    style={{
                      display: "flex",
                      flexDirection: "column",
                      gap: 6,
                      padding: "10px 12px",
                      borderRadius: 9,
                      backgroundColor: "var(--rm-panel-soft)",
                      border: "1px solid var(--rm-panel-hover)",
                    }}
                  >
                    <div
                      style={{
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "space-between",
                        gap: 10,
                      }}
                    >
                      <div
                        style={{
                          flex: 1,
                          minWidth: 0,
                          display: "flex",
                          flexDirection: "column",
                          gap: 2,
                        }}
                      >
                        <div
                          style={{
                            color: "var(--rm-text)",
                            fontSize: 14,
                            fontWeight: 700,
                            overflow: "hidden",
                            textOverflow: "ellipsis",
                            whiteSpace: "nowrap",
                          }}
                        >
                          {r.role}
                        </div>
                        <div
                          style={{
                            color: "var(--rm-text-muted)",
                            fontSize: 11,
                            fontWeight: 500,
                            overflow: "hidden",
                            textOverflow: "ellipsis",
                            whiteSpace: "nowrap",
                          }}
                        >
                          {r.project}
                        </div>
                      </div>
                      <div
                        style={{
                          fontSize: 11,
                          color: "var(--rm-text-muted)",
                        }}
                      >
                        {share}% of total
                      </div>
                      <div
                        style={{
                          backgroundColor: `${ORANGE}22`,
                          color: ORANGE,
                          borderRadius: 999,
                          padding: "2px 10px",
                          fontSize: 11,
                          fontWeight: 800,
                        }}
                      >
                        {r.count}
                      </div>
                    </div>
                    <div
                      style={{
                        height: 6,
                        borderRadius: 999,
                        backgroundColor: "var(--rm-panel-hover)",
                        overflow: "hidden",
                      }}
                    >
                      <div
                        style={{
                          height: "100%",
                          width: `${share}%`,
                          background: `linear-gradient(90deg, ${ORANGE}, #F2A35A)`,
                          borderRadius: 999,
                        }}
                      />
                    </div>
                  </div>
                );
              })}
            </div>
          </Panel>
        </div>

        {/* Active Project Load by Client */}
        <Panel>
          <SectionHeader
            icon={Building2}
            color={BLUE}
            title="Active Project Load by Client"
            right={
              <span
                style={{
                  color: "var(--rm-text-muted)",
                  fontSize: 11,
                  fontWeight: 600,
                  textTransform: "uppercase",
                  letterSpacing: "0.05em",
                }}
              >
                Top {clientLoad.length}
              </span>
            }
          />
          {clientLoad.length === 0 && (
            <div style={{ color: "var(--rm-text-faint)", fontSize: 13, padding: "10px 0" }}>
              No active project load to show.
            </div>
          )}
          <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
            {clientLoad.map((c) => {
              const pct = Math.max(4, Math.round((c.value / maxClientValue) * 100));
              return (
                <button
                  key={c.client}
                  onClick={() => setClientModal(c.client)}
                  style={{ all: "unset", display: "block", cursor: "pointer", borderRadius: 8, padding: "6px 8px", margin: "-6px -8px", transition: "background 120ms" }}
                  onMouseEnter={e => (e.currentTarget as HTMLButtonElement).style.backgroundColor = "var(--rm-panel-hover)"}
                  onMouseLeave={e => (e.currentTarget as HTMLButtonElement).style.backgroundColor = "transparent"}
                  title={`View projects for ${c.client}`}
                >
                  <div
                    style={{
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "space-between",
                      marginBottom: 5,
                    }}
                  >
                    <div
                      style={{
                        color: GREEN,
                        fontSize: 13,
                        fontWeight: 600,
                        overflow: "hidden",
                        textOverflow: "ellipsis",
                        whiteSpace: "nowrap",
                        flex: 1,
                        minWidth: 0,
                        textDecoration: "none",
                      }}
                    >
                      {c.client}
                    </div>
                    <div
                      style={{
                        color: "var(--rm-text-muted)",
                        fontSize: 11,
                        marginLeft: 12,
                      }}
                    >
                      {c.count} project{c.count === 1 ? "" : "s"}
                    </div>
                    <div
                      style={{
                        color: GREEN,
                        fontSize: 12,
                        fontWeight: 800,
                        marginLeft: 14,
                        minWidth: 64,
                        textAlign: "right",
                      }}
                    >
                      {fmtM(c.value)}
                    </div>
                  </div>
                  <div
                    style={{
                      height: 8,
                      borderRadius: 999,
                      backgroundColor: "var(--rm-panel-hover)",
                      overflow: "hidden",
                    }}
                  >
                    <div
                      style={{
                        width: `${pct}%`,
                        height: "100%",
                        background: `linear-gradient(90deg, ${GREEN} 0%, #A9C23F 100%)`,
                        borderRadius: 999,
                      }}
                    />
                  </div>
                </button>
              );
            })}
          </div>
        </Panel>


        {/* spacer for shell padding */}
        <div style={{ height: 24 }} />
        {/* tiny tag to keep brand consistency */}
        <div
          style={{
            color: "var(--rm-text-faint)",
            fontSize: 10,
            textAlign: "center",
            fontWeight: 700,
            letterSpacing: "0.08em",
            textTransform: "uppercase",
            marginTop: 8,
          }}
        >
          {NAVY ? "RM ONE" : ""} · Live data
        </div>
      </div>

      {demandsModal && (
        <DemandsModal
          mode={demandsModal}
          demands={demands}
          onClose={() => setDemandsModal(null)}
          onAskAi={(prompt, context) => {
            setChatPrompt(prompt, { newSession: true, autoSend: true, context });
            setDemandsModal(null);
            navigate("/chat");
          }}
        />
      )}

      {execModal && (
        <ExecSnapshotModal
          mode={execModal}
          pmm={pmm}
          opm={opm}
          lem={lem}
          buckets={buckets}
          exec={exec}
          onClose={() => setExecModal(null)}
          onAskAi={(prompt, context) => {
            setChatPrompt(prompt, { newSession: true, autoSend: true, context });
            setExecModal(null);
            navigate("/chat");
          }}
          onOpenProject={(id) => {
            setExecModal(null);
            navigate(`/project/${id}`)
          }}
        />
      )}

      {clientModal && (
        <ClientProjectsModal
          client={clientModal}
          projects={buckets.allOpen.filter((p: any) => getProjectClient(p) === clientModal)}
          onClose={() => setClientModal(null)}
          onOpenProject={(id) => { setClientModal(null); navigate(`/project/${id}`); }}
          onAskAi={(prompt, context) => {
            setChatPrompt(prompt, { newSession: true, autoSend: true, context });
            setClientModal(null);
            navigate("/chat");
          }}
        />
      )}
    </div>
  );
}

/* ─────────────  CLIENT PROJECTS MODAL  ─────────────
 * Drill-down overlay opened by clicking a client bar on the home dashboard.
 * Lists every open project for that client + Ask AI shortcut.
 */
function ClientProjectsModal({
  client,
  projects,
  onClose,
  onOpenProject,
  onAskAi,
}: {
  client: string;
  projects: any[];
  onClose: () => void;
  onOpenProject: (id: string) => void;
  onAskAi: (prompt: string, context: string) => void;
}) {
  const PURPLE = "#9B6BF0";
  const { pos: dragPos, onDragStart } = useDraggable();

  const sorted = useMemo(
    () => [...projects].sort((a, b) => getProjectValue(b) - getProjectValue(a)),
    [projects],
  );
  const totalValue = sorted.reduce((s, p) => s + getProjectValue(p), 0);

  // Fetch resource allocation data directly from API when modal opens
  const [allocData, setAllocData] = useState<ResourceAllocationsResponse | null>(null);
  useEffect(() => {
    getResourceAllocations().then(setAllocData).catch(() => {});
  }, []);

  // Cross-reference client project IDs against resource allocations
  const clientProjectIds = useMemo(
    () => new Set(sorted.map((p) => (p.TicketId || p.RecordId || p.Id || "") as string).filter(Boolean)),
    [sorted],
  );
  const clientResources: LiveResourceProxy[] = useMemo(() => {
    if (!allocData) return [];
    return allocData.resources.filter((r) =>
      r.activeProjects.some((pid) => clientProjectIds.has(pid)) ||
      r.allProjectIds.some((pid) => clientProjectIds.has(pid))
    );
  }, [allocData, clientProjectIds]);

  const overAllocated = clientResources.filter((r) => r.currentPct > 100);
  const underUtil     = clientResources.filter((r) => r.currentPct > 0 && r.currentPct < 40);
  const bench         = clientResources.filter((r) => r.currentPct === 0);
  const avgUtil = clientResources.length > 0
    ? Math.round(clientResources.reduce((s, r) => s + r.currentPct, 0) / clientResources.length)
    : null;

  // Single Ask AI — concise prompt: top projects summary + real resource + utilization data
  const handleAskAi = () => {
    // Top 5 by value, then a count for the rest
    const top5 = sorted.slice(0, 5).map((p, i) => {
      const title = p.Title || p.ProjectName || p.Name || "Untitled";
      const status = p.ProjectStatus || p.Status || "Active";
      const v = getProjectValue(p);
      return `${i + 1}. ${title} · ${status}${v > 0 ? ` · ${fmtM(v)}` : ""}`;
    }).join("\n");
    const remaining = sorted.length > 5 ? `\n...and ${sorted.length - 5} more projects` : "";

    const statusCounts: Record<string, number> = {};
    sorted.forEach((p) => {
      const s = p.ProjectStatus || p.Status || "Active";
      statusCounts[s] = (statusCounts[s] || 0) + 1;
    });
    const statusSummary = Object.entries(statusCounts).map(([s, n]) => `${n} ${s}`).join(", ");

    const overList  = overAllocated.map((r) => `${r.name} (${Math.round(r.currentPct)}%)`).join(", ") || "none";
    const underList = [...underUtil, ...bench].map((r) => `${r.name} (${Math.round(r.currentPct)}%)`).join(", ") || "none";

    const prompt =
      `Give me a complete health summary for the client "${client}".\n\n` +
      `PROJECTS: ${sorted.length} open · ${fmtM(totalValue)} total · ${statusSummary}\n` +
      `Top projects by value:\n${top5}${remaining}\n\n` +
      `RESOURCE ALLOCATION (${clientResources.length} staff on this client):\n` +
      `- Average utilization: ${avgUtil !== null ? `${avgUtil}%` : "calculating..."}\n` +
      `- Over-allocated (>100%): ${overList}\n` +
      `- Under-utilized or bench (<40%): ${underList}\n\n` +
      `Please provide:\n` +
      `1. A project portfolio summary — delivery risk, key statuses, concentration risk\n` +
      `2. A resource summary — who is over-allocated and who is under-allocated, and the impact\n` +
      `3. Analysis of the current utilization rate (${avgUtil !== null ? `${avgUtil}% average` : "see above"}) and specific recommendations to improve it`;

    const context =
      `Client: ${client} · ${sorted.length} projects · ${fmtM(totalValue)} · ${statusSummary}\n` +
      `Staff: ${clientResources.length} assigned · avg util: ${avgUtil !== null ? `${avgUtil}%` : "N/A"}\n` +
      `Over-alloc: ${overList} · Under-util/bench: ${underList}`;

    onAskAi(prompt, context);
  };

  return (
    <div
      onClick={onClose}
      style={{ position: "fixed", inset: 0, zIndex: Z.MODAL_MENU, backgroundColor: "rgba(0,0,0,0.55)", display: "flex", alignItems: "center", justifyContent: "center", padding: "20px" }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{ backgroundColor: "var(--rm-panel)", borderRadius: 18, width: "100%", maxWidth: 580, maxHeight: "85vh", display: "flex", flexDirection: "column", boxShadow: "0 24px 64px rgba(0,0,0,0.45)", transform: `translate(${dragPos.x}px, ${dragPos.y}px)` }}
      >
        {/* Header */}
        <div onMouseDown={onDragStart} style={{ padding: "20px 24px 14px", borderBottom: "1px solid var(--rm-panel-border)", display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 12, cursor: "grab", userSelect: "none" }}>
          <div>
            <div style={{ fontSize: 17, fontWeight: 800, color: "var(--rm-text)", lineHeight: 1.2 }}>{client}</div>
            <div style={{ fontSize: 12, color: "var(--rm-text-muted)", marginTop: 3 }}>
              {sorted.length} project{sorted.length === 1 ? "" : "s"} · {fmtM(totalValue)} total
            </div>
          </div>
          <button
            onClick={onClose}
            style={{ padding: "7px 10px", borderRadius: 9, border: "1px solid var(--rm-panel-border)", backgroundColor: "transparent", color: "var(--rm-text-muted)", cursor: "pointer", fontSize: 16, lineHeight: 1 }}
          >×</button>
        </div>

        {/* Projects list */}
        <div style={{ overflowY: "auto", padding: "12px 24px 24px", flex: 1 }}>
          {sorted.length === 0 ? (
            <div style={{ padding: "24px 0", textAlign: "center", color: "var(--rm-text-muted)", fontSize: 13 }}>No open projects for this client.</div>
          ) : (
            <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
              {sorted.map((p, i) => {
                const title = p.Title || p.ProjectName || p.Name || "Untitled";
                const id = p.TicketId || p.RecordId || p.Id || "";
                const status = p.ProjectStatus || p.Status || "Active";
                const v = getProjectValue(p);
                const handleProjectAi = (e: React.MouseEvent) => {
                  e.stopPropagation();
                  const prompt =
                    `Look up the project "${title}"${id ? ` (ID: ${id})` : ""} in RM ONE ` +
                    `(client: ${client}, status: ${status}, value: ${v > 0 ? fmtM(v) : "not set"}).\n\n` +
                    `Skip re-stating the health score or score breakdown — go straight to:\n` +
                    `1. Who is over-allocated and who is under-allocated on this project (names and %)\n` +
                    `2. Current team utilization rate and specific steps to improve it\n` +
                    `3. Top 2–3 delivery risks and concrete recommended actions`;
                  onAskAi(prompt, `${title}${id ? ` · ${id}` : ""} · ${client} · ${status} · ${v > 0 ? fmtM(v) : "—"}`);
                };
                return (
                  <div
                    key={id || i}
                    style={{ display: "flex", alignItems: "center", padding: "10px 14px", borderRadius: 10, border: "1px solid var(--rm-panel-border)", backgroundColor: "var(--rm-panel-soft)", gap: 10 }}
                  >
                    <button
                      onClick={() => id && onOpenProject(id)}
                      style={{ all: "unset", flex: 1, minWidth: 0, cursor: id ? "pointer" : "default" }}
                    >
                      <div style={{ fontSize: 13, fontWeight: 600, color: "var(--rm-text)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{title}</div>
                      {id && <div style={{ fontSize: 10, color: "var(--rm-text-muted)", marginTop: 1 }}>{id}</div>}
                    </button>
                    <div style={{ fontSize: 10, padding: "3px 8px", borderRadius: 6, backgroundColor: "var(--rm-panel-hover)", color: "var(--rm-text-muted)", whiteSpace: "nowrap", flexShrink: 0 }}>{status}</div>
                    <div style={{ fontSize: 13, fontWeight: 800, color: GREEN, minWidth: 56, textAlign: "right", whiteSpace: "nowrap", flexShrink: 0 }}>{v > 0 ? fmtM(v) : "—"}</div>
                    <button
                      onClick={handleProjectAi}
                      style={{ display: "flex", alignItems: "center", gap: 4, padding: "5px 10px", borderRadius: 7, border: "none", backgroundColor: ORANGE + "18", color: ORANGE, cursor: "pointer", fontWeight: 700, fontSize: 11, flexShrink: 0 }}
                    >
                      <Sparkles size={11} />Ask AI
                    </button>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

/* ─────────────  STAFFING DEMANDS MODAL  ─────────────
 * Fullscreen overlay that lists every open demand record. Opened from the
 * "Open Requests" or "Roles in Demand" stat tiles on the home dashboard.
 * Includes an "Ask AI" button that sends the table contents to the chat
 * page as a pre-filled prompt so the user can deep-dive without retyping.
 */
function DemandsModal({
  mode,
  demands,
  onClose,
  onAskAi,
}: {
  mode: "requests" | "roles";
  demands: DemandItem[];
  onClose: () => void;
  onAskAi: (prompt: string, context: string) => void;
}) {
  const { pos: dragPos, onDragStart } = useDraggable();
  const open = useMemo(() => demands.filter((d) => !d.IsLocked), [demands]);

  // Roll up by role for the "Roles in Demand" view.
  const byRole = useMemo(() => {
    const map = new Map<string, { role: string; count: number; items: DemandItem[] }>();
    for (const d of open) {
      const role = (d.Role || "").trim() || getBusinessRules().unassignedLabel;
      const cur = map.get(role) ?? { role, count: 0, items: [] };
      cur.count += 1;
      cur.items.push(d);
      map.set(role, cur);
    }
    return Array.from(map.values()).sort((a, b) => b.count - a.count);
  }, [open]);

  const isRoles = mode === "roles";
  const title = isRoles ? "Roles in Demand" : "Open Staffing Requests";
  const subtitle = isRoles
    ? `${byRole.length} distinct role${byRole.length === 1 ? "" : "s"} · ${open.length} total requests`
    : `${open.length} open request${open.length === 1 ? "" : "s"} across ${byRole.length} role${byRole.length === 1 ? "" : "s"}`;

  const fmtDate = (s: string | null | undefined) => {
    if (!s) return "—";
    const d = new Date(s);
    if (Number.isNaN(d.getTime())) return "—";
    return d.toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
  };

  // Build a short, user-friendly prompt (what the user sees in chat) plus a
  // detailed hidden context block (sent to the AI as system context, not
  // shown in the conversation). This keeps the chat clean instead of dumping
  // a 100-line bullet list as the user message.
  const buildAiPrompt = (): { prompt: string; context: string } => {
    if (isRoles) {
      const lines = byRole
        .map((r) => `- ${r.role}: ${r.count} open request${r.count === 1 ? "" : "s"}`)
        .join("\n");
      const prompt =
        `Analyze the open staffing demand by role (${byRole.length} distinct roles, ${open.length} total open requests). ` +
        `Recommend a hiring plan with priority order, sourcing options, and which projects each role should be assigned to first.`;
      const context =
        `STAFFING DEMAND BY ROLE — snapshot from the Home dashboard\n` +
        `Totals: ${byRole.length} distinct roles, ${open.length} total open requests.\n\n` +
        `Per-role breakdown:\n${lines}`;
      return { prompt, context };
    }
    const lines = open
      .map((d) => {
        const proj = (d.Title || "").trim() || "Untitled";
        const start = fmtDate(d.AllocationStartDate);
        const end = fmtDate(d.AllocationEndDate);
        return `- ${d.Role || getBusinessRules().unassignedLabel} @ ${proj} · ${d.PctAllocation}% · ${start} → ${end}`;
      })
      .join("\n");
    const prompt =
      `Analyze the ${open.length} open staffing requests across ${byRole.length} role${byRole.length === 1 ? "" : "s"} on the dashboard. ` +
      `Group by project, surface staffing risks, recommend hiring priorities, and propose a sourcing plan with target start dates.`;
    const context =
      `OPEN STAFFING REQUESTS — snapshot from the Home dashboard\n` +
      `${open.length} open requests across ${byRole.length} role${byRole.length === 1 ? "" : "s"}.\n\n` +
      `Full list:\n${lines}`;
    return { prompt, context };
  };

  // Lock background scroll while open.
  useEffect(() => {
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => { document.body.style.overflow = prev; };
  }, []);

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={title}
      onClick={onClose}
      style={{
        position: "fixed", inset: 0, zIndex: Z.MODAL_CHILD_2,
        backgroundColor: "rgba(8,14,20,0.72)",
        backdropFilter: "blur(4px)",
        display: "flex", alignItems: "center", justifyContent: "center",
        padding: 24,
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          width: "100%", maxWidth: 980, maxHeight: "85vh",
          display: "flex", flexDirection: "column",
          backgroundColor: "var(--rm-panel)",
          border: "1px solid var(--rm-panel-border)",
          borderRadius: 16,
          boxShadow: "0 30px 60px rgba(0,0,0,0.55)",
          overflow: "hidden",
          transform: `translate(${dragPos.x}px, ${dragPos.y}px)`,
        }}
      >
        <div onMouseDown={onDragStart} style={{
          display: "flex", alignItems: "center", gap: 12,
          padding: "16px 20px",
          borderBottom: "1px solid var(--rm-panel-border)",
          cursor: "grab", userSelect: "none",
        }}>
          <div style={{
            width: 36, height: 36, borderRadius: 10,
            backgroundColor: `${ORANGE}22`,
            display: "flex", alignItems: "center", justifyContent: "center",
          }}>
            <Users size={18} color={ORANGE} />
          </div>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ color: "var(--rm-text)", fontSize: 16, fontWeight: 800 }}>{title}</div>
            <div style={{ color: "var(--rm-text-muted)", fontSize: 12, marginTop: 2 }}>
              {subtitle}
            </div>
          </div>
          <button
            type="button"
            onClick={() => {
              const { prompt, context } = buildAiPrompt();
              onAskAi(prompt, context);
            }}
            style={{
              display: "inline-flex", alignItems: "center", gap: 6,
              padding: "8px 12px", borderRadius: 9,
              backgroundColor: `${ORANGE}22`,
              border: `1px solid ${ORANGE}66`,
              color: ORANGE,
              fontSize: 12, fontWeight: 800, letterSpacing: "0.04em",
              textTransform: "uppercase",
              cursor: "pointer",
            }}
          >
            <Sparkles size={13} />
            Ask AI
          </button>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            style={{
              width: 32, height: 32, borderRadius: 8,
              border: "1px solid var(--rm-panel-border)",
              backgroundColor: "var(--rm-panel-soft)",
              color: "var(--rm-text)",
              fontSize: 18, lineHeight: 1, cursor: "pointer",
            }}
          >
            ×
          </button>
        </div>

        <div style={{ flex: 1, overflowY: "auto", padding: "12px 20px 20px" }}>
          {isRoles ? (
            <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
              {byRole.map((r) => {
                const share = open.length > 0
                  ? Math.round((r.count / open.length) * 100)
                  : 0;
                return (
                  <div key={r.role} style={{
                    padding: "12px 14px", borderRadius: 10,
                    backgroundColor: "var(--rm-panel-soft)",
                    border: "1px solid var(--rm-panel-border)",
                  }}>
                    <div style={{
                      display: "flex", alignItems: "center", justifyContent: "space-between",
                      marginBottom: 8, gap: 10,
                    }}>
                      <div style={{ color: "var(--rm-text)", fontSize: 14, fontWeight: 700 }}>{r.role}</div>
                      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                        <span style={{ color: "var(--rm-text-muted)", fontSize: 11 }}>{share}% of total</span>
                        <span style={{
                          backgroundColor: `${ORANGE}22`, color: ORANGE,
                          borderRadius: 999, padding: "2px 10px",
                          fontSize: 11, fontWeight: 800,
                        }}>{r.count}</span>
                      </div>
                    </div>
                    <div style={{ height: 6, borderRadius: 999, backgroundColor: "var(--rm-panel-hover)", overflow: "hidden" }}>
                      <div style={{
                        height: "100%", width: `${share}%`,
                        background: `linear-gradient(90deg, ${ORANGE}, #F2A35A)`,
                        borderRadius: 999,
                      }} />
                    </div>
                  </div>
                );
              })}
            </div>
          ) : (
            <div style={{
              display: "grid",
              gridTemplateColumns: "minmax(0,1.4fr) minmax(0,1.6fr) 70px 90px 110px 110px",
              gap: 0,
              fontSize: 12,
              color: "var(--rm-text)",
            }}>
              {["Role", "Project", "Alloc", "Ticket", "Start", "End"].map((h, i) => (
                <div key={i} style={{
                  padding: "10px 10px",
                  color: "var(--rm-text-muted)",
                  fontSize: 10, fontWeight: 800,
                  textTransform: "uppercase", letterSpacing: "0.06em",
                  borderBottom: "1px solid var(--rm-panel-border)",
                  position: "sticky", top: 0,
                  backgroundColor: "var(--rm-panel)",
                }}>{h}</div>
              ))}
              {open.map((d, idx) => {
                const cell: React.CSSProperties = {
                  padding: "10px 10px",
                  borderBottom: "1px solid var(--rm-panel-border)",
                  overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
                };
                return (
                  <Fragment key={`${d.TicketId}-${idx}`}>
                    <div style={{ ...cell, color: "var(--rm-text)", fontWeight: 600 }}>{d.Role || "—"}</div>
                    <div style={{ ...cell, color: "var(--rm-text)" }}>{d.Title || "—"}</div>
                    <div style={{ ...cell, color: ORANGE, fontWeight: 700 }}>{d.PctAllocation}%</div>
                    <div style={{ ...cell, color: "var(--rm-text-muted)", fontSize: 11 }}>{d.TicketId}</div>
                    <div style={{ ...cell, color: "var(--rm-text-muted)" }}>{fmtDate(d.AllocationStartDate)}</div>
                    <div style={{ ...cell, color: "var(--rm-text-muted)" }}>{fmtDate(d.AllocationEndDate)}</div>
                  </Fragment>
                );
              })}
              {open.length === 0 && (
                <div style={{ gridColumn: "1 / -1", padding: 20, color: "var(--rm-text-faint)", textAlign: "center" }}>
                  No open staffing demands.
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

/* ─────────────  EXECUTIVE SNAPSHOT MODAL  ─────────────
 * Fullscreen overlay that drills into the four Executive Snapshot stat
 * tiles (PMM Total / My Projects / Opp Pipeline / Open Leads). Lists every
 * underlying record with the relevant columns and includes an "Ask AI"
 * button that hands the list to the chat page as a pre-filled prompt.
 */
function ExecSnapshotModal({
  mode,
  pmm,
  opm,
  lem,
  buckets,
  exec,
  onClose,
  onAskAi,
  onOpenProject,
}: {
  mode: "pmm" | "mine" | "opp" | "leads" | "closed";
  pmm: any[];
  opm: any[];
  lem: any[];
  buckets: ProjectsBuckets;
  exec: { pmmTotal: number; mineCount: number; opmTotal: number; openLeads: number };
  onClose: () => void;
  onAskAi: (prompt: string, context: string) => void;
  onOpenProject: (id: string) => void;
}) {
  const { pos: dragPos, onDragStart } = useDraggable();

  // Lock background scroll while open.
  useEffect(() => {
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => {
      document.body.style.overflow = prev;
      window.removeEventListener("keydown", onKey);
    };
  }, [onClose]);

  const cfg = useMemo(() => {
    if (mode === "pmm") {
      return {
        title: "PMM Total — Open Projects",
        subtitle: `${buckets.allOpen.length} open projects · ${fmtM(exec.pmmTotal)} total contract value`,
        color: GREEN,
        icon: TrendingUp,
        records: buckets.allOpen,
        kind: "project" as const,
      };
    }
    if (mode === "mine") {
      return {
        title: "My Projects",
        subtitle: `${buckets.myOpen.length} project${buckets.myOpen.length === 1 ? "" : "s"} where you're staffed`,
        color: BLUE,
        icon: Briefcase,
        records: buckets.myOpen,
        kind: "project" as const,
      };
    }
    if (mode === "closed") {
      return {
        title: "Closed Projects",
        subtitle: `${buckets.closed.length} closed project${buckets.closed.length === 1 ? "" : "s"}`,
        color: GREEN,
        icon: FolderKanban,
        records: buckets.closed,
        kind: "project" as const,
      };
    }
    if (mode === "opp") {
      return {
        title: "Opportunity Pipeline",
        subtitle: `${opm.length} opportunit${opm.length === 1 ? "y" : "ies"} · ${fmtM(exec.opmTotal)} total value`,
        color: ORANGE,
        icon: Target,
        records: opm,
        kind: "opp" as const,
      };
    }
    const openLems = lem.filter((l: any) => {
      if (!l || typeof l !== "object") return false;
      if (l.Closed === true) return false;
      const status = String(l.LeadStatus ?? "").trim();
      return !LEM_CLOSED.has(status);
    });
    return {
      title: "Open Leads",
      subtitle: `${openLems.length} lead${openLems.length === 1 ? "" : "s"} awaiting qualification`,
      color: PURPLE,
      icon: Users,
      records: openLems,
      kind: "lead" as const,
    };
  }, [mode, pmm, opm, lem, buckets, exec]);

  const Icon = cfg.icon;

  // Short user-visible prompt + bulky hidden context (sent as system context
  // to the AI). Avoids dumping a 40-line bullet list as the user message.
  const buildAiPrompt = (): { prompt: string; context: string } => {
    const lines = cfg.records
      .map((r: any) => {
        const id = r.TicketId || r.RecordId || r.Id || "";
        const title = r.Title || r.ProjectName || r.Name || "Untitled";
        const client = getProjectClient(r) || "—";
        if (cfg.kind === "lead") {
          const status = r.LeadStatus || r.Status || "—";
          return `- ${title} (${id}) · ${client} · ${status}`;
        }
        if (cfg.kind === "opp") {
          const stage = r.CRMOpportunityStatusChoice || r.CRMProjectStatusChoice || r.Status || "—";
          const v = getOppValue(r);
          return `- ${title} (${id}) · ${client} · ${stage} · ${v > 0 ? fmtM(v) : "—"}`;
        }
        const v = getProjectValue(r);
        const status = r.CRMProjectStatusChoice || r.Status || "—";
        return `- ${title} (${id}) · ${client} · ${status} · ${v > 0 ? fmtM(v) : "—"}`;
      })
      .join("\n");

    if (mode === "pmm") {
      return {
        prompt:
          `Analyze the open project portfolio (PMM Total = ${fmtM(exec.pmmTotal)} across ${buckets.allOpen.length} projects). ` +
          `Highlight the top revenue-driving projects, surface risk concentrations by client/stage, and recommend where to focus this week.`,
        context:
          `OPEN PROJECT PORTFOLIO — snapshot from the Home dashboard\n` +
          `Totals: ${buckets.allOpen.length} open projects · ${fmtM(exec.pmmTotal)} total contract value.\n\n` +
          `Full list:\n${lines}`,
      };
    }
    if (mode === "mine") {
      return {
        prompt:
          `Analyze the ${buckets.myOpen.length} projects I'm currently staffed on. ` +
          `Surface my biggest priorities, anything overdue or at risk, and recommend the order I should tackle them this week.`,
        context:
          `MY PROJECTS — snapshot from the Home dashboard\n` +
          `${buckets.myOpen.length} project${buckets.myOpen.length === 1 ? "" : "s"} where I'm staffed.\n\n` +
          `Full list:\n${lines}`,
      };
    }
    if (mode === "closed") {
      return {
        prompt:
          `Review the ${buckets.closed.length} recently closed project${buckets.closed.length === 1 ? "" : "s"}. ` +
          `Summarize outcomes, surface lessons learned, and flag any closeout items still outstanding.`,
        context:
          `CLOSED PROJECTS — snapshot from the Home dashboard\n` +
          `${buckets.closed.length} closed project${buckets.closed.length === 1 ? "" : "s"}.\n\n` +
          `Full list:\n${lines}`,
      };
    }
    if (mode === "opp") {
      return {
        prompt:
          `Analyze the opportunity pipeline (${opm.length} opportunit${opm.length === 1 ? "y" : "ies"}, ${fmtM(exec.opmTotal)} total). ` +
          `Group by stage, flag the highest-value deals, identify stalled opportunities, and recommend a pursuit plan.`,
        context:
          `OPPORTUNITY PIPELINE — snapshot from the Home dashboard\n` +
          `${opm.length} opportunit${opm.length === 1 ? "y" : "ies"} · ${fmtM(exec.opmTotal)} total value.\n\n` +
          `Full list:\n${lines}`,
      };
    }
    return {
      prompt:
        `Analyze the ${cfg.records.length} open lead${cfg.records.length === 1 ? "" : "s"} awaiting qualification. ` +
        `Prioritize the leads most likely to convert, flag stale ones, and recommend next steps for each.`,
      context:
        `OPEN LEADS — snapshot from the Home dashboard\n` +
        `${cfg.records.length} lead${cfg.records.length === 1 ? "" : "s"} awaiting qualification.\n\n` +
        `Full list:\n${lines}`,
    };
  };

  const headers: string[] =
    cfg.kind === "lead"
      ? ["Title", "Client", "Status"]
      : cfg.kind === "opp"
        ? ["Title", "Client", "Stage", "Value"]
        : ["Title", "Client", "Status", "Value"];

  const gridCols =
    cfg.kind === "lead"
      ? "minmax(0,1.6fr) minmax(0,1.2fr) 130px"
      : "minmax(0,1.6fr) minmax(0,1.2fr) 140px 110px";

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={cfg.title}
      onClick={onClose}
      style={{
        position: "fixed", inset: 0, zIndex: Z.MODAL_CHILD_2,
        backgroundColor: "rgba(8,14,20,0.72)",
        backdropFilter: "blur(4px)",
        display: "flex", alignItems: "center", justifyContent: "center",
        padding: 24,
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          width: "100%", maxWidth: 1040, maxHeight: "85vh",
          display: "flex", flexDirection: "column",
          backgroundColor: "var(--rm-panel)",
          border: "1px solid var(--rm-panel-border)",
          borderRadius: 16,
          boxShadow: "0 30px 60px rgba(0,0,0,0.55)",
          overflow: "hidden",
          transform: `translate(${dragPos.x}px, ${dragPos.y}px)`,
        }}
      >
        <div onMouseDown={onDragStart} style={{
          display: "flex", alignItems: "center", gap: 12,
          padding: "16px 20px",
          borderBottom: "1px solid var(--rm-panel-border)",
          cursor: "grab", userSelect: "none",
        }}>
          <div style={{
            width: 36, height: 36, borderRadius: 10,
            backgroundColor: `${cfg.color}22`,
            border: `1px solid ${cfg.color}44`,
            display: "flex", alignItems: "center", justifyContent: "center",
          }}>
            <Icon size={18} color={cfg.color} />
          </div>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ color: "var(--rm-text)", fontSize: 16, fontWeight: 800 }}>{cfg.title}</div>
            <div style={{ color: "var(--rm-text-muted)", fontSize: 12, marginTop: 2 }}>
              {cfg.subtitle}
            </div>
          </div>
          <button
            type="button"
            onClick={() => {
              const { prompt, context } = buildAiPrompt();
              onAskAi(prompt, context);
            }}
            style={{
              display: "inline-flex", alignItems: "center", gap: 6,
              padding: "8px 12px", borderRadius: 9,
              backgroundColor: `${cfg.color}22`,
              border: `1px solid ${cfg.color}66`,
              color: cfg.color,
              fontSize: 12, fontWeight: 800, letterSpacing: "0.04em",
              textTransform: "uppercase",
              cursor: "pointer",
            }}
          >
            <Sparkles size={13} />
            Ask AI
          </button>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            style={{
              width: 32, height: 32, borderRadius: 8,
              border: "1px solid var(--rm-panel-border)",
              backgroundColor: "var(--rm-panel-soft)",
              color: "var(--rm-text)",
              fontSize: 18, lineHeight: 1, cursor: "pointer",
            }}
          >
            ×
          </button>
        </div>

        <div
          style={{
            display: "grid",
            gridTemplateColumns: gridCols,
            gap: 0,
            padding: "0 20px",
            borderBottom: "1px solid var(--rm-panel-border)",
            backgroundColor: "var(--rm-panel)",
          }}
        >
          {headers.map((h, i) => (
            <div
              key={i}
              style={{
                padding: "12px 10px",
                color: "var(--rm-text-muted)",
                fontSize: 10, fontWeight: 800,
                textTransform: "uppercase", letterSpacing: "0.06em",
                textAlign: i === headers.length - 1 && cfg.kind !== "lead" ? "right" : "left",
              }}
            >
              {h}
            </div>
          ))}
        </div>

        <div style={{ flex: 1, overflowY: "auto", padding: "0 20px 20px" }}>
          <div
            style={{
              display: "grid",
              gridTemplateColumns: gridCols,
              gap: 0,
              fontSize: 12,
              color: "var(--rm-text)",
            }}
          >
            {cfg.records.map((r: any, idx: number) => {
              const id = r.TicketId || r.RecordId || r.Id || "";
              const title = r.Title || r.ProjectName || r.Name || "Untitled";
              const client = getProjectClient(r) || "—";
              const value = cfg.kind === "opp" ? getOppValue(r) : getProjectValue(r);
              const status =
                cfg.kind === "lead"
                  ? r.LeadStatus || r.Status || "—"
                  : cfg.kind === "opp"
                    ? r.CRMOpportunityStatusChoice || r.CRMProjectStatusChoice || r.Status || "—"
                    : r.CRMProjectStatusChoice || r.Status || "—";
              const clickable = cfg.kind === "project" && !!id;
              const cellBase: React.CSSProperties = {
                padding: "10px 10px",
                borderBottom: "1px solid var(--rm-panel-border)",
                overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
                cursor: clickable ? "pointer" : "default",
              };
              const onRowClick = clickable ? () => onOpenProject(String(id)) : undefined;
              return (
                <Fragment key={`${id || title}-${idx}`}>
                  <div
                    onClick={onRowClick}
                    style={{
                      ...cellBase,
                      color: "var(--rm-text)", fontWeight: 600,
                      textDecoration: clickable ? "underline" : "none",
                      textDecorationColor: `${cfg.color}66`,
                      textUnderlineOffset: 3,
                    }}
                    title={title}
                  >
                    {title}
                  </div>
                  <div onClick={onRowClick} style={{ ...cellBase, color: "var(--rm-text)" }} title={client}>
                    {client}
                  </div>
                  <div
                    onClick={onRowClick}
                    style={{
                      ...cellBase,
                      color: "var(--rm-text-muted)",
                      fontSize: 11,
                    }}
                    title={String(status)}
                  >
                    {String(status)}
                  </div>
                  {cfg.kind !== "lead" && (
                    <div
                      onClick={onRowClick}
                      style={{
                        ...cellBase,
                        color: value > 0 ? cfg.color : "var(--rm-text-faint)",
                        fontWeight: 800,
                        textAlign: "right",
                      }}
                    >
                      {value > 0 ? fmtM(value) : "—"}
                    </div>
                  )}
                </Fragment>
              );
            })}
            {cfg.records.length === 0 && (
              <div
                style={{
                  gridColumn: "1 / -1",
                  padding: 20,
                  color: "var(--rm-text-faint)",
                  textAlign: "center",
                }}
              >
                Nothing to show here yet.
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

/* Briefcase / Target imports kept to satisfy typecheck for future use */
void Briefcase;
void Target;
