import { useEffect, type ReactNode } from "react";
import { X, Sparkles } from "lucide-react";

const T = {
  panel: "var(--rm-panel)",
  soft: "var(--rm-panel-soft)",
  border: "var(--rm-panel-border)",
  text: "var(--rm-text)",
  muted: "var(--rm-text-muted)",
  faint: "var(--rm-text-faint)",
};

export type AiPanelStat = {
  icon?: ReactNode;
  label: string;
  value: ReactNode;
  /** Span both columns of the stat grid. */
  wide?: boolean;
};

export type AiPanelMixSeg = { label: string; val: number; color: string };

export type AiPanelBullet = {
  icon: ReactNode;
  /** Tint for the round icon chip, e.g. "#3B82F6". */
  tone: string;
  text: ReactNode;
};

/**
 * Right-edge slide-in "AI Intelligence" panel used by the data grids'
 * AI Analysis column (companies, projects, opportunities, leads, staff).
 *
 * Purely presentational — callers compute all stats/bullets from live
 * data so the copy always reflects what is on screen.
 */
export function AiInsightPanel({
  open,
  onClose,
  title,
  subtitle = "AI Intelligence",
  accent = "#6BA539",
  badgeText,
  headerIcon,
  stats,
  mixLabel,
  mix,
  analysisTags,
  bullets,
  children,
  onAskAI,
  askLabel = "Ask AI",
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  subtitle?: string;
  /** Accent color for the header icon, badge and highlights. */
  accent?: string;
  /** e.g. "AI COMPANY INTELLIGENCE — LIVE DATA" */
  badgeText?: string;
  /** Custom header icon (defaults to Sparkles). */
  headerIcon?: ReactNode;
  stats?: AiPanelStat[];
  /** e.g. "Projects Status Mix" */
  mixLabel?: string;
  mix?: AiPanelMixSeg[];
  /** Small kicker tags inside the AI Analysis card, e.g. ["Strategy","Financials","Delivery"]. */
  analysisTags?: string[];
  bullets?: AiPanelBullet[];
  /** Extra custom sections rendered below the analysis card. */
  children?: ReactNode;
  onAskAI?: () => void;
  askLabel?: string;
}) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      window.removeEventListener("keydown", onKey);
      document.body.style.overflow = prevOverflow;
    };
  }, [open, onClose]);

  if (!open) return null;

  const mixTotal = (mix ?? []).reduce((s, m) => s + m.val, 0);

  return (
    <div
      style={{ position: "fixed", inset: 0, zIndex: 180 }}
      onClick={onClose}
      data-testid="ai-insight-overlay"
    >
      <style>{`
        @keyframes rm-ai-slide {
          from { transform: translateX(28px); opacity: 0; }
          to   { transform: translateX(0);    opacity: 1; }
        }
        @keyframes rm-ai-fade { from { opacity: 0; } to { opacity: 1; } }
        @media (prefers-reduced-motion: reduce) {
          .rm-ai-aside { animation: none !important; }
        }
        .rm-ai-scroll::-webkit-scrollbar { width: 8px; }
        .rm-ai-scroll::-webkit-scrollbar-thumb { background: rgba(128,128,128,0.35); border-radius: 4px; }
      `}</style>

      <div style={{
        position: "absolute", inset: 0,
        backgroundColor: "rgba(15,26,36,0.5)",
        backdropFilter: "blur(3px)", WebkitBackdropFilter: "blur(3px)",
        animation: "rm-ai-fade 0.2s ease",
      }} />

      <aside
        className="rm-ai-aside"
        onClick={e => e.stopPropagation()}
        role="dialog"
        aria-label={`${subtitle}: ${title}`}
        data-testid="ai-insight-panel"
        style={{
          position: "absolute", top: 0, right: 0, height: "100%",
          width: "min(460px, 94vw)",
          backgroundColor: T.panel, color: T.text,
          borderLeft: `1px solid ${T.border}`,
          boxShadow: "-14px 0 36px rgba(0,0,0,0.4)",
          display: "flex", flexDirection: "column",
          animation: "rm-ai-slide 0.28s cubic-bezier(0.16, 1, 0.3, 1)",
        }}
      >
        {/* Header */}
        <div style={{
          display: "flex", alignItems: "center", gap: 12, padding: "16px 20px",
          borderBottom: `1px solid ${T.border}`, flexShrink: 0,
          background: `linear-gradient(135deg, ${accent}17 0%, transparent 60%)`,
        }}>
          <div style={{
            width: 40, height: 40, borderRadius: 12, flexShrink: 0,
            backgroundColor: `${accent}1C`, border: `1px solid ${accent}44`,
            display: "flex", alignItems: "center", justifyContent: "center", color: accent,
          }}>
            {headerIcon ?? <Sparkles size={19} />}
          </div>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{
              fontSize: 16, fontWeight: 800, color: T.text,
              whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis",
            }}>{title}</div>
            <div style={{ fontSize: 11.5, fontWeight: 700, color: accent }}>{subtitle}</div>
          </div>
          <button
            onClick={onClose}
            aria-label="Close"
            data-testid="ai-insight-close"
            style={{
              background: "transparent", border: "none", cursor: "pointer",
              color: T.muted, padding: 6, borderRadius: 8, lineHeight: 1, flexShrink: 0,
            }}
            onMouseEnter={e => { e.currentTarget.style.backgroundColor = T.soft; }}
            onMouseLeave={e => { e.currentTarget.style.backgroundColor = "transparent"; }}
          >
            <X size={17} />
          </button>
        </div>

        {/* Body */}
        <div className="rm-ai-scroll" style={{ flex: 1, overflowY: "auto", padding: "16px 20px 20px" }}>
          {badgeText && (
            <span style={{
              display: "inline-flex", alignItems: "center", gap: 6,
              padding: "5px 12px", borderRadius: 999, marginBottom: 14,
              backgroundColor: `${accent}1A`, border: `1px solid ${accent}44`,
              color: accent, fontSize: 10, fontWeight: 800, letterSpacing: 0.7,
              textTransform: "uppercase",
            }}>
              <Sparkles size={11} />
              {badgeText}
            </span>
          )}

          {stats && stats.length > 0 && (
            <div style={{
              display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10, marginBottom: 18,
            }}>
              {stats.map((s, i) => (
                <div key={i} style={{
                  padding: "12px 14px", borderRadius: 12,
                  backgroundColor: T.soft, border: `1px solid ${T.border}`,
                  gridColumn: s.wide ? "1 / -1" : undefined, minWidth: 0,
                }}>
                  <div style={{
                    display: "flex", alignItems: "center", gap: 6, marginBottom: 4,
                    fontSize: 10.5, fontWeight: 700, color: T.muted,
                    textTransform: "uppercase", letterSpacing: 0.4,
                  }}>
                    {s.icon}
                    <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{s.label}</span>
                  </div>
                  <div style={{ fontSize: 20, fontWeight: 800, color: T.text, lineHeight: 1.2 }}>{s.value}</div>
                </div>
              ))}
            </div>
          )}

          {mix && mixTotal > 0 && (
            <div style={{ marginBottom: 18 }}>
              {mixLabel && (
                <div style={{
                  fontSize: 10.5, fontWeight: 800, color: T.muted,
                  textTransform: "uppercase", letterSpacing: 0.7, marginBottom: 8,
                }}>{mixLabel}</div>
              )}
              <div style={{
                display: "flex", height: 8, borderRadius: 999, overflow: "hidden",
                backgroundColor: "rgba(128,128,128,0.18)",
              }}>
                {mix.filter(m => m.val > 0).map((m, i) => (
                  <div key={i} style={{
                    width: `${Math.max(3, (m.val / mixTotal) * 100)}%`,
                    backgroundColor: m.color,
                  }} title={`${m.label}: ${m.val}`} />
                ))}
              </div>
              <div style={{ display: "flex", gap: 14, marginTop: 8, flexWrap: "wrap" }}>
                {mix.map((m, i) => (
                  <span key={i} style={{
                    display: "inline-flex", alignItems: "center", gap: 5,
                    fontSize: 11.5, fontWeight: 600,
                    color: m.val > 0 ? T.text : T.faint,
                  }}>
                    <span style={{
                      width: 8, height: 8, borderRadius: 999, backgroundColor: m.color,
                      opacity: m.val > 0 ? 1 : 0.35,
                    }} />
                    {m.label} {m.val}
                  </span>
                ))}
              </div>
            </div>
          )}

          {bullets && bullets.length > 0 && (
            <div style={{
              borderRadius: 14, border: `1px solid ${T.border}`,
              backgroundColor: T.soft, padding: "14px 16px", marginBottom: 16,
            }}>
              <div style={{ display: "flex", alignItems: "center", gap: 7, marginBottom: 3 }}>
                <Sparkles size={13} color={accent} />
                <span style={{ fontSize: 13, fontWeight: 800, color: T.text }}>AI Analysis</span>
              </div>
              {analysisTags && analysisTags.length > 0 && (
                <div style={{
                  display: "flex", alignItems: "center", gap: 6, marginBottom: 12,
                  fontSize: 9.5, fontWeight: 800, color: T.faint,
                  textTransform: "uppercase", letterSpacing: 0.8,
                }}>
                  {analysisTags.map((t, i) => (
                    <span key={t} style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
                      {i > 0 && <span style={{ opacity: 0.5 }}>·</span>}
                      {t}
                    </span>
                  ))}
                </div>
              )}
              <div style={{ display: "flex", flexDirection: "column", gap: 13 }}>
                {bullets.map((b, i) => (
                  <div key={i} style={{ display: "flex", gap: 11 }}>
                    <div style={{
                      width: 30, height: 30, borderRadius: 999, flexShrink: 0,
                      backgroundColor: `${b.tone}1C`, color: b.tone,
                      display: "flex", alignItems: "center", justifyContent: "center",
                    }}>
                      {b.icon}
                    </div>
                    <div style={{ fontSize: 12.5, color: T.text, lineHeight: 1.55, minWidth: 0 }}>
                      {b.text}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {children}
        </div>

        {/* Footer */}
        {onAskAI && (
          <div style={{
            display: "flex", gap: 10, padding: "12px 20px",
            borderTop: `1px solid ${T.border}`, flexShrink: 0,
          }}>
            <button
              onClick={onClose}
              style={{
                flex: "0 0 auto", padding: "9px 18px", borderRadius: 10,
                border: `1px solid ${T.border}`, background: "transparent",
                color: T.muted, fontSize: 12.5, fontWeight: 700, cursor: "pointer",
              }}
            >Close</button>
            <button
              onClick={onAskAI}
              style={{
                flex: 1, display: "flex", alignItems: "center", justifyContent: "center", gap: 7,
                padding: "9px 18px", borderRadius: 10, border: "none",
                background: "linear-gradient(135deg, #6BA539, #578a2e)",
                color: "#fff", fontSize: 12.5, fontWeight: 800, cursor: "pointer",
                boxShadow: "0 2px 10px rgba(107,165,57,0.35)",
              }}
            >
              <Sparkles size={13} />
              {askLabel}
            </button>
          </div>
        )}
      </aside>
    </div>
  );
}
