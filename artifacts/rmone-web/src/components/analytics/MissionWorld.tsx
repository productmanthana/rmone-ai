/* ─────────────────────────────────────────────────────────────
 * MissionWorld.tsx — shared Mission Control page chrome for the
 * Analytics Center hub and its section pages: the dark/light
 * ambient world, the section header, the card shell (title +
 * takeaway + PDF/Excel exports + "view data" drill), and the
 * shared ReportModel loading hook. Section pages compose these
 * so every page keeps the exact same look, export behavior and
 * honesty rules as the hub.
 * ──────────────────────────────────────────────────────────── */
import { useEffect, useRef, useState } from "react";
import { AlertTriangle, Loader2, FileText, FileSpreadsheet, Radar } from "lucide-react";
import { MC, MC_LIGHT, useMC, Glass } from "@/components/analytics/MissionKit";
import { useTheme } from "@/lib/theme";
import { peekReportModel, loadReportModel, type ReportModel } from "@/lib/reportData";
import { LIFECYCLE_CHANGED_EVENT } from "@/lib/api";
import type { CardModel } from "@/lib/analyticsCenter";
import { ModuleHeader } from "@/components/layout/ModuleHeader";

/* ── the mission-control world wrapper ──────────────────────── */
export function MissionWorld({ children }: { children: React.ReactNode }) {
  const { mode } = useTheme();
  const isDark = mode !== "light";
  const mc = isDark ? MC : MC_LIGHT;

  /* Stamp the <main> background while we're mounted so it doesn't
   * bleed the app theme's color below the last card row. Restored
   * on unmount. Re-runs when the theme switches. */
  useEffect(() => {
    const main = document.querySelector<HTMLElement>("main");
    if (!main) return;
    const prev = main.style.backgroundColor;
    main.style.backgroundColor = mc.bg;
    return () => { main.style.backgroundColor = prev; };
  }, [mc.bg]);

  return (
    <div style={{
      minHeight: "100%", position: "relative",
      background: mc.bg,
      color: mc.text,
      colorScheme: isDark ? "dark" : "light",
      fontFamily: "var(--app-font-sans)",
    }}>
      {/* ambient glow */}
      <div style={{
        position: "absolute", inset: 0, pointerEvents: "none",
        background: isDark
          ? "radial-gradient(1100px 480px at 22% -8%, rgba(107,165,57,0.14), transparent 60%)," +
            "radial-gradient(900px 500px at 92% 8%, rgba(56,189,248,0.08), transparent 55%)," +
            "radial-gradient(1200px 800px at 50% 118%, rgba(20,30,40,0.9), transparent 70%)"
          : "radial-gradient(900px 400px at 22% -8%, rgba(107,165,57,0.06), transparent 60%)," +
            "radial-gradient(700px 360px at 92% 8%, rgba(56,189,248,0.04), transparent 55%)",
      }} />
      {/* subtle grid */}
      <div style={{
        position: "absolute", inset: 0, pointerEvents: "none", opacity: isDark ? 0.35 : 0.4,
        backgroundImage: isDark
          ? "linear-gradient(rgba(255,255,255,0.035) 1px, transparent 1px), linear-gradient(90deg, rgba(255,255,255,0.035) 1px, transparent 1px)"
          : "linear-gradient(rgba(15,25,35,0.04) 1px, transparent 1px), linear-gradient(90deg, rgba(15,25,35,0.04) 1px, transparent 1px)",
        backgroundSize: "44px 44px",
        maskImage: "radial-gradient(900px 520px at 50% 0%, #000 30%, transparent 100%)",
        WebkitMaskImage: "radial-gradient(900px 520px at 50% 0%, #000 30%, transparent 100%)",
      }} />
      <div style={{ position: "relative", maxWidth: 1400, margin: "0 auto", padding: "22px 28px 40px" }}>
        {children}
      </div>
    </div>
  );
}

/* ── section header: back link + RM block + title + live/partial badge ── */
export function SectionHeader({ title, kicker, m, error, right }: {
  title: string;
  kicker?: string;
  m: ReportModel | null;
  error: string | null;
  right?: React.ReactNode;
}) {
  const mc = useMC();
  const sourcesOk = !m?.sources || (m.sources.records && m.sources.staffing && m.sources.demands);
  return (
    <ModuleHeader
      title={title}
      section={kicker ?? "Analytics Center"}
      icon={Radar}
      backTo={{ href: "/analytics-center", label: "Analytics Center" }}
      actions={right}
      status={m && (error || !sourcesOk) ? (
            <span style={{
              display: "inline-flex", alignItems: "center", gap: 6, padding: "6px 11px",
              borderRadius: 999, fontSize: 11, fontWeight: 500,
              background: "rgba(251,146,60,0.1)", border: "1px solid rgba(251,146,60,0.35)", color: mc.warn,
            }}>
              <AlertTriangle size={12} />
              {error ? "Couldn't refresh — showing earlier numbers" : "Partial data — some sources didn't load"}
            </span>
      ) : undefined}
      style={{ marginBottom: 16, color: mc.text }}
    />
  );
}

/* ── PDF / Excel export pill ──────────────────────────────────── */
export function ExportBtn({ label, icon: Icon, loading, disabled, onClick }: {
  label: string; icon: React.ElementType; loading: boolean; disabled: boolean;
  onClick: (e: React.MouseEvent) => void;
}) {
  const mc = useMC();
  return (
    <button
      type="button"
      disabled={disabled}
      aria-label={`Export as ${label}`}
      onClick={e => { e.stopPropagation(); if (!disabled) onClick(e); }}
      style={{
        display: "inline-flex", alignItems: "center", gap: 5,
        padding: "5px 10px", borderRadius: 8,
        border: "1px solid rgba(168,214,114,0.3)",
        background: loading ? "rgba(168,214,114,0.12)" : "transparent",
        fontSize: 10, fontWeight: 700, color: mc.greenInk,
        cursor: disabled ? "default" : "pointer",
        opacity: disabled && !loading ? 0.5 : 1, whiteSpace: "nowrap",
      }}
    >
      {loading ? <Loader2 size={11} className="animate-spin" /> : <Icon size={11} />}
      {label}
    </button>
  );
}

/* ── shared PDF/Excel export state ───────────────────────────── */
function useCardExports(card: CardModel | null) {
  const [busy, setBusy] = useState<"pdf" | "xlsx" | null>(null);
  const [err, setErr] = useState(false);

  const runExport = async (kind: "pdf" | "xlsx", e: React.MouseEvent) => {
    e.stopPropagation();
    if (!card || busy) return;
    setBusy(kind);
    setErr(false);
    try {
      const mod = await import("@/lib/exportCard");
      if (kind === "pdf") await mod.exportCardPdf(card);
      else await mod.exportCardExcel(card);
    } catch {
      setErr(true);
    } finally {
      setBusy(null);
    }
  };
  return { busy, err, runExport };
}

/* ── card shell: Glass + title + takeaway + footer ─────────────
 *    Every analytics card renders through this so the export
 *    requirement holds by construction. ── */
export function CardShell({ title, takeaway, card, onDrill, children, style }: {
  title: string;
  takeaway?: string;
  card: CardModel | null;
  onDrill: (card: CardModel) => void;
  children: React.ReactNode;
  style?: React.CSSProperties;
}) {
  const mc = useMC();
  const { busy, err, runExport } = useCardExports(card);
  // Usage Analytics intentionally defers event-level evidence. Never let a
  // cold summary export an empty table as if it were real zero-row evidence;
  // opening the card loads its evidence and enables export on the same card.
  const evidencePending = card?.id === "usage" && card.rows.length === 0;

  return (
    <Glass
      style={{ display: "flex", flexDirection: "column", padding: 20, ...style }}
    >
      <div style={{ fontSize: 12.5, fontWeight: 700, letterSpacing: "0.02em", color: mc.text }}>{title}</div>
      {takeaway && (
        <div style={{ marginTop: 4, fontSize: 11, lineHeight: 1.5, color: mc.muted }}>{takeaway}</div>
      )}
      <div
        role={card ? "button" : undefined}
        tabIndex={card ? 0 : undefined}
        title={card ? "See the data behind this card" : undefined}
        onClick={card ? (e) => { e.stopPropagation(); onDrill(card); } : undefined}
        onKeyDown={card ? (e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); e.stopPropagation(); onDrill(card); } } : undefined}
        style={{ marginTop: 12, flex: 1, display: "flex", flexDirection: "column", ...(card ? { cursor: "zoom-in" as const, outline: "none" } : {}) }}
      >
        {children}
      </div>
      <div style={{ marginTop: 14, paddingTop: 12, borderTop: `1px solid ${mc.border}`, display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8 }}>
        {card ? (
          <button
            type="button"
            onClick={(e) => { e.stopPropagation(); onDrill(card); }}
            style={{
              fontSize: 10.5, fontWeight: 700, color: mc.greenInk, textTransform: "uppercase",
              letterSpacing: "0.08em", background: "none", border: "none", cursor: "pointer", padding: 0,
            }}
          >
            {evidencePending ? "View data · load evidence" : `View data · ${card.rows.length.toLocaleString("en-US")} rows`}
          </button>
        ) : (
          <span style={{ fontSize: 10.5, color: mc.faint }}>No underlying rows for this card</span>
        )}
        <span style={{ display: "inline-flex", gap: 6 }}>
          {err && <span style={{ fontSize: 10, color: mc.bad, alignSelf: "center" }}>Export failed</span>}
          {card && evidencePending ? (
            <span style={{ fontSize: 10, color: mc.faint }}>Evidence loads when opened</span>
          ) : card && (
            <>
              <ExportBtn label="PDF" icon={FileText} loading={busy === "pdf"} disabled={busy !== null} onClick={e => runExport("pdf", e)} />
              <ExportBtn label="Excel" icon={FileSpreadsheet} loading={busy === "xlsx"} disabled={busy !== null} onClick={e => runExport("xlsx", e)} />
            </>
          )}
        </span>
      </div>
    </Glass>
  );
}

/* ── compact metric card ─────────────────────────────────────── */
export function StatCard({ label, value, unit, card, onDrill, children, style }: {
  label: string;
  value: string;
  unit?: string;
  card: CardModel | null;
  onDrill: (card: CardModel) => void;
  children?: React.ReactNode;
  style?: React.CSSProperties;
}) {
  const mc = useMC();
  const { busy, err, runExport } = useCardExports(card);
  const drillProps = card ? {
    role: "button" as const,
    tabIndex: 0,
    title: "See the data behind this card",
    onClick: (e: React.SyntheticEvent) => { e.stopPropagation(); onDrill(card); },
    onKeyDown: (e: React.KeyboardEvent) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); e.stopPropagation(); onDrill(card); } },
    style: { cursor: "zoom-in" as const },
  } : {};
  return (
    <Glass style={{ padding: "16px 20px", display: "flex", flexDirection: "column", ...style }}>
      {/* label row — no export buttons here so narrow cards don't overflow */}
      <div style={{ fontSize: 10, fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.14em", color: mc.faint, minHeight: 30, lineHeight: 1.5 }}>{label}</div>
      {/* Value stays at a FIXED offset from the top (no flex:1 here) so the
          bar right below it lines up across every card in the row. Leftover
          height is absorbed by the footer's marginTop:auto instead. */}
      <div style={{ marginTop: 8 }}>
        <DrillNumber value={value} unit={unit} card={card} onDrill={onDrill} size={26} />
      </div>
      {children}
      {/* footer — PDF/Excel always on their own line so they never overflow */}
      {card && (
        <div style={{ marginTop: "auto", paddingTop: 12, borderTop: `1px solid ${mc.border}`, display: "flex", alignItems: "center", justifyContent: "space-between", gap: 6, flexWrap: "wrap" }}>
          <span {...drillProps} style={{
            fontSize: 10.5, fontWeight: 700, color: mc.greenInk,
            textTransform: "uppercase", letterSpacing: "0.08em",
            ...(drillProps as { style?: React.CSSProperties }).style,
          }}>
            View data · {card.rows.length.toLocaleString("en-US")} rows
          </span>
          <span style={{ display: "inline-flex", gap: 5 }}>
            {err && <span style={{ fontSize: 10, color: mc.bad, alignSelf: "center" }}>Export failed</span>}
            <ExportBtn label="PDF" icon={FileText} loading={busy === "pdf"} disabled={busy !== null} onClick={e => runExport("pdf", e)} />
            <ExportBtn label="Excel" icon={FileSpreadsheet} loading={busy === "xlsx"} disabled={busy !== null} onClick={e => runExport("xlsx", e)} />
          </span>
        </div>
      )}
    </Glass>
  );
}

/* ── clickable drill affordance wrapper ─────────────────────── */
export function DrillZone({ card, onDrill, children, label = "See the data behind this", style }: {
  card: CardModel | null;
  onDrill: (card: CardModel) => void;
  children: React.ReactNode;
  label?: string;
  style?: React.CSSProperties;
}) {
  if (!card) return <div style={style}>{children}</div>;
  return (
    <div
      role="button"
      tabIndex={0}
      title={label}
      onClick={() => onDrill(card)}
      onKeyDown={e => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); onDrill(card); } }}
      style={{ cursor: "zoom-in", ...style }}
    >
      {children}
    </div>
  );
}

/* ── clickable number ────────────────────────────────────────── */
export function DrillNumber({ value, unit, card, onDrill, size = 30 }: {
  value: string;
  unit?: string;
  card: CardModel | null;
  onDrill: (card: CardModel) => void;
  size?: number;
}) {
  const mc = useMC();
  const props = card ? {
    role: "button" as const,
    tabIndex: 0,
    title: "See the data behind this number",
    onClick: () => onDrill(card),
    onKeyDown: (e: React.KeyboardEvent) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); onDrill(card); } },
    style: { cursor: "zoom-in" as const },
  } : {};
  return (
    <span style={{ display: "inline-flex", alignItems: "baseline", gap: 7 }}>
      <span {...props} style={{
        fontSize: size, fontWeight: 800, lineHeight: 1, letterSpacing: "-0.02em",
        fontVariantNumeric: "tabular-nums",
        color: mc.text,
        textShadow: "0 0 26px rgba(107,165,57,0.25)",
        ...(props as { style?: React.CSSProperties }).style,
      }}>{value}</span>
      {unit && <span style={{ fontSize: 11.5, color: mc.muted }}>{unit}</span>}
    </span>
  );
}

/* ── shared ReportModel loader ──────────────────────────────── */
export function useReportModel(): { m: ReportModel | null; loading: boolean; error: string | null } {
  const [initial] = useState<ReportModel | null>(() => { try { return peekReportModel(); } catch { return null; } });
  const [m, setM] = useState<ReportModel | null>(initial);
  const [loading, setLoading] = useState(!initial);
  const [error, setError] = useState<string | null>(null);
  const requestIdRef = useRef(0);

  useEffect(() => {
    let alive = true;
    const refresh = async (showLoading: boolean) => {
      const requestId = ++requestIdRef.current;
      if (showLoading) setLoading(true);
      setError(null);
      try {
        const built = await loadReportModel();
        // A lifecycle event can arrive while the initial load is in flight.
        // Only the newest request may commit, so a pre-write response can
        // never overwrite the post-write rebuild.
        if (!alive || requestId !== requestIdRef.current) return;
        if (!built) setError("No portfolio data is available right now.");
        else setM(built);
      } catch (e) {
        if (alive && requestId === requestIdRef.current) {
          setError(String((e as Error)?.message || e));
        }
      } finally {
        if (alive && requestId === requestIdRef.current) setLoading(false);
      }
    };

    void refresh(!initial);
    const onLifecycleChanged = () => { void refresh(false); };
    window.addEventListener(LIFECYCLE_CHANGED_EVENT, onLifecycleChanged);
    return () => {
      alive = false;
      requestIdRef.current++;
      window.removeEventListener(LIFECYCLE_CHANGED_EVENT, onLifecycleChanged);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return { m, loading, error };
}

/* ── loading / error blocks ──────────────────────────────────── */
export function LoadingBlock({ text = "Loading live portfolio data…" }: { text?: string }) {
  const mc = useMC();
  return (
    <Glass style={{ marginTop: 18, padding: 80, display: "flex", alignItems: "center", justifyContent: "center", gap: 10, color: mc.muted }}>
      <Loader2 className="animate-spin" size={18} style={{ color: mc.green }} />
      {text}
    </Glass>
  );
}

export function ErrorBlock({ text }: { text: string }) {
  const mc = useMC();
  return (
    <Glass style={{ marginTop: 18, padding: 60, display: "flex", alignItems: "center", justifyContent: "center", gap: 10, color: mc.warn }}>
      <AlertTriangle size={16} />
      {text}
    </Glass>
  );
}
