/**
 * TimelineBlock + ChartBlock — light-theme web ports of the mobile renderers
 * at artifacts/rmone-mobile/app/(tabs)/chat.tsx (renderTimelineBlock ~3565,
 * renderBarChart ~3529). Pure visual widgets — no network calls.
 */
import { compactUsd } from "../../lib/money";
import React from "react";

const C = {
  text: "var(--rm-text)",
  textMuted: "var(--rm-text-muted)",
  border: "var(--rm-panel-border)",
  borderSoft: "var(--rm-panel-border)",
  bg: "var(--rm-panel)",
  bgSoft: "var(--rm-panel-soft)",
  bgDeep: "var(--rm-panel-soft)",
  trackBg: "var(--rm-panel-border)",
  green: "#6BA539",
  orange: "#E87722",
};

const CHART_COLORS = [C.green, C.orange, "#A9C23F", "#3B82F6", "#E87722", "#6BA539", "#8E5BD9", "#16A6B0"];

function parseDateOrNumber(raw: string): { display: string; num: number } {
  const trimmed = raw.trim();
  if (/^\d{8}$/.test(trimmed)) {
    const y = trimmed.slice(0, 4), m = trimmed.slice(4, 6), d = trimmed.slice(6, 8);
    const ts = new Date(`${y}-${m}-${d}`).getTime();
    return { display: `${m}/${d}/${y}`, num: isNaN(ts) ? parseFloat(trimmed) : ts };
  }
  if (/^-?\d+(\.\d+)?$/.test(trimmed)) {
    const n = parseFloat(trimmed);
    const display = n >= 1e9 ? compactUsd(n)
      : n >= 1000000 ? `$${(n / 1000000).toFixed(1)}M`
      : n >= 1000 ? n.toLocaleString()
      : trimmed;
    return { display, num: isNaN(n) ? 0 : n };
  }
  if (/[-/T]/.test(trimmed)) {
    const ts = new Date(trimmed).getTime();
    if (!isNaN(ts)) {
      const dt = new Date(ts);
      const mm = String(dt.getMonth() + 1).padStart(2, "0");
      const dd = String(dt.getDate()).padStart(2, "0");
      const yy = dt.getFullYear();
      return { display: `${mm}/${dd}/${yy}`, num: ts };
    }
  }
  const n = parseFloat(trimmed);
  return { display: trimmed, num: isNaN(n) ? 0 : n };
}

export function ChartBlock({ content }: { content: string }) {
  const lines = content.split("\n").map(l => l.trim()).filter(Boolean);
  const subtitleLine = lines.find(l => !l.includes(":"));
  const dataLines = lines.filter(l => l.includes(":"));
  const rows = dataLines.map(l => {
    const idx = l.lastIndexOf(":");
    const raw = l.slice(idx + 1).trim();
    const { display, num } = parseDateOrNumber(raw);
    return { label: l.slice(0, idx).trim(), display, num };
  }).filter(r => r.label && r.num !== 0);

  if (rows.length === 0) return null;
  const max = Math.max(...rows.map(r => Math.abs(r.num)), 1);
  const barWidth = (val: number) => Math.max((Math.abs(val) / max) * 95, 5);

  return (
    <div style={{
      background: C.bgDeep, borderRadius: 12, padding: "16px 20px", margin: "12px 0",
      border: `1px solid ${C.border}`,
      boxShadow: "0 4px 20px rgba(0,0,0,0.08), inset 0 1px 0 rgba(255,255,255,0.05)",
      animation: "chat-fade-in-up 0.4s cubic-bezier(0.16, 1, 0.3, 1) forwards",
    }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16 }}>
        <span style={{ color: C.textMuted, fontSize: 11, fontWeight: 700, letterSpacing: 1.2 }}>CHART</span>
        {subtitleLine ? <span style={{ color: C.green, fontSize: 12, fontWeight: 600 }}>{subtitleLine}</span> : null}
      </div>
      <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
        {rows.map((r, i) => (
          <div key={i}>
            <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 6 }}>
              <span style={{ color: C.textMuted, fontSize: 13, flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{r.label}</span>
              <span style={{ color: C.text, fontSize: 13, fontWeight: 700, marginLeft: 12, fontVariantNumeric: "tabular-nums" }}>{r.display}</span>
            </div>
            <div style={{ height: 10, background: C.trackBg, borderRadius: 5, overflow: "hidden", boxShadow: "inset 0 1px 3px rgba(0,0,0,0.1)" }}>
              <div style={{
                height: 10, width: `${barWidth(r.num)}%`,
                background: `linear-gradient(90deg, ${CHART_COLORS[i % CHART_COLORS.length]}, ${CHART_COLORS[i % CHART_COLORS.length]}dd)`,
                borderRadius: 5,
                transition: "width 0.8s cubic-bezier(0.16, 1, 0.3, 1)",
                boxShadow: "inset 0 1px 0 rgba(255,255,255,0.2)",
              }} />
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

export function TimelineBlock({ content }: { content: string }) {
  const rows = content.split("\n").filter(l => l.includes("|")).map(l => {
    const parts = l.split("|").map(s => s.trim());
    return { label: parts[0] ?? "", start: parts[1] ?? "", end: parts[2] ?? "" };
  }).filter(r => {
    if (!r.label) return false;
    // Defensive guard against AI hallucinations: drop rows where end < start
    // (a strong tell that the model invented the dates instead of copying the
    // pre-built block from the server). Also drop rows whose dates land more
    // than ~10 years from "today" — the live data always lives in a tight
    // window around now, and a 2025/2026 mix-up showed up in production.
    const s = new Date(r.start).getTime();
    const e = new Date(r.end).getTime();
    if (!isNaN(s) && !isNaN(e) && e < s) {
      // eslint-disable-next-line no-console
      console.warn("[TimelineBlock] dropping row with end<start (likely AI hallucination):", r);
      return false;
    }
    const now = Date.now();
    const TEN_YEARS = 10 * 365 * 86400000;
    for (const t of [s, e]) {
      if (!isNaN(t) && Math.abs(t - now) > TEN_YEARS) {
        // eslint-disable-next-line no-console
        console.warn("[TimelineBlock] dropping row with date >10y from today:", r);
        return false;
      }
    }
    return true;
  });
  if (rows.length === 0) return null;

  const toMs = (d: string) => { const t = new Date(d).getTime(); return isNaN(t) ? null : t; };
  const fmtDate = (d: string) => {
    const t = new Date(d).getTime();
    if (isNaN(t)) return d || "—";
    const dt = new Date(t);
    const mo = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
    return `${mo[dt.getMonth()]} ${dt.getDate()}, ${dt.getFullYear()}`;
  };
  const isValid = (d: string) => !!d && !/^n\/?a$/i.test(d.trim()) && !isNaN(new Date(d).getTime());

  const allMs = rows.flatMap(r => [toMs(r.start), toMs(r.end)]).filter((v): v is number => v !== null);
  const minMs = allMs.length ? Math.min(...allMs) : 0;
  const maxMs = allMs.length ? Math.max(...allMs) : 1;
  const span = maxMs - minMs || 1;

  return (
    <div style={{
      background: C.bgDeep, borderRadius: 12, padding: "16px 20px", margin: "12px 0",
      border: `1px solid ${C.border}`,
      boxShadow: "0 4px 20px rgba(0,0,0,0.08), inset 0 1px 0 rgba(255,255,255,0.05)",
      animation: "chat-fade-in-up 0.4s cubic-bezier(0.16, 1, 0.3, 1) forwards",
    }}>
      <div style={{ color: C.textMuted, fontSize: 11, fontWeight: 700, letterSpacing: 1.2, marginBottom: 16 }}>
        PROJECT SCHEDULE
      </div>
      <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
        {rows.map((r, i) => {
          const color = CHART_COLORS[i % CHART_COLORS.length];
          const hasStart = isValid(r.start);
          const hasEnd = isValid(r.end);
          const s = toMs(r.start);
          const e = toMs(r.end);
          const hasValidRange = s !== null && e !== null;
          const days = hasValidRange ? Math.round((e! - s!) / 86400000) : null;
          const left = hasValidRange ? ((s! - minMs) / span) * 100 : 0;
          const width = hasValidRange ? Math.max(((e! - s!) / span) * 100, 4) : 0;
          return (
            <div key={i} style={{ display: "flex", flexDirection: "column", gap: 8 }}>
              <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                <span style={{ width: 10, height: 10, borderRadius: "50%", background: `linear-gradient(135deg, ${color}, ${color}aa)`, display: "inline-block", flexShrink: 0, boxShadow: `0 0 8px ${color}66` }} />
                <span style={{ fontWeight: 600, fontSize: 13, color: C.text, flex: 1, textShadow: "0 1px 2px rgba(0,0,0,0.1)" }}>{r.label}</span>
                {days !== null && <span style={{ fontSize: 11, color: C.textMuted, fontWeight: 500, background: "rgba(100,100,100,0.1)", padding: "2px 6px", borderRadius: 4 }}>{days}d</span>}
              </div>
              <div style={{ display: "flex", alignItems: "center", paddingLeft: 18, gap: 8 }}>
                <span style={{ fontSize: 11, color: hasStart ? C.textMuted : "#A8B3BC", fontWeight: 500 }}>{hasStart ? fmtDate(r.start) : "N/A"}</span>
                <span style={{ fontSize: 11, color: "rgba(150,150,150,0.3)" }}>→</span>
                <span style={{ fontSize: 11, color: hasEnd ? C.textMuted : "#A8B3BC", fontWeight: 500 }}>{hasEnd ? fmtDate(r.end) : "N/A"}</span>
              </div>
              {hasValidRange && (
                <div style={{ height: 14, background: C.trackBg, borderRadius: 7, position: "relative", marginLeft: 18, overflow: "hidden", boxShadow: "inset 0 1px 3px rgba(0,0,0,0.1)" }}>
                  <div style={{
                    position: "absolute", left: `${left}%`, width: `${width}%`,
                    height: "100%", background: `linear-gradient(90deg, ${color}, ${color}dd)`, borderRadius: 7,
                    boxShadow: "inset 0 1px 0 rgba(255,255,255,0.2)",
                    animation: `chat-slide-right 0.6s cubic-bezier(0.16, 1, 0.3, 1) forwards`,
                    animationDelay: `${i * 0.05}s`,
                    transformOrigin: "left",
                  }} />
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
