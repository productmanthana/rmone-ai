/* ─────────────────────────────────────────────────────────────
 * Analytics Center — Usage Analytics page (Mission Control style).
 * Admin-only. Server-side telemetry aggregates (logins, module
 * visits, transaction types) — NOT the client ReportModel, so a
 * separate fetch with its own honest failure states:
 *   error / kill-switch off / restricted / collecting / ready.
 * Charts rule: ONE recharts chart (weekly trend); everything else
 * is ranked bars and big numbers. Every figure drills to rows
 * (DataDrawer) and every card exports PDF + Excel via CardShell.
 * Portfolio-status context card renders only in single-tenant
 * scope (it comes from the viewer's own ReportModel — a root
 * superadmin's cross-tenant view has no honest source for it).
 * ──────────────────────────────────────────────────────────── */
import { useEffect, useRef, useState } from "react";
import { FileText, FileSpreadsheet } from "lucide-react";
import { useTheme } from "@/lib/theme";
import { getUsageAnalytics, getUsageAllocEdits, type UsageAnalytics, type AllocEditRow } from "@/lib/api";
import { readUsageSeed, writeUsageSeed, currentUsageScope } from "@/lib/usageAnalyticsCache";
import { buildUsageView, ALL_TAB, OUTCOME_MIN_WEEKS, type UsageView, type UsageOutcomes } from "@/lib/analyticsUsage";
import { int, type CardModel, type SectionId, PROJECT_COLS, projRows, STAFF_COLS, staffRows } from "@/lib/analyticsCenter";
import {
  MissionWorld, SectionHeader, CardShell, StatCard, DrillZone, DrillNumber, ExportBtn, useReportModel, LoadingBlock, ErrorBlock,
} from "@/components/analytics/MissionWorld";
import { MC, useMC, Glass, MiniBars, MiniSparkline } from "@/components/analytics/MissionKit";
import { ArcGauge, MissionArea, MissionMultiLine, ChartCaption } from "@/components/analytics/MissionCharts";
import {
  ComposedChart, Bar, Line, Cell, LabelList,
  ResponsiveContainer as RC, XAxis, YAxis, CartesianGrid, Tooltip as RTooltip,
} from "recharts";
import { DataDrawer } from "@/components/analytics/DataDrawer";
import { OrgDimPicker, useOrgDim } from "@/components/analytics/OrgDimPicker";
import { orgDimLabel } from "@/lib/analyticsCenter";
import { dedupeUsageOrgStaff, usageAdoptionByOrg } from "@/lib/usageOrg";

const TENANT_COLORS = ["#8EC94A", "#38BDF8", "#F0A842", "#A78BFA", "#F87171"];
const USAGE_AUTO_REFRESH_MS = 30_000;

/** Detail responses repeat aggregate fields for standalone API consumers.
 * The screen deliberately preserves its already-rendered summary, however:
 * a drawer is allowed to add evidence rows only, never roll dashboard
 * aggregates back to an older detail-cache generation. */
function mergeUsageEvidence(summary: UsageAnalytics, detail: UsageAnalytics): UsageAnalytics {
  if (!summary.available || !detail.available) return summary;
  const evidenceByTenant = new Map(detail.tenants.map((tenant) => [tenant.tenant, tenant]));
  return {
    ...summary,
    tenants: summary.tenants.map((tenant) => {
      const evidence = evidenceByTenant.get(tenant.tenant);
      if (!evidence) return tenant;
      return {
        ...tenant,
        pageVisitRows: evidence.pageVisitRows,
        pageVisitTotal: evidence.pageVisitTotal,
        loginDetailRows: evidence.loginDetailRows,
        loginDetailTotal: evidence.loginDetailTotal,
        txDetailRows: evidence.txDetailRows,
        txDetailTotal: evidence.txDetailTotal,
        outcomes: {
          ...tenant.outcomes,
          consistentMembers: evidence.outcomes.consistentMembers,
          occasionalMembers: evidence.outcomes.occasionalMembers,
        },
      };
    }),
  };
}

/* ── Role breakdown card ────────────────────────────────────────────────────
 * Replaces the old "Managers: N" StatCard with a per-role count list so any
 * non-technical user can see the full picture at a glance. */
function RoleBreakdownCard({
  roleCounts,
  onDrill,
}: {
  roleCounts: Record<string, number>;
  onDrill: (card: CardModel) => void;
}) {
  const MC = useMC();
  const ROW_LIMIT = 3;
  const [exportBusy, setExportBusy] = useState<"pdf" | "xlsx" | null>(null);

  // Sort by count descending so the largest group appears first.
  const allRows = Object.entries(roleCounts).sort((a, b) => b[1] - a[1]);
  const visibleRows = allRows.slice(0, ROW_LIMIT);
  const overflow = allRows.length - ROW_LIMIT;
  const total = allRows.reduce((s, [, n]) => s + n, 0);

  // Build a CardModel so the user can see ALL roles in the shared DataDrawer.
  const card: CardModel = {
    id: "usage" as SectionId,
    title: "Users by Role",
    takeaway: `${total} enabled user${total !== 1 ? "s" : ""} across ${allRows.length} role${allRows.length !== 1 ? "s" : ""}.`,
    stats: [
      { label: "Total users", value: String(total) },
      { label: "Distinct roles", value: String(allRows.length) },
    ],
    columns: [
      { key: "role",  label: "Role",  width: 60 },
      { key: "count", label: "Users", kind: "int" as const, align: "right", width: 20 },
      { key: "share", label: "Share", align: "right", width: 20 },
    ],
    rows: allRows.map(([role, count]) => ({
      role,
      count,
      share: total > 0 ? `${Math.round((count / total) * 100)}%` : "—",
    })),
  };

  const runExport = async (kind: "pdf" | "xlsx", e: React.MouseEvent) => {
    e.stopPropagation();
    if (exportBusy) return;
    setExportBusy(kind);
    try {
      const mod = await import("@/lib/exportCard");
      if (kind === "pdf") await mod.exportCardPdf(card);
      else await mod.exportCardExcel(card);
    } catch { /* silent */ }
    finally { setExportBusy(null); }
  };

  return (
    <Glass style={{ padding: "16px 20px", display: "flex", flexDirection: "column" }}>
      {/* Header label — matches StatCard typography */}
      <div style={{ fontSize: 10, fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.14em", color: MC.faint }}>
        Users by role
      </div>

      {/* Top-N role rows */}
      <div style={{ marginTop: 10, flex: 1, display: "flex", flexDirection: "column", gap: 6 }}>
        {visibleRows.length === 0 ? (
          <div style={{ fontSize: 13, color: MC.faint }}>—</div>
        ) : visibleRows.map(([role, count]) => (
          <div key={role} style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <div style={{ height: 4, borderRadius: 2, flex: 1, background: MC.border, overflow: "hidden" }}>
              <div style={{
                height: "100%", borderRadius: 2,
                width: `${Math.max(4, Math.round((count / Math.max(total, 1)) * 100))}%`,
                background: MC.greenBright,
              }} />
            </div>
            <span style={{ fontSize: 11.5, color: MC.muted, flex: 1, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{role}</span>
            <span style={{ fontSize: 14, fontWeight: 800, fontVariantNumeric: "tabular-nums", color: MC.text, minWidth: 28, textAlign: "right" }}>{count}</span>
          </div>
        ))}
        {overflow > 0 && (
          <div style={{ fontSize: 10, color: MC.faint, textAlign: "right" }}>
            +{overflow} more role{overflow !== 1 ? "s" : ""}
          </div>
        )}
      </div>

      {/* Footer — identical structure to StatCard */}
      <div style={{ marginTop: 12, paddingTop: 10, borderTop: `1px solid ${MC.border}`, display: "flex", alignItems: "center", justifyContent: "space-between", gap: 6, flexWrap: "wrap" }}>
        <span
          role="button"
          tabIndex={0}
          title="See the data behind this card"
          onClick={() => onDrill(card)}
          onKeyDown={e => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); onDrill(card); } }}
          style={{ fontSize: 10.5, fontWeight: 700, color: MC.greenInk, textTransform: "uppercase", letterSpacing: "0.08em", cursor: "zoom-in" }}
        >
          View data · {allRows.length} rows
        </span>
        <span style={{ display: "inline-flex", gap: 5 }}>
          <ExportBtn label="PDF"   icon={FileText}        loading={exportBusy === "pdf"}  disabled={exportBusy !== null} onClick={e => runExport("pdf",  e)} />
          <ExportBtn label="Excel" icon={FileSpreadsheet} loading={exportBusy === "xlsx"} disabled={exportBusy !== null} onClick={e => runExport("xlsx", e)} />
        </span>
      </div>
    </Glass>
  );
}

/* ── Phase 2: Usage → Outcomes section ─────────────────────────────────── */

function OutcomeValue({ display, hasEnoughHistory, color }: { display: string; hasEnoughHistory: boolean; color?: string }) {
  const MC = useMC();
  return (
    <div style={{ fontSize: 32, fontWeight: 800, fontVariantNumeric: "tabular-nums", color: display === "—" ? MC.faint : (color ?? MC.text) }}>
      {display}
    </div>
  );
}

function OutcomeCard({
  badge, title, body, metric, unit, note, hasEnoughHistory, color,
  sparkline, sparkLabels, onDrill, card,
}: {
  badge: string;
  title: string;
  body: string;
  metric: string;
  unit?: string;
  note: string;
  hasEnoughHistory: boolean;
  color?: string;
  sparkline: (number | null)[];
  sparkLabels: string[];
  onDrill: (card: import("@/lib/analyticsCenter").CardModel) => void;
  card: import("@/lib/analyticsCenter").CardModel | null;
}) {
  const MC = useMC();
  const { mode } = useTheme();
  const isDark = mode !== "light";
  const effectiveColor = color ?? MC.greenBright;
  const nonNullCount = sparkline.filter((v) => v !== null).length;
  const showSpark = hasEnoughHistory && nonNullCount >= 2;
  const [exportBusy, setExportBusy] = useState<"pdf" | "xlsx" | null>(null);
  const evidencePending = card?.id === "usage" && card.rows.length === 0;

  const runExport = async (kind: "pdf" | "xlsx", e: React.MouseEvent) => {
    e.stopPropagation();
    if (exportBusy || !card || evidencePending) return;
    setExportBusy(kind);
    try {
      const mod = await import("@/lib/exportCard");
      if (kind === "pdf") await mod.exportCardPdf(card);
      else await mod.exportCardExcel(card);
    } catch { /* silent — user will notice nothing downloaded */ }
    finally { setExportBusy(null); }
  };

  return (
    <div style={{
      borderRadius: 16, padding: "20px 22px",
      background: isDark
        ? "linear-gradient(160deg, rgba(62,92,117,0.42) 0%, rgba(37,55,70,0.55) 55%, rgba(30,46,60,0.65) 100%)"
        : "#FFFFFF",
      border: isDark ? "1px solid rgba(255,255,255,0.10)" : `1px solid ${MC.border}`,
      boxShadow: isDark ? "none" : "0 2px 16px rgba(15,25,35,0.07)",
      display: "flex", flexDirection: "column", gap: 10,
    }}>
      <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 8 }}>
        <span style={{
          fontSize: 9.5, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.14em",
          padding: "4px 9px", borderRadius: 999, whiteSpace: "nowrap",
          color: effectiveColor, background: `${effectiveColor}22`, border: `1px solid ${effectiveColor}55`,
        }}>{badge}</span>
        {!hasEnoughHistory && (
          <span style={{ fontSize: 10, color: MC.faint, whiteSpace: "nowrap" }}>
            needs {OUTCOME_MIN_WEEKS} wks
          </span>
        )}
      </div>
      <div style={{ fontSize: 13, fontWeight: 700, color: MC.text, lineHeight: 1.35 }}>{title}</div>
      <DrillZone card={card} onDrill={onDrill} label="See detail">
        <div style={{ display: "flex", alignItems: "flex-end", justifyContent: "space-between", gap: 12 }}>
          <div>
            <OutcomeValue display={metric} hasEnoughHistory={hasEnoughHistory} color={hasEnoughHistory && metric !== "—" ? effectiveColor : undefined} />
            {unit && metric !== "—" && (
              <div style={{ fontSize: 10.5, color: MC.muted, marginTop: -4 }}>{unit}</div>
            )}
          </div>
          {showSpark && (
            <div style={{ flexShrink: 0, opacity: 0.9 }}>
              <MiniSparkline points={sparkline} labels={sparkLabels} color={effectiveColor} w={100} h={38} />
            </div>
          )}
        </div>
      </DrillZone>
      <div style={{ fontSize: 11.5, lineHeight: 1.6, color: MC.muted }}>{body}</div>

      {/* Note + export row ── */}
      <div style={{
        borderTop: `1px solid ${MC.border}`, paddingTop: 8,
        display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 10,
      }}>
        <div style={{ fontSize: 10.5, color: MC.faint, flex: 1 }}>{note}</div>
        {card && evidencePending ? (
          <span style={{ fontSize: 10, color: MC.faint, flexShrink: 0 }}>Open detail to load evidence</span>
        ) : card && (
          <div style={{ display: "flex", gap: 5, flexShrink: 0, marginTop: 1 }}>
            {(["pdf", "xlsx"] as const).map(kind => (
              <button
                key={kind}
                onClick={(e) => { void runExport(kind, e); }}
                disabled={exportBusy !== null}
                title={kind === "pdf" ? "Download PDF" : "Download Excel"}
                style={{
                  fontSize: 9.5, fontWeight: 700, letterSpacing: "0.06em",
                  padding: "3px 7px", borderRadius: 5, cursor: exportBusy ? "wait" : "pointer",
                  border: `1px solid ${effectiveColor}55`,
                  color: exportBusy === kind ? MC.faint : effectiveColor,
                  background: `${effectiveColor}11`,
                  opacity: exportBusy && exportBusy !== kind ? 0.45 : 1,
                  transition: "opacity 0.15s",
                }}>
                {exportBusy === kind ? "…" : kind === "pdf" ? "↓ PDF" : "↓ Excel"}
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function OutcomeSection({ outcomes, weeks, onDrill }: {
  outcomes: UsageOutcomes;
  weeks: number;
  onDrill: (card: import("@/lib/analyticsCenter").CardModel) => void;
}) {
  const MC = useMC();
  const { allocEditsPerUserWeek: alloc, featureBreadth: breadth, importRegularity: imports, allocCard, breadthCard, importCard } = outcomes;

  return (
    <div style={{ marginTop: 16 }}>
      {/* section header */}
      <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 12 }}>
        <span style={{
          fontSize: 10, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.12em",
          padding: "5px 12px", borderRadius: 999,
          color: MC.greenInk, background: "rgba(107,165,57,0.12)", border: "1px solid rgba(107,165,57,0.35)",
        }}>
          Usage → Outcomes
        </span>
        <span style={{ fontSize: 11.5, color: MC.faint }}>
          Observed patterns from {weeks} week{weeks !== 1 ? "s" : ""} of recorded activity
          {!alloc.hasEnoughHistory && ` · numbers appear after ${OUTCOME_MIN_WEEKS} weeks`}
        </span>
      </div>

      <div style={{ display: "grid", gap: 14, gridTemplateColumns: "repeat(auto-fit, minmax(300px, 1fr))" }}>
        {/* Card 1 — Schedule update cadence */}
        <OutcomeCard
          badge="Schedule Updates"
          title="Are teams keeping their project plans up to date?"
          body={
            alloc.hasEnoughHistory && alloc.value !== null
              ? `${alloc.totalEdits} plan update${alloc.totalEdits !== 1 ? "s" : ""} were saved by ${alloc.activeUsers} person${alloc.activeUsers !== 1 ? "s" : ""} over ${weeks} weeks — that's ${alloc.display} each per week on average.`
              : alloc.hasEnoughHistory
              ? "No plan updates were recorded in this date range."
              : `Check back after ${OUTCOME_MIN_WEEKS} weeks — not enough data yet to show a pattern.`
          }
          metric={alloc.display}
          unit="updates saved per person, per week"
          note="When teams update their schedules often, it's a sign they're staying on top of the project. This counts how often those saves happened — not whether the schedules are correct."
          hasEnoughHistory={alloc.hasEnoughHistory}
          color="#38BDF8"
          sparkline={alloc.sparkline}
          sparkLabels={alloc.sparkLabels}
          onDrill={onDrill}
          card={allocCard}
        />

        {/* Card 2 — Feature breadth by engagement level */}
        <OutcomeCard
          badge="Platform Depth"
          title="Do people who log in often use more of the system?"
          body={
            breadth.hasEnoughHistory && breadth.consistentAvg !== null && breadth.occasionalAvg !== null
              ? `People who log in most weeks visited ${breadth.consistentAvg} section${breadth.consistentAvg !== 1 ? "s" : ""} on average. Those who log in less often visited ${breadth.occasionalAvg} — ${breadth.ratio !== null ? `${breadth.ratio}× fewer` : "a smaller range"}.`
              : breadth.hasEnoughHistory && (breadth.consistentUsers === 0 || breadth.occasionalUsers === 0)
              ? `Only ${breadth.consistentUsers > 0 ? "frequent" : "occasional"} users were active in this window — both groups are needed to compare.`
              : `Check back after ${OUTCOME_MIN_WEEKS} weeks — not enough data yet to show a pattern.`
          }
          metric={
            breadth.consistentAvg !== null && breadth.occasionalAvg !== null
              ? `${breadth.consistentAvg} vs ${breadth.occasionalAvg}`
              : "—"
          }
          unit="sections visited: frequent vs occasional users"
          note="We split people into two groups — those who log in most weeks, and those who log in less often. For each group we count how many different areas of the app they visited. More areas means they're using more of the system."
          hasEnoughHistory={breadth.hasEnoughHistory}
          color="#A78BFA"
          sparkline={breadth.sparkline}
          sparkLabels={breadth.sparkLabels}
          onDrill={onDrill}
          card={breadthCard}
        />

        {/* Card 3 — Data upload frequency */}
        <OutcomeCard
          badge="Data Uploads"
          title="How often is new data brought into the system?"
          body={
            imports.hasEnoughHistory && imports.pct !== null
              ? `A data file was uploaded in ${imports.importWeeks} of ${imports.totalWeeks} week${imports.totalWeeks !== 1 ? "s" : ""} (${imports.pct}%). ${imports.pct >= 80 ? "Files come in consistently each week." : imports.pct >= 40 ? "Files come in regularly, though not every week." : "Files are brought in occasionally during this period."}`
              : `Check back after ${OUTCOME_MIN_WEEKS} weeks — not enough data yet to show a pattern.`
          }
          metric={imports.display}
          unit="weeks where a file was uploaded"
          note="Each week we check whether anyone brought in a new data file — like a staff list or project update. This just shows how often it happened. There's no target to hit; it depends on how the team works."
          hasEnoughHistory={imports.hasEnoughHistory}
          color="#F0A842"
          sparkline={imports.sparkline}
          sparkLabels={imports.sparkLabels}
          onDrill={onDrill}
          card={importCard}
        />
      </div>
    </div>
  );
}

export default function AnalyticsUsagePage() {
  const MC = useMC();
  const { mode } = useTheme();
  const isDark = mode !== "light";
  const MONO = "'IBM Plex Mono', ui-monospace, monospace";
  const { m } = useReportModel(); // portfolio context card only — usage numbers never come from it
  const [payload, setPayload] = useState<UsageAnalytics | null | undefined>(undefined);
  const [allocEdits, setAllocEdits] = useState<{ rows: AllocEditRow[]; total: number } | null>(null);
  const [tab, setTab] = useState<string>(ALL_TAB);
  const [drawer, setDrawer] = useState<CardModel | null>(null);
  const [drawerLoading, setDrawerLoading] = useState(false);
  const [settledSummaryGeneration, setSettledSummaryGeneration] = useState<number | null>(null);
  const [refreshKey, setRefreshKey] = useState(0);
  const [refreshing, setRefreshing] = useState(false);
  // One-shot flag: the Refresh button forces a cluster-wide server recompute
  // (?bust=1) on the NEXT fetch; period/date changes accept cached payloads.
  const bustNextRef = useRef(false);
  const refreshInFlightRef = useRef(false);
  const refreshRequestIdRef = useRef(0);
  const detailKeysRef = useRef(new Set<string>());
  const detailInflightRef = useRef(new Set<string>());
  const analyticsGenerationRef = useRef(0);
  const [dateStart, setDateStart] = useState(""); // "" = all time
  const [dateEnd, setDateEnd] = useState("");
  const [period, setPeriod] = useState<"all" | "4w" | "3m" | "6m" | "ytd" | "custom">("all");
  /* Shared org-dimension selection (same session key as the other Analytics
   * Center pages — switching here follows the user across pages). */
  const [orgDim, setOrgDim] = useOrgDim("analytics:orgDim");
  const [attentionTab, setAttentionTab] = useState<"inactive" | "active">("inactive");
  const today = new Date().toISOString().slice(0, 10);
  // Both summary and deferred-evidence requests must prove they still belong
  // to the currently selected tenant/date window before painting. A user can
  // change periods while either request is in flight.
  const requestSelectionKey = `${currentUsageScope()}|${dateStart}|${dateEnd}`;
  const activeSelectionRef = useRef(requestSelectionKey);
  activeSelectionRef.current = requestSelectionKey;

  /** Compute YYYY-MM-DD for N days ago from today. */
  const daysAgo = (n: number) => {
    const d = new Date();
    d.setDate(d.getDate() - n);
    return d.toISOString().slice(0, 10);
  };

  const applyPeriod = (p: typeof period) => {
    setPeriod(p);
    if (p === "all")    { setDateStart(""); setDateEnd(""); }
    else if (p === "4w")  { setDateStart(daysAgo(28));  setDateEnd(today); }
    else if (p === "3m")  { setDateStart(daysAgo(90));  setDateEnd(today); }
    else if (p === "6m")  { setDateStart(daysAgo(182)); setDateEnd(today); }
    else if (p === "ytd") { setDateStart(new Date().getFullYear() + "-01-01"); setDateEnd(today); }
    // "custom" — leave dates as-is; the debounced effect below fires once both are filled
    // Preset selections batch with the date updates in one React render and fire immediately.
    if (p !== "custom") setRefreshKey((k) => k + 1);
  };

  // Auth boundary: on login/logout/tenant switch while this page is mounted,
  // drop everything on screen and refetch under the new identity — telemetry
  // fetched for the previous identity must never stay visible.
  useEffect(() => {
    const onAuth = () => {
      setPayload(undefined);
      setAllocEdits(null);
      setRefreshKey((k) => k + 1);
    };
    window.addEventListener("rmone:authChanged", onAuth);
    return () => window.removeEventListener("rmone:authChanged", onAuth);
  }, []);

  // Auto-load for Custom period: fire a refresh 600 ms after both dates are filled.
  // Debounce prevents mid-type fetches when the user is still entering the second date.
  useEffect(() => {
    if (period !== "custom") return;
    if (!dateStart || !dateEnd) return;
    const timer = setTimeout(() => { setRefreshKey((k) => k + 1); }, 600);
    return () => clearTimeout(timer);
  }, [period, dateStart, dateEnd]);

  // Usage events are written asynchronously and the server intentionally
  // serves its analytics cache for up to five minutes. Recompute while this
  // page is visible so feature totals reflect navigation without requiring a
  // manual browser refresh. Hidden tabs pause the interval and refresh once
  // when they become visible again.
  useEffect(() => {
    const refreshVisibleUsage = () => {
      if (document.visibilityState !== "visible" || refreshInFlightRef.current) return;
      bustNextRef.current = true;
      setRefreshKey((k) => k + 1);
    };
    const onVisibilityChange = () => {
      if (document.visibilityState === "visible") refreshVisibleUsage();
    };
    const timer = window.setInterval(refreshVisibleUsage, USAGE_AUTO_REFRESH_MS);
    document.addEventListener("visibilitychange", onVisibilityChange);
    return () => {
      window.clearInterval(timer);
      document.removeEventListener("visibilitychange", onVisibilityChange);
    };
  }, []);

  useEffect(() => {
    let alive = true;
    const bust = bustNextRef.current;
    bustNextRef.current = false;
    refreshInFlightRef.current = true;
    const requestId = ++refreshRequestIdRef.current;
    setRefreshing(true);
    setAllocEdits(null); // clear stale edit log while reloading
    const opts = (dateStart || dateEnd)
      ? { start: dateStart || undefined, end: dateEnd || undefined }
      : undefined;
    // Instant paint — seed from the in-session cache (memory-only; see
    // usageAnalyticsCache.ts) while the fetch revalidates in the background.
    // The "Refreshing…" pill stays on and the "Data as of" label discloses
    // the seed's age, so nothing stale masquerades as fresh. An explicit
    // Refresh skips the seed: the user asked for a real reload.
    const seed = bust ? null : readUsageSeed(dateStart, dateEnd);
    if (seed) setPayload(seed);
    const scopeAtStart = currentUsageScope();
    const selectionAtStart = `${scopeAtStart}|${dateStart}|${dateEnd}`;
    // Invalidate deferred evidence as soon as this summary generation starts,
    // not only when it settles. A detail request begun before Refresh may
    // still resolve after the refreshed summary does.
    const generationAtStart = ++analyticsGenerationRef.current;
    setSettledSummaryGeneration(null);
    // Phase 1 — load the main payload first so the page renders immediately.
    // Phase 2 — load the alloc edit log lazily in the background after the
    //            main render, so it never blocks the page from appearing.
    getUsageAnalytics(bust ? { ...(opts ?? {}), bust: true } : opts).then((p) => {
      if (!alive) return;
      // Identity guard: a response authorized under the OLD token must never
      // paint after a login/tenant switch — the authChanged effect below
      // clears state and refetches under the new identity instead.
      if (
        currentUsageScope() !== scopeAtStart ||
        activeSelectionRef.current !== selectionAtStart ||
        analyticsGenerationRef.current !== generationAtStart
      ) return;
      if (p) {
        setPayload(p);
        // A new summary must not be paired with an old drill payload after an
        // explicit refresh or selected-window change.
        detailKeysRef.current.clear();
        writeUsageSeed(dateStart, dateEnd, p, scopeAtStart); // no-op for failure/off shapes
        // Only a successfully returned summary unlocks a drawer detail query.
        // This orders `details=1` after the summary's ?bust=1 cache invalidation.
        setSettledSummaryGeneration(generationAtStart);
      } else if (!seed) {
        setPayload(null); // failed with nothing on screen → honest error state
      } // else: keep the seeded (real, previously-loaded) data on a failed
        // background refresh — the "Data as of" label still shows its age.
      setRefreshing(false);
      // Fire the edit-log fetch in the background after the main payload is set.
      getUsageAllocEdits(opts).then((edits) => {
        if (alive && currentUsageScope() === scopeAtStart && activeSelectionRef.current === selectionAtStart) setAllocEdits(edits);
      });
    }).finally(() => {
      if (refreshRequestIdRef.current === requestId) refreshInFlightRef.current = false;
    });
    return () => { alive = false; };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [refreshKey]); // dateStart/dateEnd are read here but intentionally not deps:
                    // presets batch them with refreshKey; custom uses the debounced effect above.

  // Drill evidence is intentionally not part of the initial usage payload.
  // Fetch it only after someone opens a drawer, then rebuild the matching
  // usage card in place. The summary on screen remains accurate while this
  // optional, potentially larger request is in flight.
  useEffect(() => {
    if (!drawer || !payload || !("available" in payload) || payload.available !== true) {
      setDrawerLoading(false);
      return;
    }
    const scope = currentUsageScope();
    const key = `${scope}|${dateStart}|${dateEnd}`;
    const generation = analyticsGenerationRef.current;
    // A visible stale summary is useful while Refresh runs, but it must not
    // launch a fresh-generation detail call before that summary has completed
    // its bust/recompute. The payload update above re-runs this effect once
    // the matching generation has settled.
    if (settledSummaryGeneration !== generation) {
      setDrawerLoading(true);
      return;
    }
    const detailKey = `${key}|${generation}`;
    if (detailKeysRef.current.has(detailKey)) {
      setDrawerLoading(false);
      return;
    }
    if (detailInflightRef.current.has(detailKey)) {
      setDrawerLoading(true);
      return;
    }

    detailInflightRef.current.add(detailKey);
    setDrawerLoading(true);
    const opts = (dateStart || dateEnd)
      ? { start: dateStart || undefined, end: dateEnd || undefined, details: true }
      : { details: true };
    void getUsageAnalytics(opts).then((detailPayload) => {
      detailInflightRef.current.delete(detailKey);
      if (
        !detailPayload ||
        currentUsageScope() !== scope ||
        activeSelectionRef.current !== key ||
        analyticsGenerationRef.current !== generation
      ) {
        if (activeSelectionRef.current === key && analyticsGenerationRef.current === generation) setDrawerLoading(false);
        return;
      }
      detailKeysRef.current.add(detailKey);
      if (detailKeysRef.current.size > 40) {
        const oldest = detailKeysRef.current.values().next().value;
        if (oldest) detailKeysRef.current.delete(oldest);
      }
      setPayload((currentPayload) => {
        if (!currentPayload || !("available" in currentPayload) || currentPayload.available !== true) return currentPayload;
        return mergeUsageEvidence(currentPayload, detailPayload);
      });
      setDrawer((openCard) => {
        if (!openCard) return openCard;
        const merged = payload && "available" in payload && payload.available === true
          ? mergeUsageEvidence(payload, detailPayload)
          : detailPayload;
        const refreshed = buildUsageView(merged, tab);
        const candidates = [
          ...Object.values(refreshed.agg?.cards ?? {}),
          refreshed.outcomes?.card,
          refreshed.outcomes?.allocCard,
          refreshed.outcomes?.breadthCard,
          refreshed.outcomes?.importCard,
        ].filter((card): card is CardModel => Boolean(card));
        return candidates.find((card) => card.title === openCard.title) ?? openCard;
      });
      if (activeSelectionRef.current === key && analyticsGenerationRef.current === generation) setDrawerLoading(false);
    }).catch(() => {
      if (activeSelectionRef.current === key && analyticsGenerationRef.current === generation) setDrawerLoading(false);
    });
  }, [drawer, payload, dateStart, dateEnd, tab, settledSummaryGeneration]);

  const v: UsageView | null = payload === undefined ? null : buildUsageView(payload, tab);
  const a = v?.agg ?? null;

  // Per-tenant data for multi-line chart and stat strip sub-labels.
  // Filtered to the active tab (single tenant or all).
  const activeTenants = (payload && "tenants" in payload ? payload.tenants : [])
    .filter((t) => tab === ALL_TAB || t.tenant === tab);

  // Build the data series for the multi-tenant weekly line chart.
  const tenantSeries = activeTenants.map((t, i) => ({
    key: t.tenant, label: t.tenant, color: TENANT_COLORS[i % TENANT_COLORS.length],
  }));
  const weeklyChartData = (a?.weekly ?? []).map((w) => {
    const row: Record<string, unknown> = { label: w.label };
    for (const t of activeTenants) {
      const wk = t.weekly.find((x) => x.week === w.week);
      row[t.tenant] = wk?.activity ?? 0;
    }
    return row;
  });

  /** Format an ISO timestamp to a readable "Aug 17 · 1:12 PM" label. */
  const fmtAllocAt = (iso: string): string => {
    try {
      const d = new Date(iso);
      return d.toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
    } catch { return iso.slice(0, 16).replace("T", " "); }
  };

  /**
   * Build a sub-card showing per-edit events. Returns null when no data is available.
   * This card is drilled into from the weekly allocCard via the _subCard mechanism.
   */
  /** Format an hour delta as "+8 h", "40 h → 48 h", or "—" when not available. */
  const fmtHourChange = (r: AllocEditRow): string => {
    if (r.hoursBefore == null || r.hoursAfter == null) return "—";
    const delta = Math.round((r.hoursAfter - r.hoursBefore) * 10) / 10;
    const sign  = delta > 0 ? "+" : "";
    if (r.hoursBefore === r.hoursAfter) return `${r.hoursAfter} h (no change)`;
    return `${r.hoursBefore} h → ${r.hoursAfter} h (${sign}${delta} h)`;
  };

  const buildAllocEditLogCard = (edits: { rows: AllocEditRow[]; total: number } | null): CardModel | null => {
    if (!edits) return null;
    const hasHourData = edits.rows.some(r => r.hoursBefore != null || r.hoursAfter != null);
    return {
      id: "usage" as import("@/lib/analyticsCenter").SectionId,
      title: "Allocation Edit Log",
      takeaway: `Individual allocation save events — who edited which project and when. ${edits.total} event${edits.total !== 1 ? "s" : ""} recorded.${hasHourData ? " Hour totals show the before/after for each save." : ""}`,
      stats: [
        { label: "Events", value: String(edits.total) },
      ],
      columns: [
        { key: "time",    label: "When",          width: 18 },
        { key: "user",    label: "User",           width: 18 },
        { key: "project", label: "Project",        width: 32 },
        { key: "change",  label: "Hours changed",  align: "right" as const, width: 22 },
        { key: "cells",   label: "Cells saved",    align: "right" as const, kind: "int" as const, width: 10 },
      ],
      rows: edits.rows.map(r => ({
        time:    fmtAllocAt(r.at),
        user:    r.username,
        project: r.projectTicketId
          ? `${r.projectTicketId}${r.projectTitle ? ` · ${r.projectTitle}` : ""}`
          : (r.projectId || "—"),
        change:  fmtHourChange(r),
        cells:   r.cellsSaved,
        // Let DataDrawer generate a project link when a ticket ID is present.
        _ticket: r.projectTicketId ?? undefined,
      })),
    };
  };

  /** Return the ISO Monday (YYYY-MM-DD) for any timestamp string. */
  const weekStartOf = (iso: string): string => {
    const d = new Date(iso);
    const dow = (d.getUTCDay() + 6) % 7; // Mon=0 … Sun=6
    const ms  = d.getTime() - dow * 86_400_000;
    return new Date(ms).toISOString().slice(0, 10);
  };

  /**
   * Build a per-week sub-card showing only the edit events that fell in that week.
   * Used as _subCard on each week row in the allocCard so the user can drill from
   * "Aug 17 · 1 edit" into "who edited what on that specific week".
   */
  const buildWeekSubCard = (weekIso: string, weekLabel: string, weekEdits: AllocEditRow[]): CardModel => ({
    id: "usage" as import("@/lib/analyticsCenter").SectionId,
    title: `Schedule Edits — week of ${weekLabel}`,
    takeaway: `${weekEdits.length} save event${weekEdits.length !== 1 ? "s" : ""} recorded during this week. Each row is one save — who changed hours for which project and at what time.`,
    stats: [
      { label: "Events this week", value: String(weekEdits.length) },
      { label: "People who saved", value: String(new Set(weekEdits.map(r => r.username)).size) },
    ],
    columns: [
      { key: "time",    label: "When",          width: 18 },
      { key: "user",    label: "Who saved",      width: 20 },
      { key: "project", label: "Which project",  width: 30 },
      { key: "change",  label: "Hours changed",  align: "right" as const, width: 22 },
      { key: "cells",   label: "Cells saved",    align: "right" as const, kind: "int" as const, width: 10 },
    ],
    rows: weekEdits.map(r => ({
      time:    fmtAllocAt(r.at),
      user:    r.username,
      project: r.projectTicketId
        ? `${r.projectTicketId}${r.projectTitle ? ` · ${r.projectTitle}` : ""}`
        : (r.projectId || "—"),
      change:  fmtHourChange(r),
      cells:   r.cellsSaved,
      _ticket: r.projectTicketId ?? undefined,
    })),
  });

  // Patch allocCard:
  //  • Prepend a "📋 Edit Log" row that drills into ALL events across all weeks.
  //  • Inject _subCard on each week row that has ≥1 recorded event so the user
  //    can click any active week and see exactly who saved what that week.
  const patchAllocCard = (base: CardModel | undefined, edits: { rows: AllocEditRow[]; total: number } | null): CardModel | undefined => {
    if (!base) return base;
    const logCard = buildAllocEditLogCard(edits);
    if (!logCard) return base;

    // Group events by their Mon-week ISO string.
    const byWeek = new Map<string, AllocEditRow[]>();
    for (const r of edits!.rows) {
      const wk = weekStartOf(r.at);
      if (!byWeek.has(wk)) byWeek.set(wk, []);
      byWeek.get(wk)!.push(r);
    }

    // Patch each existing week row: if events exist for that week, attach a sub-card.
    const patchedRows = base.rows.map(row => {
      const wkIso = row._weekStart as string | undefined;
      if (!wkIso) return row;
      const weekEdits = byWeek.get(wkIso);
      if (!weekEdits || weekEdits.length === 0) return row;
      return {
        ...row,
        _subCard: buildWeekSubCard(wkIso, String(row.week), weekEdits),
      };
    });

    // "📋 Edit Log" summary row at the top — drills into all events combined.
    const drillRow = {
      week:     "📋 All edits",
      edits:    edits!.total,
      users:    "—",
      rate:     "→ view",
      _subCard: logCard,
    };
    return { ...base, rows: [drillRow, ...patchedRows] };
  };

  return (
    <MissionWorld>
      <SectionHeader
        title="Usage Analytics"
        m={m}
        error={null}
        right={
          <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: 8 }}>
            {/* period pills */}
            <div style={{ display: "inline-flex", background: isDark ? "rgba(255,255,255,0.08)" : "rgba(0,0,0,0.06)", borderRadius: 999, padding: 3, gap: 1 }}>
              {([ ["all","All time"], ["4w","4 wks"], ["3m","3 mo"], ["6m","6 mo"], ["ytd","This year"], ["custom","Custom"] ] as const).map(([key, label]) => {
                const active = period === key;
                return (
                  <button key={key} onClick={() => applyPeriod(key)} style={{
                    fontFamily: MONO, fontSize: 10, letterSpacing: "0.08em", textTransform: "uppercase",
                    border: 0,
                    background: active ? MC.green : "transparent",
                    color: active ? "#FFFFFF" : MC.muted,
                    padding: "5px 11px", borderRadius: 999, cursor: "pointer",
                    fontWeight: active ? 700 : 500,
                    transition: "background 0.15s, color 0.15s", whiteSpace: "nowrap",
                    boxShadow: active ? `0 2px 8px ${MC.green}55` : "none",
                  }}>{label}</button>
                );
              })}
            </div>
            {/* date range label */}
            {v?.windowLabel && (
              <span style={{ fontFamily: MONO, fontSize: 10.5, color: MC.muted, letterSpacing: "0.04em" }}>
                {v.windowLabel.split("·")[0].trim()}
              </span>
            )}
            {/* custom date pickers */}
            {period === "custom" && (
              <div style={{ display: "flex", alignItems: "center", gap: 5, background: MC.panel, border: `1px solid ${MC.border}`, borderRadius: 3, padding: "3px 8px" }}>
                <span style={{ fontFamily: MONO, fontSize: 9.5, color: MC.faint, fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.06em" }}>From</span>
                <input type="date" value={dateStart} max={dateEnd || today} onChange={(e) => setDateStart(e.target.value)} style={{
                  padding: "2px 5px", borderRadius: 2, fontSize: 10,
                  background: "rgba(255,255,255,0.08)", border: "1px solid rgba(255,255,255,0.2)",
                  color: MC.text, outline: "none", cursor: "pointer",
                }} />
                <span style={{ fontFamily: MONO, fontSize: 9.5, color: MC.faint, fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.06em" }}>To</span>
                <input type="date" value={dateEnd} min={dateStart || undefined} max={today} onChange={(e) => setDateEnd(e.target.value)} style={{
                  padding: "2px 5px", borderRadius: 2, fontSize: 10,
                  background: "rgba(255,255,255,0.08)", border: "1px solid rgba(255,255,255,0.2)",
                  color: MC.text, outline: "none", cursor: "pointer",
                }} />
              </div>
            )}
            {/* Refresh */}
            <button
              onClick={() => { bustNextRef.current = true; setRefreshKey((k) => k + 1); }}
              disabled={refreshing}
              title="Refresh now. This page also auto-refreshes every 30 seconds while visible."
              aria-label="Refresh usage analytics now"
              style={{
                padding: "4px 10px", borderRadius: 999, fontSize: 10, fontWeight: 700,
                background: refreshing ? "rgba(148,163,184,0.1)" : "rgba(56,189,248,0.12)",
                border: `1px solid ${refreshing ? "rgba(148,163,184,0.25)" : "rgba(56,189,248,0.4)"}`,
                color: refreshing ? "#94A3B8" : "#38BDF8",
                cursor: refreshing ? "default" : "pointer",
                transition: "opacity 0.15s", whiteSpace: "nowrap",
              }}
            >
              {refreshing ? "Refreshing…" : "↻ Refresh"}
            </button>
          </div>
        }
      />

      {payload === undefined && <LoadingBlock text="Loading usage telemetry…" />}

      {v && v.state === "error" && <ErrorBlock text={v.reason ?? "Usage data didn't load."} />}
      {v && (v.state === "off" || v.state === "restricted") && (
        <Glass style={{ marginTop: 16, padding: "48px 40px", textAlign: "center" }}>
          <div style={{ fontSize: 14, fontWeight: 700 }}>
            {v.state === "off" ? "Usage tracking is switched off" : "Restricted"}
          </div>
          <p style={{ margin: "10px auto 0", maxWidth: 480, fontSize: 12.5, lineHeight: 1.6, color: MC.muted }}>{v.reason}</p>
        </Glass>
      )}

      {v && v.state === "collecting" && a && (
        <>
          <Glass style={{ marginTop: 16, padding: "36px 40px", textAlign: "center" }}>
            <div style={{ fontSize: 10, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.18em", color: MC.greenInk }}>
              Usage tracking is live
            </div>
            <div style={{ marginTop: 8, fontSize: 24, fontWeight: 800 }}>
              Collecting since {v.collectingSinceLabel ?? "just now"}
            </div>
            <p style={{ margin: "10px auto 0", maxWidth: 520, fontSize: 12.5, lineHeight: 1.6, color: MC.muted }}>
              No activity has been recorded yet, so this page shows no percentages — a "0%" here would be
              a made-up number, since people may have been active before recording started. Numbers appear
              as soon as anyone signs in or opens a page.
            </p>
          </Glass>
          <div style={{ marginTop: 16, display: "grid", gap: 12, gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))" }}>
            <StatCard label="Enabled users being observed" value={int(a.enabledUsers)} card={a.cards.adoption} onDrill={setDrawer} />
            <RoleBreakdownCard roleCounts={a.roleCounts} onDrill={setDrawer} />
            <StatCard label="Activity recorded so far" value="0" card={null} onDrill={setDrawer} />
          </div>
        </>
      )}

      {v && v.state === "ready" && a && (
        <>
          {/* window + recording disclosure */}
          <div style={{ marginTop: 12, display: "flex", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: 10 }}>
            {v.tabs.length > 0 ? (
              <div style={{ display: "inline-flex", alignItems: "center", gap: 2, padding: 3, borderRadius: 10, background: MC.panel, border: `1px solid ${MC.border}` }}>
                {v.tabs.map((t) => (
                  <button
                    key={t}
                    onClick={() => setTab(t)}
                    style={{
                      padding: "6px 14px", borderRadius: 8, fontSize: 11.5, cursor: "pointer", border: "none",
                      ...(t === v.tab
                        ? { background: "linear-gradient(140deg, #8EC94A, #6BA539)", color: "#16240a", fontWeight: 700 }
                        : { background: "transparent", color: MC.muted, fontWeight: 500 }),
                    }}
                  >
                    {t}
                  </button>
                ))}
              </div>
            ) : <span />}
            {/* recording-since label removed — the early-recording banner below covers this */}
          </div>
          {/* Early-recording notice — shown when all presets contain the same data because
              recording started less than 4 weeks ago. Warn users so they aren't confused. */}
          {v.weeks <= 4 && v.collectingSinceLabel && (
            <div style={{
              display: "flex", alignItems: "flex-start", gap: 8,
              margin: "10px 0 0", padding: "9px 14px", borderRadius: 8,
              background: isDark ? "rgba(239,68,68,0.10)" : "rgba(220,38,38,0.88)",
              border: isDark ? "1px solid rgba(239,68,68,0.35)" : "none",
            }}>
              <span style={{ fontSize: 15, lineHeight: 1, marginTop: 1, flexShrink: 0 }}>⚠️</span>
              <span style={{ fontSize: 11.5, color: isDark ? "#FCA5A5" : "#FFFFFF", lineHeight: 1.55 }}>
                <b style={{ color: isDark ? "#F87171" : "#FFFFFF" }}>All presets show identical numbers right now.</b>
                {" "}Recording started {v.collectingSinceLabel} — every preset window (4 wks, 3 mo, All time…)
                contains the same {v.weeks === 1 ? "1 week" : `${v.weeks} weeks`} of data.
                The numbers will naturally diverge as more weeks accumulate.
                To see sub-period differences today, use <b style={{ color: isDark ? "#F87171" : "#FFFFFF" }}>Custom</b> and pick a narrower date range.
              </span>
            </div>
          )}

          {/* ── Stat strip ── all key metrics in one row with per-tenant breakdown */}
          {(() => {
            const stripTiles = [
              {
                label: "Enabled Users",
                value: int(a.enabledUsers),
                card: a.cards.adoption,
                sub: activeTenants.length > 1 ? activeTenants.map((t, i) => (
                  <span key={t.tenant} style={{ display: "inline-flex", alignItems: "center", gap: 3 }}>
                    <span style={{ width: 6, height: 6, borderRadius: 99, background: TENANT_COLORS[i % TENANT_COLORS.length], display: "inline-block" }} />
                    <span>{t.tenant} {int(t.enabledUsers)}</span>
                  </span>
                )) : null,
              },
              {
                label: "Active Users",
                value: int(a.activeUsers),
                card: a.cards.activity,
                sub: activeTenants.length > 1 ? activeTenants.map((t, i) => (
                  <span key={t.tenant} style={{ display: "inline-flex", alignItems: "center", gap: 3 }}>
                    <span style={{ width: 6, height: 6, borderRadius: 99, background: TENANT_COLORS[i % TENANT_COLORS.length], display: "inline-block" }} />
                    <span>{t.tenant} {int(t.activeUsers)}</span>
                  </span>
                )) : null,
              },
              {
                label: "Observed Adoption",
                value: a.adoptionPct != null ? `${a.adoptionPct}%` : "—",
                card: a.cards.adoption,
                sub: activeTenants.length > 1 ? activeTenants.map((t, i) => {
                  const pct = t.enabledUsers > 0 ? Math.round((t.activeUsers / t.enabledUsers) * 1000) / 10 : null;
                  return (
                    <span key={t.tenant} style={{ display: "inline-flex", alignItems: "center", gap: 3 }}>
                      <span style={{ width: 6, height: 6, borderRadius: 99, background: TENANT_COLORS[i % TENANT_COLORS.length], display: "inline-block" }} />
                      <span>{t.tenant} {pct != null ? `${pct}%` : "—"}</span>
                    </span>
                  );
                }) : null,
              },
              {
                label: "Human Transactions",
                value: int(a.humanTx),
                card: a.cards.humanTxUsers,
                sub: activeTenants.length > 1 ? activeTenants.map((t, i) => (
                  <span key={t.tenant} style={{ display: "inline-flex", alignItems: "center", gap: 3 }}>
                    <span style={{ width: 6, height: 6, borderRadius: 99, background: TENANT_COLORS[i % TENANT_COLORS.length], display: "inline-block" }} />
                    <span>{t.tenant} {int(t.humanTx)}</span>
                  </span>
                )) : null,
              },
              {
                label: "Page Visits",
                value: int(a.pageVisits),
                card: a.cards.pageVisitsUsers,
                sub: activeTenants.length > 1 ? activeTenants.map((t, i) => (
                  <span key={t.tenant} style={{ display: "inline-flex", alignItems: "center", gap: 3 }}>
                    <span style={{ width: 6, height: 6, borderRadius: 99, background: TENANT_COLORS[i % TENANT_COLORS.length], display: "inline-block" }} />
                    <span>{t.tenant} {int(t.pageVisits)}</span>
                  </span>
                )) : null,
              },
              ...(m ? [{
                label: "Total Projects",
                value: int(m.projects.length),
                card: {
                  id: "executive" as SectionId,
                  title: "All Projects",
                  takeaway: "Every active project in the portfolio.",
                  stats: [{ label: "Total", value: int(m.projects.length) }],
                  columns: PROJECT_COLS,
                  rows: projRows(m.projects),
                  explanation: {
                    meaning: "All projects loaded for this tenant, sorted by contract value descending.",
                    calculation: "One row per project record.",
                    period: "Current snapshot",
                    measure: "actual" as const,
                    source: "Project records",
                  },
                } as CardModel,
                sub: null,
              }] : []),
            ];
            return (
              <div style={{ marginTop: 12, display: "flex", borderRadius: 14, overflow: "hidden", border: `1px solid ${MC.border}` }}>
                {stripTiles.map((tile, idx) => (
                  <div
                    key={tile.label}
                    role={tile.card ? "button" : undefined}
                    tabIndex={tile.card ? 0 : undefined}
                    onClick={() => tile.card && setDrawer(tile.card)}
                    onKeyDown={(e) => { if (tile.card && (e.key === "Enter" || e.key === " ")) { e.preventDefault(); setDrawer(tile.card); } }}
                    style={{
                      flex: 1,
                      padding: "14px 16px",
                      background: MC.bg,
                      borderLeft: idx === 0 ? "none" : `1px solid ${MC.border}`,
                      cursor: tile.card ? "zoom-in" : "default",
                      minWidth: 0,
                    }}
                  >
                    <div style={{ fontSize: 8.5, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.15em", color: MC.faint, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                      {tile.label}
                    </div>
                    <div style={{ fontSize: 26, fontWeight: 800, fontVariantNumeric: "tabular-nums", marginTop: 4, lineHeight: 1.1 }}>
                      {tile.value}
                    </div>
                    {tile.sub && (
                      <div style={{ marginTop: 5, display: "flex", flexWrap: "wrap", gap: "3px 8px", fontSize: 9.5, color: MC.faint }}>
                        {tile.sub}
                      </div>
                    )}
                  </div>
                ))}
              </div>
            );
          })()}

{/* ── Adoption across the organization — dual-axis combo chart.
           * Grouped by the SHARED selected org dimension (Division / BU /
           * Department are separate canonical fields). A dimension without
           * genuine data shows an honest note — never another dimension's
           * groups relabeled. ── */}
          {v.scope === "tenant" && m && (() => {
            const staffList = dedupeUsageOrgStaff(m.staff);
            // Build active-name set from the FULL uncapped activeUserNames list
            // the server sends (period-scoped). Positive-set matching avoids the
            // ROW_CAP-truncation bug: neverActiveRows is capped at 300, so with
            // 491 never-active users the remaining 191 appear "active" and the
            // org percentages never change with the selected period.
            // Fall back to the never-active rows for tenants on older server
            // builds that don't include activeUserNames yet.
            const activeNamesArr = v.agg
              ? (payload as any).tenants?.flatMap((t: any) => t.activeUserNames ?? []) ?? []
              : [];
            const activeNames: Set<string> = activeNamesArr.length > 0
              ? new Set<string>(activeNamesArr.map((n: string) => n.toLowerCase().trim()))
              : (() => {
                  // Legacy fallback: invert the neverActive list (imprecise due to cap).
                  const allNames = new Set(staffList.map(s => s.name.toLowerCase().trim()));
                  const neverSet = new Set(a.cards.neverActive.rows.map((r) => String(r["user"] ?? "").toLowerCase().trim()));
                  return new Set([...allNames].filter(n => !neverSet.has(n)));
                })();
            const orgRes = usageAdoptionByOrg(staffList, activeNames, orgDim);
            /* Hide the whole card only when NO dimension has signal. */
            const anyDim = orgRes
              || usageAdoptionByOrg(staffList, activeNames, "division")
              || usageAdoptionByOrg(staffList, activeNames, "businessUnit")
              || usageAdoptionByOrg(staffList, activeNames, "department");
            if (!anyDim) return null;
            const dimLabel = orgDimLabel(orgDim);
            const chartData = (orgRes?.rows ?? []).slice(0, 10).map((r) => ({
              // Keep full name for tooltip; only clip truly extreme strings (>22 chars)
              // so labels remain readable when rotated at -35°.
              name: r.group.length > 22 ? r.group.slice(0, 21) + "…" : r.group,
              fullName: r.group,
              enabled: r.total, active: r.active, rate: r.adoptionPct ?? 0,
            }));
            const maxEnabled = Math.max(1, ...chartData.map((d) => d.enabled));
            const yMax = Math.ceil(maxEnabled * 1.2 / 50) * 50;
            const zeroed = (orgRes?.rows ?? []).filter((d) => d.total === 0).length;
            const groupCount = orgRes?.rows.length ?? 0;
            const drillCard = orgRes?.card ?? null;
             const PANEL_TEXT = isDark ? "#FFFFFF" : "#0D1512";
             const PANEL_MUTED = isDark ? "rgba(255,255,255,0.65)" : "#5A6B60";
             const PANEL_FAINT = isDark ? "rgba(255,255,255,0.50)" : "#748276";
            const STEEL  = "#2B4A6A";
            const ORG_G  = "#6BA539";
            const LINE_C = "#D4FF40";
             const RATE_TEXT = isDark ? LINE_C : "#4D7F2A";
             const BDR2   = isDark ? "rgba(255,255,255,0.14)" : "#CBD2C7";
             const tickSt = { fontSize: 10, fill: isDark ? "rgba(255,255,255,0.42)" : "#748276" } as const;
             const cardBg = isDark
               ? "linear-gradient(160deg, #2E4557 0%, #253746 100%)"
               : "#F2F5F0";
             const cardSh = isDark
               ? "0 24px 60px rgba(0,0,0,0.45), inset 0 1px 0 rgba(255,255,255,0.06)"
               : "0 2px 16px rgba(15,25,35,0.07)";
            return (
              <div style={{ marginTop: 16 }}>
                <div style={{ borderRadius: 18, background: cardBg, border: `1px solid ${BDR2}`, boxShadow: cardSh, overflow: "hidden" }}>
                  {/* Header */}
                  <div style={{ padding: "22px 28px 14px" }}>
                    <div style={{ fontSize: 18, fontWeight: 800, color: PANEL_TEXT, letterSpacing: "-0.02em" }}>
Adoption across the organization
                    </div>
                    <div style={{ fontSize: 11.5, color: PANEL_MUTED, marginTop: 5, lineHeight: 1.5, maxWidth: 580 }}>
                      Each bar shows how many people are in that group. The line shows what share of them have actively used RM ONE —
                      a large bar with a low line means most people in that group haven't logged in yet.
                    </div>
                    {/* Shared org-dimension chips (Division / BU / Department) */}
                    <div style={{ display: "flex", alignItems: "center", gap: 10, marginTop: 16 }}>
                      <OrgDimPicker value={orgDim} onChange={setOrgDim} dark={isDark} />
                      {orgRes && (
                        <span style={{
                          fontSize: 10, fontWeight: 700, padding: "2px 8px", borderRadius: 99,
                          background: isDark ? "rgba(107,165,57,0.15)" : "rgba(107,165,57,0.1)",
                            color: isDark ? "#A8D672" : "#4D7F2A",
                        }}>{groupCount} groups</span>
                      )}
                    </div>
                  </div>
                  {/* Honest absence: the selected dimension has no real groups —
                   * say so instead of silently regrouping by another dimension. */}
                  {!orgRes && (
                    <div style={{ padding: "26px 28px 30px", fontSize: 12, color: PANEL_MUTED, lineHeight: 1.6 }}>
                      No {dimLabel.toLowerCase()} data on the staff roster yet — people either have no
                      {" "}{dimLabel.toLowerCase()} assigned or they all share one value, so there's nothing
                      meaningful to compare. Pick another dimension above, or add {dimLabel.toLowerCase()}s
                      to staff records to unlock this view.
                    </div>
                  )}
                  {orgRes && (<>
                  {/* Axis labels */}
                  <div style={{ display: "flex", justifyContent: "space-between", padding: "0 44px 0 64px" }}>
                    <span style={{ fontSize: 9, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.14em", color: PANEL_FAINT }}>STAFF</span>
                    <span style={{ fontSize: 9, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.14em", color: PANEL_FAINT }}>RATE</span>
                  </div>
                  {/* Chart */}
                  <div style={{ padding: "0 16px 4px" }}>
                    <RC width="100%" height={320}>
                      <ComposedChart
                      data={chartData}
                      margin={{ top: 30, right: 36, bottom: 0, left: 0 }}
                      barCategoryGap="30%"
                      style={{ cursor: "pointer" }}
                      onClick={(chartEvt: any) => {
                        const payload = chartEvt?.activePayload?.[0]?.payload;
                        if (!payload) return;
                        const groupName: string = payload.fullName ?? payload.name;
                        if (!groupName) return;
                        /* filter the full staff roster down to this group */
                        const dimKey = orgDim === "businessUnit" ? "businessUnit"
                          : orgDim === "department" ? "department"
                          : "division";
                        const groupStaff = (staffList as any[]).filter((s: any) => {
                          const val = ((s[dimKey] ?? "") as string).trim() || "Unassigned";
                          return val === groupName;
                        });
                        if (!groupStaff.length) return;
                        const activeCount = groupStaff.filter((s: any) =>
                          activeNames.has((s.name ?? "").toLowerCase().trim())
                        ).length;
                        const card: CardModel = {
                          id: "usage" as SectionId,
                          title: `${groupName} — Staff`,
                          takeaway: `All ${groupStaff.length} people in ${groupName}: ${activeCount} active, ${groupStaff.length - activeCount} never active in this window.`,
                          stats: [
                            { label: "Total staff", value: String(groupStaff.length) },
                            { label: "Active", value: String(activeCount) },
                            { label: "Never active", value: String(groupStaff.length - activeCount) },
                          ],
                          columns: [
                            ...STAFF_COLS,
                            { key: "_usage", label: "Usage", width: 14, align: "right" as const },
                          ],
                          rows: staffRows(groupStaff).map((row: any, i: number) => ({
                            ...row,
                            _usage: activeNames.has((groupStaff[i]?.name ?? "").toLowerCase().trim())
                              ? "✓ Active" : "Never active",
                          })),
                        };
                        setDrawer(card);
                      }}
                    >
                         <CartesianGrid strokeDasharray="3 3" stroke={isDark ? "rgba(255,255,255,0.06)" : "rgba(0,0,0,0.07)"} vertical={false} />
                         <XAxis
                           dataKey="name"
                           // eslint-disable-next-line @typescript-eslint/no-explicit-any
                           tick={{ fontSize: 10, fill: isDark ? "rgba(255,255,255,0.55)" : "#5A6B60", angle: -35, textAnchor: "end" } as any}
                           tickLine={false}
                           axisLine={{ stroke: isDark ? "rgba(255,255,255,0.1)" : "#CBD2C7" }}
                           height={72}
                           interval={0}
                         />
                        <YAxis yAxisId="staff" orientation="left" tick={tickSt} tickLine={false} axisLine={false}
                          domain={[0, yMax]} tickFormatter={(v: number) => v >= 1000 ? `${(v / 1000).toFixed(0)}k` : String(v)} width={42} />
                        <YAxis yAxisId="rate" orientation="right" tick={tickSt} tickLine={false} axisLine={false}
                          domain={[0, 100]} tickFormatter={(v: number) => `${v}%`} width={36} />
                        <RTooltip
                           contentStyle={{ background: isDark ? "#0F1E2C" : "#FFFFFF", border: `1px solid ${BDR2}`, borderRadius: 10, color: PANEL_TEXT, fontSize: 11, boxShadow: "0 14px 36px rgba(0,0,0,0.25)" }}
                           labelStyle={{ color: PANEL_TEXT, fontWeight: 700 }}
                           itemStyle={{ color: isDark ? "rgba(255,255,255,0.78)" : "#0D1512" }}
                          labelFormatter={(label: string) => {
                            const hit = chartData.find((d) => d.name === label);
                            return hit?.fullName ?? label;
                          }}
                          formatter={(value: number, name: string) =>
                            name === "rate" ? [`${value}%`, "Adoption rate"]
                            : name === "active" ? [value.toLocaleString(), "Active staff"]
                            : [value.toLocaleString(), "Enabled staff"]
                          }
                        />
                        <Bar yAxisId="staff" dataKey="enabled" barSize={22} radius={[4, 4, 0, 0]}>
                          {chartData.map((_, i) => <Cell key={i} fill={STEEL} />)}
                          <LabelList dataKey="enabled" content={(props: any) => {
                            const cx = Number(props.x) + Number(props.width) / 2;
                            const cy = Number(props.y);
                            if (!props.value || isNaN(cx) || isNaN(cy)) return null;
                             return <text x={cx} y={cy - 5} textAnchor="middle" fontSize={9} fontWeight={700} fill={isDark ? "rgba(255,255,255,0.6)" : "#0D1512"}>{Number(props.value).toLocaleString()}</text>;
                          }} />
                        </Bar>
                        <Bar yAxisId="staff" dataKey="active" barSize={22} radius={[4, 4, 0, 0]}>
                          {chartData.map((_, i) => <Cell key={i} fill={ORG_G} />)}
                        </Bar>
                        <Line yAxisId="rate" type="monotone" dataKey="rate"
                          stroke={LINE_C} strokeWidth={2.5}
                          dot={(p: any) => {
                            if (!p.value) return <g key={p.key} />;
                            return (
                              <g key={p.key}>
                                 <circle cx={p.cx} cy={p.cy} r={9} fill="#0B1623" stroke={LINE_C} strokeWidth={2}
                                   style={{ filter: `drop-shadow(0 0 6px ${LINE_C})` }} />
                                <circle cx={p.cx} cy={p.cy} r={3} fill={LINE_C} />
                              </g>
                            );
                          }}
                           activeDot={{ r: 7, fill: LINE_C, stroke: "#0B1623", strokeWidth: 2 }}
                           style={{ filter: `drop-shadow(0 0 5px ${LINE_C}55)` }}>
                          <LabelList dataKey="rate" content={(props: any) => {
                            const cx = Number(props.x), cy = Number(props.y);
                            if (!props.value || isNaN(cx) || isNaN(cy)) return null;
                             return <text x={cx} y={Math.max(14, cy - 28)} textAnchor="middle" fontSize={9} fontWeight={700} fill={RATE_TEXT}
                                style={{ filter: `drop-shadow(0 0 4px ${RATE_TEXT}55)` }}>{props.value}%</text>;
                          }} />
                        </Line>
                      </ComposedChart>
                    </RC>
                  </div>
                  {/* Legend */}
                  <div style={{ padding: "2px 28px 14px", display: "flex", alignItems: "center", gap: 20, flexWrap: "wrap" }}>
                    {[
                      { color: STEEL,  label: "Enabled staff", solid: true  },
                      { color: ORG_G,  label: "Active staff",  solid: true  },
                      { color: LINE_C, label: "Adoption rate", solid: false },
                    ].map(({ color, label, solid }) => (
                       <span key={label} style={{ display: "inline-flex", alignItems: "center", gap: 7, fontSize: 11, color: PANEL_MUTED }}>
                        {solid ? (
                          <span style={{ width: 12, height: 12, borderRadius: 3, background: color, flexShrink: 0 }} />
                        ) : (
                          <span style={{ position: "relative", width: 18, height: 18, display: "inline-flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
                            <span style={{ position: "absolute", width: 16, height: 2, background: color, borderRadius: 1 }} />
                             <span style={{ width: 9, height: 9, borderRadius: "50%", border: `2px solid ${color}`, background: "#0B1623", zIndex: 1 }} />
                          </span>
                        )}
                        {label}
                      </span>
                    ))}
                  </div>
                  {/* Footer */}
                  <div style={{ borderTop: `1px solid ${BDR2}`, padding: "13px 28px", display: "flex", alignItems: "center", gap: 12 }}>
                     <span style={{ flex: 1, fontSize: 11, color: PANEL_FAINT }}>
                      {zeroed > 0
                        ? `${zeroed} of ${groupCount} ${dimLabel.toLowerCase()} groups have no enabled staff and are not charted`
                        : `All ${groupCount} ${dimLabel.toLowerCase()} groups are charted`}
                    </span>
                    <button onClick={() => drillCard && setDrawer(drillCard)} style={{
                      padding: "7px 18px", borderRadius: 8, fontSize: 11, fontWeight: 600, cursor: "pointer",
                        background: "rgba(107,165,57,0.10)",
                        border: `1px solid ${BDR2}`, color: isDark ? "#A8D672" : "#4D7F2A",
                    }}>
                      View Data
                    </button>
                  </div>
                  </>)}
                </div>
              </div>
            );
          })()}

          {/* ── Two-column main: multi-tenant chart (left) + top features (right) */}
          <div style={{ marginTop: 16, display: "grid", gap: 16, gridTemplateColumns: "3fr 2fr" }}>
            {/* Weekly Activity Trend — multi-tenant lines */}
            <CardShell
              title="Weekly Activity Trend"
              takeaway={`Human activity by week — system and admin accounts excluded. ${tenantSeries.length > 1 ? "One line per tenant." : ""} Last week is partial.`}
              card={a.cards.weekly}
              onDrill={setDrawer}
            >
              <DrillZone card={a.cards.weekly} onDrill={setDrawer}>
                {tenantSeries.length > 1 ? (
                  a.weekly.length <= 4 ? (
                    /* sparse multi-tenant — grouped bars */
                    <RC width="100%" height={230}>
                      <ComposedChart data={weeklyChartData} margin={{ top: 20, right: 8, bottom: 4, left: 0 }} barCategoryGap="30%">
                        <CartesianGrid strokeDasharray="3 3" stroke={isDark ? "rgba(255,255,255,0.06)" : "rgba(0,0,0,0.07)"} vertical={false} />
                        <XAxis dataKey="label" tick={{ fontSize: 11, fill: MC.muted }} tickLine={false} axisLine={false} />
                        <YAxis tick={{ fontSize: 10, fill: MC.faint }} tickLine={false} axisLine={false} width={36}
                          tickFormatter={(v: number) => v >= 1000 ? `${(v / 1000).toFixed(0)}k` : String(v)} />
                        <RTooltip contentStyle={{ background: isDark ? "#0F1E2C" : "#FFF", border: `1px solid ${MC.border}`, borderRadius: 10, fontSize: 11, color: MC.text }} />
                        {tenantSeries.map((s) => (
                          <Bar key={s.key} dataKey={s.key} name={s.label} fill={s.color} radius={[5, 5, 0, 0]} barSize={28}>
                            <LabelList dataKey={s.key} position="top" style={{ fontSize: 9, fill: MC.faint, fontWeight: 700 }} />
                          </Bar>
                        ))}
                      </ComposedChart>
                    </RC>
                  ) : (
                    <MissionMultiLine data={weeklyChartData} xKey="label" series={tenantSeries} height={230} />
                  )
                ) : a.weekly.length <= 4 ? (
                  /* sparse single-tenant — clean bars instead of a diagonal line */
                  <RC width="100%" height={230}>
                    <ComposedChart data={a.weekly} margin={{ top: 24, right: 8, bottom: 4, left: 0 }} barCategoryGap="35%">
                      <defs>
                        <linearGradient id="wkBarGrad" x1="0" y1="0" x2="0" y2="1">
                          <stop offset="0%" stopColor="#8EC94A" stopOpacity={1} />
                          <stop offset="100%" stopColor="#6BA539" stopOpacity={0.7} />
                        </linearGradient>
                      </defs>
                      <CartesianGrid strokeDasharray="3 3" stroke={isDark ? "rgba(255,255,255,0.06)" : "rgba(0,0,0,0.07)"} vertical={false} />
                      <XAxis dataKey="label" tick={{ fontSize: 11, fill: MC.muted }} tickLine={false} axisLine={false} />
                      <YAxis tick={{ fontSize: 10, fill: MC.faint }} tickLine={false} axisLine={false} width={36}
                        tickFormatter={(v: number) => v >= 1000 ? `${(v / 1000).toFixed(0)}k` : String(v)} />
                      <RTooltip
                        contentStyle={{ background: isDark ? "#0F1E2C" : "#FFF", border: `1px solid ${MC.border}`, borderRadius: 10, fontSize: 11, color: MC.text }}
                        formatter={(v: number) => [int(v), "Activity"]}
                      />
                      <Bar dataKey="activity" fill="url(#wkBarGrad)" radius={[6, 6, 0, 0]} maxBarSize={80}>
                        <LabelList dataKey="activity" position="top"
                          content={(props: any) => {
                            const cx = Number(props.x) + Number(props.width) / 2;
                            const cy = Number(props.y);
                            if (!props.value || isNaN(cx) || isNaN(cy)) return null;
                            return <text x={cx} y={cy - 6} textAnchor="middle" fontSize={12} fontWeight={800} fill="#8EC94A">{int(Number(props.value))}</text>;
                          }}
                        />
                      </Bar>
                    </ComposedChart>
                  </RC>
                ) : (
                  <MissionArea data={a.weekly} xKey="label" yKey="activity" color="#8EC94A" height={230} />
                )}
              </DrillZone>
              {tenantSeries.length > 1 && (
                <ChartCaption items={tenantSeries} />
              )}
            </CardShell>

            {/* Most Used Features — ranked with gradient bars */}
            <CardShell title="Most Used Features" takeaway="Human page visits per module during the observation period." card={a.cards.features} onDrill={setDrawer}>
              <div style={{ display: "flex", flexDirection: "column", gap: 7 }}>
                {a.features.slice(0, 8).map((f, rank) => {
                  const maxVisits = Math.max(1, a.features[0]?.visits ?? 1);
                  const pct = Math.max(2, Math.round((f.visits / maxVisits) * 100));
                  const isTop = rank === 0;
                  const barGrad = rank === 0
                    ? "linear-gradient(90deg,#8EC94A,#A8D672)"
                    : rank <= 2
                    ? "linear-gradient(90deg,#6BA539,#8EC94A)"
                    : "linear-gradient(90deg,#4A7825,#6BA539)";
                  const tenantVisits = activeTenants.map((t) => ({
                    tenant: t.tenant,
                    visits: t.features.find((x) => x.name === f.name)?.visits ?? 0,
                  }));
                  return (
                    <div key={f.name} role="button" tabIndex={0} onClick={() => setDrawer(a.cards.features)}
                      onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); setDrawer(a.cards.features); } }}
                      style={{ cursor: "zoom-in", padding: "3px 0" }}
                    >
                      <div style={{ display: "flex", alignItems: "center", gap: 7, marginBottom: 4 }}>
                        <span style={{ fontSize: 9, fontWeight: 800, width: 14, textAlign: "right", flexShrink: 0, fontVariantNumeric: "tabular-nums", color: isTop ? "#8EC94A" : MC.faint }}>#{rank + 1}</span>
                        <span style={{ flex: 1, fontSize: 11.5, color: MC.text, fontWeight: isTop ? 700 : 500, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{f.name}</span>
                        <span style={{ fontSize: isTop ? 14 : 12, fontWeight: 800, fontVariantNumeric: "tabular-nums", color: isTop ? "#8EC94A" : MC.muted }}>{int(f.visits)}</span>
                      </div>
                      {activeTenants.length > 1 ? (
                        <div style={{ marginLeft: 21, display: "flex", flexDirection: "column", gap: 2 }}>
                          {tenantVisits.map((tv, i) => (
                            <div key={tv.tenant} style={{ display: "flex", alignItems: "center", gap: 5 }}>
                              <div style={{ flex: 1, height: 6, borderRadius: 4, background: MC.border, overflow: "hidden" }}>
                                <div style={{ height: "100%", borderRadius: 4, width: `${Math.max(2, Math.round((tv.visits / maxVisits) * 100))}%`, background: TENANT_COLORS[i % TENANT_COLORS.length] }} />
                              </div>
                              <span style={{ fontSize: 9, color: MC.faint, minWidth: 24, textAlign: "right", fontVariantNumeric: "tabular-nums" }}>{int(tv.visits)}</span>
                            </div>
                          ))}
                        </div>
                      ) : (
                        <div style={{ marginLeft: 21, height: 8, borderRadius: 4, background: MC.border, overflow: "hidden" }}>
                          <div style={{ height: "100%", borderRadius: 4, width: `${pct}%`, background: barGrad }} />
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            </CardShell>
          </div>

          {/* ── Secondary row: WAU + Login Frequency + Human vs System ── */}
          <div style={{ marginTop: 16, display: "grid", gap: 16, gridTemplateColumns: "repeat(auto-fit, minmax(280px, 1fr))" }}>
            <CardShell title="Weekly Active Users" takeaway="Unique humans with any recorded action, per week." card={a.cards.weekly} onDrill={setDrawer}>
              <div role="button" tabIndex={0} onClick={() => setDrawer(a.cards.weekly)}
                onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); setDrawer(a.cards.weekly); } }}
                style={{ cursor: "zoom-in" }}>
                {a.weekly.length > 0 ? (
                  <RC width="100%" height={155}>
                    <ComposedChart data={a.weekly.map(w => ({ label: w.label, wau: w.wau }))} margin={{ top: 22, right: 4, bottom: 0, left: -18 }} barCategoryGap="35%">
                      <defs>
                        <linearGradient id="wauBarGrad" x1="0" y1="0" x2="0" y2="1">
                          <stop offset="0%" stopColor="#6B99BB" stopOpacity={1} />
                          <stop offset="100%" stopColor="#4A7899" stopOpacity={0.55} />
                        </linearGradient>
                      </defs>
                      <CartesianGrid strokeDasharray="3 3" stroke={isDark ? "rgba(255,255,255,0.06)" : "rgba(0,0,0,0.07)"} vertical={false} />
                      <XAxis dataKey="label" tick={{ fontSize: 10, fill: MC.muted }} tickLine={false} axisLine={false} />
                      <YAxis tick={{ fontSize: 9, fill: MC.faint }} tickLine={false} axisLine={false} width={22} allowDecimals={false} />
                      <RTooltip contentStyle={{ background: isDark ? "#0F1E2C" : "#FFF", border: `1px solid ${MC.border}`, borderRadius: 8, fontSize: 11, color: MC.text }} formatter={(v: number) => [int(v), "Active users"]} />
                      <Bar dataKey="wau" fill="url(#wauBarGrad)" radius={[5, 5, 0, 0]} maxBarSize={72}>
                        <LabelList dataKey="wau" content={(props: any) => {
                          const cx = Number(props.x) + Number(props.width) / 2;
                          const cy = Number(props.y);
                          if (isNaN(cx) || isNaN(cy) || !props.value) return null;
                          return <text x={cx} y={cy - 5} textAnchor="middle" fontSize={12} fontWeight={800} fill="#6B99BB">{int(Number(props.value))}</text>;
                        }} />
                      </Bar>
                    </ComposedChart>
                  </RC>
                ) : (
                  <div style={{ textAlign: "center", padding: "28px 0", color: MC.faint, fontSize: 12 }}>No weekly data yet</div>
                )}
              </div>
            </CardShell>

            <CardShell
              title="Login Frequency"
              takeaway={`How consistently the ${int(a.activeUsers)} active users signed in; ${int(a.neverTotal)} enabled users showed no activity at all.`}
              card={a.cards.bands}
              onDrill={setDrawer}
            >
              {(() => {
                const total = a.bands.reduce((s, b) => s + b.users, 0);
                const BAND_COLORS = ["#8EC94A", "#6B99BB", "#F0A842", "#A78BFA", MC.muted];
                return (
                  <div role="button" tabIndex={0} onClick={() => setDrawer(a.cards.bands)}
                    onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); setDrawer(a.cards.bands); } }}
                    style={{ cursor: "zoom-in" }}>
                    {/* Stacked proportion pill */}
                    <div style={{ display: "flex", height: 12, borderRadius: 999, overflow: "hidden", marginBottom: 14, background: MC.border }}>
                      {a.bands.filter(b => b.users > 0).map((b, i) => (
                        <div key={b.band} style={{ width: `${total > 0 ? (b.users / total) * 100 : 0}%`, background: BAND_COLORS[i % BAND_COLORS.length], minWidth: 3 }} />
                      ))}
                    </div>
                    {/* Band rows */}
                    <div style={{ display: "flex", flexDirection: "column", gap: 9 }}>
                      {a.bands.map((b, i) => {
                        const pct = total > 0 ? Math.round((b.users / total) * 100) : 0;
                        return (
                          <div key={b.band}>
                            <div style={{ display: "flex", alignItems: "center", gap: 7, marginBottom: 4 }}>
                              <span style={{ width: 8, height: 8, borderRadius: "50%", background: BAND_COLORS[i % BAND_COLORS.length], flexShrink: 0 }} />
                              <span style={{ flex: 1, fontSize: 11, color: MC.muted, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{b.band}</span>
                              <b style={{ fontSize: 13, fontVariantNumeric: "tabular-nums", color: MC.text }}>{int(b.users)}</b>
                              <span style={{ fontSize: 10, color: MC.faint, width: 30, textAlign: "right" }}>{pct}%</span>
                            </div>
                            <div style={{ height: 5, borderRadius: 4, background: MC.border, overflow: "hidden" }}>
                              <div style={{ height: "100%", width: `${Math.max(b.users > 0 ? 2 : 0, pct)}%`, borderRadius: 4, background: BAND_COLORS[i % BAND_COLORS.length] }} />
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                );
              })()}
            </CardShell>

            <CardShell
              title="Human vs System"
              takeaway="System = import pipeline bulk writes and automated jobs — flagged at write time, never mixed into human counts."
              card={a.cards.humanSystem}
              onDrill={setDrawer}
            >
              <DrillZone card={a.cards.humanSystem} onDrill={setDrawer}>
                {(() => {
                  const total = a.humanEvents + a.systemEvents;
                  const humanPct = total > 0 ? Math.round((a.humanEvents / total) * 100) : 0;
                  const accentColor = humanPct >= 80 ? "#8EC94A" : humanPct >= 50 ? "#F0A842" : "#F87171";
                  return (
                    <div>
                      {/* Hero % display */}
                      <div style={{ display: "flex", alignItems: "flex-end", gap: 10, marginBottom: 12 }}>
                        <span style={{ fontSize: 44, fontWeight: 900, lineHeight: 1, color: accentColor, fontVariantNumeric: "tabular-nums", letterSpacing: "-0.03em" }}>{humanPct}%</span>
                        <span style={{ fontSize: 12, color: MC.muted, paddingBottom: 7, lineHeight: 1.4 }}>human<br/>activity</span>
                      </div>
                      {/* Split pill bar */}
                      <div style={{ display: "flex", height: 14, borderRadius: 999, overflow: "hidden", background: MC.border, marginBottom: 12 }}>
                        <div style={{ width: `${humanPct}%`, background: "#8EC94A", transition: "width 0.4s ease" }} />
                        <div style={{ flex: 1, background: "#A78BFA" }} />
                      </div>
                      {/* Two stat tiles */}
                      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8, marginBottom: 10 }}>
                        <div style={{ padding: "8px 12px", borderRadius: 10, background: "rgba(142,201,74,0.08)", border: "1px solid rgba(142,201,74,0.22)" }}>
                          <div style={{ fontSize: 9, fontWeight: 700, color: "#8EC94A", textTransform: "uppercase", letterSpacing: "0.1em", marginBottom: 3 }}>Human</div>
                          <div style={{ fontSize: 20, fontWeight: 800, fontVariantNumeric: "tabular-nums", color: "#8EC94A" }}>{int(a.humanEvents)}</div>
                        </div>
                        <div style={{ padding: "8px 12px", borderRadius: 10, background: "rgba(167,139,250,0.08)", border: "1px solid rgba(167,139,250,0.22)" }}>
                          <div style={{ fontSize: 9, fontWeight: 700, color: "#A78BFA", textTransform: "uppercase", letterSpacing: "0.1em", marginBottom: 3 }}>System</div>
                          <div style={{ fontSize: 20, fontWeight: 800, fontVariantNumeric: "tabular-nums", color: "#A78BFA" }}>{int(a.systemEvents)}</div>
                        </div>
                      </div>
                      {a.cards.humanSystem.rows.length > 1 && (
                        <div style={{ display: "grid", gap: 5 }}>
                          {a.cards.humanSystem.rows.map((r) => (
                            <div key={String(r["tenant"])} style={{ display: "flex", justifyContent: "space-between", fontSize: 11, color: MC.muted }}>
                              <b style={{ color: MC.text }}>{String(r["tenant"])}</b>
                              <span style={{ fontVariantNumeric: "tabular-nums" }}>{int(Number(r["human"]))}H · {int(Number(r["system"]))}S</span>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  );
                })()}
              </DrillZone>
            </CardShell>
          </div>

          {/* Monthly Activity Trend — only useful once we have ≥2 months */}
          {a.monthly.length >= 2 && (
            <div style={{ marginTop: 16 }}>
              <CardShell
                title="Monthly Activity Trend"
                takeaway={`Human events per month — system and automated activity excluded. ${a.monthly.length} month${a.monthly.length !== 1 ? "s" : ""} of data recorded so far.`}
                card={a.cards.weekly}
                onDrill={setDrawer}
              >
                <DrillZone card={a.cards.weekly} onDrill={setDrawer}>
                  <MissionArea data={a.monthly} xKey="label" yKey="activity" color="#6B99BB" height={180} />
                </DrillZone>
                <div style={{ marginTop: 10, display: "flex", gap: 24, flexWrap: "wrap" }}>
                  {a.monthly.map((mo) => (
                    <div key={mo.month} style={{ minWidth: 80 }}>
                      <div style={{ fontSize: 10, color: MC.faint, fontWeight: 600, textTransform: "uppercase" }}>{mo.label}</div>
                      <div style={{ fontSize: 16, fontWeight: 800, fontVariantNumeric: "tabular-nums" }}>{int(mo.activity)}</div>
                      <div style={{ fontSize: 10, color: MC.muted }}>events · peak {int(mo.mau)} WAU</div>
                    </div>
                  ))}
                </div>
              </CardShell>
            </div>
          )}


          {/* features + transactions */}
          <div style={{ marginTop: 16, display: "grid", gap: 16, gridTemplateColumns: "repeat(auto-fit, minmax(320px, 1fr))" }}>

            <CardShell
              title="Feature Usage"
              takeaway="All modules ranked by page visits — highest first. Zero-visit modules flagged at the bottom."
              card={a.cards.features}
              onDrill={setDrawer}
            >
              <div style={{ display: "flex", flexDirection: "column", gap: 7 }}>
                {a.features.slice(0, 4).map((f, rank) => {
                  const maxVisits = Math.max(1, a.features[0]?.visits ?? 1);
                  const pct = f.visits > 0 ? Math.max(2, Math.round((f.visits / maxVisits) * 100)) : 0;
                  const isTop = rank === 0;
                  const barGrad = rank === 0
                    ? "linear-gradient(90deg,#8EC94A,#A8D672)"
                    : rank <= 2
                    ? "linear-gradient(90deg,#6BA539,#8EC94A)"
                    : f.visits === 0
                    ? "none"
                    : "linear-gradient(90deg,#4A7825,#6BA539)";
                  return (
                    <div key={f.name} role="button" tabIndex={0}
                      onClick={() => setDrawer(a.cards.features)}
                      onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); setDrawer(a.cards.features); } }}
                      style={{ cursor: "zoom-in", padding: "3px 0" }}
                    >
                      <div style={{ display: "flex", alignItems: "center", gap: 7, marginBottom: 4 }}>
                        <span style={{ fontSize: 9, fontWeight: 800, width: 14, textAlign: "right", flexShrink: 0, fontVariantNumeric: "tabular-nums", color: isTop ? "#8EC94A" : MC.faint }}>#{rank + 1}</span>
                        <span style={{ flex: 1, fontSize: 11.5, color: MC.text, fontWeight: isTop ? 700 : 500, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{f.name}</span>
                        {f.visits === 0 ? (
                          <span style={{ fontSize: 9, fontWeight: 800, color: "#F87171", background: "rgba(248,113,113,0.12)", border: "1px solid rgba(248,113,113,0.3)", padding: "1px 6px", borderRadius: 4, flexShrink: 0 }}>ZERO</span>
                        ) : (
                          <span style={{ fontSize: isTop ? 14 : 12, fontWeight: 800, fontVariantNumeric: "tabular-nums", color: isTop ? "#8EC94A" : MC.muted, flexShrink: 0 }}>{int(f.visits)}</span>
                        )}
                      </div>
                      <div style={{ marginLeft: 21, height: 6, borderRadius: 4, background: MC.border, overflow: "hidden" }}>
                        {pct > 0 && <div style={{ height: "100%", borderRadius: 4, width: `${pct}%`, background: barGrad }} />}
                      </div>
                    </div>
                  );
                })}
              </div>
            </CardShell>

            <CardShell title="Transactions by Type" takeaway="What people actually do — human counts, with automated volume shown separately." card={a.cards.tx} onDrill={setDrawer}>
              <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                {(() => {
                  const totalHuman = a.txByType.reduce((s, t) => s + t.human, 0);
                  const totalSys   = a.txByType.reduce((s, t) => s + t.system, 0);
                  const total = totalHuman + totalSys;
                  const hPct  = total > 0 ? Math.round((totalHuman / total) * 100) : 0;
                  return (
                    <div style={{ marginBottom: 4 }}>
                      <div style={{ display: "flex", justifyContent: "space-between", fontSize: 10.5, marginBottom: 5 }}>
                        <span style={{ color: "#6B99BB", fontWeight: 700 }}>{int(totalHuman)} human</span>
                        <b style={{ color: hPct > 80 ? "#6BA539" : "#F0A842" }}>{hPct}% human</b>
                        <span style={{ color: MC.faint }}>{int(totalSys)} system</span>
                      </div>
                      <div style={{ display: "flex", height: 8, borderRadius: 4, overflow: "hidden", background: MC.border }}>
                        <div style={{ width: `${hPct}%`, background: "#6B99BB", transition: "width 0.3s" }} />
                        <div style={{ flex: 1, background: "#A78BFA" }} />
                      </div>
                    </div>
                  );
                })()}
                {a.txByType.slice(0, 5).map((t) => {
                  const maxH = Math.max(1, a.txByType[0]?.human ?? 1);
                  const pct = Math.max(2, Math.round((t.human / maxH) * 100));
                  return (
                    <div key={t.label} role="button" tabIndex={0} onClick={() => setDrawer(a.cards.tx)}
                      onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); setDrawer(a.cards.tx); } }}
                      style={{ cursor: "zoom-in" }}>
                      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", marginBottom: 3 }}>
                        <span style={{ fontSize: 11, color: MC.muted, fontWeight: 500, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", maxWidth: "70%" }}>{t.label}</span>
                        <span style={{ fontSize: 11, fontWeight: 700, fontVariantNumeric: "tabular-nums", color: MC.text, flexShrink: 0 }}>
                          {int(t.human)}{t.system > 0 && <span style={{ fontSize: 9, fontWeight: 400, color: MC.faint }}> +{int(t.system)} sys</span>}
                        </span>
                      </div>
                      <div style={{ height: 6, borderRadius: 3, background: MC.border, overflow: "hidden" }}>
                        <div style={{ height: "100%", borderRadius: 3, width: `${pct}%`, background: "linear-gradient(90deg,#6B99BB,#8BB5D0)" }} />
                      </div>
                    </div>
                  );
                })}
              </div>
            </CardShell>
          </div>

          {/* portfolio context (single-tenant only) + onboarding attention */}
          <div style={{ marginTop: 16, display: "grid", gap: 16, gridTemplateColumns: "repeat(auto-fit, minmax(340px, 1fr))" }}>
            {v.scope === "tenant" && m && (() => {
              const byStatus = new Map<string, number>();
              for (const p of m.projects) {
                const s = (p.status || "").trim() || "Not Set";
                byStatus.set(s, (byStatus.get(s) ?? 0) + 1);
              }
              const rows = [...byStatus.entries()].sort((x, y) => y[1] - x[1]);
              const card: CardModel = {
                id: "usage",
                title: "Portfolio Status",
                takeaway: "Status hygiene context for the usage numbers — same live records as the rest of the Analytics Center.",
                stats: [{ label: "Total projects", value: int(m.projects.length) }],
                columns: [
                  { key: "status", label: "Status", width: 18 },
                  { key: "count", label: "Total Projects", kind: "int", align: "right", width: 12 },
                ],
                rows: rows.map(([status, count]) => {
                  const statusProjects = m.projects.filter(
                    (p) => ((p.status || "").trim() || "Not Set") === status,
                  );
                  const subCard: CardModel = {
                    id: "usage",
                    title: `${status} — ${count} project${count !== 1 ? "s" : ""}`,
                    takeaway: `All projects currently in "${status}" status.`,
                    stats: [{ label: "Total Projects", value: String(count) }],
                    columns: [
                      { key: "id",       label: "ID",       width: 14 },
                      { key: "name",     label: "Project",  width: 32 },
                      { key: "division", label: "Division", width: 18 },
                      { key: "value",    label: "Value",    kind: "money" as const, align: "right" as const, width: 16 },
                    ],
                    rows: statusProjects.map((p) => ({
                      id: p.id, name: p.name, division: p.division || "—", value: p.value,
                      _ticket: p.id,
                    })),
                  };
                  return { status, count, _subCard: statusProjects.length > 0 ? subCard : undefined };
                }),
              };
              return (
                <CardShell title="Portfolio Status" takeaway={`Context: ${int(m.projects.length)} projects in this tenant, by status.`} card={card} onDrill={setDrawer}>
                  <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                    {rows.slice(0, 6).map(([status, count]) => {
                      const sl = status.toLowerCase();
                      const color = /activ|in.?progress|ongoing|open/.test(sl) ? "#6BA539"
                        : /complet|done|finish|clos|project.?complete/.test(sl) ? "#6B99BB"
                        : /hold|pause|defer/.test(sl) ? "#F0A842"
                        : /cancel|terminat|lost|declin/.test(sl) ? "#F87171"
                        : /plan|propos|bid|not.?start/.test(sl) ? "#A78BFA"
                        : "#8B8FA8";
                      const maxCount = rows[0]?.[1] ?? 1;
                      const pct = Math.max(2, Math.round((count / maxCount) * 100));
                      return (
                        <div key={status} role="button" tabIndex={0} onClick={() => setDrawer(card)}
                          onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); setDrawer(card); } }}
                          style={{ cursor: "zoom-in" }}>
                          <div style={{ display: "flex", alignItems: "center", gap: 7, marginBottom: 4 }}>
                            <span style={{ width: 8, height: 8, borderRadius: "50%", background: color, flexShrink: 0 }} />
                            <span style={{ flex: 1, fontSize: 11.5, color: MC.text, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{status}</span>
                            <b style={{ fontSize: 14, fontVariantNumeric: "tabular-nums", color }}>{int(count)}</b>
                          </div>
                          <div style={{ height: 7, borderRadius: 4, background: MC.border, overflow: "hidden" }}>
                            <div style={{ height: "100%", width: `${pct}%`, borderRadius: 4, background: color, opacity: 0.8 }} />
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </CardShell>
              );
            })()}

            {(() => {
              const showInactive = attentionTab === "inactive";
              return (
                <CardShell
                  title="User Activity Status"
                  takeaway={showInactive
                    ? "Enabled accounts with zero recorded activity — the onboarding follow-up list."
                    : "Enabled accounts with at least one recorded action in the window."}
                  card={showInactive ? a.cards.neverActive : a.cards.activity}
                  onDrill={setDrawer}
                >
                  {/* Toggle tabs */}
                  <div style={{ display: "flex", gap: 6, marginBottom: 14 }}>
                    {([
                      { key: "inactive", label: "Never Active", count: a.neverTotal, color: "#F87171" },
                      { key: "active",   label: "Active",       count: a.activeTotal, color: "#6BA539" },
                     ] as const).map(({ key, label, count, color }) => {
                      const on = attentionTab === key;
                       const targetCard = key === "inactive" ? a.cards.neverActive : a.cards.activity;
                      return (
                         <button
                           key={key}
                           onClick={(e) => {
                             // This button sits inside CardShell's clickable
                             // content region. Stop the stale outer-card
                             // handler from opening the currently selected
                             // list, then open the list represented by the
                             // button that was actually clicked.
                             e.stopPropagation();
                             setAttentionTab(key);
                             setDrawer(targetCard);
                           }}
                           onKeyDown={(e) => {
                             if (e.key === "Enter" || e.key === " ") e.stopPropagation();
                           }}
                           style={{
                          flex: 1, padding: "7px 10px", borderRadius: 8, fontSize: 12,
                          fontWeight: on ? 700 : 500, cursor: "pointer",
                          background: on ? `${color}18` : "transparent",
                          border: `1px solid ${on ? color : MC.border}`,
                          color: on ? color : MC.muted, transition: "all 0.12s",
                          display: "flex", flexDirection: "column", alignItems: "center", gap: 2,
                         }}>
                          <span style={{ fontSize: 18, fontWeight: 800, fontVariantNumeric: "tabular-nums", lineHeight: 1 }}>{int(count)}</span>
                          <span style={{ fontSize: 10 }}>{label}</span>
                        </button>
                      );
                    })}
                  </div>
                  {/* Body */}
                  <DrillZone
                    card={showInactive ? a.cards.neverActive : a.cards.activity}
                    onDrill={setDrawer}
                    label={showInactive ? "See who's on this list" : "See active users"}
                  >
                    <div style={{ display: "flex", alignItems: "baseline", gap: 10 }}>
                      <DrillNumber
                        value={int(showInactive ? a.neverTotal : a.activeTotal)}
                        card={showInactive ? a.cards.neverActive : a.cards.activity}
                        onDrill={setDrawer}
                        size={40}
                      />
                      <span style={{ fontSize: 11.5, color: MC.muted }}>
                        of {int(a.enabledUsers)} enabled users{" "}
                        {showInactive ? "never active" : "active"} in the window
                      </span>
                    </div>
                    {showInactive && a.neverTotal > a.neverShown && (
                      <div style={{ marginTop: 6, fontSize: 10.5, color: MC.faint }}>
                        The list shows the first {int(a.neverShown)} — the count above is the true total.
                      </div>
                    )}
                    {!showInactive && a.activeTotal > a.activeShown && (
                      <div style={{ marginTop: 6, fontSize: 10.5, color: MC.faint }}>
                        The list shows the first {int(a.activeShown)} — the count above is the true total.
                      </div>
                    )}
                  </DrillZone>
                </CardShell>
              );
            })()}
          </div>

          {/* Phase 2 — Usage → Outcomes (allocCard patched with edit-log drill row) */}
          {v.outcomes && (
            <OutcomeSection
              outcomes={{
                ...v.outcomes,
                allocCard: patchAllocCard(v.outcomes.allocCard ?? undefined, allocEdits) ?? v.outcomes.allocCard,
              }}
              weeks={v.weeks}
              onDrill={setDrawer}
            />
          )}
        </>
      )}

      <DataDrawer card={drawer} loading={drawerLoading} onClose={() => setDrawer(null)} />
    </MissionWorld>
  );
}
