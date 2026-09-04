/**
 * Actuals vs Forecast — per-project graph (deliverable 1 of 3).
 *
 * Blue line = Forecast Total at Completion (actuals-to-date + remaining plan,
 * i.e. the EAC), green line = cumulative Actuals to Date. The two lines
 * converge at project completion. History comes from FROZEN weekly snapshots
 * (never recomputed from today's plan); filtered views are recomputed live
 * from the detail table and say so.
 *
 * Sign convention (differs from the legacy tool, on purpose):
 *   variance = forecast-to-date − actual-to-date, POSITIVE = favorable.
 */
import { useEffect, useMemo, useRef, useState } from "react";
import { Link } from "wouter";
import {
  Loader2, AlertTriangle, Lock, TrendingUp, Upload, RefreshCw, Info,
  ChevronLeft, ChevronRight, ChevronDown, Flag,
} from "lucide-react";
import {
  getAfOverview, getAfProject, getModuleRecords, rebuildAfSnapshots,
  type AfOverview, type AfProjectData, type AfWeekRow,
} from "@/lib/api";
import { useAuth } from "@/lib/useAuth";
import {
  toPoints, pickPeriodKind, seriesFromDetail, filterDetail, latestAtOrBefore,
  lastWeek, parseMoneyish, fmtNum, fmtUsd, mondayIsoOf, bucketKeyOf, pointValueOf, round2,
  buildAfPersonChoices, afDetailMetricAt, afPickerAnchorPoint,
  UNIT_LABEL, type AfUnit, type AfPoint, type AfMetric, type AfPersonChoice,
} from "@/lib/afMath";
import { compactUsd } from "@/lib/money";
import { AfExplainPopup } from "@/components/AfExplainPopup";
import { AfPeoplePickerPopup } from "@/components/AfPeoplePickerPopup";
import {
  ResponsiveContainer, ComposedChart, Line, XAxis, YAxis, CartesianGrid,
  Tooltip as RTooltip, Legend, ReferenceLine, LabelList,
} from "recharts";

const BLUE = "#2563eb";   // forecast total at completion (EAC)
const GREEN = "#16a34a";  // actual to date
const GRAY = "#94a3b8";   // plan to date (context line)
const AMBER = "#d97706";  // milestones

const PAGE_SIZE = 12; // periods shown at a time (client requirement)

const card: React.CSSProperties = {
  background: "hsl(var(--card))",
  border: "1px solid hsl(var(--border))",
  borderRadius: 12,
  padding: 16,
};

function fmtVal(unit: AfUnit, v: number): string {
  return unit === "hours" ? `${fmtNum(v)} h` : fmtUsd(v);
}

/** Short milestone code for chart/table annotations ("Schematic Design" → "SD");
 * short names ("Bid") stay as-is. Full titles appear in header tooltips. */
function milestoneCode(title: string): string {
  const t = title.trim();
  if (t.length <= 4) return t;
  const initials = t.split(/[\s/&-]+/).filter(Boolean).map((w) => w[0]!.toUpperCase()).join("");
  return initials.slice(0, 4) || t.slice(0, 4);
}

export default function ActualsForecastPage() {
  const { user } = useAuth();
  const isAdmin = user?.isAdmin === true;

  const [overview, setOverview] = useState<AfOverview | null | undefined>(undefined);
  const [recordMap, setRecordMap] = useState<Map<string, { title: string; contract: number | null }>>(new Map());
  const [ticket, setTicket] = useState<string>(() => {
    try { return new URLSearchParams(window.location.search).get("ticket") ?? ""; } catch { return ""; }
  });
  const [data, setData] = useState<AfProjectData | null | undefined>(undefined);
  const [unit, setUnit] = useState<AfUnit>("hours");
  const [division, setDivision] = useState<string | null>(null); // null = all
  const [person, setPerson] = useState<string | null>(null);     // null = all
  const [peoplePopupOpen, setPeoplePopupOpen] = useState(false);
  const [pageOffset, setPageOffset] = useState(0); // 0 = latest window; grows to the past
  const [rebuilding, setRebuilding] = useState(false);
  const [rebuildMsg, setRebuildMsg] = useState<string | null>(null);
  // Click-to-explain: which table cell / chart point is being explained.
  const [explain, setExplain] = useState<{ point: AfPoint; unit: AfUnit; metric: AfMetric; personKey?: string } | null>(null);
  const loadSeq = useRef(0);

  useEffect(() => {
    let alive = true;
    getAfOverview().then((o) => { if (alive) setOverview(o); });
    Promise.all([getModuleRecords("PMM").catch(() => null), getModuleRecords("OPM").catch(() => null)])
      .then(([pmm, opm]) => {
        if (!alive) return;
        const m = new Map<string, { title: string; contract: number | null }>();
        for (const list of [pmm?.data, opm?.data]) {
          for (const r of list ?? []) {
            const id = String((r as Record<string, unknown>).TicketId ?? "").trim();
            if (!id) continue;
            const rec = r as Record<string, unknown>;
            m.set(id, {
              title: String(rec.Title ?? rec.ProjectTitle ?? "").trim(),
              contract: parseMoneyish(rec.ContractValue),
            });
          }
        }
        setRecordMap(m);
      });
    return () => { alive = false; };
  }, []);

  // Default project: first ticket in the overview once it arrives.
  useEffect(() => {
    if (ticket || !overview || !("available" in overview) || !overview.available) return;
    const first = overview.projects[0]?.ticket;
    if (first) setTicket(first);
  }, [overview, ticket]);

  // Load the selected project's series; keep the URL shareable.
  useEffect(() => {
    if (!ticket) return;
    const seq = ++loadSeq.current;
    setData(undefined);
    setDivision(null);
    setPerson(null);
    setPeoplePopupOpen(false);
    setPageOffset(0);
    setExplain(null);
    try {
      window.history.replaceState(null, "", `/actuals-forecast?ticket=${encodeURIComponent(ticket)}`);
    } catch { /* history unavailable */ }
    getAfProject(ticket).then((d) => { if (loadSeq.current === seq) setData(d); });
  }, [ticket]);

  const available = data && "available" in data && data.available ? data : null;
  const buildInProgress = !!overview && "available" in overview && overview.available && overview.building === true;

  const filtered = division !== null || person !== null;
  // Detail rows in scope for the active filter — feeds the filtered series
  // AND the click-to-explain popup breakdowns (same rows, same truth).
  const detailRows = useMemo(() => {
    if (!available) return [];
    if (!filtered) return available.detail;
    const f: { division?: string; person?: string } = {};
    if (division !== null) f.division = division;
    if (person !== null) f.person = person;
    return filterDetail(available.detail, f);
  }, [available, filtered, division, person]);
  const weeks: AfWeekRow[] = useMemo(() => {
    if (!available) return [];
    if (!filtered) return available.weeks;
    return seriesFromDetail(detailRows);
  }, [available, filtered, detailRows]);

  const kind = pickPeriodKind(weeks.length);
  const unitNoun = unit === "hours" ? "Hours" : unit === "cost" ? "Labor Cost" : "Billing";
  const ptLabel = (v: number) => (unit === "hours" ? fmtNum(v) : compactUsd(v));
  const points = useMemo(
    () => (available ? toPoints(weeks, unit, kind, available.currentWeek) : []),
    [available, weeks, unit, kind],
  );
  // 12-period window with ‹ › paging (offset counts windows back from "now").
  const windowed: AfPoint[] = useMemo(() => {
    const end = Math.max(0, points.length - pageOffset * PAGE_SIZE);
    return points.slice(Math.max(0, end - PAGE_SIZE), end);
  }, [points, pageOffset]);
  const chartPoints = useMemo(
    () => windowed.map((p) => p.actualsCovered ? p : { ...p, actualTd: null, eac: null }),
    [windowed],
  );
  const canOlder = points.length > (pageOffset + 1) * PAGE_SIZE;
  const canNewer = pageOffset > 0;

  // Milestones → visible bucket labels.
  const milestoneMarks = useMemo(() => {
    if (!available) return [] as { label: string; title: string }[];
    const byKey = new Map(windowed.map((p) => [p.key, p.label]));
    const out: { label: string; title: string }[] = [];
    for (const m of available.milestones) {
      const iso = m.dueDate ?? m.startDate;
      if (!iso) continue;
      const monday = mondayIsoOf(iso);
      if (!monday) continue;
      const lbl = byKey.get(bucketKeyOf(monday, kind));
      if (lbl && m.title) out.push({ label: lbl, title: m.title });
    }
    return out.slice(0, 12);
  }, [available, windowed, kind]);

  // Milestone titles per visible column label — feeds the table header codes.
  const milestonesByLabel = useMemo(() => {
    const m = new Map<string, string[]>();
    for (const mk of milestoneMarks) {
      const arr = m.get(mk.label) ?? [];
      arr.push(mk.title);
      m.set(mk.label, arr);
    }
    return m;
  }, [milestoneMarks]);

  // KPIs — always from the UNFILTERED frozen series.
  const kpis = useMemo(() => {
    if (!available) return null;
    const latest = latestAtOrBefore(available.weeks, available.currentWeek);
    const last = lastWeek(available.weeks);
    const planCost = last?.forecastCostTd ?? 0;
    const eacCost = latest?.forecastTotalCost ?? 0;
    const contract = recordMap.get(available.ticket)?.contract ?? null;
    return {
      contract,
      planCost,
      eacCost,
      targetMultiple: contract != null && planCost > 0 ? contract / planCost : null,
      forecastMultiple: contract != null && eacCost > 0 ? contract / eacCost : null,
      pctComplete: eacCost > 0 ? ((latest?.actualCostTd ?? 0) / eacCost) * 100 : null,
      latest,
    };
  }, [available, recordMap]);

  // 8-row summary table (hours block + cost block) over the visible periods,
  // in the client's approved row order: hours (actual / remaining / total),
  // costs (actual / remaining / total), then the two variance rows.
  // "Forecast Remaining" = Forecast Total at Completion − Actuals to Date
  // (the remaining plan as of that week); clicking a remaining cell opens the
  // Expected-total explanation, which shows the used / remaining split.
  const tableRows = useMemo(() => {
    if (!available) return [];
    const hrs = toPoints(weeks, "hours", kind, available.currentWeek);
    const cost = toPoints(weeks, "cost", kind, available.currentWeek);
    const hMap = new Map(hrs.map((p) => [p.key, p]));
    const cMap = new Map(cost.map((p) => [p.key, p]));
    const cols = windowed.map((p) => p.key);
    const row = (
      name: string, unitFam: AfUnit, valKind: AfMetric | "remaining",
      m: Map<string, AfPoint>, fmt: (v: number) => string,
      opts?: { varRow?: boolean; labelColor?: string; needsActuals?: boolean },
    ) => {
      const pts = cols.map((k) => m.get(k));
      const metric: AfMetric = valKind === "remaining" ? "eac" : valKind;
      return {
        name, unit: unitFam, metric, pts,
        vals: pts.map((p) => (p ? (valKind === "remaining" ? round2(p.eac - p.actualTd) : pointValueOf(p, valKind)) : 0)),
        fmt, varRow: opts?.varRow === true, labelColor: opts?.labelColor,
        needsActuals: opts?.needsActuals === true,
      };
    };
    return [
      row("Actual Hours To Date", "hours", "actual", hMap, (v) => fmtNum(v), { labelColor: GREEN, needsActuals: true }),
      row("Forecast Remaining Hours", "hours", "remaining", hMap, (v) => fmtNum(v)),
      row("Forecast Total Hours at Completion", "hours", "eac", hMap, (v) => fmtNum(v), { needsActuals: true }),
      row("Actual Labor Cost To Date", "cost", "actual", cMap, fmtUsd, { labelColor: GREEN, needsActuals: true }),
      row("Forecast Remaining Cost", "cost", "remaining", cMap, fmtUsd),
      row("Forecast Total Labor Cost at Completion", "cost", "eac", cMap, fmtUsd, { needsActuals: true }),
      row("Hours Variance (Actuals – Forecast)", "hours", "variance", hMap, (v) => fmtNum(v), { varRow: true, needsActuals: true }),
      row("Cost Variance (Actuals – Forecast)", "cost", "variance", cMap, fmtUsd, { varRow: true, needsActuals: true }),
    ];
  }, [available, weeks, kind, windowed]);

  const divisions = useMemo(() => {
    if (!available) return [];
    const s = new Set<string>();
    for (const r of available.detail) s.add(r.division);
    return [...s].sort((a, b) => (a || "~").localeCompare(b || "~"));
  }, [available]);

  const people = useMemo<AfPersonChoice[]>(
    () => (available ? buildAfPersonChoices(available.detail, available.weeks, available.currentWeek) : []),
    [available],
  );

  const selectedPersonName = person === null
    ? "All people"
    : people.find((p) => p.id === person)?.name ?? "Unknown team member";
  // Anchor for picker-triggered detail popups — ALWAYS from the unfiltered
  // frozen series: `points` above follow the ACTIVE filter, so choosing
  // person B while person A is selected must not anchor B's popup on A's
  // sparse (possibly future-only) timeline.
  const personDetailPoint = useMemo(
    () => (available ? afPickerAnchorPoint(available.weeks, available.currentWeek, unit) : null),
    [available, unit],
  );

  const choosePerson = (id: string | null) => {
    const detailPoint = personDetailPoint;
    setPeoplePopupOpen(false);
    setPerson(id);
    if (id === null || !detailPoint || !available) { setExplain(null); return; }
    // Route to the tab that actually has this person's rows AT the popup's
    // cutoff week and scope. Picker stats are to-date; the popup renders at
    // the anchor point, and the two cutoffs can legally differ (future-only
    // plans), so routing by picker stats could open an empty breakdown.
    const scoped = filterDetail(available.detail, division !== null ? { division, person: id } : { person: id });
    setExplain({ point: detailPoint, unit, metric: afDetailMetricAt(scoped, detailPoint.weekMonday, id, unit), personKey: id });
  };

  const substitutionShown = !!available && available.flags.usePlannedAsActualFallback &&
    !available.flags.useImportedActuals && (kpis?.latest?.substitutedHours ?? 0) > 0;
  const unrated = !filtered ? (kpis?.latest?.unratedActualHours ?? 0) : 0;
  const anyBackfilled = useMemo(() => windowed.some((p) => p.backfilled), [windowed]);

  /* ── shells ── */
  if (overview === undefined) {
    return <Center><Loader2 size={22} className="animate-spin" style={{ color: "hsl(var(--muted-foreground))" }} /></Center>;
  }
  if (overview === null) {
    return <Notice icon={<AlertTriangle size={20} style={{ color: "#d97706" }} />} title="Couldn't load Actuals vs Forecast"
      body="The server didn't answer. Check your connection and try again." />;
  }
  if (!overview.available) {
    return <Notice icon={<Lock size={20} style={{ color: "hsl(var(--muted-foreground))" }} />} title="Actuals vs Forecast isn't available"
      body={overview.reason ?? "This data isn't available for your account."} />;
  }

  const projects = overview.projects;

  return (
    <div style={{ padding: "20px 24px 40px", maxWidth: 1240, margin: "0 auto", display: "flex", flexDirection: "column", gap: 14 }}>
      {/* header */}
      <div style={{ display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
        <div style={{ width: 38, height: 38, borderRadius: 10, background: `${BLUE}15`, display: "flex", alignItems: "center", justifyContent: "center" }}>
          <TrendingUp size={19} style={{ color: BLUE }} />
        </div>
        <div style={{ minWidth: 0, flex: 1 }}>
          <h1 style={{ fontSize: 18, fontWeight: 700, margin: 0 }}>Actuals vs Forecast</h1>
          <div style={{ fontSize: 12, color: "hsl(var(--muted-foreground))" }}>
            Weekly point-in-time snapshots — history is frozen as it was reported, never rewritten.
          </div>
        </div>
        {isAdmin && (
          <Link href="/actuals-import" style={{ textDecoration: "none" }}>
            <span style={{
              display: "inline-flex", alignItems: "center", gap: 6, padding: "7px 12px", borderRadius: 8,
              border: "1px solid hsl(var(--border))", fontSize: 12.5, fontWeight: 600, cursor: "pointer",
              color: "hsl(var(--foreground))", background: "hsl(var(--card))",
            }}>
              <Upload size={14} /> Import Actuals
            </span>
          </Link>
        )}
      </div>

      {projects.length === 0 ? (
        <div style={{ ...card, display: "flex", flexDirection: "column", gap: 10, alignItems: "flex-start" }}>
          <div style={{ fontSize: 14, fontWeight: 600 }}>{buildInProgress ? "Snapshots are building now" : "No snapshots yet"}</div>
          <div style={{ fontSize: 13, color: "hsl(var(--muted-foreground))", maxWidth: 640 }}>
            {buildInProgress ? (
              "The build is running — projects appear as they finish, most recent first. Large workspaces can take a few minutes. Refresh to check progress."
            ) : (
              <>
                Snapshots build automatically every hour from the current plan and any imported actuals.
                {isAdmin ? " You can import actual hours or build the first snapshot now." : " Check back soon, or ask an administrator to import actual hours."}
              </>
            )}
          </div>
          {isAdmin && (
            <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
              <button
                type="button"
                disabled={rebuilding || buildInProgress}
                onClick={async () => {
                  setRebuilding(true); setRebuildMsg(null);
                  try {
                    const r = await rebuildAfSnapshots({});
                    const o = await getAfOverview();
                    setOverview(o);
                    setRebuildMsg((r as { started?: boolean }).started
                      ? "Build started — projects appear as they finish, most recent first. Refresh in a few minutes."
                      : "Snapshots built.");
                  } catch (e) {
                    const msg = e instanceof Error ? e.message : String(e);
                    setRebuildMsg(/rebuild_in_progress/i.test(msg)
                      ? "A snapshot build is already running — refresh in a few minutes."
                      : `Build failed: ${msg}`);
                  } finally { setRebuilding(false); }
                }}
                style={{
                  display: "inline-flex", alignItems: "center", gap: 6, padding: "7px 12px", borderRadius: 8,
                  border: "none", fontSize: 12.5, fontWeight: 600, cursor: rebuilding ? "wait" : "pointer",
                  color: "#fff", background: BLUE, opacity: rebuilding ? 0.7 : 1,
                }}
              >
                {rebuilding || buildInProgress ? <Loader2 size={14} className="animate-spin" /> : <RefreshCw size={14} />} {buildInProgress ? "Build running…" : "Build snapshots now"}
              </button>
              {rebuildMsg && <span style={{ fontSize: 12, color: "hsl(var(--muted-foreground))" }}>{rebuildMsg}</span>}
            </div>
          )}
        </div>
      ) : (
        <>
          {buildInProgress && (
            <div style={{ fontSize: 12.5, color: "hsl(var(--muted-foreground))", display: "flex", alignItems: "center", gap: 6 }}>
              <Loader2 size={13} className="animate-spin" /> Snapshot build in progress — more projects appear as they finish.
            </div>
          )}
          {/* controls — equal-width cells that fill the full row */}
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))", gap: 10, alignItems: "center" }}>
            <Select value={ticket} onChange={setTicket}
              options={projects.map((p) => ({
                value: p.ticket,
                label: recordMap.get(p.ticket)?.title ? `${p.ticket} — ${recordMap.get(p.ticket)!.title}` : p.ticket,
              }))} />
            <Segmented value={unit} onChange={(v) => { setUnit(v as AfUnit); setExplain(null); }}
              options={(["hours", "cost", "bill"] as AfUnit[]).map((u) => ({ value: u, label: UNIT_LABEL[u] }))} />
            {available && (
              <>
                <Select value={division === null ? "\u0000all" : division}
                  onChange={(v) => { setDivision(v === "\u0000all" ? null : v); setExplain(null); }}
                  options={[{ value: "\u0000all", label: "All divisions" },
                    ...divisions.map((d) => ({ value: d, label: d || "(No division)" }))]} />
                <button
                  type="button"
                  onClick={() => setPeoplePopupOpen(true)}
                  aria-haspopup="dialog"
                  aria-expanded={peoplePopupOpen}
                  style={{
                    display: "inline-flex", alignItems: "center", justifyContent: "space-between", gap: 8,
                    width: "100%", minWidth: 0, padding: "7px 10px", borderRadius: 8, fontSize: 12.5,
                    border: "1px solid hsl(var(--border))", background: "hsl(var(--card))",
                    color: "hsl(var(--foreground))", cursor: "pointer", textAlign: "left",
                  }}
                >
                  <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{selectedPersonName}</span>
                  <ChevronDown size={14} style={{ color: "hsl(var(--muted-foreground))", flexShrink: 0 }} />
                </button>
              </>
            )}
            <div style={{ display: "flex", alignItems: "center", gap: 6, justifyContent: "space-between" }}>
              <PagerBtn disabled={!canOlder} onClick={() => setPageOffset((o) => o + 1)}><ChevronLeft size={15} /></PagerBtn>
              <span style={{ fontSize: 12, color: "hsl(var(--muted-foreground))", flex: 1, minWidth: 0, textAlign: "center", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                {windowed.length ? `${windowed[0].label} – ${windowed[windowed.length - 1].label}` : "—"}
                <span style={{ opacity: 0.7 }}> · {kind === "week" ? "weekly" : kind === "month" ? "monthly" : "yearly"}</span>
              </span>
              <PagerBtn disabled={!canNewer} onClick={() => setPageOffset((o) => Math.max(0, o - 1))}><ChevronRight size={15} /></PagerBtn>
            </div>
          </div>

          {/* KPI strip */}
          {data === undefined ? (
            <Center small><Loader2 size={18} className="animate-spin" style={{ color: "hsl(var(--muted-foreground))" }} /></Center>
          ) : !available ? (
            <Notice inline icon={<AlertTriangle size={16} style={{ color: "#d97706" }} />} title="Couldn't load this project"
              body={data && "reason" in (data as object) ? String((data as { reason?: string }).reason ?? "") : "The server didn't answer — try again."} />
          ) : (
            <>
              {kpis && (
                <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))", gap: 10 }}>
                  <Kpi label="Target Multiple" value={kpis.targetMultiple != null ? `${fmtNum(kpis.targetMultiple)}×` : "—"} />
                  <Kpi label="Forecasted Multiple" value={kpis.forecastMultiple != null ? `${fmtNum(kpis.forecastMultiple)}×` : "—"}
                    tone={kpis.forecastMultiple != null && kpis.targetMultiple != null
                      ? (kpis.forecastMultiple >= kpis.targetMultiple ? "good" : "bad") : undefined} />
                  <Kpi label="Contract" value={kpis.contract != null ? fmtUsd(kpis.contract) : "—"} />
                  <Kpi label="Plan Cost" value={kpis.planCost > 0 ? fmtUsd(kpis.planCost) : "—"} />
                  <Kpi label="Forecast Cost at Completion" value={kpis.eacCost > 0 ? fmtUsd(kpis.eacCost) : "—"} />
                  <Kpi label="% Complete (cost)" value={kpis.pctComplete != null ? `${fmtNum(kpis.pctComplete)}%` : "—"} />
                </div>
              )}

              {/* chart */}
              <div style={card}>
                {windowed.length === 0 ? (
                  <div style={{ fontSize: 13, color: "hsl(var(--muted-foreground))", padding: 20, textAlign: "center" }}>
                    No snapshot weeks {filtered ? "match this filter" : "for this project yet"}.
                  </div>
                ) : (
                  <ResponsiveContainer width="100%" height={340}>
                    <ComposedChart
                      data={chartPoints}
                      margin={{ top: 20, right: 24, bottom: 8, left: 8 }}
                      style={{ cursor: "pointer" }}
                      onClick={(state) => {
                        // Click anywhere on a period → explain that period.
                        // Opens on the blue headline line (Expected total);
                        // the popup has a switcher for the other metrics.
                        const pt = (state as unknown as { activePayload?: Array<{ payload?: AfPoint }> } | null)
                          ?.activePayload?.[0]?.payload;
                        if (pt) setExplain({ point: pt, unit, metric: "eac" });
                      }}>
                      <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                      <XAxis dataKey="label" tick={{ fontSize: 11 }} />
                      <YAxis tick={{ fontSize: 11 }} width={64}
                        tickFormatter={(v: number) => (unit === "hours" ? fmtNum(v) : fmtUsd(v))} />
                      <RTooltip
                        formatter={(v: number | string, name: string) => [fmtVal(unit, Number(v)), name]}
                        labelFormatter={(l: string, payload) => {
                          const p = Array.isArray(payload) && payload[0]?.payload as AfPoint | undefined;
                          const extra = p ? ` · week of ${p.weekMonday}${p.final ? "" : " (open)"}${p.backfilled ? " · reconstructed" : ""}` : "";
                          return `${l}${extra}`;
                        }}
                        contentStyle={{ fontSize: 12, borderRadius: 8 }} />
                      <Legend wrapperStyle={{ fontSize: 12 }} />
                      {milestoneMarks.map((m, i) => (
                        <ReferenceLine key={`ms-${i}`} x={m.label} stroke={AMBER} strokeDasharray="4 3"
                          label={{ value: milestoneCode(m.title), position: "insideTopRight", fontSize: 10, fontWeight: 700, fill: AMBER }} />
                      ))}
                      <Line type="monotone" dataKey="forecastTd" name="Plan to Date" stroke={GRAY} strokeDasharray="5 4" strokeWidth={1.6} dot={false} />
                      <Line type="monotone" dataKey="eac" name={`Forecast (Total ${unitNoun} at Completion)`} stroke={BLUE} strokeWidth={2.4}
                        dot={{ r: 2.5 }} activeDot={{ r: 4 }}>
                        <LabelList dataKey="eac" position="top" offset={9}
                          formatter={(v: React.ReactNode) => ptLabel(Number(v))}
                          style={{ fontSize: 9.5, fontWeight: 600, fill: BLUE, pointerEvents: "none" }} />
                      </Line>
                      <Line type="monotone" dataKey="actualTd" name={`Actuals (${unitNoun})`} stroke={GREEN} strokeWidth={2.4}
                        dot={{ r: 2.5 }} activeDot={{ r: 4 }}>
                        <LabelList dataKey="actualTd" position="bottom" offset={9}
                          formatter={(v: React.ReactNode) => ptLabel(Number(v))}
                          style={{ fontSize: 9.5, fontWeight: 600, fill: GREEN, pointerEvents: "none" }} />
                      </Line>
                    </ComposedChart>
                  </ResponsiveContainer>
                )}
                {/* disclosures */}
                <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginTop: 8 }}>
                  <Chip icon={<Info size={11} />} text="Click any chart point or table number to see where it comes from." />
                  {milestoneMarks.length > 0 && <Chip icon={<Flag size={11} />} text={`${milestoneMarks.length} milestone${milestoneMarks.length === 1 ? "" : "s"} in view`} />}
                  {filtered && <Chip warn text="Filtered view — recomputed from today's detail, not the frozen weekly snapshots." />}
                  {substitutionShown && <Chip warn text={`Includes ${fmtNum(kpis?.latest?.substitutedHours ?? 0)} h of planned hours substituted as actuals (setting enabled).`} />}
                  {unrated > 0 && <Chip warn text={`${fmtNum(unrated)} actual hours have no rate and are counted at $0.`} />}
                  {anyBackfilled && <Chip text="Some points were reconstructed from the current plan (marked in tooltips) — added before weekly snapshots began." />}
                  <Chip text="Forecast includes unstaffed (open) demand." />
                </div>
              </div>

              {/* period table */}
              <div style={{ ...card, padding: 0, overflow: "hidden" }}>
                <div style={{ padding: "7px 14px", fontSize: 11.5, color: "hsl(var(--muted-foreground))", borderBottom: "1px solid hsl(var(--border))", display: "flex", alignItems: "center", gap: 6 }}>
                  <Info size={12} /> Click any number to see exactly where it comes from — who the hours belong to and how it was calculated.
                </div>
                <div style={{ overflowX: "auto" }}>
                  <table style={{ borderCollapse: "separate", borderSpacing: 0, width: "100%", fontSize: 12.5, minWidth: 720 }}>
                    <thead>
                      <tr>
                        <th style={{ ...thStyle, position: "sticky", left: 0, zIndex: 2, textAlign: "left", minWidth: 210 }}>Metric</th>
                        {windowed.map((p) => {
                          const ms = milestonesByLabel.get(p.label);
                          return (
                            <th key={p.key} title={ms?.join(" · ")} style={{ ...thStyle, fontWeight: p.isCurrent ? 800 : 600 }}>
                              {p.label}{p.isCurrent ? " •" : ""}
                              {ms && (
                                <div style={{ fontSize: 9.5, color: AMBER, fontWeight: 700, lineHeight: 1.2 }}>
                                  {ms.map(milestoneCode).join(" ")}
                                </div>
                              )}
                            </th>
                          );
                        })}
                      </tr>
                    </thead>
                    <tbody>
                      {tableRows.map((r) => (
                        <tr key={r.name}>
                          <td style={{
                            ...tdStyle, position: "sticky", left: 0, zIndex: 1, background: "hsl(var(--card))",
                            fontWeight: 600, textAlign: "left", whiteSpace: "normal", minWidth: 210, maxWidth: 230,
                            lineHeight: 1.3, color: r.labelColor,
                          }}>{r.name}</td>
                          {r.vals.map((v, i) => {
                            const pt = r.pts[i];
                            const missingActuals = !!pt && r.needsActuals && !pt.actualsCovered;
                            const displayValue = missingActuals
                              ? (r.metric === "actual" ? "Not imported" : "—")
                              : r.fmt(v);
                            return (
                              <td key={i}
                                onClick={pt ? () => setExplain({ point: pt, unit: r.unit, metric: r.metric }) : undefined}
                                title={pt ? "See where this number comes from" : undefined}
                                style={{
                                  ...tdStyle,
                                   color: r.varRow && !missingActuals ? (round2(v) > 0 ? GREEN : round2(v) < 0 ? "#dc2626" : "hsl(var(--muted-foreground))") : undefined,
                                  fontWeight: r.varRow ? 600 : 400,
                                  cursor: pt ? "pointer" : undefined,
                                }}>
                                {pt ? (
                                  <span
                                    role="button"
                                    tabIndex={0}
                                    aria-label={`${r.name}, ${windowed[i]?.label ?? ""}: see where this number comes from`}
                                    onKeyDown={(e) => {
                                      if (e.key === "Enter" || e.key === " ") {
                                        e.preventDefault();
                                        setExplain({ point: pt, unit: r.unit, metric: r.metric });
                                      }
                                    }}
                                    style={{ textDecoration: "underline dotted", textUnderlineOffset: 3, textDecorationColor: "hsl(var(--muted-foreground) / 0.45)", cursor: "pointer", outlineOffset: 2 }}
                                  >
                                     {displayValue}
                                  </span>
                                 ) : displayValue}
                              </td>
                            );
                          })}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>

              <LegendCards unit={unit} />

              <Definitions />

              {explain && (
                <AfExplainPopup
                  ticket={available.ticket}
                  projectTitle={recordMap.get(available.ticket)?.title ?? ""}
                  point={explain.point}
                  unit={explain.unit}
                  initialMetric={explain.metric}
                  initialPersonKey={explain.personKey}
                  periodKind={kind}
                  detail={detailRows}
                  filtered={filtered}
                  flags={available.flags}
                  seriesStartWeek={available.weeks[0]?.weekMonday ?? null}
                  onClose={() => setExplain(null)}
                />
              )}
              {peoplePopupOpen && (
                <AfPeoplePickerPopup
                  projectTitle={recordMap.get(available.ticket)?.title ?? ""}
                  choices={people}
                  selectedId={person}
                  onSelect={choosePerson}
                  onClose={() => setPeoplePopupOpen(false)}
                />
              )}
            </>
          )}
        </>
      )}
    </div>
  );
}

/* ── small building blocks ────────────────────────────────────────────── */

function Center({ children, small }: { children: React.ReactNode; small?: boolean }) {
  return <div style={{ display: "flex", alignItems: "center", justifyContent: "center", minHeight: small ? 80 : "45vh" }}>{children}</div>;
}

function Notice({ icon, title, body, inline }: { icon: React.ReactNode; title: string; body: string; inline?: boolean }) {
  const inner = (
    <div style={{ ...card, display: "flex", gap: 12, alignItems: "flex-start", maxWidth: 620 }}>
      <div style={{ marginTop: 2 }}>{icon}</div>
      <div>
        <div style={{ fontSize: 14, fontWeight: 700 }}>{title}</div>
        <div style={{ fontSize: 13, color: "hsl(var(--muted-foreground))", marginTop: 4 }}>{body}</div>
      </div>
    </div>
  );
  if (inline) return inner;
  return <div style={{ padding: 24, display: "flex", justifyContent: "center", marginTop: 40 }}>{inner}</div>;
}

function Kpi({ label, value, tone }: { label: string; value: string; tone?: "good" | "bad" }) {
  return (
    <div style={{ ...card, padding: "10px 14px" }}>
      <div style={{ fontSize: 11, color: "hsl(var(--muted-foreground))", fontWeight: 600, textTransform: "uppercase", letterSpacing: 0.4 }}>{label}</div>
      <div style={{
        fontSize: 18, fontWeight: 750, marginTop: 2, fontVariantNumeric: "tabular-nums",
        color: tone === "good" ? GREEN : tone === "bad" ? "#dc2626" : "hsl(var(--foreground))",
      }}>{value}</div>
    </div>
  );
}

function Chip({ text, icon, warn }: { text: string; icon?: React.ReactNode; warn?: boolean }) {
  return (
    <span style={{
      display: "inline-flex", alignItems: "center", gap: 5, padding: "3px 9px", borderRadius: 999,
      fontSize: 11, border: `1px solid ${warn ? "#d9770640" : "hsl(var(--border))"}`,
      background: warn ? "#d977060d" : "hsl(var(--muted))", color: warn ? "#b45309" : "hsl(var(--muted-foreground))",
    }}>{icon}{text}</span>
  );
}

function Select({ value, onChange, options, width }: {
  value: string; onChange: (v: string) => void;
  options: { value: string; label: string }[]; width?: number;
}) {
  return (
    <select value={value} onChange={(e) => onChange(e.target.value)}
      style={{
        maxWidth: width ?? "100%", width: "100%", minWidth: 0, padding: "7px 10px", borderRadius: 8, fontSize: 12.5,
        border: "1px solid hsl(var(--border))", background: "hsl(var(--card))", color: "hsl(var(--foreground))",
      }}>
      {options.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
    </select>
  );
}

function Segmented({ value, onChange, options }: {
  value: string; onChange: (v: string) => void; options: { value: string; label: string }[];
}) {
  return (
    <div style={{ display: "flex", width: "100%", border: "1px solid hsl(var(--border))", borderRadius: 8, overflow: "hidden" }}>
      {options.map((o) => (
        <button key={o.value} type="button" onClick={() => onChange(o.value)}
          style={{
            flex: 1, padding: "7px 12px", fontSize: 12, fontWeight: 600, border: "none", cursor: "pointer",
            background: o.value === value ? "#2563eb" : "hsl(var(--card))",
            color: o.value === value ? "#fff" : "hsl(var(--muted-foreground))",
          }}>{o.label}</button>
      ))}
    </div>
  );
}

function PagerBtn({ disabled, onClick, children }: { disabled: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button type="button" disabled={disabled} onClick={onClick}
      style={{
        width: 26, height: 26, borderRadius: 7, border: "1px solid hsl(var(--border))",
        background: "hsl(var(--card))", color: disabled ? "hsl(var(--border))" : "hsl(var(--foreground))",
        display: "inline-flex", alignItems: "center", justifyContent: "center", cursor: disabled ? "default" : "pointer",
      }}>{children}</button>
  );
}

function Definitions() {
  const li: React.CSSProperties = { marginBottom: 6, lineHeight: 1.5 };
  return (
    <div style={{ ...card, background: "hsl(var(--muted))" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 7, fontSize: 13, fontWeight: 700, marginBottom: 8 }}>
        <Info size={14} style={{ color: "hsl(var(--muted-foreground))" }} /> Definitions
      </div>
      <ul style={{ margin: 0, paddingLeft: 18, fontSize: 12.5, color: "hsl(var(--muted-foreground))" }}>
        <li style={li}><b>Actual to Date (green)</b> — cumulative imported actual hours/cost through each week.</li>
        <li style={li}><b>Forecast Total at Completion (blue)</b> — actuals to date <b>plus</b> the remaining plan as it stood that week. The blue and green lines converge at completion.</li>
        <li style={li}><b>Plan to Date (gray)</b> — what the plan expected to be spent by that week.</li>
        <li style={li}><b>Forecast Remaining</b> — the plan still ahead as of that week: Forecast Total at Completion − Actuals to Date.</li>
        <li style={li}><b>Variance = Plan to Date − Actual to Date.</b> Positive is favorable (under plan). Note: the legacy tool sometimes showed this with the opposite sign; these numbers follow this definition consistently.</li>
        <li style={li}><b>Frozen history</b> — each week's snapshot is stored when the week closes and never recomputed from today's plan. Later corrections to actuals update the actual/variance figures only. Points added for weeks before snapshots began are reconstructed from the current plan and marked accordingly.</li>
        <li style={li}><b>Multiples</b> — Target = Contract ÷ Plan Cost; Forecasted = Contract ÷ Forecast Cost at Completion; % Complete = Actual Cost TD ÷ Forecast Cost at Completion.</li>
        <li style={li}><b>Unstaffed demand is included</b> in the forecast (unlike the Financial analytics page, which counts staffed assignments only).</li>
        <li style={li}><b>Filtered views</b> (division / person) are recomputed from the current detail table and may differ from the frozen weekly totals.</li>
      </ul>
    </div>
  );
}

/** Reading guide under the table — mirrors the client's approved legend. */
function LegendCards({ unit }: { unit: AfUnit }) {
  const noun = unit === "hours" ? "labor hours" : unit === "cost" ? "labor cost" : "billing";
  const Noun = unit === "hours" ? "Hours" : unit === "cost" ? "Labor Cost" : "Billing";
  const item: React.CSSProperties = { ...card, padding: "10px 14px", flex: "1 1 200px", minWidth: 200 };
  const head: React.CSSProperties = { display: "flex", alignItems: "center", gap: 7, fontSize: 12.5, fontWeight: 700 };
  const body: React.CSSProperties = { fontSize: 11.5, color: "hsl(var(--muted-foreground))", marginTop: 4, lineHeight: 1.45 };
  const dot = (color: string, hollow?: boolean): React.CSSProperties => ({
    width: 10, height: 10, borderRadius: 999, flexShrink: 0,
    background: hollow ? "transparent" : color, border: `2px solid ${color}`,
  });
  return (
    <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
      <div style={item}>
        <div style={head}><span style={dot(BLUE)} /> Forecast (Total {Noun} at Completion)</div>
        <div style={body}>System forecast of total {noun} at completion — actuals to date plus the remaining plan.</div>
      </div>
      <div style={item}>
        <div style={head}><span style={dot(GREEN)} /> Actuals ({Noun})</div>
        <div style={body}>Logged actual {noun}.</div>
      </div>
      <div style={item}>
        <div style={head}><span style={dot(AMBER, true)} /> Milestone</div>
        <div style={body}>Key milestone in the project schedule.</div>
      </div>
      <div style={{ ...item, flex: "2 1 320px" }}>
        <div style={head}>How to read</div>
        <div style={body}>
          Variance compares Actuals against the Forecast plan to date.{" "}
          <b style={{ color: GREEN }}>Positive (green)</b> = Actuals below Forecast ·{" "}
          <b style={{ color: "#dc2626" }}>Negative (red)</b> = Actuals above Forecast · Zero = On Forecast.
        </div>
      </div>
    </div>
  );
}

const thStyle: React.CSSProperties = {
  padding: "8px 12px", fontSize: 11.5, textAlign: "right", whiteSpace: "nowrap",
  borderBottom: "1px solid hsl(var(--border))", background: "hsl(var(--muted))",
  color: "hsl(var(--muted-foreground))",
};
const tdStyle: React.CSSProperties = {
  padding: "7px 12px", textAlign: "right", whiteSpace: "nowrap",
  borderBottom: "1px solid hsl(var(--border))", fontVariantNumeric: "tabular-nums",
};
