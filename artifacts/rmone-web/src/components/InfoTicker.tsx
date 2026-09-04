import { useState } from "react";
import { useReducedMotion } from "framer-motion";
import { X } from "lucide-react";
import { Z } from "@/lib/zLayers";

export type InfoTickerItemDetail = {
  title: string;
  body: string[];
  openLabel?: string;
  onOpen?: () => void;
};

export type InfoTickerItem = {
  label: string;
  value: string;
  tone: "good" | "warn" | "bad" | "info";
  onClick?: () => void;
  detail?: InfoTickerItemDetail;
};

const GREEN = "#6BA539";
const LIGHT_GREEN = "#A9C23F";
const ORANGE_WARM = "#FF9425";
const RED = "#FF4D2E";

export function InfoTicker({
  items,
  brandLabel = "RM ONE · LIVE",
  companyLabel,
  compact = false,
}: {
  items: InfoTickerItem[];
  brandLabel?: string;
  companyLabel?: string;
  compact?: boolean;
}) {
  const prefersReducedMotion = useReducedMotion();
  const [active, setActive] = useState<InfoTickerItem | null>(null);
  if (!items.length) return null;
  const toneColor = (t: InfoTickerItem["tone"]) =>
    t === "good" ? GREEN : t === "warn" ? ORANGE_WARM : t === "bad" ? RED : LIGHT_GREEN;

  function handleItemClick(it: InfoTickerItem) {
    if (it.detail) setActive(it);
    else if (it.onClick) it.onClick();
  }

  const strip = (
    <div className="flex items-center shrink-0" style={{ paddingRight: 48 }}>
      {items.map((it, idx) => {
        const inner = (
          <>
            <span
              style={{
                fontFamily: 'ui-monospace, SFMono-Regular, "SF Mono", Menlo, monospace',
                fontSize: 10,
                fontWeight: 700,
                letterSpacing: "0.22em",
                color: "var(--rm-text-muted)",
                textTransform: "uppercase",
                marginRight: 10,
              }}
            >
              {it.label}
            </span>
            <span
              style={{
                fontSize: 13,
                fontWeight: 800,
                color: toneColor(it.tone),
                letterSpacing: "0.01em",
              }}
            >
              {it.value}
            </span>
            <span
              aria-hidden
              style={{
                display: "inline-block",
                width: 6,
                height: 6,
                borderRadius: "50%",
                backgroundColor: toneColor(it.tone),
                boxShadow: `0 0 8px ${toneColor(it.tone)}`,
                marginLeft: 16,
              }}
            />
          </>
        );
        const clickable = !!(it.detail || it.onClick);
        return clickable ? (
          <button
            key={idx}
            type="button"
            onClick={() => handleItemClick(it)}
            className="flex items-center hover:opacity-90 transition-opacity"
            style={{
              paddingRight: 48,
              background: "transparent",
              border: "none",
              cursor: "pointer",
              color: "inherit",
            }}
            data-testid={`ticker-item-${idx}`}
          >
            {inner}
          </button>
        ) : (
          <div key={idx} className="flex items-center" style={{ paddingRight: 48 }}>
            {inner}
          </div>
        );
      })}
    </div>
  );

  return (
    <>
      <div
        className="rmone-ticker w-full overflow-hidden"
        style={{
          borderRadius: compact ? 0 : 8,
          backgroundColor: compact ? "transparent" : "var(--rm-panel)",
          border: compact ? "none" : "2px solid var(--rm-panel-border)",
          padding: compact ? "0" : "8px 12px",
        }}
        tabIndex={0}
        aria-label={brandLabel}
        data-testid="info-ticker"
      >
        <div className="flex items-center gap-3">
          <span
            style={{
              fontFamily: 'ui-monospace, SFMono-Regular, "SF Mono", Menlo, monospace',
              fontSize: 9,
              fontWeight: 800,
              letterSpacing: "0.26em",
              color: LIGHT_GREEN,
              textTransform: "uppercase",
              whiteSpace: "nowrap",
            }}
          >
            {brandLabel}
          </span>
          {companyLabel && (
            <>
              <div
                aria-hidden
                style={{
                  width: 1,
                  alignSelf: "stretch",
                  minHeight: 14,
                  backgroundColor: "rgba(169,194,63,0.25)",
                }}
              />
              <span
                style={{
                  fontSize: 14,
                  fontWeight: 900,
                  letterSpacing: "0.02em",
                  color: "#FF9425",
                  whiteSpace: "nowrap",
                }}
              >
                {companyLabel}
              </span>
            </>
          )}
          <div
            aria-hidden
            style={{
              width: 1,
              alignSelf: "stretch",
              minHeight: 14,
              backgroundColor: "rgba(169,194,63,0.25)",
            }}
          />
          <div className="relative flex-1 overflow-hidden" style={{ height: 22 }}>
            {prefersReducedMotion ? (
              <div className="flex items-center" style={{ position: "absolute", inset: 0 }}>
                {strip}
              </div>
            ) : (
              <div
                className="rmone-ticker-track flex items-center"
                aria-hidden="true"
                style={{
                  position: "absolute",
                  inset: 0,
                  width: "max-content",
                }}
              >
                {strip}
                {strip}
              </div>
            )}
          </div>
        </div>
        <style>{`
          @keyframes rmone-ticker-marquee {
            0% { transform: translateX(0); }
            100% { transform: translateX(-50%); }
          }
          .rmone-ticker-track {
            animation: rmone-ticker-marquee 32s linear infinite;
          }
          .rmone-ticker:hover .rmone-ticker-track,
          .rmone-ticker:focus-within .rmone-ticker-track {
            animation-play-state: paused;
          }
        `}</style>
      </div>
      {active && (
        <TickerDetailPopup
          item={active}
          onClose={() => setActive(null)}
        />
      )}
    </>
  );
}

function TickerDetailPopup({
  item,
  onClose,
}: {
  item: InfoTickerItem;
  onClose: () => void;
}) {
  const tone =
    item.tone === "good" ? GREEN :
    item.tone === "warn" ? ORANGE_WARM :
    item.tone === "bad" ? RED : LIGHT_GREEN;
  const detail = item.detail!;
  return (
    <div
      role="dialog"
      aria-modal="true"
      onClick={onClose}
      style={{
        position: "fixed", inset: 0, zIndex: Z.MODAL,
        backgroundColor: "rgba(15,26,36,0.72)",
        display: "flex", alignItems: "center", justifyContent: "center",
        padding: 16,
      }}
      data-testid="ticker-detail-popup"
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          width: "100%", maxWidth: 460,
          backgroundColor: "#FFFFFF",
          borderRadius: 14,
          padding: "18px 18px 14px",
          boxShadow: "0 18px 50px rgba(0,0,0,0.45)",
          color: "#1B2B38",
          fontFamily: "Inter, sans-serif",
        }}
      >
        <div className="flex items-start justify-between" style={{ gap: 12, marginBottom: 6 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <span
              aria-hidden
              style={{
                width: 10, height: 10, borderRadius: "50%",
                backgroundColor: tone,
                boxShadow: `0 0 8px ${tone}`,
                display: "inline-block",
              }}
            />
            <div
              style={{
                fontFamily: 'ui-monospace, SFMono-Regular, "SF Mono", Menlo, monospace',
                fontSize: 10, fontWeight: 800, letterSpacing: "0.22em",
                color: "rgba(27,43,56,0.55)", textTransform: "uppercase",
              }}
            >
              {item.label}
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            style={{
              background: "transparent", border: "none", cursor: "pointer",
              padding: 4, color: "#1B2B38",
            }}
          >
            <X size={18} />
          </button>
        </div>
        <div style={{ fontSize: 18, fontWeight: 800, marginBottom: 10, color: "#1B2B38" }}>
          {detail.title}
        </div>
        <div style={{ fontSize: 14, fontWeight: 700, color: tone, marginBottom: 12 }}>
          {item.value}
        </div>
        {detail.body.length > 0 && (
          <ul style={{ listStyle: "none", padding: 0, margin: "0 0 14px", display: "grid", gap: 6 }}>
            {detail.body.map((line, i) => (
              <li key={i} style={{ fontSize: 13, color: "rgba(27,43,56,0.78)", lineHeight: 1.45 }}>
                {line}
              </li>
            ))}
          </ul>
        )}
        <div style={{ display: "flex", justifyContent: "flex-end", gap: 8 }}>
          <button
            type="button"
            onClick={onClose}
            style={{
              padding: "8px 14px", borderRadius: 8,
              border: "1px solid rgba(27,43,56,0.18)",
              backgroundColor: "#FFFFFF", color: "#1B2B38",
              fontSize: 13, fontWeight: 700, cursor: "pointer",
            }}
          >
            Close
          </button>
          {detail.onOpen && (
            <button
              type="button"
              onClick={() => { detail.onOpen?.(); onClose(); }}
              style={{
                padding: "8px 14px", borderRadius: 8,
                border: "none",
                backgroundColor: GREEN, color: "#FFFFFF",
                fontSize: 13, fontWeight: 800, cursor: "pointer",
              }}
              data-testid="ticker-detail-open"
            >
              {detail.openLabel || "Open"}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
