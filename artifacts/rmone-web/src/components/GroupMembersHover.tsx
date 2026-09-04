/**
 * Shared "who's in this group?" hover card.
 *
 * Anywhere a user-group NAME renders (Stage Rules chips/pickers, Navigation
 * settings pills, …), wrapping it in <GroupMembersHover> shows a small popup
 * on mouse-over listing the group's members by name.
 *
 * Member names resolve from the own-tenant roster (getUserList — already
 * session-cached in lib/api). Group memberIds are stored lowercase and match
 * the roster's `Id` lowercased (same convention as UserGroupsSettings).
 * When the roster isn't available (still loading, failed, or a superadmin
 * viewing ANOTHER tenant where the own-tenant roster would be wrong), the
 * card falls back to a plain member count — never wrong names.
 *
 * The popup uses position:fixed coordinates from the trigger's bounding box
 * so it escapes overflow-hidden dropdowns and scroll containers.
 */

import { useEffect, useRef, useState, type CSSProperties, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { Users } from "lucide-react";
import { getUserList } from "@/lib/api";
import { Z } from "@/lib/zLayers";

/* ── Roster name map (module-level, session-scoped) ─────────────────── */

let nameMap: Map<string, string> | null = null;
let loading: Promise<void> | null = null;
const listeners = new Set<() => void>();

function loadRoster(): void {
  if (nameMap || loading) return;
  loading = getUserList()
    .then(raw => {
      const m = new Map<string, string>();
      for (const u of (Array.isArray(raw) ? raw as Record<string, unknown>[] : [])) {
        const id = String(u.Id ?? u.id ?? "").toLowerCase();
        const label = String(u.Name ?? u.name ?? u.UserName ?? u.username ?? "").trim();
        if (id && label) m.set(id, label);
      }
      nameMap = m;
      listeners.forEach(l => l());
    })
    .catch(() => { /* fall back to member counts — never cache a failure */ })
    .finally(() => { loading = null; });
}

if (typeof window !== "undefined") {
  window.addEventListener("rmone:authChanged", () => { nameMap = null; loading = null; });
}

/** Re-renders subscribers once the roster arrives. `enabled=false` (e.g.
 *  superadmin managing another tenant) never fetches and always returns null. */
export function useGroupMemberNames(enabled: boolean): ((memberIds: string[]) => string[] | null) {
  const [, bump] = useState(0);
  useEffect(() => {
    if (!enabled) return;
    const l = () => bump(v => v + 1);
    listeners.add(l);
    loadRoster();
    return () => { listeners.delete(l); };
  }, [enabled]);
  if (!enabled) return () => null;
  return (memberIds: string[]) => {
    if (!nameMap) return null;
    const names = memberIds
      .map(id => nameMap!.get(String(id).toLowerCase()))
      .filter((n): n is string => !!n)
      .sort((a, b) => a.localeCompare(b));
    // If NONE of the ids resolve (stale roster vs fresh group), show count.
    return names.length === 0 && memberIds.length > 0 ? null : names;
  };
}

/* ── Hover card ─────────────────────────────────────────────────────── */

const MAX_NAMES = 14;

export function GroupMembersHover({ groupName, memberIds, names, subtitle, wrapStyle, children }: {
  groupName: string;
  memberIds: string[];
  /** Resolved display names, or null when unavailable (count-only fallback). */
  names: string[] | null;
  /** Optional context line under the header (e.g. what the group can do). */
  subtitle?: string;
  /** Layout override for the trigger wrapper — default inline-flex shrink-wraps,
   *  pass e.g. { display:"flex", width:"100%" } around full-width rows. */
  wrapStyle?: CSSProperties;
  children: ReactNode;
}) {
  const anchorRef = useRef<HTMLSpanElement>(null);
  const [pos, setPos] = useState<{ x: number; y: number; up: boolean } | null>(null);
  const hideTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const show = () => {
    if (hideTimer.current) { clearTimeout(hideTimer.current); hideTimer.current = null; }
    const r = anchorRef.current?.getBoundingClientRect();
    if (!r) return;
    // Open downward unless the trigger sits in the bottom third of the viewport.
    const up = r.bottom > window.innerHeight * 0.66;
    setPos({ x: Math.min(r.left, window.innerWidth - 240), y: up ? r.top - 6 : r.bottom + 6, up });
  };
  // Small delay so skimming the cursor across a row doesn't flash popups.
  const scheduleShow = () => {
    if (hideTimer.current) { clearTimeout(hideTimer.current); }
    hideTimer.current = setTimeout(show, 220);
  };
  const hide = () => {
    if (hideTimer.current) { clearTimeout(hideTimer.current); hideTimer.current = null; }
    setPos(null);
  };
  useEffect(() => () => { if (hideTimer.current) clearTimeout(hideTimer.current); }, []);

  const shown = names ? names.slice(0, MAX_NAMES) : [];
  const extra = names ? names.length - shown.length : 0;

  return (
    <span ref={anchorRef} onMouseEnter={scheduleShow} onMouseLeave={hide} style={{ display: "inline-flex", minWidth: 0, ...wrapStyle }}>
      {children}
      {pos && createPortal(
        <div style={{
          position: "fixed", left: pos.x, top: pos.up ? undefined : pos.y,
          bottom: pos.up ? window.innerHeight - pos.y : undefined,
          zIndex: Z.POPUP, minWidth: 180, maxWidth: 240, pointerEvents: "none",
          background: "hsl(var(--popover))", border: "1px solid hsl(var(--border))",
          borderRadius: 8, boxShadow: "0 8px 24px rgba(0,0,0,0.35)", padding: "8px 10px",
        }}>
          <div style={{ display: "flex", alignItems: "center", gap: 5, fontSize: 11, fontWeight: 700, color: "hsl(var(--foreground))", marginBottom: names && names.length > 0 ? 5 : 0 }}>
            <Users style={{ width: 11, height: 11, flexShrink: 0 }} />
            <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{groupName}</span>
            <span style={{ marginLeft: "auto", fontWeight: 500, color: "hsl(var(--muted-foreground))", flexShrink: 0 }}>
              {memberIds.length} {memberIds.length === 1 ? "member" : "members"}
            </span>
          </div>
          {subtitle && (
            <div style={{ fontSize: 10.5, color: "hsl(var(--muted-foreground))", marginBottom: 5, marginTop: -2 }}>{subtitle}</div>
          )}
          {names === null ? (
            memberIds.length > 0 && (
              <div style={{ fontSize: 11, color: "hsl(var(--muted-foreground))" }}>Member names unavailable here</div>
            )
          ) : names.length === 0 ? (
            <div style={{ fontSize: 11, color: "hsl(var(--muted-foreground))" }}>No members yet</div>
          ) : (
            <div style={{ maxHeight: 190, overflow: "hidden" }}>
              {shown.map(n => (
                <div key={n} style={{ fontSize: 11.5, color: "hsl(var(--foreground))", padding: "1.5px 0", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                  {n}
                </div>
              ))}
              {extra > 0 && (
                <div style={{ fontSize: 11, color: "hsl(var(--muted-foreground))", paddingTop: 2 }}>+{extra} more</div>
              )}
            </div>
          )}
        </div>,
        document.body,
      )}
    </span>
  );
}
