import { X, PencilLine, Upload, ChevronRight } from "lucide-react";
import { Z } from "@/lib/zLayers";

const C = {
  bg: "#FFFFFF",
  border: "#D8E0E7",
  borderSoft: "#E8EDF2",
  green: "#6BA539",
  text: "#253746",
  muted: "#6B7E8A",
};

interface Props {
  open: boolean;
  /** e.g. "Project", "Opportunity", "Staff Member" */
  entityLabel: string;
  onManual: () => void;
  onBulk: () => void;
  onClose: () => void;
}

/**
 * Asks the user how they want to add records: one at a time (manual) or many at
 * once from a filled-in template (bulk upload). Shown when the user clicks a
 * "New …" / "Add …" button.
 */
export default function CreateChoiceModal({ open, entityLabel, onManual, onBulk, onClose }: Props) {
  if (!open) return null;

  const Choice = ({
    icon, title, desc, onClick,
  }: { icon: React.ReactNode; title: string; desc: string; onClick: () => void }) => (
    <button
      onClick={onClick}
      style={{
        display: "flex", alignItems: "center", gap: 14, width: "100%", textAlign: "left",
        padding: "16px 16px", borderRadius: 12, border: `1px solid ${C.border}`,
        background: "#FFFFFF", cursor: "pointer",
      }}
      onMouseEnter={(e) => { e.currentTarget.style.borderColor = C.green; e.currentTarget.style.background = C.green + "0A"; }}
      onMouseLeave={(e) => { e.currentTarget.style.borderColor = C.border; e.currentTarget.style.background = "#FFFFFF"; }}
    >
      <div style={{
        width: 40, height: 40, borderRadius: 10, flexShrink: 0, background: C.green + "1A",
        display: "flex", alignItems: "center", justifyContent: "center", color: C.green,
      }}>
        {icon}
      </div>
      <div style={{ flex: 1 }}>
        <div style={{ fontSize: 14.5, fontWeight: 800, color: C.text }}>{title}</div>
        <div style={{ fontSize: 12.5, color: C.muted, marginTop: 2, lineHeight: 1.45 }}>{desc}</div>
      </div>
      <ChevronRight size={18} color={C.muted} />
    </button>
  );

  return (
    <div
      onClick={onClose}
      style={{
        position: "fixed", inset: 0, background: "rgba(15,30,42,0.55)", zIndex: Z.MODAL,
        display: "flex", alignItems: "flex-start", justifyContent: "center", padding: "10vh 16px",
        overflowY: "auto",
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          width: "100%", maxWidth: 440, background: C.bg, borderRadius: 16,
          boxShadow: "0 24px 60px rgba(0,0,0,0.35)", overflow: "hidden",
        }}
      >
        <div style={{
          display: "flex", alignItems: "center", gap: 10, padding: "16px 18px",
          borderBottom: `1px solid ${C.borderSoft}`,
        }}>
          <div style={{ flex: 1 }}>
            <div style={{ fontSize: 15, fontWeight: 800, color: C.text }}>Add {entityLabel}</div>
            <div style={{ fontSize: 11.5, color: C.muted }}>Choose how you'd like to add</div>
          </div>
          <button onClick={onClose} style={{ background: "none", border: "none", cursor: "pointer", color: C.muted }}>
            <X size={20} />
          </button>
        </div>

        <div style={{ padding: "16px 18px", display: "flex", flexDirection: "column", gap: 12 }}>
          <Choice
            icon={<PencilLine size={20} />}
            title="Manual entry"
            desc={`Fill out a form to add one ${entityLabel.toLowerCase()} at a time.`}
            onClick={onManual}
          />
          <Choice
            icon={<Upload size={20} />}
            title="Bulk upload"
            desc="Download a template, fill it in, and upload to add many at once."
            onClick={onBulk}
          />
        </div>
      </div>
    </div>
  );
}
