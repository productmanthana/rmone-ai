import { useEffect, useState, useMemo, useCallback } from "react";
import { Loader2, AlertTriangle, ArrowLeft, X, Search } from "lucide-react";
import { Link, useLocation } from "wouter";
import {
  peekReportModel, loadReportModel, fmtMoney, fmtMoneyFull, fmtDateShort,
  type ReportModel, type ProjectRow, type OppRow, type LeadRow, type StaffRow, type DemandRow,
} from "@/lib/reportData";
import {
  SectionCard, KpiStat, HBarList, DonutChart, FunnelBars,
  ColumnChart, WinLossBars, PALETTE,
} from "@/components/charts/ExecCharts";
import { filterRowsByOrgKey } from "@/lib/analyticsCenter";

/* ─────────────────────────────────────────────────────────────
 * Drill-down popup — opens instantly (all data already in m).
 * ──────────────────────────────────────────────────────────── */
type DrillState =
  | { kind: "projects"; label: string; rows: ProjectRow[] }
  | { kind: "opps";     label: string; rows: OppRow[]     }
  | { kind: "leads";    label: string; rows: LeadRow[]    }
  | { kind: "staff";    label: string; rows: StaffRow[]   }
  | { kind: "demands";  label: string; rows: DemandRow[]  };

const MAX_SHOW = 200; /* render cap — search to narrow further */

/* value-band helpers (mirrors reportData.ts valueRanges) */
const VALUE_BANDS: { label: string; min: number; max: number }[] = [
  { label: "<$1M",    min: 0,    max: 1e6     },
  { label: "$1–5M",   min: 1e6,  max: 5e6     },
  { label: "$5–15M",  min: 5e6,  max: 15e6    },
  { label: "$15–50M", min: 15e6, max: 50e6    },
  { label: "$50M+",   min: 50e6, max: Infinity },
];

function DrillPopup({ drill, onClose, onNavigate }: {
  drill: DrillState;
  onClose: () => void;
  onNavigate: (id: string) => void;
}) {
  const [q, setQ] = useState("");

  /* close on Escape */
  useEffect(() => {
    const handler = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [onClose]);

  /* filtered rows — memoised so search is instant even for large lists */
  const filtered = useMemo(() => {
    const term = q.trim().toLowerCase();
    if (!term) return drill.rows as any[];
    return (drill.rows as any[]).filter(row => {
      const haystack = Object.values(row).filter(v => typeof v === "string").join(" ").toLowerCase();
      return haystack.includes(term);
    });
  }, [q, drill.rows]);

  const visible = filtered.slice(0, MAX_SHOW);
  const overflow = filtered.length > MAX_SHOW;

  const th: React.CSSProperties = {
    fontSize: 9.5, fontWeight: 700, letterSpacing: "0.07em", textTransform: "uppercase",
    color: "var(--rm-text-faint)", textAlign: "left", padding: "7px 10px",
    borderBottom: "1px solid var(--rm-panel-border)",
    position: "sticky", top: 0, background: "var(--rm-panel)", zIndex: 1,
    whiteSpace: "nowrap",
  };
  const td: React.CSSProperties = {
    fontSize: 11.5, color: "var(--rm-text)", padding: "8px 10px",
    borderBottom: "1px solid var(--rm-panel-border)",
    whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis",
  };

  function renderTable() {
    if (!visible.length) return (
      <div style={{ padding: "40px 20px", textAlign: "center", color: "var(--rm-text-muted)", fontSize: 12 }}>
        No records match your search.
      </div>
    );

    if (drill.kind === "projects") {
      return (
        <table style={{ width: "100%", borderCollapse: "collapse" }}>
          <thead><tr>
            <th style={th}>Project</th>
            <th style={th}>Client</th>
            <th style={th}>Sector</th>
            <th style={th}>Division</th>
            <th style={{ ...th, textAlign: "right" }}>Value</th>
            <th style={th}>Schedule</th>
          </tr></thead>
          <tbody>
            {(visible as ProjectRow[]).map(p => (
              <tr
                key={p.id}
                onClick={() => { onClose(); onNavigate(p.id); }}
                style={{ cursor: "pointer" }}
                onMouseEnter={e => (e.currentTarget as HTMLElement).style.backgroundColor = "var(--rm-panel-soft)"}
                onMouseLeave={e => (e.currentTarget as HTMLElement).style.backgroundColor = "transparent"}
              >
                <td style={{ ...td, fontWeight: 650, maxWidth: 240 }}>{p.name}</td>
                <td style={{ ...td, color: "var(--rm-text-muted)", maxWidth: 160 }}>{p.client ?? "—"}</td>
                <td style={{ ...td, color: "var(--rm-text-muted)" }}>{p.sector}</td>
                <td style={{ ...td, color: "var(--rm-text-muted)" }}>{p.division ?? "—"}</td>
                <td style={{ ...td, textAlign: "right", fontWeight: 750, fontVariantNumeric: "tabular-nums" }}>{fmtMoney(p.value)}</td>
                <td style={td}>
                  {p.overdue
                    ? <span style={{ color: PALETTE.orange, fontWeight: 700 }}>Overdue{p.daysOverdue != null ? ` ${p.daysOverdue}d` : ""}</span>
                    : p.noDate
                      ? <span style={{ color: "var(--rm-text-faint)" }}>No end date</span>
                      : <span style={{ color: PALETTE.green, fontWeight: 700 }}>On schedule</span>}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      );
    }

    if (drill.kind === "opps") {
      return (
        <table style={{ width: "100%", borderCollapse: "collapse" }}>
          <thead><tr>
            <th style={th}>Opportunity</th>
            <th style={th}>Client</th>
            <th style={th}>Sector</th>
            <th style={th}>Stage</th>
            <th style={{ ...th, textAlign: "right" }}>Value</th>
            <th style={{ ...th, textAlign: "right" }}>Prob.</th>
            <th style={th}>Bid Date</th>
          </tr></thead>
          <tbody>
            {(visible as OppRow[]).map(o => (
              <tr
                key={o.id}
                onClick={() => { onClose(); onNavigate(o.id); }}
                style={{ cursor: "pointer", opacity: o.closed ? 0.65 : 1 }}
                onMouseEnter={e => (e.currentTarget as HTMLElement).style.backgroundColor = "var(--rm-panel-soft)"}
                onMouseLeave={e => (e.currentTarget as HTMLElement).style.backgroundColor = "transparent"}
              >
                <td style={{ ...td, fontWeight: 650, maxWidth: 240 }}>{o.name}</td>
                <td style={{ ...td, color: "var(--rm-text-muted)", maxWidth: 160 }}>{o.client ?? "—"}</td>
                <td style={{ ...td, color: "var(--rm-text-muted)" }}>{o.sector}</td>
                <td style={{ ...td, color: "var(--rm-text-muted)" }}>{o.stage}</td>
                <td style={{ ...td, textAlign: "right", fontWeight: 750, fontVariantNumeric: "tabular-nums" }}>{fmtMoney(o.value)}</td>
                <td style={{ ...td, textAlign: "right", color: "var(--rm-text-muted)", fontVariantNumeric: "tabular-nums" }}>{o.probability != null ? `${o.probability}%` : "—"}</td>
                <td style={{ ...td, color: "var(--rm-text-muted)" }}>{fmtDateShort(o.bidDate)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      );
    }

    if (drill.kind === "leads") {
      return (
        <table style={{ width: "100%", borderCollapse: "collapse" }}>
          <thead><tr>
            <th style={th}>Lead</th>
            <th style={th}>Client</th>
            <th style={th}>Sector</th>
            <th style={th}>City</th>
            <th style={th}>Status</th>
            <th style={{ ...th, textAlign: "right" }}>Value</th>
          </tr></thead>
          <tbody>
            {(visible as LeadRow[]).map(l => (
              <tr key={l.id}
                style={{ cursor: "default" }}
                onMouseEnter={e => (e.currentTarget as HTMLElement).style.backgroundColor = "var(--rm-panel-soft)"}
                onMouseLeave={e => (e.currentTarget as HTMLElement).style.backgroundColor = "transparent"}
              >
                <td style={{ ...td, fontWeight: 650, maxWidth: 240 }}>{l.name}</td>
                <td style={{ ...td, color: "var(--rm-text-muted)", maxWidth: 160 }}>{l.client ?? "—"}</td>
                <td style={{ ...td, color: "var(--rm-text-muted)" }}>{l.sector}</td>
                <td style={{ ...td, color: "var(--rm-text-muted)" }}>{l.city ?? "—"}</td>
                <td style={{ ...td, color: "var(--rm-text-muted)" }}>{l.status}</td>
                <td style={{ ...td, textAlign: "right", fontWeight: 750, fontVariantNumeric: "tabular-nums" }}>{l.value > 0 ? fmtMoney(l.value) : "—"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      );
    }

    if (drill.kind === "staff") {
      return (
        <table style={{ width: "100%", borderCollapse: "collapse" }}>
          <thead><tr>
            <th style={th}>Name</th>
            <th style={th}>Role</th>
            <th style={th}>Division</th>
            <th style={{ ...th, textAlign: "right" }}>Utilization</th>
            <th style={th}>Band</th>
          </tr></thead>
          <tbody>
            {(visible as StaffRow[]).map(s => {
              const bandColor = s.band === "Overloaded" ? PALETTE.orange : s.band === "Available" ? PALETTE.slate : s.band === "Full" ? PALETTE.amber : PALETTE.green;
              return (
                <tr key={s.id}
                  onMouseEnter={e => (e.currentTarget as HTMLElement).style.backgroundColor = "var(--rm-panel-soft)"}
                  onMouseLeave={e => (e.currentTarget as HTMLElement).style.backgroundColor = "transparent"}
                >
                  <td style={{ ...td, fontWeight: 650, maxWidth: 200 }}>{s.name}</td>
                  <td style={{ ...td, color: "var(--rm-text-muted)" }}>{s.role ?? "—"}</td>
                  <td style={{ ...td, color: "var(--rm-text-muted)" }}>{s.division ?? "—"}</td>
                  <td style={{ ...td, textAlign: "right", fontVariantNumeric: "tabular-nums" }}>{s.utilization}%</td>
                  <td style={{ ...td }}><span style={{ color: bandColor, fontWeight: 700 }}>{s.band}</span></td>
                </tr>
              );
            })}
          </tbody>
        </table>
      );
    }

    if (drill.kind === "demands") {
      return (
        <table style={{ width: "100%", borderCollapse: "collapse" }}>
          <thead><tr>
            <th style={th}>Project</th>
            <th style={th}>Role</th>
            <th style={{ ...th, textAlign: "right" }}>Allocation</th>
            <th style={th}>Start</th>
            <th style={th}>End</th>
            <th style={th}>Type</th>
          </tr></thead>
          <tbody>
            {(visible as DemandRow[]).map((d, i) => (
              <tr key={`${d.ticket}-${i}`}
                onMouseEnter={e => (e.currentTarget as HTMLElement).style.backgroundColor = "var(--rm-panel-soft)"}
                onMouseLeave={e => (e.currentTarget as HTMLElement).style.backgroundColor = "transparent"}
              >
                <td style={{ ...td, fontWeight: 650, maxWidth: 220 }}>{d.project}</td>
                <td style={{ ...td, color: "var(--rm-text-muted)" }}>{d.role}</td>
                <td style={{ ...td, textAlign: "right", fontVariantNumeric: "tabular-nums" }}>{d.pct > 0 ? `${d.pct}%` : "—"}</td>
                <td style={{ ...td, color: "var(--rm-text-muted)" }}>{fmtDateShort(d.start)}</td>
                <td style={{ ...td, color: "var(--rm-text-muted)" }}>{fmtDateShort(d.end)}</td>
                <td style={{ ...td }}><span style={{ fontSize: 10, color: d.soft ? PALETTE.amber : PALETTE.teal, fontWeight: 700 }}>{d.soft ? "Soft" : "Hard"}</span></td>
              </tr>
            ))}
          </tbody>
        </table>
      );
    }

    return null;
  }

  return (
    /* backdrop */
    <div
      onClick={onClose}
      style={{
        position: "fixed", inset: 0, zIndex: 300,
        background: "rgba(0,0,0,0.48)", backdropFilter: "blur(2px)",
        display: "flex", alignItems: "center", justifyContent: "center",
        padding: 16,
      }}
    >
      {/* panel */}
      <div
        onClick={e => e.stopPropagation()}
        style={{
          width: "min(940px, 100%)", maxHeight: "82vh",
          display: "flex", flexDirection: "column",
          background: "var(--rm-panel)", borderRadius: 18,
          border: "1px solid var(--rm-panel-border)",
          boxShadow: "0 24px 80px rgba(0,0,0,0.28)",
        }}
      >
        {/* header */}
        <div style={{
          display: "flex", alignItems: "center", gap: 12,
          padding: "14px 18px", borderBottom: "1px solid var(--rm-panel-border)",
          flexShrink: 0, flexWrap: "wrap",
        }}>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontSize: 13.5, fontWeight: 800, color: "var(--rm-text)", letterSpacing: "-0.01em" }}>
              {drill.label}
            </div>
            <div style={{ fontSize: 11, color: "var(--rm-text-muted)", marginTop: 2 }}>
              {drill.rows.length === 0
                ? "No records"
                : overflow
                  ? `Showing ${MAX_SHOW.toLocaleString()} of ${filtered.length.toLocaleString()} — refine with search`
                  : `${filtered.length.toLocaleString()} record${filtered.length !== 1 ? "s" : ""}`}
            </div>
          </div>

          {/* search */}
          <div style={{
            display: "flex", alignItems: "center", gap: 6,
            background: "var(--rm-panel-soft)", borderRadius: 8,
            border: "1px solid var(--rm-panel-border)",
            padding: "5px 10px", minWidth: 180,
          }}>
            <Search style={{ width: 12, height: 12, color: "var(--rm-text-faint)", flexShrink: 0 }} />
            <input
              autoFocus
              value={q}
              onChange={e => setQ(e.target.value)}
              placeholder="Filter…"
              style={{
                border: "none", outline: "none", background: "transparent",
                fontSize: 12, color: "var(--rm-text)", width: "100%",
              }}
            />
            {q && (
              <button
                onClick={() => setQ("")}
                style={{ border: "none", background: "none", cursor: "pointer", padding: 0, color: "var(--rm-text-faint)", lineHeight: 1 }}
              >×</button>
            )}
          </div>

          <button
            onClick={onClose}
            style={{
              border: "none", background: "var(--rm-panel-soft)", cursor: "pointer",
              borderRadius: 8, padding: "5px 8px", color: "var(--rm-text-muted)",
              display: "flex", alignItems: "center", flexShrink: 0,
            }}
            title="Close (Esc)"
          >
            <X style={{ width: 15, height: 15 }} />
          </button>
        </div>

        {/* scrollable body */}
        <div style={{ overflowY: "auto", overflowX: "auto", flex: 1 }}>
          {renderTable()}
        </div>

        {/* footer note for large sets */}
        {overflow && (
          <div style={{
            padding: "8px 18px", borderTop: "1px solid var(--rm-panel-border)",
            fontSize: 10.5, color: "var(--rm-text-faint)", flexShrink: 0,
          }}>
            Showing first {MAX_SHOW} of {filtered.length.toLocaleString()} results — use the search box to narrow down.
          </div>
        )}
      </div>
    </div>
  );
}

/* ─────────────────────────────────────────────────────────────
 * Analytics — executive analytics for construction leadership.
 * ──────────────────────────────────────────────────────────── */
export default function AnalyticsPage() {
  const initial = (() => { try { return peekReportModel(); } catch { return null; } })();
  const [m, setM] = useState<ReportModel | null>(initial);
  const [loading, setLoading] = useState(!initial);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      if (!initial) setLoading(true);
      setError(null);
      try {
        const built = await loadReportModel();
        if (cancelled) return;
        if (!built) setError("No portfolio data is available right now.");
        else setM(built);
      } catch (e: any) {
        if (!cancelled && !initial) setError(String(e?.message || e));
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, []);

  return (
    <div style={{ minHeight: "100%", backgroundColor: "var(--rm-bg)", padding: "20px 72px 40px 20px" }}>
      <div style={{ maxWidth: 1360, margin: "0 auto" }}>

        {/* Header */}
        <div style={{ marginBottom: 18 }}>
          <Link
            href="/"
            className="inline-flex items-center gap-1.5 text-[12px] font-semibold uppercase tracking-wider"
            style={{ color: "var(--rm-text-muted)" }}
          >
            <ArrowLeft className="h-3.5 w-3.5" />
            Back to Home
          </Link>
          <div style={{ display: "flex", alignItems: "flex-end", justifyContent: "space-between", flexWrap: "wrap", gap: 12 }}>
            <div>
              <h1 style={{ color: "var(--rm-text)", fontSize: 26, fontWeight: 850, margin: "6px 0 2px", letterSpacing: "-0.015em" }}>
                Executive Analytics
              </h1>
              <div style={{ color: "var(--rm-text-muted)", fontSize: 13 }}>
                Portfolio, pipeline, market and workforce performance — live from your operational data.
              </div>
            </div>
            {m && (
              <div style={{ fontSize: 11, color: "var(--rm-text-faint)", paddingBottom: 4 }}>
                As of {new Date(m.generatedAt).toLocaleString("en-US", { month: "long", day: "numeric", year: "numeric", hour: "numeric", minute: "2-digit" })}
              </div>
            )}
          </div>
        </div>

        {loading && (
          <div style={{
            display: "flex", alignItems: "center", justifyContent: "center", gap: 10,
            padding: 80, color: "var(--rm-text-muted)",
            backgroundColor: "var(--rm-panel)", borderRadius: 20,
            border: "1px solid var(--rm-panel-border)",
          }}>
            <Loader2 className="h-5 w-5 animate-spin" style={{ color: PALETTE.green }} />
            Loading live portfolio data…
          </div>
        )}

        {!loading && error && !m && (
          <div style={{
            display: "flex", alignItems: "center", gap: 10, padding: 24,
            color: "#FFB36B", backgroundColor: "rgba(232,119,34,0.10)",
            border: "1px solid rgba(232,119,34,0.35)", borderRadius: 16,
          }}>
            <AlertTriangle className="h-5 w-5" />
            {error}
          </div>
        )}

        {m && <AnalyticsBody m={m} />}
      </div>
    </div>
  );
}

function AnalyticsBody({ m }: { m: ReportModel }) {
  const [drill, setDrill] = useState<DrillState | null>(null);
  const [, navigate] = useLocation();
  const closeDrill = useCallback(() => setDrill(null), []);

  const winRateTone = m.winRate == null ? null : m.winRate >= 50 ? "good" as const : m.winRate >= 30 ? "warn" as const : "bad" as const;
  const overdueTone = m.overdueCount === 0 ? "good" as const : m.overdueCount > m.activeProjects * 0.25 ? "bad" as const : "warn" as const;
  const demandTone = m.openDemands === 0 ? "good" as const : m.openDemands > 20 ? "bad" as const : "warn" as const;

  /* ── drill openers ── */
  function openFunnel(label: string) {
    if (label === "Leads")           setDrill({ kind: "leads",    label: "Leads",             rows: m.leads });
    else if (label === "Active Bids") setDrill({ kind: "opps",    label: "Active Bids",        rows: m.opps });
    else if (label.startsWith("Awarded")) setDrill({ kind: "opps", label: "Awarded (YTD)",     rows: m.decidedOpps.filter(o => o.won) });
  }

  function openStage(stageLabel: string) {
    const rows = m.opps.filter(o => o.stage === stageLabel);
    setDrill({ kind: "opps", label: `Active Bids — ${stageLabel}`, rows });
  }

  function openSector(sector: string) {
    const rows = m.projects.filter(p => p.sector === sector);
    setDrill({ kind: "projects", label: `Backlog by Sector — ${sector}`, rows });
  }

  function openScheduleSlice(sliceLabel: string) {
    let rows: ProjectRow[];
    if (sliceLabel === "On schedule")   rows = m.projects.filter(p => !p.overdue && !p.noDate);
    else if (sliceLabel === "Overdue")  rows = m.projects.filter(p => p.overdue);
    else                                 rows = m.projects.filter(p => p.noDate);
    setDrill({ kind: "projects", label: `Schedule Health — ${sliceLabel}`, rows });
  }

  function openDivision(division: string, group?: { key?: string }) {
    const key = group?.key ?? `name:${division}`;
    const rows = filterRowsByOrgKey(m.projects, "division", key);
    setDrill({ kind: "projects", label: `Backlog by Division — ${division}`, rows });
  }

  function openClient(client: string) {
    const rows = m.projects.filter(p => p.client === client);
    setDrill({ kind: "projects", label: `Client — ${client}`, rows });
  }

  function openCity(city: string) {
    const rows = m.projects.filter(p => p.city === city);
    setDrill({ kind: "projects", label: `Geographic Exposure — ${city}`, rows });
  }

  function openWinLoss(sector: string, outcome: "won" | "lost") {
    const rows = m.decidedOpps.filter(o => o.sector === sector && (outcome === "won" ? o.won : !o.won));
    setDrill({ kind: "opps", label: `${outcome === "won" ? "Won" : "Lost"} Bids — ${sector}`, rows });
  }

  function openValueBand(bandLabel: string) {
    const band = VALUE_BANDS.find(b => b.label === bandLabel);
    if (!band) return;
    const rows = m.projects.filter(p => p.value >= band.min && p.value < band.max);
    setDrill({ kind: "projects", label: `Project Size — ${bandLabel}`, rows });
  }

  function openUtilBand(bandLabel: string) {
    const rows = m.staff.filter(s => s.band === (bandLabel as any));
    setDrill({ kind: "staff", label: `Workforce — ${bandLabel}`, rows });
  }

  function handleNavigate(id: string) {
    if (id) navigate(`/project/${id}`);
  }

  return (
    <>
      {drill && <DrillPopup drill={drill} onClose={closeDrill} onNavigate={handleNavigate} />}

      <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>

        {/* ── KPI strip ── */}
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))", gap: 10 }}>
          <KpiStat label="Contracted Backlog"  value={fmtMoney(m.backlogValue)}   sub={`${m.activeProjects} active projects`} accent={PALETTE.green}
            onClick={() => setDrill({ kind: "projects", label: "Contracted Backlog — Active Projects", rows: m.projects })} />
          <KpiStat label="Open Pipeline"       value={fmtMoney(m.pipelineValue)}  sub={`${m.activeBids} active bids`}        accent={PALETTE.blue}
            onClick={() => setDrill({ kind: "opps", label: "Open Pipeline", rows: m.opps })} />
          <KpiStat label="Weighted Pipeline"   value={fmtMoney(m.weightedPipeline)} sub="probability-adjusted"               accent={PALETTE.blue}
            onClick={() => setDrill({ kind: "opps", label: "Weighted Pipeline — Open Pursuits", rows: m.opps.filter(o => o.probability != null) })} />
          <KpiStat label="Win Rate (YTD)"      value={m.winRate != null ? `${m.winRate}%` : "—"}
            sub={m.winRate != null ? `${m.wonCount} of ${m.wonCount + m.lostCount} decided` : "no decided bids yet"} tone={winRateTone}
            onClick={() => setDrill({ kind: "opps", label: "Win Rate — Decided Bids (YTD)", rows: m.decidedOpps })} />
          <KpiStat label="On-Time Delivery"    value={m.onTimeRate != null ? `${m.onTimeRate}%` : "—"} sub={`${m.overdueCount} overdue`} tone={overdueTone}
            onClick={() => setDrill({ kind: "projects", label: "On-Time Delivery — All Active Projects", rows: m.projects })} />
          <KpiStat label="Staff Deployed"      value={m.deployedRate != null ? `${m.deployedRate}%` : "—"} sub={`${m.totalStaff} staff · ${m.benchCount} available`} accent={PALETTE.teal}
            onClick={() => setDrill({ kind: "staff", label: "Staff Deployed", rows: m.staff })} />
          <KpiStat label="Unfilled Positions"  value={String(m.openDemands)} sub={m.openDemands > 0 ? "open staffing requests" : "all positions filled"} tone={demandTone}
            onClick={() => setDrill({ kind: "demands", label: "Unfilled Staffing Positions", rows: m.demands })} />
          <KpiStat label="Avg Project Size"    value={fmtMoney(m.avgProjectValue)} sub="active portfolio average" accent={PALETTE.purple}
            onClick={() => setDrill({ kind: "projects", label: "Active Projects by Value", rows: m.projects })} />
        </div>

        {/* ── pipeline row ── */}
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(400px, 1fr))", gap: 14 }}>
          <SectionCard title="Business Development Funnel" subtitle="Lead generation through award — count and value at each stage">
            <FunnelBars stages={m.funnel} valueFmt={fmtMoney} onRowClick={openFunnel} />
          </SectionCard>
          <SectionCard title="Active Bids by Stage" subtitle="Where the open pipeline sits today">
            <HBarList
              rows={m.opmByStage.map(s => ({ label: s.label, value: s.value, sub: `${s.count} bid${s.count === 1 ? "" : "s"}` }))}
              valueFmt={fmtMoney}
              emptyText="No active bids in the pipeline."
              onRowClick={openStage}
            />
          </SectionCard>
        </div>

        {/* ── conversion tracking row ── */}
        <SectionCard
          title="Conversion Tracking"
          subtitle="How work moves through the lifecycle — leads that became opportunities, and opportunities that became projects. Click a conversion to see the records."
        >
          <ConversionFlow
            m={m}
            onLeads={() => setDrill({ kind: "leads", label: "Converted Leads — became Opportunities", rows: m.conversion.convertedLeads })}
            onOpps={() => setDrill({ kind: "opps", label: "Converted Opportunities — became Projects", rows: m.conversion.convertedOpps })}
          />
        </SectionCard>

        {/* ── portfolio composition row ── */}
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(400px, 1fr))", gap: 14 }}>
          <SectionCard title="Backlog by Sector" subtitle="Active contract value by market sector">
            <DonutChart
              slices={m.backlogBySector.map(s => ({ label: s.label, value: s.value }))}
              centerLabel={fmtMoney(m.backlogValue)}
              centerSub="backlog"
              onSliceClick={openSector}
            />
          </SectionCard>
          <SectionCard title="Backlog by Division" subtitle="Which business lines carry the work">
            <HBarList
              rows={m.backlogByDivision.map(d => ({ label: d.label, value: d.value, sub: `${d.count} proj`, key: d.key }))}
              valueFmt={fmtMoney}
              color={PALETTE.green}
              emptyText="No division data recorded on active projects."
              onRowClick={openDivision}
            />
          </SectionCard>
        </div>

        {/* ── risk & market row ── */}
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(400px, 1fr))", gap: 14 }}>
          <SectionCard title="Client Concentration" subtitle="Top clients by contracted backlog — concentration above 25% is a revenue risk">
            <HBarList
              rows={m.clientConcentration.map(c => ({ label: c.label, value: c.value, sub: `${c.share}%` }))}
              valueFmt={fmtMoney}
              color={PALETTE.blue}
              emptyText="No client names recorded on active projects."
              onRowClick={openClient}
            />
          </SectionCard>
          <SectionCard title="Geographic Exposure" subtitle="Active contract value by market / city">
            <HBarList
              rows={m.cityExposure.map(c => ({ label: c.label, value: c.value, sub: `${c.count} proj` }))}
              valueFmt={fmtMoney}
              color={PALETTE.teal}
              emptyText="No city data recorded on active projects."
              onRowClick={openCity}
            />
          </SectionCard>
        </div>

        {/* ── distribution & win-loss row ── */}
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(400px, 1fr))", gap: 14 }}>
          <SectionCard title="Project Size Distribution" subtitle="Number of active projects by contract value band">
            <ColumnChart data={m.valueRanges} color={PALETTE.purple} onBarClick={openValueBand} />
          </SectionCard>
          <SectionCard title="Win / Loss by Sector" subtitle="Decided bids — where you win and where you lose">
            <WinLossBars rows={m.winLossBySector} onRowClick={openWinLoss} />
          </SectionCard>
        </div>

        {/* ── delivery & workforce row ── */}
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(400px, 1fr))", gap: 14 }}>
          <SectionCard title="Schedule Health" subtitle="Active projects against their target completion dates">
            <DonutChart
              slices={[
                { label: "On schedule", value: m.scheduleHealth.onSchedule, color: PALETTE.green },
                { label: "Overdue",     value: m.scheduleHealth.overdue,    color: PALETTE.orange },
                { label: "No end date", value: m.scheduleHealth.noDate,     color: PALETTE.slate },
              ]}
              centerLabel={m.onTimeRate != null ? `${m.onTimeRate}%` : "—"}
              centerSub="on schedule"
              size={150}
              onSliceClick={openScheduleSlice}
            />
          </SectionCard>
          <SectionCard title="Workforce Utilization" subtitle="Staff count by current workload band">
            <ColumnChart
              data={m.utilizationBands}
              color={PALETTE.teal}
              countFmt={v => `${v} staff`}
              onBarClick={openUtilBand}
            />
          </SectionCard>
        </div>

        {/* ── largest engagements table ── */}
        <SectionCard
          title="Largest Active Engagements"
          subtitle="Top projects by contract value — click any row to open the project"
        >
          <TopProjectsTable m={m} onNavigate={handleNavigate} />
        </SectionCard>
      </div>
    </>
  );
}

/* ── conversion flow strip: Leads → Opportunities → Projects ── */
function ConversionFlow({ m, onLeads, onOpps }: { m: ReportModel; onLeads: () => void; onOpps: () => void }) {
  const c = m.conversion;

  const node = (label: string, count: number, sub: string, accent: string) => (
    <div style={{
      flex: "1 1 150px", minWidth: 150, position: "relative", overflow: "hidden",
      background: "var(--rm-panel-soft)", border: "1px solid var(--rm-panel-border)",
      borderRadius: 10, padding: "12px 14px 12px 18px",
    }}>
      <span style={{ position: "absolute", left: 0, top: 10, bottom: 10, width: 3, borderRadius: 2, background: accent }} />
      <div style={{ fontSize: 9.5, fontWeight: 700, letterSpacing: "0.08em", textTransform: "uppercase", color: "var(--rm-text-faint)" }}>{label}</div>
      <div style={{ fontSize: 22, fontWeight: 850, lineHeight: 1.15, color: "var(--rm-text)", fontVariantNumeric: "tabular-nums" }}>{count}</div>
      <div style={{ fontSize: 11, color: "var(--rm-text-muted)", marginTop: 2 }}>{sub}</div>
    </div>
  );

  const chip = (title: string, count: number, rate: number | null, value: number, onClick: () => void) => {
    const has = count > 0;
    return (
      <div
        onClick={has ? onClick : undefined}
        role={has ? "button" : undefined}
        tabIndex={has ? 0 : undefined}
        onKeyDown={has ? (e => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); onClick(); } }) : undefined}
        title={has ? "View converted records" : undefined}
        onMouseEnter={has ? (e => (e.currentTarget as HTMLElement).style.backgroundColor = "var(--rm-panel-soft)") : undefined}
        onMouseLeave={has ? (e => (e.currentTarget as HTMLElement).style.backgroundColor = "transparent") : undefined}
        style={{
          alignSelf: "center", flex: "0 1 auto", minWidth: 132,
          display: "flex", flexDirection: "column", alignItems: "center", gap: 1,
          padding: "8px 14px", borderRadius: 10,
          border: `1px dashed ${has ? PALETTE.green : "var(--rm-panel-border)"}`,
          cursor: has ? "pointer" : "default", textAlign: "center",
        }}
      >
        <div style={{ fontSize: 9, fontWeight: 700, letterSpacing: "0.07em", textTransform: "uppercase", color: "var(--rm-text-faint)" }}>{title}</div>
        <div style={{ fontSize: 15, fontWeight: 800, color: has ? PALETTE.green : "var(--rm-text-faint)", fontVariantNumeric: "tabular-nums" }}>
          {count} converted →
        </div>
        <div style={{ fontSize: 10.5, color: "var(--rm-text-muted)" }}>
          {rate != null ? `${rate}% rate` : "no records yet"}{has ? ` · ${fmtMoney(value)}` : ""}
        </div>
      </div>
    );
  };

  return (
    <div style={{ display: "flex", alignItems: "stretch", gap: 10, flexWrap: "wrap" }}>
      {node("Leads", c.leadsTotal, "all leads on record", PALETTE.amber)}
      {chip("Leads → Opps", c.leadsConverted, c.leadConversionRate, c.leadsConvertedValue, onLeads)}
      {node("Opportunities", c.oppsTotal, "all bids on record", PALETTE.blue)}
      {chip("Opps → Projects", c.oppsConverted, c.oppConversionRate, c.oppsConvertedValue, onOpps)}
      {node("Projects", m.activeProjects + m.closedProjects.length, `${m.activeProjects} active · ${m.closedProjects.length} closed`, PALETTE.green)}
    </div>
  );
}

function TopProjectsTable({ m, onNavigate }: { m: ReportModel; onNavigate: (id: string) => void }) {
  const rows = m.projects.slice(0, 10);
  if (!rows.length) {
    return (
      <div style={{ padding: "18px 0", fontSize: 12, color: "var(--rm-text-muted)" }}>
        No active projects on file.
      </div>
    );
  }
  const th: React.CSSProperties = {
    fontSize: 9.5, fontWeight: 700, letterSpacing: "0.07em", textTransform: "uppercase",
    color: "var(--rm-text-faint)", textAlign: "left", padding: "6px 10px",
    borderBottom: "1px solid var(--rm-panel-border)", whiteSpace: "nowrap",
  };
  const td: React.CSSProperties = {
    fontSize: 12, color: "var(--rm-text)", padding: "8px 10px",
    borderBottom: "1px solid var(--rm-panel-border)",
    whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis", maxWidth: 260,
  };
  return (
    <div style={{ overflowX: "auto" }}>
      <table style={{ width: "100%", borderCollapse: "collapse" }}>
        <thead>
          <tr>
            <th style={th}>Project</th>
            <th style={th}>Client</th>
            <th style={th}>Sector</th>
            <th style={th}>Division</th>
            <th style={{ ...th, textAlign: "right" }}>Contract Value</th>
            <th style={{ ...th, textAlign: "right" }}>Share</th>
            <th style={th}>Schedule</th>
          </tr>
        </thead>
        <tbody>
          {rows.map(p => {
            const share = m.backlogValue > 0 ? Math.round((p.value / m.backlogValue) * 100) : 0;
            return (
              <tr
                key={p.id}
                onClick={() => onNavigate(p.id)}
                style={{ cursor: "pointer" }}
                onMouseEnter={e => (e.currentTarget as HTMLElement).style.backgroundColor = "var(--rm-panel-soft)"}
                onMouseLeave={e => (e.currentTarget as HTMLElement).style.backgroundColor = "transparent"}
                title="Open project"
              >
                <td style={{ ...td, fontWeight: 650 }}>{p.name}</td>
                <td style={{ ...td, color: "var(--rm-text-muted)" }}>{p.client ?? "—"}</td>
                <td style={{ ...td, color: "var(--rm-text-muted)" }}>{p.sector}</td>
                <td style={{ ...td, color: "var(--rm-text-muted)" }}>{p.division ?? "—"}</td>
                <td style={{ ...td, textAlign: "right", fontWeight: 750, fontVariantNumeric: "tabular-nums" }}>{fmtMoney(p.value)}</td>
                <td style={{ ...td, textAlign: "right", color: "var(--rm-text-muted)", fontVariantNumeric: "tabular-nums" }}>{share > 0 ? `${share}%` : "—"}</td>
                <td style={td}>
                  {p.overdue ? (
                    <span style={{ color: PALETTE.orange, fontWeight: 700 }}>Overdue{p.daysOverdue != null ? ` ${p.daysOverdue}d` : ""}</span>
                  ) : p.noDate ? (
                    <span style={{ color: "var(--rm-text-faint)" }}>No end date</span>
                  ) : (
                    <span style={{ color: PALETTE.green, fontWeight: 700 }}>On schedule</span>
                  )}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
