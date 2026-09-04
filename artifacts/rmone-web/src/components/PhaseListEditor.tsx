/**
 * PhaseListEditor — Workflow-stages-style ordered list editor used by the
 * Projects & Opportunities settings (schedule phases + opportunity stage set).
 * Mirrors the Stage Rules "Workflow stages" UX: numbered preview bar, drag &
 * drop rows (with up/down arrow fallback), inline rename, delete, and an
 * add-your-own footer with one-click suggestions.
 *
 * Colors: phase colors are resolved by the SAME resolver the Gantt and phase
 * chips use app-wide (lib/phaseColors), so the swatch shown here is exactly
 * the color users will see on project schedules. They're display-only — the
 * resolver keeps custom names coherent without per-phase config.
 *
 * PhaseSetsSaveBar — sidebar of saved schedules (one card for the default
 * list plus one per saved set) with an editor pane. Persisted as a JSON
 * string (server type ProjectPhaseSet in onboarding-defaults.ts — validation
 * caps mirror there). Saved sets are PLAIN TEMPLATES: audience scoping was
 * retired (Aug 2026) — the default list applies to everyone, and "Make
 * default" is the only way to switch which list new records are built from.
 * Legacy applyMode/groupIds fields round-trip untouched but are ignored.
 */

import React, { Fragment, useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { GripVertical, Pencil, Check, X, ChevronUp, ChevronDown, ChevronRight, ChevronLeft, CornerDownRight, Trash2, Plus, Search, Star, SlidersHorizontal, Palette } from "lucide-react";
import { resolvePhaseColor } from "@/lib/phaseColors";
import { type UserGroup } from "@/lib/permissions";
import MultiPick from "@/components/MultiPick";
import { GroupMembersHover, useGroupMemberNames } from "@/components/GroupMembersHover";
import { isUserAudienceId, personAudienceOptions, audienceIdName, type PersonOption } from "@/lib/audienceIds";
import { Z } from "@/lib/zLayers";

/* ── Lifecycle-library visual constants (mirrors project-detail.tsx) ──────── */
const LL_NAVY   = "#24384A";
const LL_GREEN  = "#6BA539";
const LL_LIME   = "#AAC23E";
const LL_ORANGE = "#F2921F";
const LL_MUTE   = "#6B7A83";
const LL_LINE   = "#E1E6E5";
const LL_PAPER  = "#F7F9F8";
const LL_INK    = "#16222E";
type LLFam = "design" | "procure" | "build" | "close" | "custom";
const LL_FAM_COLORS: Record<LLFam, string> = { design: LL_NAVY, procure: LL_ORANGE, build: LL_LIME, close: LL_GREEN, custom: "#8C99A2" };
function llPhaseFamily(name: string): LLFam {
  const n = name.toLowerCase();
  if (/design|schematic|pre.schemati|document|^dd\b|^cd\b/.test(n)) return "design";
  if (/bid|procure|lump.sum|encumbran|award|rfp|rfq/.test(n)) return "procure";
  if (/construct|build|admin|\bca\b|\bcm\b/.test(n)) return "build";
  if (/close|complete|finish|turnover/.test(n)) return "close";
  return "custom";
}
function llPhaseCode(name: string): string {
  const words = name.replace(/[^a-zA-Z0-9 ]/g, " ").trim().split(/\s+/).filter(Boolean);
  if (words.length >= 2) return words.map(w => w[0]).join("").toUpperCase().slice(0, 4);
  return name.replace(/[^a-zA-Z0-9]/g, "").toUpperCase().slice(0, 4) || "?";
}
function LLPhaseRail({ phases }: { phases: string[] }) {
  return (
    <span style={{ display: "flex", alignItems: "flex-start", overflowX: "auto", paddingBottom: 2 }}>
      {phases.map((name, si) => {
        const fam = llPhaseFamily(name);
        const col = LL_FAM_COLORS[fam];
        const prevCol = si > 0 ? LL_FAM_COLORS[llPhaseFamily(phases[si - 1])] : col;
        return (
          <Fragment key={si}>
            {si > 0 && <span style={{ flex: 1, minWidth: 14, height: 2, marginTop: 4.5, background: `linear-gradient(90deg,${prevCol},${col})`, display: "block" }} />}
            <span style={{ flexShrink: 0, minWidth: 40, textAlign: "center" }} title={name}>
              <span style={{ width: 10, height: 10, borderRadius: "50%", margin: "0 auto", display: "block", background: fam === "custom" ? "#fff" : col, border: fam === "custom" ? "1.5px dashed #8C99A2" : "none", boxShadow: fam === "custom" ? "0 0 0 3px #fff" : `0 0 0 3px #fff,0 0 0 4px ${col}4D` }} />
              <span style={{ display: "block", marginTop: 5, fontFamily: "ui-monospace,SFMono-Regular,Menlo,monospace", fontSize: 9, letterSpacing: "0.07em", color: LL_MUTE, whiteSpace: "nowrap" }}>{llPhaseCode(name)}</span>
            </span>
          </Fragment>
        );
      })}
    </span>
  );
}

const border = "1px solid hsl(var(--border))";
const muted = "hsl(var(--muted-foreground))";

// ── Phase color picker ────────────────────────────────────────────────────────

/** Returns true when a hex color is dark enough to need white text. */
export function phaseColorIsDark(hex: string): boolean {
  const h = hex.replace("#", "");
  if (h.length < 6) return false;
  const r = parseInt(h.slice(0, 2), 16);
  const g = parseInt(h.slice(2, 4), 16);
  const b = parseInt(h.slice(4, 6), 16);
  return (0.299 * r + 0.587 * g + 0.114 * b) < 145;
}

/** Color swatches offered in the per-phase color picker. */
export const PHASE_COLOR_PALETTE: { hex: string; label: string }[] = [
  // Row 1 — canonical A/E schedule progression
  { hex: "#C9F1E4", label: "Pre-SD mint" },
  { hex: "#86D5CA", label: "SD teal" },
  { hex: "#44A2B1", label: "DD blue-teal" },
  { hex: "#236E97", label: "CD slate" },
  { hex: "#1B296D", label: "Bidding navy" },
  { hex: "#79260A", label: "CM rust" },
  { hex: "#DD8629", label: "CO amber" },
  // Row 2 — extended
  { hex: "#6366f1", label: "Indigo" },
  { hex: "#8b5cf6", label: "Violet" },
  { hex: "#ec4899", label: "Pink" },
  { hex: "#ef4444", label: "Red" },
  { hex: "#f97316", label: "Orange" },
  { hex: "#10b981", label: "Emerald" },
  { hex: "#0ea5e9", label: "Sky" },
  // Row 3 — more options
  { hex: "#64748b", label: "Slate grey" },
  { hex: "#D0BF9E", label: "No Phase tan" },
  { hex: "#fbbf24", label: "Yellow" },
  { hex: "#a3e635", label: "Lime" },
  { hex: "#14b8a6", label: "Teal" },
  { hex: "#f43f5e", label: "Rose" },
  { hex: "#3b82f6", label: "Blue" },
];

/**
 * Small circular swatch button that opens an inline palette popup.
 * `current` = hex override or null (auto). `onChange(null)` clears the override.
 */
export function ColorSwatchPicker({ current, onChange, size = 22 }: {
  current?: string | null;
  onChange: (hex: string | null) => void;
  size?: number;
}) {
  const [open, setOpen] = React.useState(false);
  const ref = React.useRef<HTMLDivElement>(null);
  React.useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [open]);

  return (
    <div ref={ref} style={{ position: "relative", flexShrink: 0 }}>
      <button
        type="button"
        title={current ? `Phase color: ${current} — click to change` : "Set a custom phase color"}
        onClick={() => setOpen(o => !o)}
        style={{
          width: size, height: size, borderRadius: 999,
          background: current ?? "hsl(var(--muted))",
          border: current
            ? `2px solid ${phaseColorIsDark(current) ? "rgba(255,255,255,0.25)" : "rgba(0,0,0,0.12)"}`
            : "1.5px dashed hsl(var(--border))",
          cursor: "pointer", flexShrink: 0,
          display: "flex", alignItems: "center", justifyContent: "center",
          outline: open ? "2px solid hsl(var(--primary))" : "none", outlineOffset: 1,
          boxShadow: current ? "0 1px 3px rgba(0,0,0,0.18)" : "none",
          padding: 0,
        }}
      >
        {!current && (
          <Palette style={{ width: 11, height: 11, color: "hsl(var(--muted-foreground))" }} />
        )}
      </button>
      {open && (
        <div style={{
          position: "absolute", top: "calc(100% + 5px)", left: "50%", transform: "translateX(-50%)",
          zIndex: Z.POPUP, background: "hsl(var(--background))",
          border: "1px solid hsl(var(--border))", borderRadius: 10,
          padding: "10px 10px 8px",
          boxShadow: "0 8px 28px rgba(0,0,0,0.14)",
          display: "flex", flexDirection: "column", gap: 7, minWidth: 174,
        }}>
          <div style={{ fontSize: 11, fontWeight: 700, color: muted, letterSpacing: 0.3, textTransform: "uppercase" }}>
            Phase color
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(7, 22px)", gap: 5 }}>
            {PHASE_COLOR_PALETTE.map(({ hex, label }) => (
              <button
                key={hex}
                type="button"
                title={label}
                onClick={() => { onChange(hex); setOpen(false); }}
                style={{
                  width: 22, height: 22, borderRadius: 999, background: hex, cursor: "pointer", padding: 0,
                  border: current === hex
                    ? "2.5px solid hsl(var(--primary))"
                    : "1.5px solid rgba(0,0,0,0.10)",
                  boxShadow: current === hex ? "0 0 0 2px hsl(var(--primary) / 0.25)" : "none",
                  outline: "none",
                }}
              />
            ))}
          </div>
          {current && (
            <button
              type="button"
              onClick={() => { onChange(null); setOpen(false); }}
              style={{
                fontSize: 11, color: muted, background: "none", border: "none",
                cursor: "pointer", textAlign: "left", padding: "2px 0",
                textDecoration: "underline", marginTop: 1,
              }}
            >
              Reset to automatic color
            </button>
          )}
        </div>
      )}
    </div>
  );
}

function parseList(v: string): string[] {
  return v.split(",").map((s) => s.trim()).filter(Boolean);
}

/** Numbered bubble matching the Stage Rules preview style. */
function Bubble({ n, bg, text }: { n: number; bg: string; text: string }) {
  return (
    <span style={{
      width: 22, height: 22, borderRadius: 999, background: bg, color: text,
      display: "inline-flex", alignItems: "center", justifyContent: "center",
      fontSize: 11, fontWeight: 700, flexShrink: 0,
    }}>{n}</span>
  );
}

export function PhaseListEditor({ value, onChange, suggestions, colored = true, itemNoun = "phase", headerEnd, footerEnd, listMaxHeight, extraOf, showPreview = true, removeConfirmNote, onSetRules, ruleCountOf, colors, onColorChange }: {
  /** Comma-separated ordered list (the settings form's storage shape). */
  value: string;
  onChange: (v: string) => void;
  suggestions: string[];
  /** Show the app-wide resolved phase color as a swatch on each row/preview. */
  colored?: boolean;
  itemNoun?: string;
  /** ReactNode rendered on the right side of the drag-to-reorder header bar (e.g. Save / Save As buttons). */
  headerEnd?: React.ReactNode;
  /** ReactNode rendered in the add-footer row alongside CLICK TO ADD suggestions (e.g. Manage button). */
  footerEnd?: React.ReactNode;
  /** When provided, the item list scrolls vertically at this pixel height instead of growing unbounded. */
  listMaxHeight?: number;
  /** Rows where this returns true get a small green "extra" badge — used by
   *  exception lists to mark phases that aren't in the default list. */
  extraOf?: (name: string) => boolean;
  /** Hide the read-only preview bar above the rows (exception panels — the
   *  sidebar card already shows the same chips flow). */
  showPreview?: boolean;
  /** When set, removing a row asks for confirmation first and appends this
   *  sentence. Used by the DEFAULT list, whose saves reconcile live records
   *  (a removed stage is cleared from records that still sit on it) — and
   *  which now saves automatically, so there is no Save press to think twice at. */
  removeConfirmNote?: string;
  /** When provided, each row shows a "Set rules" button (locks, required
   *  fields, skips, who-can-act) that opens the per-stage rules drawer. */
  onSetRules?: (name: string) => void;
  /** Live per-stage rule count for the "Set rules (N)" badge. */
  ruleCountOf?: (name: string) => number;
  /** Per-phase color overrides: name → hex. Overrides the auto-resolved
   *  lib/phaseColors color and is reflected live in the row swatch + preview bar. */
  colors?: Record<string, string>;
  /** Called when the user picks or clears a color for a phase (null = reset to auto). */
  onColorChange?: (name: string, color: string | null) => void;
}) {
  const items = useMemo(() => parseList(value), [value]);
  const [dragIdx, setDragIdx] = useState<number | null>(null);
  const [overIdx, setOverIdx] = useState<number | null>(null);
  const [editIdx, setEditIdx] = useState<number | null>(null);
  const [editText, setEditText] = useState("");
  const [custom, setCustom] = useState("");

  const commit = (next: string[]) => onChange(next.join(", "));
  const move = (from: number, to: number) => {
    if (from === to || from < 0 || to < 0 || from >= items.length || to >= items.length) return;
    const next = [...items];
    const [m] = next.splice(from, 1);
    next.splice(to, 0, m);
    commit(next);
  };
  const remove = (i: number) => {
    if (removeConfirmNote && !window.confirm(
      `Remove the "${items[i]}" ${itemNoun}? ${removeConfirmNote}`
    )) return;
    commit(items.filter((_, idx) => idx !== i));
  };
  const add = (name: string) => {
    const v = name.trim();
    if (!v || items.some((p) => p.toLowerCase() === v.toLowerCase())) return;
    commit([...items, v]);
  };
  const rename = (i: number) => {
    const v = editText.trim();
    setEditIdx(null);
    if (!v || v === items[i]) return;
    if (items.some((p, idx) => idx !== i && p.toLowerCase() === v.toLowerCase())) return;
    const next = [...items];
    next[i] = v;
    commit(next);
  };

  const colorOf = (name: string, i: number) => {
    const override = colors?.[name];
    if (override) return { bg: override, text: phaseColorIsDark(override) ? "#fff" : "#222" };
    return colored ? resolvePhaseColor(name, i, items.length) : { bg: "hsl(var(--primary))", text: "#fff" };
  };

  const remainingSuggestions = suggestions.filter(
    (s) => !items.some((p) => p.toLowerCase() === s.toLowerCase()),
  );

  return (
    <div>
      <style>{`
        .ple-ib { width: 28px; height: 28px; border: none; border-radius: 6px;
          background: none; display: inline-flex; align-items: center; justify-content: center;
          color: hsl(var(--muted-foreground)); cursor: pointer; padding: 0; flex-shrink: 0; }
        .ple-ib:hover:not(:disabled) { background: hsl(var(--muted) / 0.5); color: hsl(var(--foreground)); }
        .ple-ib:disabled { opacity: 0.3; cursor: not-allowed; }
        .ple-ib-del:hover:not(:disabled) { background: rgba(220,38,38,0.08); color: #dc2626; }
        .ple-ib-rules {
          width: auto; height: 28px; padding: 0 6px; gap: 4px;
          font-size: 11.5px; font-weight: 600; white-space: nowrap;
          border: none; background: none; color: hsl(var(--primary)); }
        .ple-ib-rules:hover:not(:disabled) { text-decoration: underline; color: hsl(var(--primary)); background: none; }
        .ple-rules-badge { font-size: 10px; font-weight: 600; font-family: ui-monospace, monospace;
          padding: 1px 5px; border-radius: 9px; }
        .ple-rules-badge-on  { background: #eaf2e3; color: #4c7a25; }
        .ple-rules-badge-off { background: hsl(var(--muted) / 0.5); color: hsl(var(--muted-foreground)); }
        .ple-row:hover { background: hsl(var(--muted) / 0.3); }
        .ple-sg { font-size: 12px; padding: 4px 11px; border: 1px dashed hsl(var(--border)); border-radius: 999px;
          background: transparent; color: hsl(var(--muted-foreground)); cursor: pointer;
          display: inline-flex; align-items: center; gap: 4px; }
        .ple-sg:hover { border-style: solid; border-color: hsl(var(--primary) / 0.45); background: hsl(var(--primary) / 0.08); color: hsl(var(--primary)); }
        .ple-band-wrap { padding: 12px 14px 8px; background: hsl(var(--muted) / 0.18); border-bottom: 1px solid hsl(var(--border)); }
        .ple-band-cap { display: flex; justify-content: space-between; align-items: baseline; margin-bottom: 8px;
          font-family: ui-monospace, monospace; font-size: 10px; font-weight: 600; letter-spacing: .12em;
          text-transform: uppercase; color: hsl(var(--muted-foreground)); }
        .ple-band { display: flex; gap: 3px; height: 28px; }
        .ple-seg { position: relative; border-radius: 5px; display: flex; align-items: center; padding: 0 9px;
          font-size: 11.5px; font-weight: 600; color: #fff; white-space: nowrap; overflow: hidden;
          text-overflow: ellipsis; min-width: 0; flex: 1; }
        .ple-ticks { display: flex; justify-content: space-between; padding: 5px 1px 0;
          font-family: ui-monospace, monospace; font-size: 10px; color: hsl(var(--muted-foreground)); }
      `}</style>
      {/* ── Preview band — proportional Gantt colour strip ── */}
      {showPreview && items.length > 0 && (
        <div className="ple-band-wrap">
          <div className="ple-band-cap">
            <span>Preview on the Gantt</span>
          </div>
          <div className="ple-band">
            {items.map((p, i) => {
              const c = colorOf(p, i);
              return (
                <div key={`band-${p}-${i}`} className="ple-seg" style={{ background: c.bg }}
                  title={p}>
                  {p}
                </div>
              );
            })}
          </div>
          <div className="ple-ticks">
            <span>Start</span>
            {items.length > 2 && <span>Mid</span>}
            <span>End</span>
          </div>
        </div>
      )}

      {/* ── Editable rows — mockup style: hover rows, boxed icon buttons ── */}
      <div style={{ border, borderRadius: 8, overflow: "hidden" }}>
        {headerEnd && (
          <div style={{ display: "flex", alignItems: "center", justifyContent: "flex-end", gap: 6, padding: "6px 10px", borderBottom: border, background: "hsl(var(--muted) / 0.25)" }}>
            {headerEnd}
          </div>
        )}
        <div style={listMaxHeight ? { maxHeight: listMaxHeight, overflowY: "auto" } : undefined}>
        {items.map((p, i) => {
          const c = colorOf(p, i);
          const editing = editIdx === i;
          return (
            <div
              key={`${p}-${i}`}
              className="ple-row"
              draggable={!editing}
              onDragStart={() => setDragIdx(i)}
              onDragOver={(e) => { e.preventDefault(); setOverIdx(i); }}
              onDrop={() => { if (dragIdx !== null) move(dragIdx, i); setDragIdx(null); setOverIdx(null); }}
              onDragEnd={() => { setDragIdx(null); setOverIdx(null); }}
              style={{
                display: "flex", alignItems: "center", gap: 10, padding: "8px 12px",
                borderTop: i > 0 ? "1px solid hsl(var(--muted) / 0.5)" : "none",
                background: overIdx === i && dragIdx !== null && dragIdx !== i ? "hsl(var(--primary) / 0.08)" : undefined,
                cursor: editing ? "default" : "grab", opacity: dragIdx === i ? 0.5 : 1,
              }}
            >
              <GripVertical style={{ width: 14, height: 14, color: muted, flexShrink: 0 }} />
              <Bubble n={i + 1} bg={c.bg} text={c.text} />
              {editing ? (
                <span style={{ display: "flex", alignItems: "center", gap: 6, flex: 1, minWidth: 0 }}>
                  <Input
                    autoFocus value={editText}
                    onChange={(e) => setEditText(e.target.value)}
                    onKeyDown={(e) => { if (e.key === "Enter") rename(i); if (e.key === "Escape") setEditIdx(null); }}
                    style={{ height: 28, fontSize: 12.5, maxWidth: 260 }}
                  />
                  <button type="button" onClick={() => rename(i)} title="Save name" style={{ background: "none", border: "none", cursor: "pointer", color: "#10b981", display: "flex", padding: 2 }}>
                    <Check style={{ width: 14, height: 14 }} />
                  </button>
                  <button type="button" onClick={() => setEditIdx(null)} title="Cancel" style={{ background: "none", border: "none", cursor: "pointer", color: muted, display: "flex", padding: 2 }}>
                    <X style={{ width: 14, height: 14 }} />
                  </button>
                </span>
              ) : (
                <>
                  <span style={{ display: "flex", alignItems: "center", gap: 4, flex: 1, minWidth: 0, overflow: "hidden" }}>
                    <span style={{ fontSize: 13.5, fontWeight: 500, color: "hsl(var(--foreground))", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{p}</span>
                    <button type="button" className="ple-ib"
                      title={`Rename this ${itemNoun}`}
                      onClick={() => { setEditIdx(i); setEditText(p); }}
                      style={{ flexShrink: 0 }}>
                      <Pencil style={{ width: 13, height: 13 }} />
                    </button>
                  </span>
                  {extraOf?.(p) && (
                    <span title="Not in the default list" style={{
                      fontSize: 10.5, fontWeight: 600, padding: "2px 7px", borderRadius: 5, flexShrink: 0,
                      background: "rgba(34,197,94,0.12)", color: "#15803d",
                    }}>extra</span>
                  )}
                </>
              )}
              {!editing && (
                <span style={{ display: "flex", alignItems: "center", gap: 4, flexShrink: 0 }}>
                  {onColorChange && (
                    <ColorSwatchPicker
                      current={colors?.[p] ?? null}
                      onChange={(hex) => onColorChange(p, hex)}
                    />
                  )}
                  {onSetRules && (() => {
                    const n = ruleCountOf?.(p) ?? 0;
                    return (
                      <button type="button" className="ple-ib ple-ib-rules"
                        title={`Rules for the "${p}" ${itemNoun} — lock fields, require fields, skip it for some records, or control who can act`}
                        onClick={() => onSetRules(p)}>
                        Set rules{n > 0 && <span className="ple-rules-badge ple-rules-badge-on">{n}</span>}
                      </button>
                    );
                  })()}
                  <button type="button" className="ple-ib ple-ib-del"
                    title={items.length <= 1 ? `At least one ${itemNoun} must remain` : `Remove this ${itemNoun}`}
                    disabled={items.length <= 1}
                    onClick={() => remove(i)}>
                    <Trash2 style={{ width: 13, height: 13 }} />
                  </button>
                </span>
              )}
            </div>
          );
        })}
        {items.length === 0 && (
          <div style={{ padding: "10px 12px", fontSize: 12.5, color: muted }}>
            No {itemNoun}s yet — add one below.
          </div>
        )}
        </div>{/* end scroll wrapper */}
        {/* ── Add footer + one-click suggestions (mockup .padd / .sugg) ── */}
        <div style={{ borderTop: border, background: "hsl(var(--muted) / 0.25)", padding: "9px 12px", display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
          <Input
            value={custom}
            onChange={(e) => setCustom(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); add(custom); setCustom(""); } }}
            placeholder={`New ${itemNoun} name…`}
            style={{ height: 32, fontSize: 12.5, maxWidth: 230, background: "hsl(var(--background))" }}
          />
          <Button type="button" variant="outline" size="sm" onClick={() => { add(custom); setCustom(""); }} disabled={!custom.trim()}>
            <Plus className="w-3.5 h-3.5 mr-1" /> Add {itemNoun}
          </Button>
          {footerEnd && <div style={{ marginLeft: "auto" }}>{footerEnd}</div>}
        </div>
        {remainingSuggestions.length > 0 && (
          <div style={{ display: "flex", flexWrap: "wrap", gap: 6, alignItems: "center", padding: "8px 12px", borderTop: "1px solid hsl(var(--muted) / 0.5)" }}>
            <span style={{ fontSize: 11.5, color: muted }}>Common ones:</span>
            {remainingSuggestions.map((s) => (
              <button key={s} type="button" className="ple-sg" onClick={() => add(s)}>
                <Plus style={{ width: 11, height: 11 }} /> {s}
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

/* ── Named phase sets: Save / Save As… / Manage (MS-Word-style) ─────────── */

/** Web mirror of the server's ProjectPhaseSet (onboarding-defaults.ts). */
export interface ProjectPhaseSet {
  id: string;
  name: string;
  phases: string[];
  groupIds: string[];
  /** "groups" (creator in a listed group — default), "except" (creator NOT in
   *  any listed group), "everyone". Server collapses incoherent combos. */
  applyMode?: "everyone" | "except" | "groups";
  /** Per-phase color overrides — phase name → hex string. When set, takes
   *  precedence over the auto-resolved lib/phaseColors color for that name.
   *  Stored in the set JSON and threaded through to all color resolution sites. */
  phaseColors?: Record<string, string>;
}

export type PhaseScopeMode = "everyone" | "except" | "groups";

export function parsePhaseSets(raw: string): ProjectPhaseSet[] {
  if (!raw) return [];
  try {
    const p = JSON.parse(raw);
    if (!Array.isArray(p)) return [];
    return p.filter((s): s is ProjectPhaseSet =>
      !!s && typeof s === "object" && typeof s.id === "string" && typeof s.name === "string",
    ).map((s) => ({
      id: s.id, name: s.name,
      phases: Array.isArray(s.phases) ? s.phases.filter((x: unknown): x is string => typeof x === "string") : [],
      groupIds: Array.isArray(s.groupIds) ? s.groupIds.filter((x: unknown): x is string => typeof x === "string") : [],
      ...(s.applyMode === "everyone" || s.applyMode === "except" || s.applyMode === "groups" ? { applyMode: s.applyMode } : {}),
      // Round-trip phaseColors: keep only string→string entries.
      ...(s.phaseColors && typeof s.phaseColors === "object" && !Array.isArray(s.phaseColors)
        ? { phaseColors: Object.fromEntries(
            Object.entries(s.phaseColors as Record<string, unknown>)
              .filter(([k, v]) => typeof k === "string" && typeof v === "string"),
          ) as Record<string, string> }
        : {}),
    }));
  } catch { return []; }
}

/** "Who is this for?" — scope select + audience picker, shared by the
 *  phase-set and workflow-stage "Save As" dialogs. Offers Everyone / only
 *  specific groups / only specific PEOPLE. People are stored as "user:<id>"
 *  sentinels inside the SAME groupIds list with applyMode "groups" (the
 *  server adds each viewer's own sentinel to its membership sets), so the
 *  stored shape and every matcher stay unchanged. The legacy "everyone
 *  except" choice still renders for values saved with it — the select must
 *  never lie about the current value — but new scoping hides it. */
export function ScopePicker({ mode, groupIds, onChange, groups, groupsReady, groupColors, people, everyoneLocked }: {
  mode: PhaseScopeMode;
  groupIds: string[];
  onChange: (mode: PhaseScopeMode, groupIds: string[]) => void;
  groups: UserGroup[];
  groupsReady: boolean;
  groupColors: Map<string, string>;
  /** Tenant roster for "Only specific people". null/undefined = people can't
   *  be picked here (cross-tenant superadmin edits scope by group only) —
   *  the option then only renders for values already scoped to people. */
  people?: PersonOption[] | null;
  /** Single-Everyone rule: when set, the "Everyone" choice is unavailable —
   *  the option is disabled, picks of it are refused, and this note renders
   *  under the picker saying which list already holds Everyone. Callers pass
   *  undefined when Everyone is allowed (or is already the current value). */
  everyoneLocked?: ReactNode;
}) {
  // The UI distinguishes "people" from "groups", but STORAGE does not — a
  // people scope is applyMode "groups" whose ids are all user sentinels.
  type PickMode = PhaseScopeMode | "people";
  const derive = (m: PhaseScopeMode, ids: string[]): PickMode =>
    m === "groups" && ids.length > 0 && ids.every(isUserAudienceId) ? "people" : m;
  // LOCAL mode state — the server drops applyMode whenever groupIds is empty,
  // so a fully-controlled dropdown snaps back to "Everyone" the moment the
  // admin picks "except"/"groups" (before they've had a chance to pick any
  // group). Local mode keeps the scoped choice + group picker open mid-edit;
  // external scoped changes still sync in. (Same pattern as AppliesToPick.)
  const [localMode, setLocalMode] = useState<PickMode>(derive(mode, groupIds));
  useEffect(() => {
    // Only sync in real scoped values from outside — never auto-downgrade to
    // "everyone" while the admin is still choosing groups. An EMPTY "groups"
    // value is ambiguous (people scopes store as "groups" too), so keep
    // whatever scoped kind the admin is mid-picking instead of flipping.
    if (mode === "everyone") return;
    setLocalMode((prev) =>
      mode === "groups" && groupIds.length === 0
        ? (prev === "people" ? "people" : "groups")
        : derive(mode, groupIds));
  }, [mode, groupIds.join("|")]); // eslint-disable-line react-hooks/exhaustive-deps
  // Resolve member names for hover cards (own-tenant only — superadmin's
  // tenantId=null flows bypass ScopePicker so `enabled=true` is always right here).
  const memberNamesOf = useGroupMemberNames(true);
  const hoverWrap = (value: string, node: ReactNode): ReactNode => {
    const g = groups.find(x => x.id === value);
    if (!g) return node;
    return (
      <GroupMembersHover groupName={g.name} memberIds={g.memberIds} names={memberNamesOf(g.memberIds)}>
        {node}
      </GroupMembersHover>
    );
  };
  const personOpts = personAudienceOptions(people);

  return (
    <div style={{ display: "flex", flexDirection: "row", gap: 8, alignItems: "flex-start", flexWrap: "wrap" }}>
      <select
        value={localMode}
        onChange={(e) => {
          const m = e.target.value as PickMode;
          // Single-Everyone rule: another list already holds Everyone — the
          // option is disabled AND refused here (belt), BEFORE setLocalMode
          // so the select can never display a choice that wasn't accepted.
          if (m === "everyone" && everyoneLocked) return;
          setLocalMode(m);
          // Carry picks across switches — but only ids of the right KIND
          // (group ids never survive into people mode and vice versa).
          if (m === "everyone") onChange("everyone", []);
          else if (m === "people") onChange("groups", groupIds.filter(isUserAudienceId));
          else onChange(m, groupIds.filter((id) => !isUserAudienceId(id)));
        }}
        style={{ height: 32, fontSize: 12.5, border, borderRadius: 6, background: "hsl(var(--background))", padding: "0 8px", flex: "0 0 190px" }}
      >
        <option value="everyone" disabled={!!everyoneLocked && localMode !== "everyone"}>Everyone</option>
        {localMode === "except" && <option value="except">Everyone except selected groups</option>}
        <option value="groups">Only specific groups</option>
        {(people != null || localMode === "people") && <option value="people">Only specific people</option>}
      </select>
      {localMode !== "everyone" && (
        <div style={{ flex: "1 1 180px", minWidth: 160 }}>
          <MultiPick
            options={localMode === "people"
              ? personOpts
              // Selected person entries ride along in group modes so a mixed
              // (hand-edited) list still shows names instead of raw sentinels.
              : [...groups.map((g) => ({ value: g.id, label: g.name, color: groupColors.get(g.id) })), ...personOpts.filter((o) => groupIds.includes(o.value))]}
            selected={groupIds}
            onChange={(ids: string[]) => onChange(localMode === "people" ? "groups" : localMode, ids)}
            placeholder={localMode === "people"
              ? (personOpts.length ? "Pick the people this applies to…" : people == null ? "People can't be picked from this screen" : "Loading people…")
              : groups.length
                ? (localMode === "except" ? "Pick the groups to leave out…" : "Pick the groups this applies to…")
                : groupsReady ? "No user groups yet — create one in Staff & Resources → User Groups" : "Loading groups…"}
            hoverWrap={hoverWrap}
          />
        </div>
      )}
      {everyoneLocked && (
        <div style={{ flexBasis: "100%", fontSize: 11.5, color: "#b45309", lineHeight: 1.5, display: "flex", gap: 5, alignItems: "flex-start" }}>
          <span aria-hidden="true">⚠</span>
          <span>{everyoneLocked}</span>
        </div>
      )}
    </div>
  );
}

/** DefaultScopeGuardDialog (#user) — shown when an admin points THE default
 *  (everyone) list at specific people or groups. Nine times out of ten they
 *  mean "give these people their own version", not "take the default away
 *  from the whole company" — so the primary action creates a NEW set (an
 *  exact copy, scoped to the picks) and leaves the default untouched, with a
 *  small "Limit the default anyway" escape for the rare deliberate case.
 *  Shared by the Workflow-stages card and the schedule phase-set cards.
 *  Renders above the audience popover (z 10000) and Radix dialogs. */
export function DefaultScopeGuardDialog({ noun, defaultName, pickedLabel, nameValue, onNameChange, nameError, onCreate, onLimit, onCancel }: {
  noun: string;                    // "stage set" | "schedule"
  defaultName: string;             // the default list's display name
  pickedLabel: string;             // who was picked — scopeLabel() output
  nameValue: string;
  onNameChange: (v: string) => void;
  nameError?: string | null;
  onCreate: () => void;
  onLimit: () => void;
  onCancel: () => void;
}) {
  const canCreate = !!nameValue.trim() && !nameError;
  // A REAL Radix dialog, not a hand-rolled body portal: the Manage-stage-sets
  // dialog underneath is MODAL, so custom body-portalled divs above it are
  // pointer-events dead. Nested Radix dialogs handle that correctly — same
  // pattern as AudienceClashDialog stacking above the Save As… dialog.
  return (
    <Dialog open onOpenChange={(o) => { if (!o) onCancel(); }}>
      {/* z-[11000]: opened from custom fixed surfaces (Saved Schedules modal
          z-9000, audience popovers z-10000). Default Radix z-50 would render
          it INVISIBLE behind them while locking body pointer-events — the
          whole app looks frozen. 11000 beats every custom opener (max 10500). */}
      <DialogContent className="z-[11000]" style={{ maxWidth: 500 }}>
        <DialogHeader>
          <DialogTitle style={{ fontSize: 14.5 }}>This is the default — it applies to everyone</DialogTitle>
        </DialogHeader>
        <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
        <div style={{ fontSize: 12.5, color: muted, lineHeight: 1.55 }}>
          <b style={{ color: "hsl(var(--foreground))" }}>{defaultName}</b> is the default {noun} for the whole
          company. If you limit it to <b style={{ color: "hsl(var(--foreground))" }}>{pickedLabel}</b>, everyone
          else goes back to the plain standard {noun === "schedule" ? "schedule" : "workflow"}.
        </div>
        <div style={{ padding: "9px 12px", borderRadius: 8, background: "rgba(16,185,129,0.08)", border: "1px solid rgba(16,185,129,0.35)", fontSize: 12.5, color: "hsl(var(--foreground))", lineHeight: 1.55 }}>
          <b>Recommended:</b> keep the default as it is, and create a new {noun} for those people — it starts as
          an exact copy you can then adjust.
        </div>
        <div>
          <div style={{ fontSize: 11.5, fontWeight: 600, marginBottom: 4, color: "hsl(var(--foreground))" }}>Name for the new {noun}</div>
          <Input autoFocus value={nameValue} onChange={(e) => onNameChange(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter" && canCreate) onCreate(); }}
            placeholder={`e.g. Sales team ${noun}`} style={{ height: 32, fontSize: 13 }} />
          {nameError && <div style={{ fontSize: 11.5, color: "#b91c1c", marginTop: 4 }}>{nameError}</div>}
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 2, flexWrap: "wrap" }}>
          <Button size="sm" disabled={!canCreate} onClick={onCreate} style={{ height: 30, fontSize: 12.5 }}>
            Create a new {noun} for these people
          </Button>
          <Button size="sm" variant="ghost" onClick={onCancel} style={{ height: 30, fontSize: 12.5 }}>Cancel</Button>
          <button type="button" onClick={onLimit}
            style={{ marginLeft: "auto", background: "none", border: "none", cursor: "pointer", fontSize: 11.5, color: muted, textDecoration: "underline", padding: 4 }}>
            Limit the default anyway
          </button>
        </div>
        <div style={{ fontSize: 11, color: muted, marginTop: 2 }}>
          Press Save at the top when you're done.
        </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

export function scopeLabel(set: { applyMode?: PhaseScopeMode; groupIds: string[] }, groups: UserGroup[], people?: PersonOption[] | null): string {
  const names = set.groupIds.map((id) => audienceIdName(id, groups, people)).join(", ");
  if (set.applyMode === "everyone") return "Everyone";
  if (set.applyMode === "except") return `Everyone except: ${names || "—"}`;
  if (set.groupIds.length && set.groupIds.every(isUserAudienceId)) return `Only these people: ${names}`;
  return set.groupIds.length ? `Only: ${names}` : "Nobody yet — no groups or people picked";
}
/** Colored numbered chips row — how a saved set previews in the sidebar. */
function PhaseChips({ phases, colors }: { phases: string[]; colors?: Record<string, string> }) {
  return (
    <div style={{ display: "flex", flexWrap: "wrap", gap: 4, alignItems: "center" }}>
      {phases.map((p, i) => {
        const override = colors?.[p];
        const c = override
          ? { bg: override, text: phaseColorIsDark(override) ? "#fff" : "#222" }
          : resolvePhaseColor(p, i, phases.length);
        return (
          <span key={`${p}-${i}`} style={{
            display: "inline-flex", alignItems: "center", gap: 5, padding: "2px 8px 2px 3px",
            border, borderRadius: 999, background: "hsl(var(--background))", fontSize: 11.5, fontWeight: 600,
          }}>
            <Bubble n={i + 1} bg={c.bg} text={c.text} />
            {p}
          </span>
        );
      })}
      {phases.length === 0 && <span style={{ fontSize: 11.5, color: muted }}>No phases yet</span>}
    </div>
  );
}


/**
 * PhaseSetsSaveBar — stacked accordion cards (client's mockup):
 *   • one card for the default list — opens to its audience + phase editor
 *   • one collapsible card per named exception (name → audience → phases →
 *     compared-with-default note → remove), reordered by drag or ↑↓
 *   • a dashed "+ Add an exception for a team" row below the cards
 *
 * Same data model as before (projectPhaseSets JSON string). All edits flow
 * into form state and are persisted by the section's Save button.
 */
export function PhaseSetsSaveBar({
  phasesValue, onPhasesChange, phaseSetsValue, onPhaseSetsChange,
  onSaveSection, onSaveSetsOnly, saving,
  tenantId, suggestions, setNoun = "phase set",
  colored = true, itemNoun = "phase",
  phasesFieldKey, setsFieldKey,
  importedScope,
  onAddExceptionReady,
  onSetRules,
  ruleCountOf,
  lifecycleTemplates,
  onDeleteTemplate,
  onColorChangeReady,
  onSavedSchedulesPopupReady,
  onMakeDefaultReady,
}: {
  phasesValue: string;
  onPhasesChange: (v: string) => void;
  phaseSetsValue: string;
  onPhaseSetsChange: (v: string) => void;
  /** Persist the section — kept for call-site compatibility. */
  onSaveSection: (overrides?: Record<string, string>) => void;
  /** Kept for call-site compatibility (unused). */
  onSaveSetsOnly?: (overrides: Record<string, string>) => void;
  saving: boolean;
  tenantId?: string | null;
  suggestions: string[];
  setNoun?: string;
  colored?: boolean;
  itemNoun?: string;
  /** Settings field key for the default phases list (e.g. "defaultOpportunityStages").
   *  When provided alongside onSaveSetsOnly, makeSetDefault fires an immediate
   *  save (bypassing the debounce) instead of waiting for the auto-save timer. */
  phasesFieldKey?: string;
  /** Kept for call-site compatibility. */
  setsFieldKey?: string;
  /** Kept for call-site compatibility. */
  importedScope?: "project" | "opp";
  /** Called with the addException fn when ready (or null on unmount), so
   *  the parent can render the button wherever it likes. */
  onAddExceptionReady?: (fn: (() => void) | null) => void;
  /** When provided, every phase/stage row shows a "Set rules" button. Called
   *  with the clicked name plus the FULL list it belongs to (default list or
   *  the selected saved set) so the rules drawer can navigate prev/next, plus
   *  the active set's current phaseColors so the rules drawer can display and
   *  modify the phase's color. */
  onSetRules?: (name: string, list: string[], colors: Record<string, string>) => void;
  /** Live per-stage rule count for the "Set rules (N)" badges. */
  ruleCountOf?: (name: string) => number;
  /** Lifecycle templates fetched from the DB (e.g. created by imports).
   *  Shown as a read-only section below saved schedules so admins can
   *  add any of them as a saved schedule or make one the default. */
  lifecycleTemplates?: Array<{ id: number; name: string; phases: string[] }>;
  /** Called when the admin wants to permanently delete a lifecycle template.
   *  Two-step client-side confirmation is shown before this is invoked. */
  onDeleteTemplate?: (id: number, name: string) => Promise<void>;
  /** Registers a stable function the parent can call to change the color of
   *  a phase in the currently-selected set (used by the "Set rules" drawer's
   *  inline color picker to write back without knowing which set is active). */
  onColorChangeReady?: (fn: ((phase: string, color: string | null) => void) | null) => void;
  /** Called with a fn that opens the Saved Schedules popup, or null on unmount.
   *  Parent renders the trigger button wherever it likes (e.g. next to "+ Add schedule"). */
  onSavedSchedulesPopupReady?: (fn: (() => void) | null) => void;
  /** Called with a fn that promotes the currently-selected saved schedule to
   *  the default (or null when the Default card is selected / on unmount).
   *  Parent renders the "Make default" button in its header row. */
  onMakeDefaultReady?: (fn: (() => void) | null) => void;
}) {
  const EVERYONE = "__everyone__";
  /** Special entry that stores the Everyone card's scope; hidden from the
   *  exception list so it never shows up as an audience-targeted set. */
  const DEFAULT_SCOPE_ID = "__default_scope__";

  const allParsed = useMemo(() => parsePhaseSets(phaseSetsValue), [phaseSetsValue]);
  // Saved schedules — strip the hidden scope entry before rendering. (The
  // entry survives on legacy data purely to keep the default's custom name;
  // audience scoping on schedules was retired Aug 2026 and is ignored.)
  const sets = useMemo(() => allParsed.filter(s => s.id !== DEFAULT_SCOPE_ID), [allParsed]);
  const defaultScopeEntry = useMemo(() => allParsed.find(s => s.id === DEFAULT_SCOPE_ID), [allParsed]);
  const [selectedId, setSelectedId] = useState<string>(EVERYONE);
  // Custom name for the default list — stored in the hidden __default_scope__
  // entry's `name` field (sentinel "__default__" = not yet renamed).
  const defaultCustomName = (defaultScopeEntry?.name && defaultScopeEntry.name !== "__default__")
    ? defaultScopeEntry.name : "";
  const defaultCardTitle = defaultCustomName || "Default";

  // ── Sidebar search — always owned internally. ───────────────────────────
  const [audQuery, setAudQuery] = useState("");
  const audQ = audQuery.trim().toLowerCase();
  const nameMatches = (name: string): boolean => !audQ || name.toLowerCase().includes(audQ);
  // Saved schedules are named containers for phase/stage subsections. Search
  // must be useful when the schedule name is unknown. Project contract statuses
  // such as Pipeline/Active are intentionally NOT schedule phases, however:
  // the popup renders a clear source card for those terms below rather than
  // falsely implying a saved schedule is missing.
  const scheduleMatches = (name: string, phases: string[]): boolean =>
    !audQ || [name, ...phases].some(value => value.toLowerCase().includes(audQ));
  const projectStatusMatches = importedScope === "project" && !!audQ
    && ["project statuses", "project status", "pipeline", "active"]
      .some(value => value.includes(audQ));

  // ── Saved-schedules popup. ──────────────────────────────────────────────
  const [savedSchedulesOpen, setSavedSchedulesOpen] = useState(false);

  // Keep selectedId in sync: if the currently selected exception was removed,
  // fall back to Everyone.
  useEffect(() => {
    if (selectedId !== EVERYONE && !sets.some((s) => s.id === selectedId)) {
      setSelectedId(EVERYONE);
    }
  }, [sets, selectedId]);

  // Debounce timer for the sets-only server persist — prevents a toast popup
  // on every keystroke when the user is typing a schedule name.
  const saveSetsTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Commit always preserves the hidden __default_scope__ entry if present.
  // The server persist is debounced (1 200 ms) so rapid edits (e.g. typing a
  // schedule name) coalesce into a single save + a single "Saved" toast.
  // Explicit actions (makeSetDefault, addException, delete) flush the timer
  // and call onSaveSetsOnly directly for an immediate persist.
  const commitSets = (nextVisible: ProjectPhaseSet[]) => {
    const scopeEntry = allParsed.find(s => s.id === DEFAULT_SCOPE_ID);
    const all = scopeEntry ? [scopeEntry, ...nextVisible] : nextVisible;
    const newSetsStr = all.length ? JSON.stringify(all) : "";
    onPhaseSetsChange(newSetsStr);
    if (onSaveSetsOnly && setsFieldKey) {
      if (saveSetsTimerRef.current) clearTimeout(saveSetsTimerRef.current);
      saveSetsTimerRef.current = setTimeout(() => {
        saveSetsTimerRef.current = null;
        onSaveSetsOnly!({ [setsFieldKey!]: newSetsStr });
      }, 1200);
    }
  };

  // Flush any pending debounced save immediately — called before explicit
  // actions that do their own direct onSaveSetsOnly (makeSetDefault, delete).
  const flushSetsTimer = () => {
    if (saveSetsTimerRef.current) {
      clearTimeout(saveSetsTimerRef.current);
      saveSetsTimerRef.current = null;
    }
  };

  // Cancel timer on unmount so it never fires into an unmounted component.
  useEffect(() => () => { flushSetsTimer(); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  /** Promote a saved schedule so it BECOMES the default list.
   *
   *  Copies the schedule's phases into the Default card's list (so records are
   *  built from them). The schedule itself stays in the sidebar — it does NOT
   *  disappear. Legacy audience fields are cleared in the same write (saved
   *  schedules are plain templates now). */
  const makeSetDefault = (id: string, opts?: { skipConfirm?: boolean }) => {
    const s = sets.find((x) => x.id === id);
    if (!s) return;
    const oldCount = parseList(phasesValue).length;
    const label = s.name.trim() || "this schedule";
    if (!opts?.skipConfirm && !window.confirm(
      `Make "${label}" the new default?\n\n`
      + `New records will be built from it. It replaces the current default list (${oldCount} ${itemNoun}${oldCount === 1 ? "" : "s"}).\n\n`
      + `"${label}" stays in the sidebar as a saved schedule. This saves automatically.`,
    )) return;
    // Compute new values first so we can use them in both the local state
    // update AND the immediate save call.
    const newPhases = s.phases.join(", ");
    const rest = allParsed
      .filter((x) => x.id !== DEFAULT_SCOPE_ID)
      .map((x) => {
        if (x.id === id) return { ...x, applyMode: "groups" as PhaseScopeMode, groupIds: [] };
        // Demote any other legacy everyone-scoped schedule.
        if (modeOf(x) === "everyone") return { ...x, applyMode: "groups" as PhaseScopeMode, groupIds: [] };
        return x;
      });
    const scopeEntry: ProjectPhaseSet = {
      id: DEFAULT_SCOPE_ID, name: defaultCustomName || "__default__", phases: [], groupIds: [], applyMode: "everyone",
    };
    const newSets = JSON.stringify([scopeEntry, ...rest]);

    // Update local state (drives the UI immediately).
    onPhasesChange(newPhases);
    onPhaseSetsChange(newSets);
    setSelectedId(EVERYONE);

    // Fire an immediate save bypassing the debounce so the server reconciles
    // and adopts right away — the opportunity page sees the new stages without
    // waiting 1.5 s for the auto-save timer.
    if (onSaveSetsOnly && phasesFieldKey && setsFieldKey) {
      onSaveSetsOnly({ [phasesFieldKey]: newPhases, [setsFieldKey]: newSets });
    }
  };
  // Rename the default list — creates the hidden scope entry if needed.
  const setDefaultName = (name: string) => {
    const visibleSets = allParsed.filter(s => s.id !== DEFAULT_SCOPE_ID);
    const existing = allParsed.find(s => s.id === DEFAULT_SCOPE_ID);
    if (!name.trim() && !existing) return; // nothing to store
    const entry: ProjectPhaseSet = {
      id: DEFAULT_SCOPE_ID,
      name: name || "__default__",
      phases: [],
      groupIds: existing?.groupIds ?? [],
      applyMode: existing?.applyMode ?? "everyone",
    };
    if (!name.trim() && entry.applyMode === "everyone" && entry.groupIds.length === 0) {
      // Name cleared + no scope → drop the entry entirely
      onPhaseSetsChange(visibleSets.length ? JSON.stringify(visibleSets) : "");
    } else {
      onPhaseSetsChange(JSON.stringify([entry, ...visibleSets]));
    }
  };
  const patchSet = (id: string, p: Partial<ProjectPhaseSet>) =>
    commitSets(sets.map((s) => (s.id === id ? { ...s, ...p } : s)));
  const moveSet = (from: number, to: number) => {
    if (to < 0 || to >= sets.length || from === to) return;
    const next = [...sets];
    const [m] = next.splice(from, 1);
    next.splice(to, 0, m);
    commitSets(next);
  };

  const globalScope = tenantId === null;

  // Set when the user opted in ("Make this new schedule the default?") while
  // creating a schedule that has no phases yet: once the schedule gains its
  // first phases, promote it automatically without a second confirm.
  const [askMakeDefaultForId, setAskMakeDefaultForId] = useState<string | null>(null);

  const addException = () => {
    if (globalScope) return;
    // New schedules start blank so the user fills in their own phases.
    // (Previously copied the default list — led to "nothing happened" UX
    // because the pre-filled copy looked identical to the existing schedule.)
    const newSet: ProjectPhaseSet = {
      id: `ps-${Date.now().toString(36)}-${Math.floor(Math.random() * 1e4).toString(36)}`,
      name: "",
      phases: [],
      groupIds: [], applyMode: "groups",
    };
    commitSets([...sets, newSet]);
    setSelectedId(newSet.id);
    // Ask immediately whether this new schedule should become the default.
    // If yes, the auto-promote effect watches for the first phases and then
    // fires makeSetDefault — no second confirm needed from the user.
    const noun = itemNoun === "schedule" ? "opportunities" : "projects";
    if (window.confirm(
      `Make this new schedule the default for all new ${noun}?\n\n`
      + `Add your phases first — it will be promoted automatically once you do.\n`
      + `(You can also promote it later with the Make default button.)`
    )) {
      setAskMakeDefaultForId(newSet.id);
    }
  };

  // Auto-promote: the user opted in at creation time, so promote the schedule
  // as soon as it has phases — without a second confirm. If the schedule was
  // deleted in the meantime, just drop the marker.
  useEffect(() => {
    if (!askMakeDefaultForId) return;
    const s = sets.find((x) => x.id === askMakeDefaultForId);
    if (!s) { setAskMakeDefaultForId(null); return; }
    if (s.phases.length === 0) return;
    setAskMakeDefaultForId(null);
    makeSetDefault(askMakeDefaultForId, { skipConfirm: true });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [askMakeDefaultForId, sets]);

  // Keep a ref that always points to the current addException so the
  // registered callback is never stale (the effect fires only when globalScope
  // changes, but addException closes over sets/commitSets which change each
  // render).
  const addExceptionLatest = useRef(addException);
  useEffect(() => { addExceptionLatest.current = addException; });
  // Stable wrapper — registered once, always delegates to the fresh version.
  const stableAddException = useCallback(() => addExceptionLatest.current(), []);

  // Expose addException to parent via callback (for rendering the button in a
  // header row rather than inside the sidebar).
  const onAddExceptionReadyRef = useRef(onAddExceptionReady);
  useEffect(() => { onAddExceptionReadyRef.current = onAddExceptionReady; });
  useEffect(() => {
    if (globalScope) return;
    onAddExceptionReadyRef.current?.(stableAddException);
    return () => onAddExceptionReadyRef.current?.(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [globalScope]);

  // Expose openSavedSchedules to parent via callback.
  const onSavedSchedulesPopupReadyRef = useRef(onSavedSchedulesPopupReady);
  useEffect(() => { onSavedSchedulesPopupReadyRef.current = onSavedSchedulesPopupReady; });
  const stableOpenSavedSchedules = useCallback(() => setSavedSchedulesOpen(true), []);
  useEffect(() => {
    if (globalScope) return;
    onSavedSchedulesPopupReadyRef.current?.(stableOpenSavedSchedules);
    return () => onSavedSchedulesPopupReadyRef.current?.(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [globalScope]);

  // Expose makeDefault fn to parent — non-null only when a saved set is
  // selected (i.e. not the Default card). Drives the header button.
  const onMakeDefaultReadyRef = useRef(onMakeDefaultReady);
  useEffect(() => { onMakeDefaultReadyRef.current = onMakeDefaultReady; });
  const makeDefaultLatest = useRef<() => void>(() => {});
  useEffect(() => {
    makeDefaultLatest.current = () => { if (selectedId !== EVERYONE) makeSetDefault(selectedId); };
  });
  const stableMakeDefault = useCallback(() => makeDefaultLatest.current(), []);
  useEffect(() => {
    if (globalScope) { onMakeDefaultReadyRef.current?.(null); return; }
    onMakeDefaultReadyRef.current?.(selectedId === EVERYONE ? null : stableMakeDefault);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedId, globalScope, stableMakeDefault]);
  // Clear on unmount so the parent hides the button.
  useEffect(() => () => { onMakeDefaultReadyRef.current?.(null); }, []);

  // ── Per-phase color overrides ────────────────────────────────────────────
  // Default list colors live in __default_scope__.phaseColors.
  // Named set colors live in the set's own phaseColors.

  /** Colors currently active (for the selected set or the default list). */
  const activeColors: Record<string, string> =
    selectedId === EVERYONE
      ? (defaultScopeEntry?.phaseColors ?? {})
      : (sets.find(s => s.id === selectedId)?.phaseColors ?? {});

  /** Change a phase color in the default list (writes __default_scope__.phaseColors). */
  const changeDefaultColor = useCallback((phase: string, color: string | null) => {
    const existing = allParsed.find(s => s.id === DEFAULT_SCOPE_ID);
    const prev = existing?.phaseColors ?? {};
    const next: Record<string, string> = color
      ? { ...prev, [phase]: color }
      : Object.fromEntries(Object.entries(prev).filter(([k]) => k !== phase));
    const entry: ProjectPhaseSet = {
      id: DEFAULT_SCOPE_ID,
      name: existing?.name ?? "__default__",
      phases: existing?.phases ?? [],
      groupIds: existing?.groupIds ?? [],
      applyMode: existing?.applyMode ?? "everyone",
      ...(Object.keys(next).length ? { phaseColors: next } : {}),
    };
    const visibleSets = allParsed.filter(s => s.id !== DEFAULT_SCOPE_ID);
    const newSetsStr = JSON.stringify([entry, ...visibleSets]);
    onPhaseSetsChange(newSetsStr);
    if (onSaveSetsOnly && setsFieldKey) onSaveSetsOnly({ [setsFieldKey]: newSetsStr });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [allParsed, onPhaseSetsChange, onSaveSetsOnly, setsFieldKey]);

  /** Change a phase color in a named set. */
  const changeSetColor = useCallback((id: string, phase: string, color: string | null) => {
    const set = sets.find(s => s.id === id);
    if (!set) return;
    const prev = set.phaseColors ?? {};
    const next: Record<string, string> = color
      ? { ...prev, [phase]: color }
      : Object.fromEntries(Object.entries(prev).filter(([k]) => k !== phase));
    patchSet(id, { phaseColors: Object.keys(next).length ? next : undefined });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sets, patchSet]);

  // Stable color-change fn exposed to the parent (for the rules drawer).
  // Uses a ref internally so it always targets the currently-selected set
  // without the registration effect ever re-firing.
  const colorChangeFnImplRef = useRef<(phase: string, color: string | null) => void>(() => {});
  useEffect(() => {
    colorChangeFnImplRef.current = (phase: string, color: string | null) => {
      if (selectedId === EVERYONE) changeDefaultColor(phase, color);
      else changeSetColor(selectedId, phase, color);
    };
  });
  const stableColorChangeFn = useCallback((phase: string, color: string | null) => {
    colorChangeFnImplRef.current(phase, color);
  }, []);
  const onColorChangeReadyRef = useRef(onColorChangeReady);
  useEffect(() => { onColorChangeReadyRef.current = onColorChangeReady; });
  useEffect(() => {
    onColorChangeReadyRef.current?.(stableColorChangeFn);
    return () => onColorChangeReadyRef.current?.(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const removeSet = (id: string, name: string) => {
    const label = name.trim() || "Unnamed";
    if (!window.confirm(
      `Delete "${label}"?\n\n` +
      `⚠ Any projects or opportunities currently assigned to this schedule will lose their lifecycle reference. ` +
      `Existing phase data on those records is not erased, but this template will no longer be selectable.\n\n` +
      `This action is permanently logged — your account name and approximate IP address will be recorded.\n\n` +
      `Click OK to continue to the final confirmation.`
    )) return;
    if (!window.confirm(
      `Final confirmation — are you absolutely sure you want to permanently delete "${label}"?\n\nThis cannot be undone.`
    )) return;
    commitSets(sets.filter((x) => x.id !== id));
    setSelectedId(EVERYONE);
  };

  // ── validation helpers ──────────────────────────────────────────────────
  /** Effective legacy audience mode — only used to demote legacy
   *  everyone-scoped rows inside makeSetDefault. */
  const modeOf = (s: { applyMode?: PhaseScopeMode; groupIds: string[] }): PhaseScopeMode =>
    s.applyMode ?? (s.groupIds.length ? "groups" : "everyone");
  const setHasError = (s: ProjectPhaseSet) => {
    if (!s.name.trim()) return "missing-name";
    return null;
  };

  // Mockup-style field labels: sentence-case bold label + muted help line
  // (replaces the old all-caps micro labels — client asked for this design).
  const fieldLabel: React.CSSProperties = { fontSize: 13, fontWeight: 600, color: "hsl(var(--foreground))", marginBottom: 2 };
  const fieldHelp: React.CSSProperties = { fontSize: 11.5, color: muted, margin: "0 0 7px", lineHeight: 1.5 };
  const titleNoun = itemNoun.charAt(0).toUpperCase() + itemNoun.slice(1);
  const arrowBtn = (disabled: boolean): React.CSSProperties => ({
    width: 26, height: 26, borderRadius: 6, border,
    background: "hsl(var(--background))", color: "hsl(var(--foreground))",
    display: "flex", alignItems: "center", justifyContent: "center",
    cursor: disabled ? "not-allowed" : "pointer", opacity: disabled ? 0.35 : 1,
  });

  // ── currently-selected set ───────────────────────────────────────────────
  const selSet = selectedId === EVERYONE ? null : sets.find((s) => s.id === selectedId) ?? null;

  return (
    <div>

      {/* ── Saved Schedules popup — Lifecycle Library theme ──────────────── */}
      {savedSchedulesOpen && (() => {
        const defaultPhases = parseList(phasesValue);
        const allCounts = [...defaultPhases.length ? [defaultPhases.length] : [], ...sets.map(s => s.phases.length)];
        const phaseMin = allCounts.length ? Math.min(...allCounts) : 0;
        const phaseMax = allCounts.length ? Math.max(...allCounts) : 0;
        const totalRows = 1 + sets.length + (lifecycleTemplates?.length ?? 0);
        return (
          <div
            onClick={() => setSavedSchedulesOpen(false)}
            style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.55)", backdropFilter: "blur(2px)", zIndex: Z.DRAWER, display: "flex", alignItems: "center", justifyContent: "center", padding: 16 }}
          >
            <div
              onClick={e => e.stopPropagation()}
              style={{ background: "#fff", borderRadius: 12, boxShadow: "0 40px 80px -20px rgba(11,20,28,.55), 0 0 0 1px rgba(11,20,28,.18)", width: "100%", maxWidth: 680, maxHeight: "min(820px,92vh)", display: "flex", flexDirection: "column", overflow: "hidden" }}
            >
              {/* Navy header */}
              <header style={{ background: LL_NAVY, color: "#fff", flexShrink: 0, backgroundImage: "repeating-linear-gradient(0deg,rgba(255,255,255,.055) 0 27px,transparent 27px 28px),repeating-linear-gradient(90deg,rgba(255,255,255,.055) 0 27px,transparent 27px 28px)" }}>
                <div style={{ display: "flex", alignItems: "flex-start", gap: 18, padding: "18px 22px 0" }}>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <p style={{ fontFamily: "ui-monospace,SFMono-Regular,Menlo,monospace", fontSize: 10, letterSpacing: "0.18em", textTransform: "uppercase", color: LL_LIME, margin: "0 0 5px" }}>
                      {itemNoun === "schedule" ? "Schedule library" : "Phase library"}
                    </p>
                    <h2 style={{ fontWeight: 700, fontSize: 22, letterSpacing: "-0.01em", margin: 0, lineHeight: 1.15, color: "#fff" }}>Saved Schedules</h2>
                    <p style={{ margin: "5px 0 0", fontSize: 13, color: "#B8C6CE", lineHeight: 1.4 }}>
                      Click a row to select it, then edit it in the panel below.
                    </p>
                  </div>
                  <button type="button" aria-label="Close" onClick={() => setSavedSchedulesOpen(false)}
                    style={{ flexShrink: 0, width: 32, height: 32, borderRadius: 7, background: "rgba(255,255,255,.08)", border: "1px solid rgba(255,255,255,.16)", color: "#fff", cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center" }}>
                    <X style={{ width: 16, height: 16 }} />
                  </button>
                </div>
                {/* Stats bar */}
                <dl style={{ display: "grid", gridTemplateColumns: "repeat(3,1fr)", margin: "14px 0 0", borderTop: "1px solid rgba(255,255,255,.16)" }}>
                  {([
                    ["Schedules", String(totalRows)],
                    ["Phase range", phaseMin === phaseMax ? String(phaseMin || "—") : `${phaseMin} – ${phaseMax}`],
                    ["Applies to", itemNoun === "schedule" ? "Opportunities" : "Projects"],
                  ] as [string, string][]).map(([label, val], ci) => (
                    <div key={label} style={{ padding: "8px 22px 9px", borderRight: ci < 2 ? "1px solid rgba(255,255,255,.16)" : "none" }}>
                      <dt style={{ fontFamily: "ui-monospace,SFMono-Regular,Menlo,monospace", fontSize: 9, letterSpacing: "0.15em", textTransform: "uppercase", color: "#8FA3AE", margin: 0 }}>{label}</dt>
                      <dd style={{ margin: "2px 0 0", fontWeight: 700, fontSize: 14, color: "#fff" }}>{val}</dd>
                    </div>
                  ))}
                </dl>
              </header>

              {/* Search */}
              {!globalScope && (
                <div style={{ padding: "14px 22px 11px", borderBottom: `1px solid ${LL_LINE}`, background: LL_PAPER, flexShrink: 0 }}>
                  <div style={{ position: "relative" }}>
                    <Search style={{ position: "absolute", left: 13, top: "50%", transform: "translateY(-50%)", width: 14, height: 14, color: LL_MUTE, pointerEvents: "none" }} />
                    <input value={audQuery} onChange={e => setAudQuery(e.target.value)}
                      placeholder={`Search ${itemNoun}s or phase names…`}
                      style={{ width: "100%", boxSizing: "border-box", padding: "10px 14px 10px 38px", fontSize: 13.5, color: LL_INK, background: "#fff", border: `1px solid ${LL_LINE}`, borderRadius: 8, outline: "none" }} />
                    {audQuery && (
                      <button type="button" onClick={() => setAudQuery("")}
                        style={{ position: "absolute", right: 10, top: "50%", transform: "translateY(-50%)", background: "none", border: "none", cursor: "pointer", color: LL_MUTE, display: "flex", padding: 2 }}>
                        <X style={{ width: 14, height: 14 }} />
                      </button>
                    )}
                  </div>
                </div>
              )}

              {/* Scrollable list */}
              <div style={{ overflowY: "auto", flex: 1, background: "#fff", padding: "4px 0" }}>
                {globalScope && (
                  <div style={{ padding: "32px 22px", textAlign: "center", color: LL_MUTE, fontSize: 13 }}>
                    Saved schedules are stored per company — pick a company above first.
                  </div>
                )}

                {/* Pipeline and Active are built-in PMM statuses, not template
                    phases. Returning this source card for an explicit search
                    prevents an empty search result from sending admins hunting
                    through schedule templates for a status lock. */}
                {!globalScope && projectStatusMatches && (
                  <section style={{ padding: "15px 22px", background: "#F4F8EF", borderBottom: `1px solid ${LL_LINE}`, borderLeft: `3px solid ${LL_GREEN}` }}>
                    <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
                      <span style={{ fontFamily: "ui-monospace,SFMono-Regular,Menlo,monospace", fontSize: 9.5, fontWeight: 800, letterSpacing: "0.12em", textTransform: "uppercase", color: "#2D6A12" }}>
                        Project statuses
                      </span>
                      <span style={{ padding: "2px 7px", borderRadius: 999, border: "1px solid rgba(107,165,57,0.42)", background: "#fff", color: "#2D6A12", fontSize: 10, fontWeight: 700 }}>
                        Not a saved schedule
                      </span>
                    </div>
                    <div style={{ display: "flex", gap: 6, marginTop: 9, flexWrap: "wrap" }}>
                      {["Pipeline", "Active"].map(status => (
                        <span key={status} style={{ padding: "3px 8px", borderRadius: 6, background: "rgba(107,165,57,0.13)", color: LL_NAVY, fontSize: 12, fontWeight: 700 }}>
                          {status}
                        </span>
                      ))}
                    </div>
                    <p style={{ margin: "9px 0 0", fontSize: 12.5, lineHeight: 1.45, color: LL_MUTE }}>
                      These are the built-in project status stages used when a project has no lifecycle schedule. Configure their order, access, and field locks in <strong style={{ color: LL_INK }}>Settings → Projects &amp; Opportunities schedule</strong>; assign a lifecycle when the project should follow dated phase rows.
                    </p>
                  </section>
                )}

                {/* Default card */}
                {!globalScope && scheduleMatches(defaultCardTitle, ["Default", ...defaultPhases]) && (() => {
                  const isActive = selectedId === EVERYONE;
                  return (
                    <button type="button"
                      onClick={() => { setSelectedId(EVERYONE); setSavedSchedulesOpen(false); }}
                      style={{ display: "grid", gridTemplateColumns: "56px 1fr", gap: 14, alignItems: "start", width: "100%", textAlign: "left", background: isActive ? "#F4F8EF" : "transparent", border: "none", borderBottom: `1px solid ${LL_LINE}`, borderLeft: `3px solid ${isActive ? LL_GREEN : "transparent"}`, padding: "13px 22px", cursor: "pointer", transition: "background .12s" }}
                      onMouseEnter={e => { if (!isActive) (e.currentTarget as HTMLButtonElement).style.background = "#F2F5F3"; }}
                      onMouseLeave={e => { if (!isActive) (e.currentTarget as HTMLButtonElement).style.background = "transparent"; }}>
                      <span style={{ textAlign: "right", paddingTop: 1 }}>
                        <b style={{ display: "block", fontFamily: "ui-monospace,SFMono-Regular,Menlo,monospace", fontWeight: 500, fontSize: 24, lineHeight: 1, color: isActive ? LL_GREEN : LL_NAVY, fontVariantNumeric: "tabular-nums" }}>{String(defaultPhases.length).padStart(2, "0")}</b>
                        <span style={{ display: "block", fontFamily: "ui-monospace,SFMono-Regular,Menlo,monospace", fontSize: 9, letterSpacing: "0.12em", textTransform: "uppercase", color: LL_MUTE, marginTop: 3 }}>Phases</span>
                      </span>
                      <span>
                        <span style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 10 }}>
                          <span style={{ fontWeight: 600, fontSize: 14, color: LL_INK }}>{defaultCardTitle}</span>
                          <span style={{ padding: "1px 8px", borderRadius: 999, background: "rgba(107,165,57,0.12)", border: "1px solid rgba(107,165,57,0.45)", color: "#2D6A12", fontSize: 9, fontWeight: 800, letterSpacing: 0.5, textTransform: "uppercase" }}>Default</span>
                        </span>
                        <LLPhaseRail phases={defaultPhases} />
                      </span>
                    </button>
                  );
                })()}

                {/* Named schedule rows */}
                {!globalScope && sets.map((s, i) => {
                  if (!scheduleMatches(s.name, s.phases)) return null;
                  const isActive = selectedId === s.id;
                  const err = setHasError(s);
                  return (
                    <div key={s.id} style={{ display: "grid", gridTemplateColumns: "56px 1fr auto", gap: 14, alignItems: "start", background: isActive ? "#F4F8EF" : "transparent", borderBottom: `1px solid ${LL_LINE}`, borderLeft: `3px solid ${err ? "#ef4444" : isActive ? LL_GREEN : "transparent"}`, padding: "13px 22px 13px 0", transition: "background .12s" }}
                      onMouseEnter={e => { if (!isActive) (e.currentTarget as HTMLDivElement).style.background = "#F2F5F3"; }}
                      onMouseLeave={e => { if (!isActive) (e.currentTarget as HTMLDivElement).style.background = "transparent"; }}>
                      {/* Phase count — clicking selects */}
                      <button type="button" onClick={() => { setSelectedId(s.id); setSavedSchedulesOpen(false); }} style={{ textAlign: "right", paddingTop: 1, background: "none", border: "none", cursor: "pointer", paddingLeft: 22 }}>
                        <b style={{ display: "block", fontFamily: "ui-monospace,SFMono-Regular,Menlo,monospace", fontWeight: 500, fontSize: 24, lineHeight: 1, color: isActive ? LL_GREEN : LL_NAVY, fontVariantNumeric: "tabular-nums" }}>{String(s.phases.length).padStart(2, "0")}</b>
                        <span style={{ display: "block", fontFamily: "ui-monospace,SFMono-Regular,Menlo,monospace", fontSize: 9, letterSpacing: "0.12em", textTransform: "uppercase", color: LL_MUTE, marginTop: 3 }}>Phases</span>
                      </button>
                      {/* Name + rail — clicking selects */}
                      <button type="button" onClick={() => { setSelectedId(s.id); setSavedSchedulesOpen(false); }} style={{ display: "block", textAlign: "left", background: "none", border: "none", cursor: "pointer", minWidth: 0 }}>
                        <span style={{ display: "block", fontWeight: 500, fontSize: 14, color: LL_INK, marginBottom: 10 }}>
                          {s.name.trim() || <span style={{ color: "#ef4444", fontStyle: "italic" }}>Unnamed</span>}
                          {err === "missing-name" && <span style={{ fontSize: 11, color: "#ef4444", marginLeft: 8 }}>⚠ needs a name</span>}
                        </span>
                        <LLPhaseRail phases={s.phases} />
                        {sets.length > 1 && !audQ && (
                          <div style={{ display: "flex", gap: 4, marginTop: 8 }} onClick={e => e.stopPropagation()}>
                            <button type="button" title="Move up" disabled={i === 0} onClick={e => { e.stopPropagation(); moveSet(i, i - 1); }} style={{ width: 22, height: 22, borderRadius: 5, border: `1px solid ${LL_LINE}`, background: "#fff", cursor: i === 0 ? "not-allowed" : "pointer", opacity: i === 0 ? 0.35 : 1, display: "flex", alignItems: "center", justifyContent: "center", color: LL_MUTE }}>
                              <ChevronUp style={{ width: 12, height: 12 }} />
                            </button>
                            <button type="button" title="Move down" disabled={i === sets.length - 1} onClick={e => { e.stopPropagation(); moveSet(i, i + 1); }} style={{ width: 22, height: 22, borderRadius: 5, border: `1px solid ${LL_LINE}`, background: "#fff", cursor: i === sets.length - 1 ? "not-allowed" : "pointer", opacity: i === sets.length - 1 ? 0.35 : 1, display: "flex", alignItems: "center", justifyContent: "center", color: LL_MUTE }}>
                              <ChevronDown style={{ width: 12, height: 12 }} />
                            </button>
                          </div>
                        )}
                      </button>
                      {/* Actions */}
                      <div style={{ display: "flex", flexDirection: "column", gap: 6, paddingRight: 4, paddingTop: 2, alignItems: "flex-end" }}>
                        <button type="button" title="Make this the default — new records will be built from it"
                          onClick={e => { e.stopPropagation(); makeSetDefault(s.id); }}
                          style={{ background: "rgba(107,165,57,0.10)", border: "1px solid rgba(107,165,57,0.35)", borderRadius: 5, padding: "3px 8px", cursor: "pointer", color: "#2D6A12", fontSize: 10, fontWeight: 700, whiteSpace: "nowrap" }}>
                          Make default
                        </button>
                        <button type="button" title="Remove this schedule"
                          onClick={e => { e.stopPropagation(); removeSet(s.id, s.name); }}
                          style={{ background: "none", border: "none", padding: "2px 4px", cursor: "pointer", display: "flex", color: "#ef4444", opacity: 0.7 }}
                          onMouseEnter={e => { (e.currentTarget as HTMLButtonElement).style.opacity = "1"; }}
                          onMouseLeave={e => { (e.currentTarget as HTMLButtonElement).style.opacity = "0.7"; }}>
                          <Trash2 style={{ width: 13, height: 13 }} />
                        </button>
                      </div>
                    </div>
                  );
                })}

                {/* Lifecycle template rows */}
                {!globalScope && lifecycleTemplates && lifecycleTemplates.length > 0 && (() => {
                  const sigSeen = new Map<string, number>();
                  const deduped = lifecycleTemplates.filter(t => {
                    const sig = t.phases.map(p => p.trim().toLowerCase()).join("\u0001");
                    const best = sigSeen.get(sig);
                    if (best === undefined || t.id < best) { sigSeen.set(sig, t.id); }
                    return sigSeen.get(sig) === t.id;
                  });
                   const visible = deduped.filter(t => scheduleMatches(t.name, t.phases));
                  if (visible.length === 0) return null;
                  return (
                    <>
                      <div style={{ padding: "10px 22px 6px", fontFamily: "ui-monospace,SFMono-Regular,Menlo,monospace", fontSize: 9.5, fontWeight: 700, color: LL_MUTE, textTransform: "uppercase", letterSpacing: "0.15em", background: LL_PAPER, borderTop: `1px solid ${LL_LINE}`, borderBottom: `1px solid ${LL_LINE}` }}>
                        Lifecycle templates
                      </div>
                      {visible.map(tpl => {
                        const displayName = tpl.name.startsWith("Imported:") && tpl.phases.length ? tpl.phases.join(", ") : tpl.name;
                        const alreadySaved = sets.some(s => s.name.trim().toLowerCase() === tpl.name.trim().toLowerCase() && s.phases.length === tpl.phases.length && s.phases.every((p, ii) => p.toLowerCase() === (tpl.phases[ii] ?? "").toLowerCase()));
                        return (
                          <div key={tpl.id} style={{ display: "grid", gridTemplateColumns: "56px 1fr auto", gap: 14, alignItems: "start", borderBottom: `1px solid ${LL_LINE}`, padding: "13px 22px 13px 0" }}>
                            <span style={{ textAlign: "right", paddingTop: 1, paddingLeft: 22 }}>
                              <b style={{ display: "block", fontFamily: "ui-monospace,SFMono-Regular,Menlo,monospace", fontWeight: 500, fontSize: 24, lineHeight: 1, color: LL_NAVY, fontVariantNumeric: "tabular-nums" }}>{String(tpl.phases.length).padStart(2, "0")}</b>
                              <span style={{ display: "block", fontFamily: "ui-monospace,SFMono-Regular,Menlo,monospace", fontSize: 9, letterSpacing: "0.12em", textTransform: "uppercase", color: LL_MUTE, marginTop: 3 }}>Phases</span>
                            </span>
                            <span>
                              <span style={{ display: "block", fontWeight: 500, fontSize: 14, color: LL_INK, marginBottom: 10 }}>{displayName}</span>
                              <LLPhaseRail phases={tpl.phases} />
                            </span>
                            <div style={{ display: "flex", flexDirection: "column", gap: 6, paddingRight: 4, paddingTop: 2, alignItems: "flex-end" }}>
                              <button type="button"
                                onClick={() => {
                                  const oldCount = parseList(phasesValue).length;
                                  const label = tpl.name.trim() || "this lifecycle";
                                  if (!window.confirm(`Make "${label}" the new default?\n\nNew projects and opportunities will be built from it. It replaces the current default list (${oldCount} phase${oldCount === 1 ? "" : "s"}).\n\nThis saves automatically.`)) return;
                                  const newPhases = tpl.phases.join(", ");
                                  const alreadyId = sets.find(s => s.name.trim().toLowerCase() === tpl.name.trim().toLowerCase() && s.phases.length === tpl.phases.length && s.phases.every((p, ii) => p.toLowerCase() === (tpl.phases[ii] ?? "").toLowerCase()))?.id;
                                  const setId = alreadyId ?? `ps-${Date.now().toString(36)}-${Math.floor(Math.random() * 1e4).toString(36)}`;
                                  const updatedSets = alreadyId ? sets.map(s => s.id === alreadyId ? { ...s, applyMode: "groups" as PhaseScopeMode, groupIds: [] } : s) : [...sets, { id: setId, name: tpl.name, phases: tpl.phases, groupIds: [] as string[], applyMode: "groups" as PhaseScopeMode }];
                                  const scopeEntry: ProjectPhaseSet = { id: DEFAULT_SCOPE_ID, name: "__default__", phases: [], groupIds: [], applyMode: "everyone" };
                                  const newSetsStr = JSON.stringify([scopeEntry, ...updatedSets]);
                                  onPhasesChange(newPhases); onPhaseSetsChange(newSetsStr); setSelectedId(EVERYONE); setSavedSchedulesOpen(false);
                                  if (onSaveSetsOnly && phasesFieldKey && setsFieldKey) { flushSetsTimer(); onSaveSetsOnly({ [phasesFieldKey]: newPhases, [setsFieldKey]: newSetsStr }); }
                                }}
                                style={{ background: "rgba(107,165,57,0.10)", border: "1px solid rgba(107,165,57,0.35)", borderRadius: 5, padding: "3px 8px", cursor: "pointer", color: "#2D6A12", fontSize: 10, fontWeight: 700, whiteSpace: "nowrap" }}>
                                Make default
                              </button>
                              {!alreadySaved ? (
                                <button type="button"
                                  onClick={() => {
                                    const newSet: ProjectPhaseSet = { id: `ps-${Date.now().toString(36)}-${Math.floor(Math.random() * 1e4).toString(36)}`, name: tpl.name, phases: tpl.phases, groupIds: [], applyMode: "groups" };
                                    commitSets([...sets, newSet]); setSelectedId(newSet.id); setSavedSchedulesOpen(false);
                                  }}
                                  style={{ background: "none", border: `1px solid ${LL_LINE}`, borderRadius: 5, padding: "3px 8px", cursor: "pointer", color: LL_MUTE, fontSize: 10, fontWeight: 600, display: "flex", alignItems: "center", gap: 4, whiteSpace: "nowrap" }}>
                                  <Plus style={{ width: 10, height: 10 }} /> Add as schedule
                                </button>
                              ) : (
                                <span style={{ fontSize: 10, color: LL_MUTE, fontStyle: "italic" }}>already saved</span>
                              )}
                              {onDeleteTemplate && (
                                <button type="button" title="Delete this lifecycle template"
                                  onClick={() => {
                                    const label = tpl.name.trim() || "Unnamed";
                                    if (!window.confirm(`Delete lifecycle template "${label}"?\n\n⚠ Records assigned to it will lose their schedule reference.\n\nClick OK to continue to the final confirmation.`)) return;
                                    if (!window.confirm(`Final confirmation — permanently delete "${label}"?\n\nThis cannot be undone.`)) return;
                                    void onDeleteTemplate(tpl.id, tpl.name);
                                  }}
                                  style={{ background: "none", border: "none", padding: "2px 4px", cursor: "pointer", color: "hsl(var(--destructive))", display: "flex", alignItems: "center", borderRadius: 4, opacity: 0.7 }}
                                  onMouseEnter={e => { (e.currentTarget as HTMLButtonElement).style.opacity = "1"; }}
                                  onMouseLeave={e => { (e.currentTarget as HTMLButtonElement).style.opacity = "0.7"; }}>
                                  <Trash2 style={{ width: 13, height: 13 }} />
                                </button>
                              )}
                            </div>
                          </div>
                        );
                      })}
                    </>
                  );
                })()}

                {!globalScope && sets.length === 0 && !lifecycleTemplates?.length && (
                  <div style={{ padding: "40px 22px", textAlign: "center", color: LL_MUTE, fontSize: 13 }}>
                    <strong style={{ display: "block", fontSize: 15, color: LL_INK, marginBottom: 6 }}>No saved schedules yet</strong>
                    Use "+ Add schedule" to create one.
                  </div>
                )}
              </div>
            </div>
          </div>
        );
      })()}

      {/* ── Editor — full width ────────────────────────────────────────────── */}
      <div style={{ border, borderRadius: 10, minHeight: 260, maxHeight: 600, overflowY: "auto", padding: "14px 16px", display: "flex", flexDirection: "column", gap: 12 }}>

        {/* breadcrumb when a named schedule is open */}
        {selSet && (
          <div style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 12, color: muted }}>
            <button type="button" onClick={() => setSelectedId(EVERYONE)}
              style={{ background: "none", border: "none", cursor: "pointer", color: muted, fontSize: 12, padding: 0, display: "flex", alignItems: "center", gap: 3 }}>
              <ChevronLeft style={{ width: 13, height: 13 }} /> Default
            </button>
            <span>/</span>
            <span style={{ color: "hsl(var(--foreground))", fontWeight: 600 }}>{selSet.name.trim() || "New schedule"}</span>
          </div>
        )}

        {/* EVERYONE selected */}
        {selectedId === EVERYONE && (
          <>

            {/* Name field — same as saved schedules so every list has a recognisable label */}
            <div>
              <div style={fieldLabel}>Name this list</div>
              <div style={fieldHelp}>Give it a name so you can recognise it in the sidebar — leave blank to call it &ldquo;Default&rdquo;.</div>
              <Input
                value={defaultCustomName}
                onChange={(e) => setDefaultName(e.target.value)}
                placeholder="Default"
                style={{ height: 32, fontSize: 13, maxWidth: 340 }}
              />
            </div>

            <div>
              <div style={fieldLabel}>{titleNoun}s, in order</div>
              <div style={fieldHelp}>Drag to change the order. These become the bars on the record&apos;s Gantt chart.</div>
              <PhaseListEditor
                value={phasesValue} onChange={onPhasesChange}
                suggestions={suggestions} colored={colored} itemNoun={itemNoun}
                listMaxHeight={360}
                removeConfirmNote={`This list saves automatically, so any record still sitting on that ${itemNoun} will have it cleared.`}
                onSetRules={onSetRules ? (n) => onSetRules(n, parseList(phasesValue), defaultScopeEntry?.phaseColors ?? {}) : undefined}
                ruleCountOf={ruleCountOf}
                colors={defaultScopeEntry?.phaseColors}
                onColorChange={changeDefaultColor}
              />
            </div>
            <p style={{ fontSize: 11.5, color: muted, margin: "2px 0 0", lineHeight: 1.5 }}>
              Changes save automatically a moment after you stop editing.
            </p>
          </>
        )}

        {/* SAVED SCHEDULE selected */}
        {selSet && (() => {
          const err = setHasError(selSet);
          const dupName = !!selSet.name.trim() && sets.some((s) =>
            s.id !== selSet.id && s.name.trim().toLowerCase() === selSet.name.trim().toLowerCase());
          const defaults = parseList(phasesValue);
          const defaultsLow = defaults.map((x) => x.trim().toLowerCase());
          const isExtra = (name: string) => !defaultsLow.includes(name.trim().toLowerCase());
          const addedVsDefault = selSet.phases.filter((p) => isExtra(p));
          const droppedVsDefault = defaults.filter((d) => !selSet.phases.some((p) => p.trim().toLowerCase() === d.trim().toLowerCase()));
          const sameOrder = selSet.phases.map((p) => p.trim().toLowerCase()).join("|") === defaultsLow.join("|");
          const boldTxt: React.CSSProperties = { color: "hsl(var(--foreground))", fontWeight: 600 };
          return (
            <>
              <div style={{ fontSize: 13.5, fontWeight: 700, color: "hsl(var(--foreground))" }}>
                {selSet.name.trim() || <span style={{ color: "#ef4444", fontStyle: "italic" }}>New schedule</span>}
              </div>

              <div>
                <div style={fieldLabel}>Name this schedule</div>
                <div style={fieldHelp}>Just so you can recognise it in the list — the heading above updates as you type.</div>
                <Input value={selSet.name}
                  onChange={(e) => patchSet(selSet.id, { name: e.target.value })}
                  placeholder={`e.g. Estimating team's ${setNoun}`}
                  style={{ height: 30, fontSize: 12.5, borderColor: !selSet.name.trim() ? "#ef4444" : undefined }} />
                {dupName && (
                  <div style={{ fontSize: 11.5, color: "#d97706", marginTop: 5, lineHeight: 1.5 }}>
                    ⚠ Another schedule has this name too — rename one so you can tell them apart.
                  </div>
                )}
              </div>

              <div>
                <div style={fieldLabel}>{titleNoun}s, in order</div>
                <div style={fieldHelp}>Drag to change the order. These become the bars on the record&apos;s Gantt chart.</div>
                <PhaseListEditor
                  value={selSet.phases.join(", ")}
                  onChange={(v) => patchSet(selSet.id, { phases: parseList(v) })}
                  suggestions={suggestions} colored={colored} itemNoun={itemNoun}
                  listMaxHeight={300}
                  extraOf={isExtra}
                  onSetRules={onSetRules ? (n) => onSetRules(n, selSet.phases, selSet.phaseColors ?? {}) : undefined}
                  ruleCountOf={ruleCountOf}
                  colors={selSet.phaseColors}
                  onColorChange={(phase, color) => changeSetColor(selSet.id, phase, color)}
                />
              </div>

              <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
                <span style={{ fontSize: 11.5, color: muted, lineHeight: 1.5 }}>
                  Use the <Trash2 style={{ width: 11, height: 11, display: "inline", verticalAlign: "middle", color: "#ef4444" }} /> on the card row to remove this schedule. Changes save automatically.
                </span>
              </div>
            </>
          );
        })()}
      </div>

    </div>
  );
}
