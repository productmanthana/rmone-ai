// BuMismatchPopup — blocking confirmation shown by the add-member flows
// (AddTeamMemberModal + InlineAddMemberRow) when the picked person's home
// Business Unit is NOT one of the project's assigned BUs. "Add to Project"
// appends the person's BU to the project record first (hook action), then the
// assignment continues with the org auto-filled; "Cancel" abandons the pick.
// All decision logic lives in useAssignMemberCascade — this is presentation
// only. Portaled to <body> above BOTH hosts (modal overlay 1100, inline-row
// picker 9200).
import { createPortal } from "react-dom";
import { Building2, Loader2, Plus, X } from "lucide-react";
import { Z } from "@/lib/zLayers";

/** Extract a plain sentence from a raw server error string.
 *  Handles the "403: {…json…}" shape returned by updateFields, stripping
 *  the status prefix and escaped quotes so the user sees a clean message. */
function parseErrorMessage(raw: string): string {
  if (!raw) return raw;
  // Strip leading "NNN: " status prefix if present
  const body = raw.replace(/^\d{3}:\s*/, "").trim();
  try {
    const obj = JSON.parse(body) as Record<string, unknown>;
    // Prefer error_description → error → Message (all may contain the text)
    const msg = String(obj.error_description ?? obj.error ?? obj.Message ?? "").trim();
    if (msg) {
      // Remove surrounding escaped quotes added by some serialisers
      return msg.replace(/^"(.*)"$/, "$1").replace(/\\"/g, '"');
    }
  } catch { /* not JSON — fall through */ }
  return raw;
}

const C = {
  border: "#D5DEE5",
  green: "#6BA539",
  orange: "#E87722",
  text: "#253746",
  muted: "#6B7E8A",
};

export function BuMismatchPopup({
  personName, buLabel, projectBuLabels, adding, error, onAdd, onCancel,
}: {
  personName: string;
  /** The person's home BU/Division label (the one missing from the project). */
  buLabel: string;
  /** The project's current BU labels — shown for context. */
  projectBuLabels: string[];
  adding: boolean;
  error?: string;
  onAdd: () => void;
  onCancel: () => void;
}) {
  if (typeof document === "undefined") return null;
  return createPortal(
    <div
      onClick={adding ? undefined : onCancel}
      style={{
        position: "fixed", inset: 0, zIndex: Z.DRAWER_ALERT,
        backgroundColor: "rgba(0,0,0,0.6)",
        display: "flex", alignItems: "center", justifyContent: "center",
        padding: 20,
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="bu-mismatch-title"
        style={{
          backgroundColor: "#FFFFFF", color: C.text,
          borderRadius: 14, width: "min(440px, 100%)",
          boxShadow: "0 20px 60px rgba(0,0,0,0.45)",
          display: "flex", flexDirection: "column", overflow: "hidden",
        }}
      >
        <div style={{
          display: "flex", alignItems: "center", gap: 10,
          padding: "14px 16px", borderBottom: `1px solid ${C.border}`,
        }}>
          <Building2 size={18} color={C.orange} />
          <div id="bu-mismatch-title" style={{ flex: 1, fontWeight: 700, fontSize: 14 }}>
            Different Business Unit
          </div>
          <button onClick={onCancel} disabled={adding} aria-label="Close"
            style={{ background: "transparent", border: "none", cursor: adding ? "default" : "pointer", padding: 4, color: C.muted }}>
            <X size={18} />
          </button>
        </div>

        <div style={{ padding: 16, fontSize: 13, lineHeight: 1.55 }}>
          <div>
            <b>{personName}</b> belongs to <b>{buLabel}</b>, which is not one of
            this project's Business Units
            {projectBuLabels.length > 0 ? <> ({projectBuLabels.join(", ")})</> : null}.
          </div>
          <div style={{ marginTop: 8, color: C.muted, fontSize: 12 }}>
            Click <b style={{ color: C.text }}>Add to Project</b> to add {buLabel} to
            the project first — then you can continue adding {personName}.
          </div>
          {error ? (
            <div style={{
              marginTop: 10, padding: 10, borderRadius: 8,
              backgroundColor: "#F8717120", border: "1px solid #F8717160",
              color: "#DC2626", fontSize: 11.5, lineHeight: 1.5,
            }}>{parseErrorMessage(error)}</div>
          ) : null}
        </div>

        <div style={{
          display: "flex", gap: 10, padding: "0 16px 16px", justifyContent: "flex-end",
        }}>
          <button onClick={onCancel} disabled={adding} style={{
            background: "transparent", border: `1px solid ${C.border}`,
            borderRadius: 9, padding: "9px 16px", cursor: adding ? "default" : "pointer",
            fontSize: 13, fontWeight: 600, color: C.muted,
          }}>Cancel</button>
          <button onClick={onAdd} disabled={adding} style={{
            backgroundColor: C.green, border: "none",
            borderRadius: 9, padding: "9px 16px",
            cursor: adding ? "wait" : "pointer",
            fontSize: 13, fontWeight: 700, color: "#FFFFFF",
            display: "flex", alignItems: "center", gap: 6,
            opacity: adding ? 0.85 : 1,
          }}>
            {adding ? <Loader2 size={14} className="animate-spin" /> : <Plus size={14} />}
            {adding ? "Adding…" : "Add to Project"}
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
