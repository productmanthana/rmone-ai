/**
 * ExecForecastPopup — per-project Actuals vs Forecast drill-down opened from
 * the Executive Forecast rollup, so managers can inspect a project without
 * leaving the portfolio page.
 *
 * Shows the client's primary graph — blue = Forecast Total at Completion
 * (actuals to date + remaining forecast), green = Actual to Date, gray =
 * Plan to Date — over the latest 12 periods, plus the frozen headline
 * numbers for the project's latest reporting week (identical to the table
 * row the user clicked, so the popup always reconciles with the rollup).
 *
 * The full Actuals vs Forecast page stays the home of history paging,
 * division/person filters, milestones and click-to-explain; the header
 * links straight to it. True modal: focus trap, Escape/backdrop close,
 * body scroll lock, Z.MODAL band (opened from a page, not another popup).
 */
import { useEffect, useMemo, useRef, useState } from "react";
import { Link } from "wouter";
import { AlertTriangle, ExternalLink, Info, Loader2, X } from "lucide-react";
import {
  ResponsiveContainer, ComposedChart, Line, XAxis, YAxis, CartesianGrid,
  Tooltip as RTooltip, Legend,
} from "recharts";
import { getAfProject, type AfOverviewProject, type AfProjectData } from "@/lib/api";
import {
  execPctUsed, fmtNum, fmtUsd, pickPeriodKind, toPoints, unitValues, UNIT_LABEL,
  type AfPoint, type AfUnit, type PeriodKind,
} from "@/lib/afMath";
import { Z } from "@/lib/zLayers";

const BLUE = "#2563eb";
const GREEN = "#16a34a";
const RED = "#dc2626";
const GRAY = "#94a3b8";
/** Same "12 periods at a time" rule as the full report page. */
const PAGE_SIZE = 12;

const FOCUSABLE = [
  'a[href]', 'button:not([disabled])', 'input:not([disabled])',
  'select:not([disabled])', 'textarea:not([disabled])',
  '[tabindex]:not([tabindex="-1"])',
].join(", ");

const UNITS: AfUnit[] = ["hours", "cost", "bill"];

interface Props {
  ticket: string;
  title: string;
  /** Frozen overview row (latest reporting week ≤ now) — the numbers the user clicked. */
  seed: AfOverviewProject;
  currentWeek: string;
  initialUnit: AfUnit;
  onClose: () => void;
}

export default function ExecForecastPopup({ ticket, title, seed, currentWeek, initialUnit, onClose }: Props) {
  const [unit, setUnit] = useState<AfUnit>(initialUnit);
  const [data, setData] = useState<AfProjectData | null | undefined>(undefined);
  const boxRef = useRef<HTMLDivElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    let alive = true;
    setData(undefined);
    getAfProject(ticket).then((d) => { if (alive) setData(d); });
    return () => { alive = false; };
  }, [ticket]);

  useEffect(() => {
    const opener = document.activeElement as HTMLElement | null;
    closeRef.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") { e.stopPropagation(); onClose(); return; }
      if (e.key !== "Tab") return;
      const el = boxRef.current;
      if (!el) return;
      const items = Array.from(el.querySelectorAll<HTMLElement>(FOCUSABLE))
        .filter((n) => n.offsetParent !== null);
      if (items.length === 0) return;
      const first = items[0];
      const last = items[items.length - 1];
      const active = document.activeElement as HTMLElement | null;
      if (e.shiftKey && (active === first || !el.contains(active))) { e.preventDefault(); last.focus(); }
      else if (!e.shiftKey && (active === last || !el.contains(active))) { e.preventDefault(); first.focus(); }
    };
    document.addEventListener("keydown", onKey, true);
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKey, true);
      document.body.style.overflow = prevOverflow;
      if (opener && document.contains(opener)) opener.focus();
    };
  }, [onClose]);

  const series = useMemo((): { kind: PeriodKind; points: AfPoint[] } => {
    if (!data || !("available" in data) || !data.available) return { kind: "week", points: [] };
    const kind = pickPeriodKind(data.weeks.length);
    return { kind, points: toPoints(data.weeks, unit, kind, currentWeek) };
  }, [data, unit, currentWeek]);
  const windowed = series.points.slice(-PAGE_SIZE);

  const v = unitValues(seed, unit);
  const pctUsed = execPctUsed(v.actualTd, v.eac); // same helper as the rollup table — tile always matches the column
  const fmtV = (n: number) => (unit === "hours" ? `${fmtNum(n)} h` : fmtUsd(n));
  const tone = (n: number): "good" | "bad" | undefined =>
    n > 0.005 ? "good" : n < -0.005 ? "bad" : undefined;

  const failed = data === null;
  const unavailable = data && "available" in data && !data.available ? data : null;
  const kindLabel = series.kind === "week" ? "weekly" : series.kind === "month" ? "monthly" : "yearly";

  return (
    <div
      role="presentation"
      onClick={onClose}
      style={{
        position: "fixed", inset: 0, zIndex: Z.MODAL, background: "rgba(15, 23, 42, 0.45)",
        display: "flex", alignItems: "center", justifyContent: "center", padding: 16,
      }}
    >
      <div
        ref={boxRef}
        role="dialog"
        aria-modal="true"
        aria-label={`${ticket} actuals vs forecast detail`}
        onClick={(e) => e.stopPropagation()}
        style={{
          background: "hsl(var(--background))", border: "1px solid hsl(var(--border))",
          borderRadius: 14, width: "min(880px, 96vw)", maxHeight: "88vh", overflowY: "auto",
          boxShadow: "0 24px 64px rgba(0,0,0,0.35)",
        }}
      >
        {/* header */}
        <div style={{
          display: "flex", alignItems: "flex-start", gap: 10, padding: "14px 16px 10px",
          borderBottom: "1px solid hsl(var(--border))", position: "sticky", top: 0,
          background: "hsl(var(--background))", zIndex: 1,
        }}>
          <div style={{ minWidth: 0, flex: 1 }}>
            <div style={{ fontSize: 15, fontWeight: 750, display: "flex", gap: 8, alignItems: "baseline", flexWrap: "wrap" }}>
              <span style={{ color: BLUE }}>{ticket}</span>
              {title && (
                <span style={{
                  fontWeight: 600, overflow: "hidden", textOverflow: "ellipsis",
                  whiteSpace: "nowrap", maxWidth: 420,
                }}>{title}</span>
              )}
            </div>
            <div style={{ fontSize: 11.5, color: "hsl(var(--muted-foreground))", marginTop: 2 }}>
              As of week {seed.weekMonday} · frozen weekly snapshot
              {seed.backfilled ? " · includes reconstructed history" : ""}
            </div>
          </div>
          <div style={{ display: "flex", gap: 4, alignItems: "center", flexShrink: 0 }}>
            {UNITS.map((u) => (
              <button
                key={u}
                type="button"
                onClick={() => setUnit(u)}
                aria-pressed={unit === u}
                style={{
                  padding: "5px 10px", borderRadius: 7, fontSize: 11.5, fontWeight: 600, cursor: "pointer",
                  border: `1px solid ${unit === u ? BLUE : "hsl(var(--border))"}`,
                  background: unit === u ? `${BLUE}14` : "hsl(var(--card))",
                  color: unit === u ? BLUE : "hsl(var(--muted-foreground))",
                }}
              >
                {UNIT_LABEL[u]}
              </button>
            ))}
          </div>
          <Link
            href={`/actuals-forecast?ticket=${encodeURIComponent(ticket)}`}
            style={{
              display: "inline-flex", alignItems: "center", gap: 5, padding: "6px 10px",
              borderRadius: 7, border: "1px solid hsl(var(--border))", fontSize: 11.5,
              fontWeight: 600, color: "hsl(var(--foreground))", textDecoration: "none",
              background: "hsl(var(--card))", flexShrink: 0, whiteSpace: "nowrap",
            }}
          >
            Full report <ExternalLink size={12} />
          </Link>
          <button
            ref={closeRef}
            type="button"
            aria-label="Close"
            onClick={onClose}
            style={{
              width: 30, height: 30, borderRadius: 7, border: "1px solid hsl(var(--border))",
              background: "hsl(var(--card))", cursor: "pointer", display: "flex",
              alignItems: "center", justifyContent: "center", color: "hsl(var(--muted-foreground))",
              flexShrink: 0,
            }}
          >
            <X size={15} />
          </button>
        </div>

        {/* headline numbers — client's five portfolio metrics + % used */}
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(136px, 1fr))", gap: 8, padding: "12px 16px 4px" }}>
          <Mini label="Actual to Date" value={seed.actualsCovered || seed.substitutedHours > 0 ? fmtV(v.actualTd) : "Not imported"} />
          <Mini label="Remaining Forecast" value={fmtV(v.remaining)} />
          <Mini label="Forecast at Completion" value={seed.actualsCovered || seed.substitutedHours > 0 ? fmtV(v.eac) : "—"} />
          <Mini label="Hours Variance" value={seed.actualsCovered || seed.substitutedHours > 0 ? `${fmtNum(seed.hoursVariance)} h` : "—"} tone={seed.actualsCovered || seed.substitutedHours > 0 ? tone(seed.hoursVariance) : undefined} />
          <Mini label="Cost Variance" value={seed.actualsCovered || seed.substitutedHours > 0 ? fmtUsd(seed.costVariance) : "—"} tone={seed.actualsCovered || seed.substitutedHours > 0 ? tone(seed.costVariance) : undefined} />
          <Mini label="% Used" value={(seed.actualsCovered || seed.substitutedHours > 0) && pctUsed != null ? `${fmtNum(pctUsed)}%` : "—"} />
        </div>

        {/* chart */}
        <div style={{ padding: "8px 16px 4px" }}>
          {data === undefined ? (
            <div style={{ display: "flex", alignItems: "center", justifyContent: "center", height: 280, gap: 8, color: "hsl(var(--muted-foreground))", fontSize: 13 }}>
              <Loader2 size={16} className="animate-spin" /> Loading weekly snapshots…
            </div>
          ) : failed ? (
            <PopupNotice text="The server didn't answer — try again, or open the full report." />
          ) : unavailable ? (
            <PopupNotice text={unavailable.reason || "This project's series isn't available."} />
          ) : windowed.length === 0 ? (
            <PopupNotice text="No snapshot weeks for this project yet." plain />
          ) : (
            <ResponsiveContainer width="100%" height={280}>
              <ComposedChart data={windowed} margin={{ top: 10, right: 16, bottom: 2, left: 6 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                <XAxis dataKey="label" tick={{ fontSize: 11 }} />
                <YAxis
                  tick={{ fontSize: 11 }}
                  width={64}
                  tickFormatter={(n: number) => (unit === "hours" ? fmtNum(n) : fmtUsd(n))}
                />
                <RTooltip
                  formatter={(val: number | string, name: string) => [fmtV(Number(val)), name]}
                  labelFormatter={(l: string, payload) => {
                    const p = Array.isArray(payload) && (payload[0]?.payload as AfPoint | undefined);
                    const extra = p
                      ? ` · week of ${p.weekMonday}${p.final ? "" : " (open)"}${p.backfilled ? " · reconstructed" : ""}`
                      : "";
                    return `${l}${extra}`;
                  }}
                  contentStyle={{ fontSize: 12, borderRadius: 8 }}
                />
                <Legend wrapperStyle={{ fontSize: 12 }} />
                <Line type="monotone" dataKey="forecastTd" name="Plan to Date" stroke={GRAY} strokeDasharray="5 4" strokeWidth={1.6} dot={false} />
                <Line type="monotone" dataKey="eac" name="Forecast Total at Completion" stroke={BLUE} strokeWidth={2.4} dot={{ r: 2.5 }} activeDot={{ r: 4 }} />
                <Line type="monotone" dataKey="actualTd" name="Actual to Date" stroke={GREEN} strokeWidth={2.4} dot={{ r: 2.5 }} activeDot={{ r: 4 }} />
              </ComposedChart>
            </ResponsiveContainer>
          )}
        </div>

        {/* footnotes */}
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap", padding: "6px 16px 14px", alignItems: "center" }}>
          {windowed.length > 0 && (
            <FootChip text={`Latest ${windowed.length} ${kindLabel} periods — the full report has older history, filters, milestones and click-to-explain.`} />
          )}
          {seed.substitutedHours > 0 && (
            <FootChip warn text={`Includes ${fmtNum(seed.substitutedHours)} h of planned hours substituted as actuals (setting enabled).`} />
          )}
          {seed.unratedActualHours > 0 && (
            <FootChip warn text={`${fmtNum(seed.unratedActualHours)} actual hours have no rate and are counted at $0.`} />
          )}
        </div>
      </div>
    </div>
  );
}

function Mini({ label, value, tone }: { label: string; value: string; tone?: "good" | "bad" }) {
  return (
    <div style={{
      border: "1px solid hsl(var(--border))", borderRadius: 10, padding: "8px 10px",
      background: "hsl(var(--card))", minWidth: 0,
    }}>
      <div style={{ fontSize: 10.5, fontWeight: 600, color: "hsl(var(--muted-foreground))", textTransform: "uppercase", letterSpacing: 0.3, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
        {label}
      </div>
      <div style={{
        fontSize: 15, fontWeight: 750, marginTop: 2, fontVariantNumeric: "tabular-nums",
        color: tone === "good" ? GREEN : tone === "bad" ? RED : "hsl(var(--foreground))",
      }}>
        {value}
      </div>
    </div>
  );
}

function PopupNotice({ text, plain }: { text: string; plain?: boolean }) {
  return (
    <div style={{
      display: "flex", alignItems: "center", justifyContent: "center", gap: 8,
      height: 160, fontSize: 13, color: "hsl(var(--muted-foreground))", textAlign: "center",
      padding: "0 24px",
    }}>
      {plain ? <Info size={15} /> : <AlertTriangle size={15} style={{ color: "#d97706" }} />}
      {text}
    </div>
  );
}

function FootChip({ text, warn }: { text: string; warn?: boolean }) {
  return (
    <span style={{
      display: "inline-flex", alignItems: "center", gap: 5, padding: "3px 9px", borderRadius: 999,
      fontSize: 11, border: `1px solid ${warn ? "#f59e0b55" : "hsl(var(--border))"}`,
      background: warn ? "#f59e0b12" : "hsl(var(--muted))",
      color: warn ? "#b45309" : "hsl(var(--muted-foreground))",
    }}>
      <Info size={11} /> {text}
    </span>
  );
}
