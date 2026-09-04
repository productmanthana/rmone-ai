/**
 * TeamViewModePicker — per-project team-layout modal.
 *
 * Opens as a CENTERED MODAL with a blurred/dimmed backdrop.
 * Zoom-in animation on open, zoom-out on close.
 * "Default — company setting" row is dimmed when already active.
 */
import { forwardRef, useEffect, useImperativeHandle, useRef, useState } from "react";
import { Check, ChevronDown, LayoutGrid, Calendar, TableProperties, AlignJustify, Eye, Users } from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { getDisplayModeFor } from "@/lib/businessRules";
import {
  MODE_GROUPS, MODE_HAS_SCHEDULE, MODE_LABELS, type ProjViewMode,
  getProjectViewOverride, setProjectViewOverride, useProjectViewModeVersion,
} from "@/lib/projectViewMode";
import { Z } from "@/lib/zLayers";

/* ─── tokens ─────────────────────────────────────────────────────────── */
const C = {
  panel:  "var(--rm-panel)",
  border: "var(--rm-panel-border)",
  text:   "var(--rm-text)",
  muted:  "var(--rm-text-muted)",
  faint:  "var(--rm-text-faint)",
  green:  "#6BA539",
};
const SELECTED_BG = "rgba(107,165,57,0.16)";
const HOVER_BG    = "rgba(255,255,255,0.06)";
const DIMMED_BG   = "rgba(255,255,255,0.02)";

/* ─── icon per mode ───────────────────────────────────────────────────── */
const MODE_ICON: Record<ProjViewMode, LucideIcon> = {
  "full":                 LayoutGrid,
  "no-schedule":          TableProperties,
  "schedule-no-grid":     Calendar,
  "no-schedule-no-grid":  AlignJustify,
  "no-schedule-no-hours": Eye,
};

/* ─── one-shot CSS injection ──────────────────────────────────────────── */
let _cssInjected = false;
function ensureCSS() {
  if (_cssInjected) return;
  _cssInjected = true;
  const s = document.createElement("style");
  s.textContent = `
    @keyframes tvmp-backdrop-in   { from{opacity:0}                      to{opacity:1} }
    @keyframes tvmp-backdrop-out  { from{opacity:1}                      to{opacity:0} }
    @keyframes tvmp-panel-in      { from{opacity:0;transform:translate(-50%,-50%) scale(0.80)} to{opacity:1;transform:translate(-50%,-50%) scale(1)} }
    @keyframes tvmp-panel-out     { from{opacity:1;transform:translate(-50%,-50%) scale(1)}    to{opacity:0;transform:translate(-50%,-50%) scale(0.80)} }
    @keyframes tvmp-btn-breathe   {
      0%,100% { transform:scale(1) translateX(0);      box-shadow:0 0 0    0   rgba(59,130,246,0);    }
      45%     { transform:scale(1.09) translateX(4px); box-shadow:0 0 12px 3px rgba(59,130,246,0.40); }
    }
    @keyframes tvmp-color-flow {
      0%   { background-position: 0% 50%; }
      50%  { background-position: 100% 50%; }
      100% { background-position: 0% 50%; }
    }
    .tvmp-pulse { animation: tvmp-btn-breathe 1.3s ease-in-out 5; transform-origin: center; }
    .tvmp-flow {
      background-image: linear-gradient(100deg, #6BA539, #14b8a6, #3b82f6, #8b5cf6, #ec4899, #6BA539);
      background-size: 500% 100%;
      animation: tvmp-color-flow 7s ease-in-out infinite;
    }
    .tvmp-pulse.tvmp-flow {
      animation: tvmp-btn-breathe 1.3s ease-in-out 5, tvmp-color-flow 7s ease-in-out infinite;
      transform-origin: center;
    }
  `;
  document.head.appendChild(s);
}

/* ══════════════════════════════════════════════════════════════════════ */
export type TeamViewModePickerHandle = {
  open: () => void;
};

type TeamViewModePickerProps = {
  recordId:    string;
  module:      string;
  variant:     "tab" | "pill";
  tabLabel?:   string;
  TabIcon?:    LucideIcon;
  tabActive?:  boolean;
  onTabSelect?: () => void;
};

export const TeamViewModePicker = forwardRef<TeamViewModePickerHandle, TeamViewModePickerProps>(
function TeamViewModePicker({
  recordId, module, variant,
  tabLabel = "Team View", TabIcon, tabActive, onTabSelect,
}, ref) {
  useProjectViewModeVersion();
  ensureCSS();

  const [open,    setOpen]    = useState(false);
  const [closing, setClosing] = useState(false);
  const [pulsed,  setPulsed]  = useState(false);
  const closeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  /* Pulse hint on first mount */
  useEffect(() => {
    const t = setTimeout(() => { setPulsed(true); }, 500);
    return () => clearTimeout(t);
  }, []);
  useEffect(() => {
    if (!pulsed) return;
    const t = setTimeout(() => setPulsed(false), 7000);
    return () => clearTimeout(t);
  }, [pulsed]);

  const ANIM_MS = 200; // must match CSS animation duration

  const openModal = () => {
    if (closeTimer.current) clearTimeout(closeTimer.current);
    setClosing(false);
    setOpen(true);
    onTabSelect?.();
  };
  useImperativeHandle(ref, () => ({ open: openModal }), [openModal]);

  const closeModal = () => {
    setClosing(true);
    closeTimer.current = setTimeout(() => {
      setOpen(false);
      setClosing(false);
    }, ANIM_MS);
  };

  // Escape key
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") closeModal(); };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open]); // eslint-disable-line react-hooks/exhaustive-deps

  const override   = getProjectViewOverride(recordId, module);
  const tenantMode = getDisplayModeFor(module);
  const effective  = override ?? tenantMode;

  const pick = (mode: ProjViewMode | null) => {
    setProjectViewOverride(recordId, mode, module);
    closeModal();
  };

  /* ── modal row ─────────────────────────────────────────────────── */
  const row = (
    mode:     ProjViewMode | null,
    name:     string,
    desc:     string,
    selected: boolean,
    dimmed:   boolean,
  ) => {
    const Icon = mode ? MODE_ICON[mode] : Users;
    // The Default row's badge reflects the layout it currently resolves to.
    const withSched = MODE_HAS_SCHEDULE[mode ?? tenantMode];
    return (
        <button
         type="button"
        key={mode ?? "default"}
        onClick={() => pick(mode)}
        style={{
          display: "flex", alignItems: "flex-start", gap: 10, width: "100%",
          textAlign: "left", padding: "9px 10px", borderRadius: 9, border: "none",
          cursor: "pointer",
          backgroundColor: selected ? SELECTED_BG : dimmed ? DIMMED_BG : "transparent",
          opacity: dimmed ? 0.5 : 1,
          transition: "background 0.12s, opacity 0.12s",
        }}
        onMouseEnter={e => { if (!selected) e.currentTarget.style.backgroundColor = HOVER_BG; }}
        onMouseLeave={e => { e.currentTarget.style.backgroundColor = selected ? SELECTED_BG : dimmed ? DIMMED_BG : "transparent"; }}
      >
        <span style={{
          width: 30, height: 30, borderRadius: 8, flexShrink: 0,
          display: "flex", alignItems: "center", justifyContent: "center",
          backgroundColor: selected ? "rgba(107,165,57,0.22)" : "rgba(255,255,255,0.05)",
          border: `1px solid ${selected ? "rgba(107,165,57,0.4)" : "rgba(255,255,255,0.07)"}`,
        }}>
          <Icon size={13} color={selected ? C.green : C.muted} />
        </span>
        <span style={{ flex: 1, minWidth: 0 }}>
          <span style={{ display: "flex", alignItems: "center", gap: 6, minWidth: 0, flexWrap: "wrap" }}>
            <span style={{ fontSize: 12.5, fontWeight: 600, color: selected ? C.green : C.text }}>
              {name}
            </span>
            {/* Schedule presence badge — green: phase schedule shown (member
                dates bounded by it); amber: no schedule in this layout.
                Ink comes from the semantic tokens so it flips with the theme
                (light green/orange on the dark panel, dark ink on white). */}
            <span style={{
              flexShrink: 0, padding: "1.5px 7px", borderRadius: 999,
              fontSize: 8.5, fontWeight: 800, letterSpacing: 0.4, textTransform: "uppercase",
              backgroundColor: withSched ? "rgba(107,165,57,0.14)" : "rgba(245,158,11,0.13)",
              border: `1px solid ${withSched ? "rgba(107,165,57,0.55)" : "rgba(245,158,11,0.55)"}`,
              color: withSched ? "var(--rm-green-ink, #4C7B22)" : "var(--rm-ink-orange, #B45309)",
            }}>
              {withSched ? "Schedule" : "No schedule"}
            </span>
          </span>
          <span style={{ display: "block", fontSize: 11, color: C.faint, marginTop: 2, lineHeight: 1.35 }}>
            {desc}
          </span>
        </span>
        <span style={{ width: 16, flexShrink: 0, paddingTop: 2 }}>
          {selected && <Check size={14} color={C.green} />}
        </span>
      </button>
    );
  };

  /* ── trigger ────────────────────────────────────────────────────── */
  const trigger = variant === "tab" ? (
    <button
       type="button"
      onClick={openModal}
      title="Choose what this project's team section shows"
      className={`${pulsed ? "tvmp-pulse" : ""} ${tabActive ? "tvmp-flow" : ""}`.trim()}
      style={{
        display: "flex", alignItems: "center", gap: 5,
        padding: "4px 10px", borderRadius: 6, border: "none", cursor: "pointer",
        fontSize: 11, fontWeight: 600,
        backgroundColor: tabActive ? C.green : "transparent",
        color: tabActive ? "#FFF" : C.faint,
        transition: "background 0.15s, color 0.15s", whiteSpace: "nowrap",
        position: "relative",
      }}
    >
      {TabIcon && <TabIcon size={11} />}
      {tabLabel}
      <ChevronDown size={11} style={{ marginLeft: 1, opacity: 0.85 }} />
      {/* green dot badge — signals a picker is behind this button */}
      <span style={{
        position: "absolute", top: -4, right: -4,
        width: 7, height: 7, borderRadius: "50%", backgroundColor: C.green,
        border: "1.5px solid var(--rm-panel,#1a1f2e)", pointerEvents: "none",
      }} />
    </button>
  ) : (
    <button
       type="button"
      onClick={openModal}
      title="Choose what this project's team section shows"
      className={pulsed ? "tvmp-pulse" : ""}
      style={{
        display: "flex", alignItems: "center", gap: 6,
        padding: "5px 10px", borderRadius: 8, cursor: "pointer",
        fontSize: 11, fontWeight: 600,
        backgroundColor: "rgba(255,255,255,0.05)",
        border: `1px solid ${C.border}`, color: C.muted, whiteSpace: "nowrap",
        transition: "border-color 0.15s, box-shadow 0.15s",
      }}
      onMouseEnter={e => {
        e.currentTarget.style.borderColor = "rgba(107,165,57,0.5)";
        e.currentTarget.style.boxShadow   = "0 0 0 2px rgba(107,165,57,0.12)";
      }}
      onMouseLeave={e => {
        e.currentTarget.style.borderColor = C.border;
        e.currentTarget.style.boxShadow   = "none";
      }}
    >
      <LayoutGrid size={11} color={C.green} />
      Layout: <span style={{ color: C.green, fontWeight: 700 }}>{MODE_LABELS[effective].name}</span>
      <ChevronDown size={11} style={{ opacity: 0.7 }} />
    </button>
  );

  /* ── modal ──────────────────────────────────────────────────────── */
  const animDuration = `${ANIM_MS}ms`;
  const modal = open && (
    <>
      {/* backdrop */}
      <div
        onClick={closeModal}
        style={{
          position: "fixed", inset: 0, zIndex: Z.DRAWER,
          background: "rgba(0,0,0,0.48)",
          backdropFilter: "blur(3px)", WebkitBackdropFilter: "blur(3px)",
          animation: `${closing ? "tvmp-backdrop-out" : "tvmp-backdrop-in"} ${animDuration} ease forwards`,
        }}
      />

      {/* centered panel — zoom in on open, zoom out on close */}
      <div style={{
        position: "fixed", top: "50%", left: "50%", zIndex: Z.DRAWER_MENU,
        width: 330,
        backgroundColor: C.panel,
        border: "1px solid rgba(255,255,255,0.1)",
        borderRadius: 14,
        boxShadow: "0 24px 60px rgba(0,0,0,0.6), 0 0 0 1px rgba(255,255,255,0.04)",
        padding: "6px 8px 10px",
        transform: "translate(-50%,-50%)",
        animation: `${closing ? "tvmp-panel-out" : "tvmp-panel-in"} ${animDuration} cubic-bezier(0.22,1,0.36,1) forwards`,
      }}>
        {/* header */}
        <div style={{
          display: "flex", alignItems: "center", gap: 7,
          padding: "8px 8px 6px",
          borderBottom: "1px solid rgba(255,255,255,0.07)", marginBottom: 6,
        }}>
          <LayoutGrid size={13} color={C.green} />
          <span style={{ fontSize: 11, fontWeight: 700, letterSpacing: 0.4, textTransform: "uppercase", color: C.faint }}>
            Team layout — this project only
          </span>
        </div>

        {/* Default row — dimmed because clicking it keeps the same layout */}
        {row(
          null,
          "Default — company setting",
          `currently: ${MODE_LABELS[tenantMode].name} · ${MODE_LABELS[tenantMode].desc}`,
          override === null,
          override === null,
        )}

        {/* mode groups */}
        {MODE_GROUPS.map(g => (
          <div key={g.label}>
            <div style={{
              fontSize: 10, fontWeight: 700, letterSpacing: 0.5, textTransform: "uppercase",
              color: C.faint, padding: "10px 10px 4px",
              borderTop: "1px solid rgba(255,255,255,0.06)", marginTop: 4,
            }}>
              {g.label}
            </div>
            {g.modes.map(m => row(m, MODE_LABELS[m].name, MODE_LABELS[m].desc, effective === m, false))}
          </div>
        ))}

        {/* footer */}
        <div style={{
          marginTop: 10, padding: "7px 10px 2px",
          borderTop: "1px solid rgba(255,255,255,0.06)",
          fontSize: 10.5, color: C.faint, lineHeight: 1.4,
        }}>
          Changes apply to this project only. "Default" follows the company setting.
        </div>
      </div>
    </>
  );

  return <>{trigger}{modal}</>;
});

TeamViewModePicker.displayName = "TeamViewModePicker";
