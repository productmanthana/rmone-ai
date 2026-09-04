/**
 * Executive Forecast (deliverable 3 of 3) — portfolio rollup across every
 * project with snapshots, in the client's approved wording: projects rolled
 * up for management showing Actual to Date, Remaining Forecast, Forecast at
 * Completion, Hours Variance and Cost Variance. All figures come from the
 * FROZEN weekly snapshots (latest week ≤ now per project).
 *
 * Variance = forecast-to-date − actual-to-date, POSITIVE = favorable:
 * green = forecast exceeds actuals, red = actuals exceed forecast.
 *
 * Clicking a project (table row or chart bar) opens an in-page drill-down
 * popup (ExecForecastPopup) instead of navigating away; the popup links to
 * the full Actuals vs Forecast page for filters and click-to-explain.
 */
import { useEffect, useMemo, useState } from "react";
import { Link } from "wouter";
import { Loader2, AlertTriangle, Lock, Briefcase, Info, Upload, Search, CheckCircle2, FileSpreadsheet } from "lucide-react";
import {
  getAfOverview, getModuleRecords,
  type AfOverview, type AfOverviewProject,
} from "@/lib/api";
import { useAuth } from "@/lib/useAuth";
import {
  execInitialSortDir, execPctUsed, execRowComparator,
  fmtNum, fmtUsd, round2, unitValues, UNIT_LABEL,
  type AfUnit, type ExecSortKey,
} from "@/lib/afMath";
import {
  exportExecForecastCsv, exportExecForecastExcel, type ExecForecastExportRow,
} from "@/lib/exportExecForecast";
import ExecForecastPopup from "@/components/ExecForecastPopup";
import {
  ResponsiveContainer, BarChart, Bar, Cell, XAxis, YAxis, CartesianGrid,
  Tooltip as RTooltip, ReferenceLine,
} from "recharts";

const GREEN = "#16a34a";
const RED = "#dc2626";
const BLUE = "#2563eb";

const card: React.CSSProperties = {
  background: "hsl(var(--card))",
  border: "1px solid hsl(var(--border))",
  borderRadius: 12,
  padding: 16,
};

/** Sortable columns — shared with afMath's comparator so check:reports-honesty guards the real order. */
type SortKey = ExecSortKey;

interface Row {
  ticket: string;
  title: string;
  actual: number;
  remaining: number;
  fac: number;
  hoursVar: number;
  costVar: number;
  pctUsed: number | null;
  hasActuals: boolean;
  substituted: boolean;
  backfilled: boolean;
  week: string;
}

export default function ExecutiveForecastPage() {
  const { user } = useAuth();
  const isAdmin = user?.isAdmin === true;

  const [overview, setOverview] = useState<AfOverview | null | undefined>(undefined);
  const [titles, setTitles] = useState<Map<string, string>>(new Map());
  const [unit, setUnit] = useState<AfUnit>("cost");
  const [search, setSearch] = useState("");
  // Default: worst cost variance first — the dollar view of "are we in trouble".
  const [sort, setSort] = useState<{ key: SortKey; dir: "asc" | "desc" }>({ key: "costVar", dir: execInitialSortDir("costVar") });
  const [popupTicket, setPopupTicket] = useState<string | null>(null);
  const [exportBusy, setExportBusy] = useState<"xlsx" | "csv" | null>(null);

  useEffect(() => {
    let alive = true;
    getAfOverview().then((o) => { if (alive) setOverview(o); });
    Promise.all([getModuleRecords("PMM").catch(() => null), getModuleRecords("OPM").catch(() => null)])
      .then(([pmm, opm]) => {
        if (!alive) return;
        const m = new Map<string, string>();
        for (const list of [pmm?.data, opm?.data]) {
          for (const r of list ?? []) {
            const rec = r as Record<string, unknown>;
            const id = String(rec.TicketId ?? "").trim();
            if (id) m.set(id, String(rec.Title ?? rec.ProjectTitle ?? "").trim());
          }
        }
        setTitles(m);
      });
    return () => { alive = false; };
  }, []);

  const projects: AfOverviewProject[] = overview && "available" in overview && overview.available ? overview.projects : [];
  const currentWeek = overview && "available" in overview && overview.available ? overview.currentWeek : "";
  const building = overview && "available" in overview && overview.available ? overview.building === true : false;

  const fmtV = (v: number) => (unit === "hours" ? `${fmtNum(v)} h` : fmtUsd(v));

  const rollup = useMemo(() => {
    const t = {
      actual: 0, remaining: 0, fac: 0, hoursVar: 0, costVar: 0,
      favorable: 0, unfavorable: 0, onPlan: 0,
      substituted: 0, unrated: 0, backfilled: 0,
      unknown: 0,
    };
    for (const p of projects) {
      const v = unitValues(p, unit);
      const hasActuals = p.actualsCovered || p.substitutedHours > 0;
      t.remaining += v.remaining;
      if (!hasActuals) { t.unknown += 1; continue; }
      t.actual += v.actualTd; t.fac += v.eac;
      t.hoursVar += p.hoursVariance; t.costVar += p.costVariance;
      if (v.variance > 0.005) t.favorable += 1;
      else if (v.variance < -0.005) t.unfavorable += 1;
      else t.onPlan += 1;
      t.substituted += p.substitutedHours;
      t.unrated += p.unratedActualHours;
      if (p.backfilled) t.backfilled += 1;
    }
    return t;
  }, [projects, unit]);

  /** Dollar health check — always in COST regardless of the unit toggle,
   * because "are we in trouble" is a dollars question for the client. */
  const costHealth = useMemo(() => {
    let over = 0, overAmt = 0, facCost = 0, unknown = 0;
    for (const p of projects) {
      if (!(p.actualsCovered || p.substitutedHours > 0)) { unknown += 1; continue; }
      facCost += p.forecastTotalCost;
      if (p.costVariance < -0.005) { over += 1; overAmt += -p.costVariance; }
    }
    return { over, overAmt, facCost, unknown };
  }, [projects]);

  const chartRows = useMemo(() => {
    const rows = projects
      .filter((p) => p.actualsCovered || p.substitutedHours > 0)
      .map((p) => ({ ticket: p.ticket, variance: round2(unitValues(p, unit).variance) }));
    rows.sort((a, b) => Math.abs(b.variance) - Math.abs(a.variance));
    return rows.slice(0, 12).reverse(); // biggest drivers at the top of a horizontal chart
  }, [projects, unit]);

  const allRows = useMemo((): Row[] => projects.map((p) => {
    const v = unitValues(p, unit);
    return {
      ticket: p.ticket,
      title: titles.get(p.ticket) ?? "",
      actual: v.actualTd,
      remaining: v.remaining,
      fac: v.eac,
      hoursVar: p.hoursVariance,
      costVar: p.costVariance,
      pctUsed: execPctUsed(v.actualTd, v.eac),
      hasActuals: p.actualsCovered || p.substitutedHours > 0,
      substituted: p.substitutedHours > 0,
      backfilled: p.backfilled,
      week: p.weekMonday,
    };
  }), [projects, unit, titles]);

  const rows = useMemo(() => {
    const q = search.trim().toLowerCase();
    const filtered = q
      ? allRows.filter((r) => r.ticket.toLowerCase().includes(q) || r.title.toLowerCase().includes(q))
      : allRows;
    // Shared comparator (afMath): nulls last regardless of direction, ticket tie-break.
    return [...filtered].sort(execRowComparator(sort.key, sort.dir));
  }, [allRows, search, sort]);

  const clickSort = (key: SortKey) => setSort((s) => s.key === key
    ? { key, dir: s.dir === "asc" ? "desc" : "asc" }
    // Variance columns start at "worst first" (ascending); magnitude columns biggest-first.
    : { key, dir: execInitialSortDir(key) });

  const popupSeed = popupTicket ? projects.find((p) => p.ticket === popupTicket) ?? null : null;

  /** Export the table exactly as currently filtered + sorted — every row
   * matching the search, not just the visible scroll window. Only reachable
   * from the loaded, non-restricted render branch below. */
  const runExport = async (kind: "xlsx" | "csv") => {
    if (exportBusy || rows.length === 0) return;
    setExportBusy(kind);
    try {
      const byTicket = new Map(projects.map((p) => [p.ticket, p]));
      const data: ExecForecastExportRow[] = rows.flatMap((r) => {
        const project = byTicket.get(r.ticket);
        return project ? [{ project, title: r.title }] : [];
      });
      if (kind === "csv") {
        exportExecForecastCsv(data);
      } else {
        await exportExecForecastExcel(data, {
          currentWeek,
          search: search.trim(),
          totalCount: allRows.length,
        });
      }
    } catch {
      alert("The export failed to build. Please try again.");
    } finally {
      setExportBusy(null);
    }
  };

  if (overview === undefined) {
    return <div style={{ display: "flex", justifyContent: "center", minHeight: "45vh", alignItems: "center" }}>
      <Loader2 size={22} className="animate-spin" style={{ color: "hsl(var(--muted-foreground))" }} /></div>;
  }
  if (overview === null || !("available" in overview)) {
    return <NoticePage icon={<AlertTriangle size={20} style={{ color: "#d97706" }} />} title="Couldn't load the Executive Forecast"
      body="The server didn't answer. Check your connection and try again." />;
  }
  if (!overview.available) {
    return <NoticePage icon={<Lock size={20} style={{ color: "hsl(var(--muted-foreground))" }} />} title="The Executive Forecast isn't available"
      body={overview.reason ?? "This data isn't available for your account."} />;
  }

  return (
    <div style={{ padding: "20px 24px 40px", maxWidth: 1240, margin: "0 auto", display: "flex", flexDirection: "column", gap: 14 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
        <div style={{ width: 38, height: 38, borderRadius: 10, background: `${BLUE}15`, display: "flex", alignItems: "center", justifyContent: "center" }}>
          <Briefcase size={19} style={{ color: BLUE }} />
        </div>
        <div style={{ minWidth: 0, flex: 1 }}>
          <h1 style={{ fontSize: 18, fontWeight: 700, margin: 0 }}>Executive Forecast</h1>
          <div style={{ fontSize: 12, color: "hsl(var(--muted-foreground))" }}>
            Portfolio actuals vs forecast across {projects.length} project{projects.length === 1 ? "" : "s"} — as of week {currentWeek}.
            {building ? " Snapshots are building now — figures update as projects finish." : ""}
          </div>
        </div>
        <div style={{ display: "inline-flex", border: "1px solid hsl(var(--border))", borderRadius: 8, overflow: "hidden" }}>
          {(["hours", "cost", "bill"] as AfUnit[]).map((u) => (
            <button key={u} type="button" onClick={() => setUnit(u)}
              style={{
                padding: "7px 12px", fontSize: 12, fontWeight: 600, border: "none", cursor: "pointer",
                background: u === unit ? BLUE : "hsl(var(--card))",
                color: u === unit ? "#fff" : "hsl(var(--muted-foreground))",
              }}>{UNIT_LABEL[u]}</button>
          ))}
        </div>
        {isAdmin && (
          <Link href="/actuals-import" style={{ textDecoration: "none" }}>
            <span style={{
              display: "inline-flex", alignItems: "center", gap: 6, padding: "7px 12px", borderRadius: 8,
              border: "1px solid hsl(var(--border))", fontSize: 12.5, fontWeight: 600, cursor: "pointer",
              color: "hsl(var(--foreground))", background: "hsl(var(--card))",
            }}><Upload size={14} /> Import Actuals</span>
          </Link>
        )}
      </div>

      {projects.length === 0 ? (
        <div style={{ ...card, fontSize: 13, color: "hsl(var(--muted-foreground))" }}>
          No snapshots yet. Snapshots build automatically every hour.
          {" "}<Link href="/actuals-forecast" style={{ color: BLUE }}>Open the Actuals vs Forecast page</Link>{isAdmin ? " to import actuals or build the first snapshot." : "."}
        </div>
      ) : (
        <>
          {/* dollar health headline — the client's "are we in trouble or not" line */}
          <div style={{
            ...card,
            padding: "10px 14px",
            display: "flex", alignItems: "center", gap: 10,
            borderColor: costHealth.over > 0 ? "#f59e0b66" : "#16a34a55",
            background: costHealth.over > 0 ? "#f59e0b0d" : "#16a34a0a",
          }}>
            {costHealth.unknown > 0
              ? <AlertTriangle size={17} style={{ color: "#d97706", flexShrink: 0 }} />
              : costHealth.over > 0
              ? <AlertTriangle size={17} style={{ color: "#d97706", flexShrink: 0 }} />
              : <CheckCircle2 size={17} style={{ color: GREEN, flexShrink: 0 }} />}
            <div style={{ fontSize: 13, lineHeight: 1.45 }}>
              {costHealth.unknown > 0 ? (
                <><b>{costHealth.unknown} project{costHealth.unknown === 1 ? "" : "s"}</b> cannot be compared because actual hours were not imported.</>
              ) : costHealth.over > 0 ? (
                <>
                  <b>{costHealth.over} of {projects.length} projects</b> have spent more than forecast to date — combined <b style={{ color: RED }}>{fmtUsd(costHealth.overAmt)} over</b>.
                </>
              ) : (
                <><b>All {projects.length} projects</b> are at or under their cost forecast to date.</>
              )}
              {" "}Portfolio forecast at completion: <b>{costHealth.unknown > 0 ? "—" : fmtUsd(costHealth.facCost)}</b>.
            </div>
          </div>

          {/* KPI strip — the client's five portfolio metrics + project counts */}
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(160px, 1fr))", gap: 10 }}>
            <Kpi label="Actual to Date" value={rollup.unknown > 0 ? "—" : fmtV(rollup.actual)} sub={rollup.unknown > 0 ? "actuals not imported for every project" : UNIT_LABEL[unit].toLowerCase()} />
            <Kpi label="Remaining Forecast" value={fmtV(rollup.remaining)} sub="future periods only" />
            <Kpi label="Forecast at Completion" value={rollup.unknown > 0 ? "—" : fmtV(rollup.fac)} sub="actuals + remaining forecast" />
            <Kpi label="Hours Variance" value={rollup.unknown > 0 ? "—" : `${fmtNum(rollup.hoursVar)} h`}
              tone={rollup.unknown === 0 && rollup.hoursVar > 0.005 ? "good" : rollup.unknown === 0 && rollup.hoursVar < -0.005 ? "bad" : undefined}
              sub={rollup.hoursVar >= 0 ? "forecast exceeds actuals" : "actuals exceed forecast"} />
            <Kpi label="Cost Variance" value={rollup.unknown > 0 ? "—" : fmtUsd(rollup.costVar)}
              tone={rollup.unknown === 0 && rollup.costVar > 0.005 ? "good" : rollup.unknown === 0 && rollup.costVar < -0.005 ? "bad" : undefined}
              sub={rollup.costVar >= 0 ? "forecast exceeds actuals" : "actuals exceed forecast"} />
            <Kpi label="Projects vs Forecast" value={`${rollup.unfavorable} over · ${rollup.favorable} under`} sub={`${rollup.onPlan} on forecast`} />
          </div>

          {/* variance drivers */}
          <div style={card}>
            <div style={{ fontSize: 13, fontWeight: 700, marginBottom: 8 }}>Largest variances — {UNIT_LABEL[unit]}</div>
            <ResponsiveContainer width="100%" height={Math.max(180, chartRows.length * 30 + 40)}>
              <BarChart data={chartRows} layout="vertical" margin={{ top: 4, right: 24, bottom: 4, left: 8 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" horizontal={false} />
                <XAxis type="number" tick={{ fontSize: 11 }} tickFormatter={(v: number) => (unit === "hours" ? fmtNum(v) : fmtUsd(v))} />
                <YAxis type="category" dataKey="ticket" width={130} tick={{ fontSize: 11 }} />
                <RTooltip
                  formatter={(v: number | string) => [fmtV(Number(v)), "Variance (forecast TD − actual TD)"]}
                  labelFormatter={(l: string) => `${l}${titles.get(l) ? ` — ${titles.get(l)}` : ""}`}
                  contentStyle={{ fontSize: 12, borderRadius: 8 }} />
                <ReferenceLine x={0} stroke="hsl(var(--border))" />
                <Bar dataKey="variance" radius={[0, 4, 4, 0]} onClick={(d: { ticket?: string; payload?: { ticket?: string } }) => {
                  const t = d?.payload?.ticket ?? d?.ticket;
                  if (t) setPopupTicket(t);
                }}>
                  {chartRows.map((r) => (
                    <Cell key={r.ticket} cursor="pointer" fill={r.variance >= 0 ? GREEN : RED} fillOpacity={0.85} />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
            <div style={{ fontSize: 11, color: "hsl(var(--muted-foreground))", marginTop: 4 }}>
              Green = forecast exceeds actuals (favorable) · red = actuals exceed forecast. Click a bar to inspect the project without leaving this page.
            </div>
          </div>

          {/* full table */}
          <div style={{ ...card, padding: 0, overflow: "hidden" }}>
            <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "10px 12px", borderBottom: "1px solid hsl(var(--border))", flexWrap: "wrap" }}>
              <div style={{ position: "relative" }}>
                <Search size={13} style={{ position: "absolute", left: 9, top: "50%", transform: "translateY(-50%)", color: "hsl(var(--muted-foreground))" }} />
                <input
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  placeholder="Search project or title…"
                  aria-label="Search projects"
                  style={{
                    padding: "6px 10px 6px 28px", fontSize: 12.5, borderRadius: 8, width: 220,
                    border: "1px solid hsl(var(--border))", background: "hsl(var(--background))",
                    color: "hsl(var(--foreground))", outline: "none",
                  }}
                />
              </div>
              <span style={{ fontSize: 11.5, color: "hsl(var(--muted-foreground))" }}>
                {search.trim() ? `${rows.length} of ${allRows.length} projects` : `${allRows.length} projects`} · click a row for the project's graph and detail
              </span>
              <div style={{ display: "flex", gap: 6, marginLeft: "auto" }}>
                <button
                  type="button"
                  onClick={() => runExport("xlsx")}
                  disabled={exportBusy !== null || rows.length === 0}
                  aria-label="Export the table to Excel"
                  title={rows.length === 0 ? "No projects to export" : "Download the filtered table as .xlsx"}
                  style={exportBtnStyle(exportBusy !== null || rows.length === 0)}
                ><FileSpreadsheet size={13} /> {exportBusy === "xlsx" ? "Exporting…" : "Excel"}</button>
                <button
                  type="button"
                  onClick={() => runExport("csv")}
                  disabled={exportBusy !== null || rows.length === 0}
                  aria-label="Export the table to CSV"
                  title={rows.length === 0 ? "No projects to export" : "Download the filtered table as .csv"}
                  style={exportBtnStyle(exportBusy !== null || rows.length === 0)}
                ><FileSpreadsheet size={13} /> {exportBusy === "csv" ? "Exporting…" : "CSV"}</button>
              </div>
            </div>
            <div style={{ overflowX: "auto" }}>
              <table style={{ borderCollapse: "separate", borderSpacing: 0, width: "100%", fontSize: 12.5, minWidth: 960 }}>
                <thead>
                  <tr>
                    <th style={{ ...thStyle, textAlign: "left" }}>Project</th>
                    <SortTh label="Actual to Date" k="actual" sort={sort} onSort={clickSort} />
                    <SortTh label="Remaining Forecast" k="remaining" sort={sort} onSort={clickSort} />
                    <SortTh label="Forecast at Completion" k="fac" sort={sort} onSort={clickSort} />
                    <SortTh label="Hours Variance" k="hoursVar" sort={sort} onSort={clickSort} />
                    <SortTh label="Cost Variance" k="costVar" sort={sort} onSort={clickSort} />
                    <SortTh label="% Used" k="pctUsed" sort={sort} onSort={clickSort} />
                    <th style={thStyle}>As of</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.length === 0 ? (
                    <tr>
                      <td colSpan={8} style={{ ...tdStyle, textAlign: "center", color: "hsl(var(--muted-foreground))", padding: 20 }}>
                        No projects match this search.
                      </td>
                    </tr>
                  ) : rows.map((r) => (
                    <tr
                      key={r.ticket}
                      tabIndex={0}
                      aria-label={`${r.ticket}${r.title ? ` ${r.title}` : ""}: open detail popup`}
                      style={{ cursor: "pointer" }}
                      onClick={() => setPopupTicket(r.ticket)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter" || e.key === " ") { e.preventDefault(); setPopupTicket(r.ticket); }
                      }}
                    >
                      <td style={{ ...tdStyle, textAlign: "left", maxWidth: 340 }}>
                        <span style={{ color: BLUE, fontWeight: 600 }}>{r.ticket}</span>
                        {r.title && (
                          <span style={{
                            color: "hsl(var(--muted-foreground))", marginLeft: 6,
                            display: "inline-block", maxWidth: 230, overflow: "hidden",
                            textOverflow: "ellipsis", whiteSpace: "nowrap", verticalAlign: "bottom",
                          }}>{r.title}</span>
                        )}
                        {r.substituted && <MiniChip text="substituted" warn />}
                        {r.backfilled && <MiniChip text="reconstructed" />}
                      </td>
                      <td style={tdStyle}>{r.hasActuals ? fmtV(r.actual) : "Not imported"}</td>
                      <td style={tdStyle}>{fmtV(r.remaining)}</td>
                      <td style={tdStyle}>{r.hasActuals ? fmtV(r.fac) : "—"}</td>
                      <td style={{ ...tdStyle, color: r.hasActuals ? (r.hoursVar > 0 ? GREEN : r.hoursVar < 0 ? RED : "hsl(var(--muted-foreground))") : undefined, fontWeight: 600 }}>{r.hasActuals ? `${fmtNum(r.hoursVar)} h` : "—"}</td>
                      <td style={{ ...tdStyle, color: r.costVar > 0 ? GREEN : r.costVar < 0 ? RED : "hsl(var(--muted-foreground))", fontWeight: 600 }}>{fmtUsd(r.costVar)}</td>
                      <td style={tdStyle}>{r.pctUsed != null ? `${fmtNum(r.pctUsed)}%` : "—"}</td>
                      <td style={{ ...tdStyle, color: "hsl(var(--muted-foreground))" }}>{r.week}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          {/* definitions — the client's approved calculation wording */}
          <div style={{ ...card, background: "hsl(var(--muted))" }}>
            <div style={{ display: "flex", alignItems: "center", gap: 7, fontSize: 13, fontWeight: 700, marginBottom: 8 }}>
              <Info size={14} style={{ color: "hsl(var(--muted-foreground))" }} /> Definitions
            </div>
            <ul style={{ margin: 0, paddingLeft: 18, fontSize: 12.5, color: "hsl(var(--muted-foreground))" }}>
              <li style={liStyle}><b>Actual to Date</b> — cumulative actual hours / labor cost recorded through each project's latest reporting week.</li>
              <li style={liStyle}><b>Remaining Forecast</b> — forecasted hours / cost for periods after the reporting week (future periods only).</li>
              <li style={liStyle}><b>Forecast at Completion</b> — Actual to Date <b>plus</b> Remaining Forecast: where the project is now expected to finish.</li>
              <li style={liStyle}><b>Hours Variance / Cost Variance</b> — forecast through the reporting week − actuals through the reporting week. <span style={{ color: GREEN, fontWeight: 600 }}>Green</span> = forecast exceeds actuals (favorable); <span style={{ color: RED, fontWeight: 600 }}>red</span> = actuals exceed forecast.</li>
              <li style={liStyle}><b>% Used</b> — Actual to Date ÷ Forecast at Completion: how much of the completion forecast is already consumed.</li>
              <li style={liStyle}><b>Frozen weekly snapshots</b> — figures are stored as each week closes and never rewritten from today's plan. The forecast includes unstaffed (open) demand.</li>
            </ul>
          </div>

          {/* disclosures */}
          <div style={{ fontSize: 11.5, color: "hsl(var(--muted-foreground))", display: "flex", flexDirection: "column", gap: 4 }}>
            {rollup.unrated > 0 && (
              <span style={{ color: "#b45309" }}>⚠ {fmtNum(rollup.unrated)} actual hours across the portfolio have no rate and are counted at $0.</span>
            )}
            {rollup.substituted > 0 && (
              <span style={{ color: "#b45309" }}>⚠ Includes {fmtNum(rollup.substituted)} h of planned hours substituted as actuals (setting enabled).</span>
            )}
            {rollup.backfilled > 0 && (
              <span>{rollup.backfilled} project{rollup.backfilled === 1 ? "'s" : "s'"} history includes points reconstructed from the current plan (added before weekly snapshots began).</span>
            )}
          </div>
        </>
      )}

      {popupSeed && (
        <ExecForecastPopup
          ticket={popupSeed.ticket}
          title={titles.get(popupSeed.ticket) ?? ""}
          seed={popupSeed}
          currentWeek={currentWeek}
          initialUnit={unit}
          onClose={() => setPopupTicket(null)}
        />
      )}
    </div>
  );
}

function SortTh({ label, k, sort, onSort }: {
  label: string; k: SortKey;
  sort: { key: SortKey; dir: "asc" | "desc" };
  onSort: (k: SortKey) => void;
}) {
  const active = sort.key === k;
  return (
    <th aria-sort={active ? (sort.dir === "asc" ? "ascending" : "descending") : undefined} style={thStyle}>
      <button
        type="button"
        onClick={() => onSort(k)}
        style={{
          all: "unset", cursor: "pointer", userSelect: "none",
          font: "inherit", color: "inherit", whiteSpace: "nowrap",
        }}
      >
        {label}{active ? (sort.dir === "asc" ? " ↑" : " ↓") : ""}
      </button>
    </th>
  );
}

function Kpi({ label, value, sub, tone }: { label: string; value: string; sub?: string; tone?: "good" | "bad" }) {
  return (
    <div style={{ ...card, padding: "10px 14px" }}>
      <div style={{ fontSize: 11, color: "hsl(var(--muted-foreground))", fontWeight: 600, textTransform: "uppercase", letterSpacing: 0.4 }}>{label}</div>
      <div style={{
        fontSize: 18, fontWeight: 750, marginTop: 2, fontVariantNumeric: "tabular-nums",
        color: tone === "good" ? GREEN : tone === "bad" ? RED : "hsl(var(--foreground))",
      }}>{value}</div>
      {sub && <div style={{ fontSize: 11, color: "hsl(var(--muted-foreground))", marginTop: 1 }}>{sub}</div>}
    </div>
  );
}

function MiniChip({ text, warn }: { text: string; warn?: boolean }) {
  return (
    <span style={{
      display: "inline-block", marginLeft: 6, padding: "1px 6px", borderRadius: 999, fontSize: 10,
      border: `1px solid ${warn ? "#d9770640" : "hsl(var(--border))"}`,
      color: warn ? "#b45309" : "hsl(var(--muted-foreground))", background: warn ? "#d977060d" : "transparent",
      verticalAlign: "middle",
    }}>{text}</span>
  );
}

function NoticePage({ icon, title, body }: { icon: React.ReactNode; title: string; body: string }) {
  return (
    <div style={{ padding: 24, display: "flex", justifyContent: "center", marginTop: 40 }}>
      <div style={{ ...card, display: "flex", gap: 12, alignItems: "flex-start", maxWidth: 620 }}>
        <div style={{ marginTop: 2 }}>{icon}</div>
        <div>
          <div style={{ fontSize: 14, fontWeight: 700 }}>{title}</div>
          <div style={{ fontSize: 13, color: "hsl(var(--muted-foreground))", marginTop: 4 }}>{body}</div>
        </div>
      </div>
    </div>
  );
}

const exportBtnStyle = (disabled: boolean): React.CSSProperties => ({
  display: "inline-flex", alignItems: "center", gap: 5, padding: "6px 10px", borderRadius: 8,
  border: "1px solid hsl(var(--border))", fontSize: 12, fontWeight: 600,
  cursor: disabled ? "default" : "pointer", opacity: disabled ? 0.5 : 1,
  color: "hsl(var(--foreground))", background: "hsl(var(--card))",
});
const liStyle: React.CSSProperties = { marginBottom: 6, lineHeight: 1.5 };

const thStyle: React.CSSProperties = {
  padding: "8px 12px", fontSize: 11.5, textAlign: "right", whiteSpace: "nowrap",
  borderBottom: "1px solid hsl(var(--border))", background: "hsl(var(--muted))",
  color: "hsl(var(--muted-foreground))",
};
const tdStyle: React.CSSProperties = {
  padding: "7px 12px", textAlign: "right", whiteSpace: "nowrap",
  borderBottom: "1px solid hsl(var(--border))", fontVariantNumeric: "tabular-nums",
};
