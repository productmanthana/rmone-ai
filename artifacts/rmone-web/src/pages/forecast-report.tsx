/**
 * Project Forecast Report (deliverable 2 of 3) — hours and costs by project,
 * expandable to a per-person / per-role breakdown. Top-level rows come from
 * the FROZEN weekly snapshots (latest week ≤ now per project); the expanded
 * breakdown is aggregated live from the project's detail table.
 *
 * Column order follows the client's approved metric list: hours block
 * (actual / remaining / total at completion), cost block (same), then the
 * two variance columns.
 *
 * Variance = plan-to-date − actual-to-date, POSITIVE = favorable
 * (labelled "Actuals – Forecast" per the client's naming).
 */
import { useEffect, useMemo, useState } from "react";
import { Link } from "wouter";
import {
  Loader2, AlertTriangle, Lock, FileSpreadsheet, ChevronDown, ChevronRight,
  Search, Upload, Info,
} from "lucide-react";
import {
  getAfOverview, getAfProject, getModuleRecords,
  type AfOverview, type AfOverviewProject, type AfDetailRow,
} from "@/lib/api";
import { useAuth } from "@/lib/useAuth";
import { afPersonDisplayName, fmtNum, fmtUsd, parseMoneyish, round2 } from "@/lib/afMath";
import { getMyCapabilitiesChecked } from "@/lib/permissions";
import { DisabledMemberStatus } from "@/components/DisabledMemberStatus";

const GREEN = "#16a34a";
const RED = "#dc2626";
const BLUE = "#2563eb";
const PROJECT_TITLE_LIMIT = 30;

const card: React.CSSProperties = {
  background: "hsl(var(--card))",
  border: "1px solid hsl(var(--border))",
  borderRadius: 12,
};

interface PersonRoleRow {
  person: string;
  personName: string;
  roleName: string;
  division: string;
  actualHours: number;
  planHoursTd: number;
  hoursVariance: number;
  costVariance: number;
  planTotalHours: number;
  eacHours: number;
  actualCost: number;
  eacCost: number;
  substituted: boolean;
  rateApproximated: boolean;
  actualsCovered: boolean;
  enabled?: boolean;
  tenantId?: string;
}

/** Aggregate a project's detail rows into one row per person+role. */
function breakdownRows(detail: AfDetailRow[], currentWeek: string): PersonRoleRow[] {
  const by = new Map<string, PersonRoleRow & { planCostTotal: number; planCostTd: number }>();
  for (const r of detail) {
    const key = `${r.person}\u0000${r.roleName.toLowerCase()}`;
    let row = by.get(key);
    if (!row) {
      row = {
        person: r.person, personName: r.personName, roleName: r.roleName, division: r.division,
        actualHours: 0, planHoursTd: 0, hoursVariance: 0, costVariance: 0, planTotalHours: 0, eacHours: 0,
        actualCost: 0, eacCost: 0, substituted: false, rateApproximated: false, actualsCovered: false,
        enabled: r.enabled, tenantId: r.tenantId,
        planCostTotal: 0, planCostTd: 0,
      };
      by.set(key, row);
    }
    row.actualHours += r.actualHours;
    row.actualCost += r.actualCost;
    row.planTotalHours += r.forecastHours;
    row.planCostTotal += r.forecastCost;
    if (r.weekMonday <= currentWeek) {
      row.planHoursTd += r.forecastHours;
      row.planCostTd += r.forecastCost;
    }
    if (r.substituted) row.substituted = true;
    if (r.actualsCovered || r.substituted) row.actualsCovered = true;
    if (r.rateApproximated) row.rateApproximated = true;
    // Explicit disabled wins across weekly entries; absent remains compatible
    // with older snapshot rows.
    if (r.enabled === false) row.enabled = false;
    if (!row.tenantId && r.tenantId) row.tenantId = r.tenantId;
    if (!row.division && r.division) row.division = r.division;
  }
  const out: PersonRoleRow[] = [];
  for (const row of by.values()) {
    row.hoursVariance = round2(row.planHoursTd - row.actualHours);
    row.costVariance = round2(row.planCostTd - row.actualCost);
    row.eacHours = round2(row.actualHours + (row.planTotalHours - row.planHoursTd));
    row.eacCost = round2(row.actualCost + (row.planCostTotal - row.planCostTd));
    row.actualHours = round2(row.actualHours);
    row.planHoursTd = round2(row.planHoursTd);
    row.planTotalHours = round2(row.planTotalHours);
    row.actualCost = round2(row.actualCost);
    out.push(row);
  }
  return out.sort((a, b) => b.eacHours - a.eacHours);
}

function displayProjectTitle(title: string): string {
  const trimmed = title.trim();
  return trimmed.length > PROJECT_TITLE_LIMIT
    ? `${trimmed.slice(0, PROJECT_TITLE_LIMIT - 1)}…`
    : trimmed;
}

type SortKey =
  | "ticket"
  | "actualHoursTd" | "remainingHours" | "eacHours"
  | "actualCostTd" | "remainingCost" | "eacCost"
  | "hoursVariance" | "costVariance";

export default function ForecastReportPage() {
  const { user } = useAuth();
  const isAdmin = user?.isAdmin === true;
  const [canManageStaff, setCanManageStaff] = useState(false);

  const [overview, setOverview] = useState<AfOverview | null | undefined>(undefined);
  const [recordMap, setRecordMap] = useState<Map<string, { title: string; contract: number | null }>>(new Map());
  const [query, setQuery] = useState("");
  const [sortKey, setSortKey] = useState<SortKey>("eacCost");
  const [sortAsc, setSortAsc] = useState(false);
  const [openTicket, setOpenTicket] = useState<string | null>(null);
  // per-ticket breakdown cache: undefined = loading, null = failed
  const [breakdowns, setBreakdowns] = useState<Map<string, PersonRoleRow[] | null | undefined>>(new Map());

  useEffect(() => {
    let alive = true;
    getAfOverview().then((o) => { if (alive) setOverview(o); });
    Promise.all([getModuleRecords("PMM").catch(() => null), getModuleRecords("OPM").catch(() => null)])
      .then(([pmm, opm]) => {
        if (!alive) return;
        const m = new Map<string, { title: string; contract: number | null }>();
        for (const list of [pmm?.data, opm?.data]) {
          for (const r of list ?? []) {
            const rec = r as Record<string, unknown>;
            const id = String(rec.TicketId ?? "").trim();
            if (!id) continue;
            m.set(id, { title: String(rec.Title ?? rec.ProjectTitle ?? "").trim(), contract: parseMoneyish(rec.ContractValue) });
          }
        }
        setRecordMap(m);
      });
    return () => { alive = false; };
  }, []);

  useEffect(() => {
    let alive = true;
    void getMyCapabilitiesChecked().then(caps => {
      if (alive) setCanManageStaff(caps?.caps.manageStaff === true);
    });
    return () => { alive = false; };
  }, []);

  const projects: AfOverviewProject[] = overview && "available" in overview && overview.available ? overview.projects : [];
  const currentWeek = overview && "available" in overview && overview.available ? overview.currentWeek : "";

  const rows = useMemo(() => {
    const q = query.trim().toLowerCase();
    const list = projects.filter((p) => {
      if (!q) return true;
      const title = recordMap.get(p.ticket)?.title ?? "";
      return p.ticket.toLowerCase().includes(q) || title.toLowerCase().includes(q);
    });
    const dir = sortAsc ? 1 : -1;
    const sortVal = (p: AfOverviewProject): number => {
      switch (sortKey) {
        case "eacHours": return p.forecastTotalHours;
        case "eacCost": return p.forecastTotalCost;
        case "actualHoursTd": return p.actualHoursTd;
        case "actualCostTd": return p.actualCostTd;
        case "remainingHours": return p.forecastRemainingHours;
        case "remainingCost": return p.forecastRemainingCost;
        case "hoursVariance": return p.hoursVariance;
        case "costVariance": return p.costVariance;
        default: return 0;
      }
    };
    return [...list].sort((a, b) => {
      if (sortKey === "ticket") return dir * a.ticket.localeCompare(b.ticket);
      return dir * (sortVal(a) - sortVal(b));
    });
  }, [projects, recordMap, query, sortKey, sortAsc]);

  const totals = useMemo(() => {
    const t = { actualHoursTd: 0, remainingHours: 0, eacHours: 0, actualCostTd: 0, remainingCost: 0, eacCost: 0, hoursVariance: 0, costVariance: 0 };
    for (const p of rows) {
      t.actualHoursTd += p.actualHoursTd;
      t.remainingHours += p.forecastRemainingHours;
      t.eacHours += p.forecastTotalHours;
      t.actualCostTd += p.actualCostTd;
      t.remainingCost += p.forecastRemainingCost;
      t.eacCost += p.forecastTotalCost;
      t.hoursVariance += p.hoursVariance;
      t.costVariance += p.costVariance;
    }
    return t;
  }, [rows]);
  const totalsHaveActuals = rows.every((p) => p.actualsCovered || p.substitutedHours > 0);

  const toggleOpen = (ticket: string) => {
    const next = openTicket === ticket ? null : ticket;
    setOpenTicket(next);
    if (next && !breakdowns.has(next)) {
      setBreakdowns((m) => new Map(m).set(next, undefined));
      getAfProject(next).then((d) => {
        setBreakdowns((m) => {
          const copy = new Map(m);
          if (d && "available" in d && d.available) copy.set(next, breakdownRows(d.detail, d.currentWeek));
          else copy.set(next, null);
          return copy;
        });
      });
    }
  };

  const exportCsv = () => {
    const esc = (s: string) => `"${s.replace(/"/g, '""')}"`;
    const header = [
      "Project ID", "Title",
      "Actual Hours To Date", "Forecast Remaining Hours", "Forecast Total Hours at Completion",
      "Actual Labor Cost To Date", "Forecast Remaining Cost", "Forecast Total Labor Cost at Completion",
      "Hours Variance (Actuals - Forecast)", "Cost Variance (Actuals - Forecast)", "As-of Week",
    ];
    const lines = [header.map(esc).join(",")];
    for (const p of rows) {
      const hasActuals = p.actualsCovered || p.substitutedHours > 0;
      lines.push([
        esc(p.ticket), esc(recordMap.get(p.ticket)?.title ?? ""),
        hasActuals ? String(round2(p.actualHoursTd)) : "Not imported",
        String(round2(p.forecastRemainingHours)),
        hasActuals ? String(round2(p.forecastTotalHours)) : "",
        hasActuals ? String(round2(p.actualCostTd)) : "Not imported",
        String(round2(p.forecastRemainingCost)),
        hasActuals ? String(round2(p.forecastTotalCost)) : "",
        hasActuals ? String(round2(p.hoursVariance)) : "",
        hasActuals ? String(round2(p.costVariance)) : "",
        esc(p.weekMonday),
      ].join(","));
    }
    const blob = new Blob([lines.join("\n")], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `forecast-report-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 5_000);
  };

  if (overview === undefined) {
    return <div style={{ display: "flex", justifyContent: "center", minHeight: "45vh", alignItems: "center" }}>
      <Loader2 size={22} className="animate-spin" style={{ color: "hsl(var(--muted-foreground))" }} /></div>;
  }
  if (overview === null || !("available" in overview)) {
    return <NoticePage icon={<AlertTriangle size={20} style={{ color: "#d97706" }} />} title="Couldn't load the Forecast Report"
      body="The server didn't answer. Check your connection and try again." />;
  }
  if (!overview.available) {
    return <NoticePage icon={<Lock size={20} style={{ color: "hsl(var(--muted-foreground))" }} />} title="The Forecast Report isn't available"
      body={overview.reason ?? "This data isn't available for your account."} />;
  }

  const sortHeader = (key: SortKey, label: string) => (
    <th
      style={{ ...thStyle, cursor: "pointer", userSelect: "none" }}
      onClick={() => {
        if (sortKey === key) setSortAsc((v) => !v);
        // Variance columns open worst-first (ascending) like the exec suite;
        // magnitude columns open biggest-first; ticket alphabetical.
        else { setSortKey(key); setSortAsc(key === "ticket" || key === "hoursVariance" || key === "costVariance"); }
      }}
    >
      {label}{sortKey === key ? (sortAsc ? " ↑" : " ↓") : ""}
    </th>
  );

  return (
    <div style={{ padding: "20px 24px 40px", maxWidth: 1280, margin: "0 auto", display: "flex", flexDirection: "column", gap: 14 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
        <div style={{ width: 38, height: 38, borderRadius: 10, background: `${BLUE}15`, display: "flex", alignItems: "center", justifyContent: "center" }}>
          <FileSpreadsheet size={19} style={{ color: BLUE }} />
        </div>
        <div style={{ minWidth: 0, flex: 1 }}>
          <h1 style={{ fontSize: 18, fontWeight: 700, margin: 0 }}>Project Forecast Report</h1>
          <div style={{ fontSize: 12, color: "hsl(var(--muted-foreground))" }}>
            Hours and costs by project — expand a row for the person / role breakdown. As of week {currentWeek}.
          </div>
        </div>
        {isAdmin && (
          <Link href="/actuals-import" style={{ textDecoration: "none" }}>
            <span style={btnGhost}><Upload size={14} /> Import Actuals</span>
          </Link>
        )}
        <button type="button" onClick={exportCsv} disabled={!rows.length} style={{ ...btnGhost, opacity: rows.length ? 1 : 0.5 }}>
          <FileSpreadsheet size={14} /> Export CSV
        </button>
      </div>

      <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
        <div style={{ position: "relative" }}>
          <Search size={13} style={{ position: "absolute", left: 9, top: 9, color: "hsl(var(--muted-foreground))" }} />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search project ID or title…"
            style={{
              padding: "7px 10px 7px 28px", borderRadius: 8, fontSize: 12.5, width: 260,
              border: "1px solid hsl(var(--border))", background: "hsl(var(--card))", color: "hsl(var(--foreground))",
            }}
          />
        </div>
        <span style={{ fontSize: 12, color: "hsl(var(--muted-foreground))" }}>
          {rows.length} project{rows.length === 1 ? "" : "s"} with snapshots
        </span>
      </div>

      {projects.length === 0 ? (
        <div style={{ ...card, padding: 20, fontSize: 13, color: "hsl(var(--muted-foreground))" }}>
          No snapshots yet. Snapshots build automatically every hour{isAdmin ? " — or import actual hours to start" : ""}.
          {" "}<Link href="/actuals-forecast" style={{ color: BLUE }}>Open the Actuals vs Forecast page</Link>.
        </div>
      ) : (
        <div style={{ ...card, overflow: "hidden" }}>
          <div style={{ overflowX: "auto" }}>
            <table style={{ borderCollapse: "separate", borderSpacing: 0, width: "100%", fontSize: 12.5, minWidth: 940, tableLayout: "fixed" }}>
              <colgroup>
                <col style={{ width: "3%" }} />
                <col style={{ width: "27%" }} />
                <col style={{ width: "8.75%" }} />
                <col style={{ width: "8.75%" }} />
                <col style={{ width: "8.75%" }} />
                <col style={{ width: "8.75%" }} />
                <col style={{ width: "8.75%" }} />
                <col style={{ width: "8.75%" }} />
                <col style={{ width: "8.75%" }} />
                <col style={{ width: "8.75%" }} />
              </colgroup>
              <thead>
                <tr>
                  <th style={{ ...thStyle, width: 30 }} />
                  {sortHeader("ticket", "Project")}
                  {sortHeader("actualHoursTd", "Actual Hours To Date")}
                  {sortHeader("remainingHours", "Forecast Remaining Hours")}
                  {sortHeader("eacHours", "Forecast Total Hours at Completion")}
                  {sortHeader("actualCostTd", "Actual Labor Cost To Date")}
                  {sortHeader("remainingCost", "Forecast Remaining Cost")}
                  {sortHeader("eacCost", "Forecast Total Labor Cost at Completion")}
                  {sortHeader("hoursVariance", "Hours Variance (Actuals – Forecast)")}
                  {sortHeader("costVariance", "Cost Variance (Actuals – Forecast)")}
                </tr>
              </thead>
              <tbody>
                {rows.map((p) => {
                  const title = recordMap.get(p.ticket)?.title ?? "";
                  const open = openTicket === p.ticket;
                  const bd = breakdowns.get(p.ticket);
                  const hasActuals = p.actualsCovered || p.substitutedHours > 0;
                  return (
                    <FragmentRow key={p.ticket}>
                      <tr
                        onClick={() => toggleOpen(p.ticket)}
                        style={{ cursor: "pointer", background: open ? "hsl(var(--muted))" : undefined }}
                      >
                        <td style={{ ...tdStyle, textAlign: "center", color: "hsl(var(--muted-foreground))" }}>
                          {open ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
                        </td>
                        <td style={{ ...tdStyle, textAlign: "left", minWidth: 0, overflow: "hidden" }}>
                          <div style={{ display: "flex", alignItems: "center", minWidth: 0, gap: 6 }}>
                            <Link
                              href={`/actuals-forecast?ticket=${encodeURIComponent(p.ticket)}`}
                              onClick={(e: React.MouseEvent) => e.stopPropagation()}
                              style={{ color: BLUE, fontWeight: 600, textDecoration: "none", flexShrink: 0 }}
                            >{p.ticket}</Link>
                            {title && <span
                              title={title}
                              style={{ color: "hsl(var(--muted-foreground))", minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}
                            >{displayProjectTitle(title)}</span>}
                          </div>
                          {(p.backfilled || p.substitutedHours > 0) && (
                            <div style={{ whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis", marginTop: 2 }}>
                              {p.backfilled && <FlagChip text="reconstructed" />}
                              {p.substitutedHours > 0 && <FlagChip text="substituted" warn />}
                            </div>
                          )}
                        </td>
                        <td style={tdStyle} title={!hasActuals ? "Actual hours have not been imported for this project." : undefined}>{hasActuals ? fmtNum(p.actualHoursTd) : "Not imported"}</td>
                        <td style={tdStyle}>{fmtNum(p.forecastRemainingHours)}</td>
                        <td style={tdStyle}>{hasActuals ? fmtNum(p.forecastTotalHours) : "—"}</td>
                        <td style={tdStyle} title={!hasActuals ? "Actual labor cost is unavailable until actual hours are imported." : undefined}>{hasActuals ? fmtUsd(p.actualCostTd) : "Not imported"}</td>
                        <td style={tdStyle}>{fmtUsd(p.forecastRemainingCost)}</td>
                        <td style={tdStyle}>{hasActuals ? fmtUsd(p.forecastTotalCost) : "—"}</td>
                        <td style={{ ...tdStyle, ...(hasActuals ? varStyle(p.hoursVariance) : {}) }}>{hasActuals ? fmtNum(p.hoursVariance) : "—"}</td>
                        <td style={{ ...tdStyle, ...(hasActuals ? varStyle(p.costVariance) : {}) }}>{hasActuals ? fmtUsd(p.costVariance) : "—"}</td>
                      </tr>
                      {open && (
                        <tr>
                          <td colSpan={10} style={{ padding: 0, borderBottom: "1px solid hsl(var(--border))" }}>
                            <div style={{ padding: "10px 16px 14px 46px", background: "hsl(var(--muted))" }}>
                              {bd === undefined ? (
                                <div style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 12, color: "hsl(var(--muted-foreground))", padding: 8 }}>
                                  <Loader2 size={14} className="animate-spin" /> Loading breakdown…
                                </div>
                              ) : bd === null ? (
                                <div style={{ fontSize: 12, color: "#b45309", padding: 8 }}>Couldn't load the breakdown for this project.</div>
                              ) : bd.length === 0 ? (
                                <div style={{ fontSize: 12, color: "hsl(var(--muted-foreground))", padding: 8 }}>No detail rows for this project.</div>
                              ) : (
                                <table style={{ borderCollapse: "collapse", width: "100%", fontSize: 12 }}>
                                  <thead>
                                    <tr>
                                      {["Person", "Role", "Division", "Actual Hours", "Forecast Remaining Hours", "Forecast Total Hours", "Actual Labor Cost", "Forecast Remaining Cost", "Forecast Total Labor Cost", "Hours Variance", "Cost Variance", ""].map((h, i) => (
                                        <th key={i} style={{ ...thStyle, background: "transparent", textAlign: i < 3 ? "left" : "right" }}>{h}</th>
                                      ))}
                                    </tr>
                                  </thead>
                                  <tbody>
                                    {bd.map((r) => (
                                      <tr key={`${r.person || "open"}:${r.roleName}`}>
                                        <td style={{ ...tdSub, textAlign: "left", fontWeight: 600, fontStyle: r.person === "" ? "italic" : undefined }}>{r.person === "" ? "Unstaffed demand" : <>{afPersonDisplayName(r.person, r.personName)} <DisabledMemberStatus enabled={r.enabled} userGuid={r.person} tenantId={r.tenantId} canManageStaff={canManageStaff} onReactivated={() => {
                                          setBreakdowns(m => {
                                            const next = new Map(m);
                                            next.set(p.ticket, (next.get(p.ticket) ?? []).map(x => x.person === r.person ? { ...x, enabled: true } : x));
                                            return next;
                                          });
                                        }} /></>}</td>
                                        <td style={{ ...tdSub, textAlign: "left" }}>{r.roleName || "—"}</td>
                                        <td style={{ ...tdSub, textAlign: "left" }}>{r.division || "—"}</td>
                                        <td style={tdSub}>{r.actualsCovered ? fmtNum(r.actualHours) : "Not imported"}</td>
                                        <td style={tdSub}>{fmtNum(round2(r.eacHours - r.actualHours))}</td>
                                        <td style={tdSub}>{r.actualsCovered ? fmtNum(r.eacHours) : "—"}</td>
                                        <td style={tdSub}>{r.actualsCovered ? fmtUsd(r.actualCost) : "Not imported"}</td>
                                        <td style={tdSub}>{fmtUsd(round2(r.eacCost - r.actualCost))}</td>
                                        <td style={tdSub}>{r.actualsCovered ? fmtUsd(r.eacCost) : "—"}</td>
                                        <td style={{ ...tdSub, ...(r.actualsCovered ? varStyle(r.hoursVariance) : {}) }}>{r.actualsCovered ? fmtNum(r.hoursVariance) : "—"}</td>
                                        <td style={{ ...tdSub, ...(r.actualsCovered ? varStyle(r.costVariance) : {}) }}>{r.actualsCovered ? fmtUsd(r.costVariance) : "—"}</td>
                                        <td style={{ ...tdSub, textAlign: "left" }}>
                                          {r.substituted && <FlagChip text="substituted" warn />}
                                          {r.rateApproximated && <FlagChip text="rate approx." />}
                                        </td>
                                      </tr>
                                    ))}
                                  </tbody>
                                </table>
                              )}
                              <div style={{ fontSize: 11, color: "hsl(var(--muted-foreground))", marginTop: 8, display: "flex", alignItems: "center", gap: 5 }}>
                                <Info size={11} /> Breakdown is aggregated from today's detail table (current plan), so its totals can differ slightly from the frozen snapshot row above.
                              </div>
                            </div>
                          </td>
                        </tr>
                      )}
                    </FragmentRow>
                  );
                })}
              </tbody>
              <tfoot>
                <tr>
                  <td style={tfootStyle} />
                  <td style={{ ...tfootStyle, textAlign: "left" }}>Total ({rows.length})</td>
                  <td style={tfootStyle}>{totalsHaveActuals ? fmtNum(totals.actualHoursTd) : "—"}</td>
                  <td style={tfootStyle}>{fmtNum(totals.remainingHours)}</td>
                  <td style={tfootStyle}>{totalsHaveActuals ? fmtNum(totals.eacHours) : "—"}</td>
                  <td style={tfootStyle}>{totalsHaveActuals ? fmtUsd(totals.actualCostTd) : "—"}</td>
                  <td style={tfootStyle}>{fmtUsd(totals.remainingCost)}</td>
                  <td style={tfootStyle}>{totalsHaveActuals ? fmtUsd(totals.eacCost) : "—"}</td>
                  <td style={{ ...tfootStyle, ...(totalsHaveActuals ? varStyle(totals.hoursVariance) : {}) }}>{totalsHaveActuals ? fmtNum(totals.hoursVariance) : "—"}</td>
                  <td style={{ ...tfootStyle, ...(totalsHaveActuals ? varStyle(totals.costVariance) : {}) }}>{totalsHaveActuals ? fmtUsd(totals.costVariance) : "—"}</td>
                </tr>
              </tfoot>
            </table>
          </div>
        </div>
      )}

      <div style={{ fontSize: 11.5, color: "hsl(var(--muted-foreground))", display: "flex", alignItems: "center", gap: 5 }}>
        <Info size={12} /> Variance compares actuals against the forecast plan to date: positive (green) = actuals below forecast, negative (red) = actuals above forecast. Forecast Total at Completion = actuals to date + remaining plan. Forecast includes unstaffed (open) demand.
      </div>
    </div>
  );
}

function FragmentRow({ children }: { children: React.ReactNode }) {
  return <>{children}</>;
}

function FlagChip({ text, warn }: { text: string; warn?: boolean }) {
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
      <div style={{ ...card, padding: 16, display: "flex", gap: 12, alignItems: "flex-start", maxWidth: 620 }}>
        <div style={{ marginTop: 2 }}>{icon}</div>
        <div>
          <div style={{ fontSize: 14, fontWeight: 700 }}>{title}</div>
          <div style={{ fontSize: 13, color: "hsl(var(--muted-foreground))", marginTop: 4 }}>{body}</div>
        </div>
      </div>
    </div>
  );
}

function varStyle(v: number): React.CSSProperties {
  // Judge the QUANTIZED value: stored variances are raw float sums, so a
  // 1e-13 tail must not tint a cell whose display rounds to "0".
  const r = round2(v);
  return { color: r > 0 ? GREEN : r < 0 ? RED : "hsl(var(--muted-foreground))", fontWeight: 600 };
}

const btnGhost: React.CSSProperties = {
  display: "inline-flex", alignItems: "center", gap: 6, padding: "7px 12px", borderRadius: 8,
  border: "1px solid hsl(var(--border))", fontSize: 12.5, fontWeight: 600, cursor: "pointer",
  color: "hsl(var(--foreground))", background: "hsl(var(--card))",
};
const thStyle: React.CSSProperties = {
  padding: "8px 10px", fontSize: 11.5, textAlign: "right", whiteSpace: "normal",
  lineHeight: 1.25, verticalAlign: "bottom", maxWidth: 130,
  borderBottom: "1px solid hsl(var(--border))", background: "hsl(var(--muted))",
  color: "hsl(var(--muted-foreground))",
};
const tdStyle: React.CSSProperties = {
  padding: "7px 10px", textAlign: "right", whiteSpace: "nowrap",
  borderBottom: "1px solid hsl(var(--border))", fontVariantNumeric: "tabular-nums",
};
const tdSub: React.CSSProperties = {
  padding: "5px 10px", textAlign: "right", whiteSpace: "nowrap",
  borderBottom: "1px solid hsl(var(--border))", fontVariantNumeric: "tabular-nums",
};
const tfootStyle: React.CSSProperties = {
  padding: "8px 10px", textAlign: "right", whiteSpace: "nowrap", fontWeight: 700,
  background: "hsl(var(--muted))", fontVariantNumeric: "tabular-nums",
};
