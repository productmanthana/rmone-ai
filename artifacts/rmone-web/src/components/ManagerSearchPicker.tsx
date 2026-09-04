/* ManagerSearchPicker — the self-contained person search that sits on top of
 * the Resources → Manager view (extracted verbatim from pages/resources.tsx so
 * the debounce-cancellation contract below is directly testable).
 *
 * CONTRACT (guarded by src/lib/__tests__/managerSearchPicker.test.ts, which
 * rides the check:reports-honesty chain):
 *   • Typing pushes the grid live-filter DEBOUNCED (180ms) via onQueryChange —
 *     never synchronously — so keystrokes don't re-render the heavy timeline
 *     grid. Clearing the box pushes "" immediately (instant full grid).
 *   • Picking a person (click or Enter) CANCELS any pending debounce timer.
 *     The parent clears managerSearch on select; a surviving timer would
 *     re-apply the stale filter ~180ms later and blank the grid.
 *   • Unmounting (view switch / navigation) also cancels the pending timer.
 *   • Enter selects the CLAMPED highlighted hit (highlight may point past the
 *     end after the hit list shrinks mid-typing).
 * If you refactor the timer handling, keep those guarantees — the chain test
 * fails loudly if any of them regress.
 */
// Namespace import: the node test chain (tsx/esbuild, jsx "preserve") compiles
// this file's JSX to classic React.createElement, so React must be in scope.
import * as React from "react";
import { useEffect, useMemo, useRef, useState } from "react";
import { Search } from "lucide-react";
import type { LiveResourceProxy } from "@/lib/api";

const BRAND = {
  card: "var(--rm-panel)",
  cardBorder: "var(--rm-panel-border)",
  greenBg: "var(--rm-green)",
  white: "var(--rm-text)",
  textMuted: "var(--rm-text-faint)",
};

function firstNameSortKey(name: string): string {
  return name.trim().split(/\s+/)[0]?.toLocaleLowerCase() ?? "";
}

function compareByFirstName(a: string, b: string): number {
  return firstNameSortKey(a).localeCompare(firstNameSortKey(b))
    || a.localeCompare(b);
}

const SHORT_ROLE_WORDS: Record<string, string> = {
  administrator: "Admin",
  analyst: "Anl",
  architect: "Arch",
  assistant: "Asst",
  coordinator: "Coord",
  designer: "Des",
  director: "Dir",
  developer: "Dev",
  engineer: "Eng",
  estimator: "Est",
  manager: "Mgr",
  president: "Pres",
  specialist: "Spec",
  supervisor: "Supv",
};

function shortRoleLabel(role: string): string {
  const clean = role.trim().replace(/\s+/g, " ");
  if (!clean) return "";
  const words = clean.split(" ");
  if (words.length > 1) {
    // Multi-word job titles are most recognizable as their initials:
    // Project Manager → PM, Senior Project Manager → SPM.
    return words.map(word => word[0] ?? "").join("").toUpperCase();
  }
  return SHORT_ROLE_WORDS[clean.toLowerCase()] ?? (
    clean.length <= 10 ? clean : `${clean.slice(0, 9)}…`
  );
}

export function ManagerSearchPicker({ people, teamMemberCounts, loading, onSelect, onQueryChange }: {
  people: LiveResourceProxy[];
  /** Manager ID → unique team members shown after selecting that person. */
  teamMemberCounts?: ReadonlyMap<string, number>;
  loading?: boolean;
  onSelect: (id: string) => void;
  onQueryChange: (q: string) => void;
}) {
  const [text, setText] = useState("");
  const [focus, setFocus] = useState(false);
  const [highlight, setHighlight] = useState(0);
  const pickerRef = useRef<HTMLDivElement>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => () => { if (debounceRef.current) clearTimeout(debounceRef.current); }, []);

  const q = text.trim().toLowerCase();
  const hits = useMemo(() => {
    const base = people.filter(r => r.id && r.name);
    // Nothing typed yet: list people right away so a click is enough.
    if (!q) return [...base].sort((a, b) => compareByFirstName(a.name, b.name));
    return base
      .filter(r => r.name.toLowerCase().includes(q) || (r.role || "").toLowerCase().includes(q))
      .sort((a, b) =>
        Number(b.name.toLowerCase().startsWith(q)) - Number(a.name.toLowerCase().startsWith(q))
        || compareByFirstName(a.name, b.name));
  }, [people, q]);
  const hi = Math.min(highlight, Math.max(hits.length - 1, 0));

  const pushQuery = (v: string) => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    // Clearing restores the full grid instantly; typing re-filters the grid
    // only after a short pause instead of on every keystroke.
    if (!v.trim()) { onQueryChange(""); return; }
    debounceRef.current = setTimeout(() => onQueryChange(v), 180);
  };
  const choose = (id: string) => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    setText("");
    setFocus(false);
    onSelect(id);
  };

  return (
    <div ref={pickerRef} style={{ position: "relative", width: "min(100%, 380px)", flex: "0 1 380px" }}>
      <Search size={13} style={{ position: "absolute", left: 11, top: "50%", transform: "translateY(-50%)", color: BRAND.textMuted, pointerEvents: "none" }} />
      <input
        value={text}
        onChange={e => { setText(e.target.value); setHighlight(0); pushQuery(e.target.value); }}
        onFocus={() => setFocus(true)}
        onBlur={() => {
          // Clicking the menu scrollbar does not give the input a normal
          // relatedTarget. Keep the menu mounted while the pointer is inside
          // the picker so its vertical thumb can be dragged.
          window.setTimeout(() => {
            if (!pickerRef.current?.matches(":hover") && !pickerRef.current?.contains(document.activeElement)) {
              setFocus(false);
            }
          }, 0);
        }}
        onKeyDown={e => {
          if (e.key === "ArrowDown") { e.preventDefault(); setHighlight(Math.min(hi + 1, Math.max(hits.length - 1, 0))); }
          else if (e.key === "ArrowUp") { e.preventDefault(); setHighlight(Math.max(hi - 1, 0)); }
          else if (e.key === "Enter") { const hit = hits[hi]; if (hit) { e.preventDefault(); choose(String(hit.id)); } }
          else if (e.key === "Escape") { e.currentTarget.blur(); }
        }}
        placeholder="Search any person to open their team hierarchy…"
        style={{
          width: "100%", boxSizing: "border-box", padding: "9px 12px 9px 32px", borderRadius: 9,
          border: `1px solid ${BRAND.cardBorder}`, background: BRAND.card,
          color: BRAND.white, fontSize: 12.5, outline: "none",
        }}
      />
      {focus && (
        <div style={{
          position: "absolute", top: "calc(100% + 4px)", left: 0, right: 0, zIndex: 80,
          background: "var(--rm-panel-solid, var(--rm-panel))", border: `1px solid ${BRAND.cardBorder}`,
           borderRadius: 10, boxShadow: "0 14px 30px rgba(0,0,0,0.5)",
           maxHeight: "min(60vh, 520px)", overflowX: "hidden", overflowY: "auto",
           overscrollBehavior: "contain", scrollbarWidth: "thin",
        }}>
          {hits.length === 0 ? (
            <div style={{ padding: "10px 12px", color: BRAND.textMuted, fontSize: 12 }}>
              {q ? `No one matches “${text.trim()}”.` : loading ? "Loading people…" : "No people found."}
            </div>
          ) : hits.map((rt, i) => {
            const teamMemberCount = teamMemberCounts?.get(String(rt.id).trim().toLowerCase());
            return (
            <button
              key={String(rt.id)}
              onMouseDown={(e) => { e.preventDefault(); choose(String(rt.id)); }}
              onMouseEnter={() => setHighlight(i)}
              style={{
                display: "flex", alignItems: "center", gap: 9, width: "100%",
                padding: "8px 12px", border: "none",
                background: i === hi ? "rgba(255,255,255,0.08)" : "transparent",
                borderTop: `1px solid ${BRAND.cardBorder}`, cursor: "pointer", textAlign: "left",
              }}
            >
              <span style={{
                width: 24, height: 24, borderRadius: "50%", background: BRAND.greenBg,
                display: "inline-flex", alignItems: "center", justifyContent: "center",
                color: "#fff", fontSize: 9, fontWeight: 800, flexShrink: 0,
              }}>
                {rt.name.trim().split(/\s+/).map(p => p[0] ?? "").slice(0, 2).join("").toUpperCase()}
              </span>
              <span style={{ minWidth: 0 }}>
                <span
                  title={rt.role || undefined}
                  style={{ display: "block", color: BRAND.white, fontSize: 12, fontWeight: 700, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}
                >
                  {rt.name}{rt.role ? ` (${shortRoleLabel(rt.role)})` : ""}
                  {teamMemberCount !== undefined ? ` – ${teamMemberCount}` : ""}
                </span>
              </span>
            </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
