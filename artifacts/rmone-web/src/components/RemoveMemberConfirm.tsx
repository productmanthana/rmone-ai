// RemoveMemberConfirm — the ONE confirmation popup for removing a team member
// or an open (unfilled) position from a project / opportunity / lead.
// Used by TeamScheduleGrid (Team View rows), TeamGantt (member popup) and
// SimpleTeamTable (no-grid modes) — never fork the copy: the audit sentence
// below is a client mandate (the server logs the actor's login and a UTC
// timestamp on every removal, and the popup must SAY so before the user acts).
// Portalled to <body> with a very high z-index so it beats every opener —
// including the TeamGantt member popup (z 300) and the grid's own portals.
import { createPortal } from "react-dom";
import { X, Trash2, ShieldAlert } from "lucide-react";
import { useAuth } from "@/lib/useAuth";
import { Z } from "@/lib/zLayers";

const PANEL = "var(--rm-panel)";
const BORDER = "var(--rm-panel-border)";
const TEXT = "var(--rm-text)";
const MUTED = "var(--rm-text-muted)";
const SOFT = "var(--rm-panel-soft)";
const RED = "#F87171";

export type RemoveTarget =
  | { kind: "member"; name: string; role?: string }
  | { kind: "open"; role: string; title?: string };

export function RemoveMemberConfirm({ target, module, busy = false, onConfirm, onCancel }: {
  target: RemoveTarget;
  /** Record module ("PMM" | "OPM" | "LEM") — only drives the wording. */
  module?: string;
  busy?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  const { user } = useAuth();
  const login = (user?.username || "").trim();
  const recWord = module === "OPM" ? "opportunity" : module === "LEM" ? "lead" : "project";
  const first = target.kind === "member" ? (target.name.trim().split(/\s+/)[0] || target.name) : "";
  const title = target.kind === "member"
    ? `Remove ${first} from this ${recWord}?`
    : "Remove this open position?";
  const body = target.kind === "member"
    ? `${target.name}'s assignment${target.role ? ` (${target.role})` : ""} and all of their planned weekly hours are removed from this ${recWord}. Their staff profile and their other assignments are not affected.`
    : `The unfilled “${target.role || target.title || "position"}” slot and its planned demand hours are removed from this ${recWord}. Nobody is assigned to it, so no person is affected.`;
  return createPortal(
    <>
      <div
        style={{ position: "fixed", inset: 0, zIndex: Z.POPUP_CHILD, background: "rgba(0,0,0,0.45)" }}
        onClick={busy ? undefined : onCancel}
      />
      <div role="dialog" aria-modal="true" aria-label={title} style={{
        position: "fixed", top: "50%", left: "50%", transform: "translate(-50%,-50%)",
        zIndex: Z.POPUP_CHILD_2, background: PANEL, border: `1px solid ${BORDER}`,
        borderRadius: 12, boxShadow: "0 12px 32px rgba(0,0,0,0.45)",
        width: 380, maxWidth: "calc(100vw - 32px)", padding: "18px 20px 16px",
      }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 8 }}>
          <span style={{
            width: 30, height: 30, borderRadius: 8, flexShrink: 0,
            background: "rgba(248,113,113,0.16)", border: "1px solid rgba(248,113,113,0.55)",
            display: "inline-flex", alignItems: "center", justifyContent: "center",
          }}>
            <Trash2 size={14} color={RED} />
          </span>
          <div style={{ fontSize: 13, fontWeight: 700, color: TEXT, flex: 1 }}>{title}</div>
          <button onClick={onCancel} disabled={busy} aria-label="Close"
            style={{ background: "transparent", border: "none", cursor: busy ? "default" : "pointer", padding: 2, display: "inline-flex" }}>
            <X size={15} color={MUTED} />
          </button>
        </div>
        <div style={{ fontSize: 11, color: MUTED, lineHeight: 1.55, marginBottom: 10 }}>{body}</div>
        {/* Audit notice — client mandate: the popup must state that the actor's
            login and the removal time are logged. The server writes both. */}
        <div style={{
          display: "flex", gap: 8, alignItems: "flex-start",
          background: "rgba(245,158,11,0.09)", border: "1px solid rgba(245,158,11,0.35)",
          borderRadius: 8, padding: "8px 10px", marginBottom: 14,
        }}>
          <ShieldAlert size={13} color="#F59E0B" style={{ flexShrink: 0, marginTop: 1 }} />
          <div style={{ fontSize: 10.5, color: MUTED, lineHeight: 1.5 }}>
            For accountability, this removal is recorded: your login
            {login ? <> <b style={{ color: TEXT }}>“{login}”</b></> : null} and the exact date &amp; time
            are written to the system log.
          </div>
        </div>
        <div style={{ display: "flex", justifyContent: "flex-end", gap: 8 }}>
          <button onClick={onCancel} disabled={busy}
            style={{ background: SOFT, border: `1px solid ${BORDER}`, color: TEXT, padding: "6px 12px", borderRadius: 8, fontSize: 11, fontWeight: 600, cursor: busy ? "default" : "pointer" }}>
            Cancel
          </button>
          <button onClick={onConfirm} disabled={busy}
            style={{ background: RED, border: "none", color: "#0B1220", padding: "6px 14px", borderRadius: 8, fontSize: 11, fontWeight: 700, cursor: busy ? "default" : "pointer", opacity: busy ? 0.7 : 1 }}>
            {busy ? "Removing…" : target.kind === "member" ? "Remove member" : "Remove position"}
          </button>
        </div>
      </div>
    </>,
    document.body,
  );
}
