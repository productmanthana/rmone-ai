import { useEffect, useRef, useState } from "react";
import { GripHorizontal, Search, UserRound, X } from "lucide-react";
import { fmtNum, type AfPersonChoice } from "@/lib/afMath";
import { Z } from "@/lib/zLayers";

export type { AfPersonChoice } from "@/lib/afMath";

const FOCUSABLE = [
  'a[href]', 'button:not([disabled])', 'input:not([disabled])',
  'select:not([disabled])', 'textarea:not([disabled])',
  '[tabindex]:not([tabindex="-1"])',
].join(", ");

export function AfPeoplePickerPopup({
  projectTitle,
  choices,
  selectedId,
  onSelect,
  onClose,
}: {
  projectTitle: string;
  choices: AfPersonChoice[];
  selectedId: string | null;
  onSelect: (id: string | null) => void;
  onClose: () => void;
}) {
  const panelRef = useRef<HTMLDivElement>(null);
  const dragRef = useRef<{ startX: number; startY: number; originX: number; originY: number } | null>(null);
  const [dragging, setDragging] = useState(false);
  const [offset, setOffset] = useState({ x: 0, y: 0 });
  const [query, setQuery] = useState("");

  // Escape closes; Tab is trapped inside the panel so keyboard focus cannot
  // reach (and change) the filter controls behind the overlay.
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") { onClose(); return; }
      if (event.key !== "Tab") return;
      const panel = panelRef.current;
      if (!panel) return;
      const nodes = Array.from(panel.querySelectorAll<HTMLElement>(FOCUSABLE));
      if (nodes.length === 0) return;
      const first = nodes[0];
      const last = nodes[nodes.length - 1];
      const active = document.activeElement as HTMLElement | null;
      if (!active || !panel.contains(active)) { event.preventDefault(); first.focus(); return; }
      if (event.shiftKey && active === first) { event.preventDefault(); last.focus(); }
      else if (!event.shiftKey && active === last) { event.preventDefault(); first.focus(); }
    };
    window.addEventListener("keydown", onKey);
    panelRef.current?.focus();
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  useEffect(() => {
    if (!dragging) return;
    const onMove = (event: PointerEvent) => {
      const drag = dragRef.current;
      if (!drag) return;
      const rect = panelRef.current?.getBoundingClientRect();
      const width = rect?.width ?? Math.min(640, window.innerWidth - 24);
      const height = rect?.height ?? Math.min(650, window.innerHeight - 24);
      const maxX = Math.max(0, (window.innerWidth - width) / 2 - 12);
      const maxY = Math.max(0, (window.innerHeight - height) / 2 - 12);
      setOffset({
        x: Math.max(-maxX, Math.min(maxX, drag.originX + event.clientX - drag.startX)),
        y: Math.max(-maxY, Math.min(maxY, drag.originY + event.clientY - drag.startY)),
      });
    };
    const stop = () => {
      dragRef.current = null;
      setDragging(false);
    };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", stop);
    window.addEventListener("pointercancel", stop);
    return () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", stop);
      window.removeEventListener("pointercancel", stop);
    };
  }, [dragging]);

  const beginDrag = (event: React.PointerEvent<HTMLDivElement>) => {
    if (event.button !== 0) return;
    event.preventDefault();
    dragRef.current = { startX: event.clientX, startY: event.clientY, originX: offset.x, originY: offset.y };
    setDragging(true);
  };

  const normalizedQuery = query.trim().toLowerCase();
  const visible = choices.filter((choice) => {
    if (!normalizedQuery) return true;
    return [choice.name, choice.role, choice.division].some((value) => value.toLowerCase().includes(normalizedQuery));
  });

  return (
    <div
      onClick={onClose}
      style={{
        position: "fixed", inset: 0, zIndex: Z.POPUP, display: "flex", alignItems: "center",
        justifyContent: "center", padding: 12, background: "rgba(15, 23, 42, 0.52)",
        backdropFilter: "blur(2px)",
      }}
    >
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-label="People on this project"
        tabIndex={-1}
        onClick={(event) => event.stopPropagation()}
        style={{
          width: "min(680px, calc(100vw - 24px))",
          maxHeight: "min(720px, calc(100vh - 24px))",
          display: "flex", flexDirection: "column", overflow: "hidden",
          transform: `translate(${offset.x}px, ${offset.y}px)`,
          background: "hsl(var(--card))", color: "hsl(var(--foreground))",
          border: "1px solid hsl(var(--border))", borderRadius: 16,
          boxShadow: "0 24px 70px rgba(2, 6, 23, 0.42)", outline: "none",
        }}
      >
        <div
          onPointerDown={beginDrag}
          style={{
            display: "flex", alignItems: "center", gap: 10, padding: "14px 16px",
            borderBottom: "1px solid hsl(var(--border))", cursor: dragging ? "grabbing" : "grab",
            userSelect: "none", touchAction: "none", background: "hsl(var(--muted) / 0.45)",
          }}
        >
          <GripHorizontal size={17} style={{ color: "hsl(var(--muted-foreground))", flexShrink: 0 }} />
          <div style={{ minWidth: 0, flex: 1 }}>
            <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: 0.4, textTransform: "uppercase", color: "hsl(var(--muted-foreground))" }}>
              Project people
            </div>
            <div style={{ fontSize: 17, fontWeight: 750, marginTop: 2, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
              {projectTitle || "People on this project"}
            </div>
            <div style={{ fontSize: 11.5, color: "hsl(var(--muted-foreground))", marginTop: 2 }}>
              Drag this header to move the popup · choose a person to open their weekly detail
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close people popup"
            style={{ border: "1px solid hsl(var(--border))", background: "hsl(var(--card))", color: "hsl(var(--muted-foreground))", borderRadius: 8, width: 30, height: 30, display: "inline-flex", alignItems: "center", justifyContent: "center", cursor: "pointer", flexShrink: 0 }}
          >
            <X size={16} />
          </button>
        </div>

        <div style={{ padding: "12px 16px 8px", display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
          <div style={{ position: "relative", flex: 1, minWidth: 180 }}>
            <Search size={14} style={{ position: "absolute", left: 10, top: 9, color: "hsl(var(--muted-foreground))" }} />
            <input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Search people, roles, or divisions"
              aria-label="Search project people"
              style={{ width: "100%", boxSizing: "border-box", padding: "8px 10px 8px 29px", borderRadius: 8, border: "1px solid hsl(var(--border))", background: "hsl(var(--background))", color: "hsl(var(--foreground))", fontSize: 12.5, outline: "none" }}
            />
          </div>
          <button
            type="button"
            onClick={() => onSelect(null)}
            style={{ padding: "8px 11px", borderRadius: 8, border: "1px solid hsl(var(--border))", background: selectedId === null ? "#2563eb" : "hsl(var(--card))", color: selectedId === null ? "#fff" : "hsl(var(--foreground))", fontSize: 12, fontWeight: 650, cursor: "pointer", whiteSpace: "nowrap" }}
          >
            All people
          </button>
        </div>

        <div style={{ overflowY: "auto", padding: "0 16px 16px" }}>
          {visible.length === 0 ? (
            <div style={{ padding: "28px 12px", textAlign: "center", fontSize: 12.5, color: "hsl(var(--muted-foreground))" }}>
              No people match this search.
            </div>
          ) : (
            <div style={{ display: "grid", gap: 8 }}>
              {visible.map((choice) => {
                const active = selectedId === choice.id;
                const meta = [choice.role, choice.division].filter(Boolean).join(" · ");
                return (
                  <button
                    type="button"
                    key={choice.id || "open-demand"}
                    onClick={() => onSelect(choice.id)}
                    style={{
                      display: "flex", alignItems: "flex-start", gap: 11, width: "100%", textAlign: "left",
                      padding: "11px 12px", borderRadius: 10, border: `1px solid ${active ? "#2563eb" : "hsl(var(--border))"}`,
                      background: active ? "#2563eb10" : "hsl(var(--card))", color: "hsl(var(--foreground))",
                      cursor: "pointer", boxShadow: active ? "0 0 0 2px #2563eb18" : undefined,
                    }}
                  >
                    <span style={{ width: 30, height: 30, borderRadius: 9, background: active ? "#2563eb18" : "hsl(var(--muted))", color: active ? "#2563eb" : "hsl(var(--muted-foreground))", display: "inline-flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
                      <UserRound size={15} />
                    </span>
                    <span style={{ minWidth: 0, flex: 1 }}>
                      <span style={{ display: "block", fontSize: 13, fontWeight: 700, fontStyle: choice.id === "" ? "italic" : undefined }}>{choice.name}</span>
                      <span style={{ display: "block", marginTop: 2, fontSize: 11.5, color: "hsl(var(--muted-foreground))" }}>{meta || "No role or division recorded"}</span>
                      <span style={{ display: "flex", gap: 12, flexWrap: "wrap", marginTop: 7, fontSize: 11, color: "hsl(var(--muted-foreground))", fontVariantNumeric: "tabular-nums" }}>
                        {choice.actualHours === 0 && choice.plannedHours === 0 && choice.plannedTotalHours > 0 ? (
                          // Everything for this row sits after the latest snapshot
                          // week — an all-zero stat line would look dead, so say so.
                          <span>Nothing recorded yet · <b style={{ color: "hsl(var(--foreground))" }}>{fmtNum(choice.plannedTotalHours)} h</b> planned ahead</span>
                        ) : (
                          <>
                            <span>Actual <b style={{ color: "hsl(var(--foreground))" }}>{fmtNum(choice.actualHours)} h</b></span>
                            <span>Planned <b style={{ color: "hsl(var(--foreground))" }}>{fmtNum(choice.plannedHours)} h</b></span>
                            <span>Difference <b style={{ color: choice.varianceHours > 0 ? "#16a34a" : choice.varianceHours < 0 ? "#dc2626" : "hsl(var(--foreground))" }}>{fmtNum(choice.varianceHours)} h</b></span>
                          </>
                        )}
                      </span>
                    </span>
                    <span style={{ fontSize: 11, color: active ? "#2563eb" : "hsl(var(--muted-foreground))", fontWeight: 650, whiteSpace: "nowrap" }}>
                      {active ? "Selected" : "View details"}
                    </span>
                  </button>
                );
              })}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}