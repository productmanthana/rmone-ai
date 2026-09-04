import { useEffect, useRef, useState } from "react";
import { X, Loader2, Calendar } from "lucide-react";
import { smartUpdate, bustCache } from "@/lib/api";
import DateField from "@/components/DateField";
import { Z } from "@/lib/zLayers";

const C = {
  bg: "#FFFFFF",
  bgDeep: "#FFFFFF",
  card: "#F5F8FA",
  border: "#D5DEE5",
  borderSoft: "#E8EDF2",
  green: "#6BA539",
  orange: "#E87722",
  red: "#DC2626",
  text: "#253746",
  muted: "#6B7E8A",
  surface: "#F5F8FA",
};

export interface OppScheduleTarget {
  id: string;
  name: string;
  rawBidDate: string;
  rawActualStart?: string;
  rawActualEnd?: string;
}

export interface OppScheduleResult {
  bidDate: string;
  actualStart: string;
  actualEnd: string;
  rawBidDate: string;
  rawActualStart: string;
  rawActualEnd: string;
}

function fmtShort(d: string): string {
  if (!d || d.startsWith("0001")) return "—";
  const dt = new Date(d);
  if (isNaN(dt.getTime())) return "—";
  return dt.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}

function toInputValue(iso: string): string {
  if (!iso || iso.startsWith("0001")) return "";
  return iso.slice(0, 10);
}

export function EditOppScheduleModal({
  opp, onClose, onSaved,
}: {
  opp: OppScheduleTarget | null;
  onClose: () => void;
  onSaved: (o: OppScheduleTarget, result: OppScheduleResult) => void;
}) {
  const [bd, setBd] = useState("");
  const [as_, setAs] = useState("");
  const [ae, setAe] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const closeRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (opp) {
      setBd(toInputValue(opp.rawBidDate));
      setAs(toInputValue(opp.rawActualStart ?? ""));
      setAe(toInputValue(opp.rawActualEnd ?? ""));
      setError(null);
      setSaving(false);
      setTimeout(() => closeRef.current?.focus(), 50);
    }
  }, [opp]);

  useEffect(() => {
    if (!opp) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !saving) onClose();
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [opp, saving, onClose]);

  async function doSave() {
    if (!opp || saving) return;
    setSaving(true);
    setError(null);
    try {
      const fields: { FieldName: string; Value: string; IsExcluded: boolean }[] = [];
      if (bd) fields.push({ FieldName: "BidDueDate", Value: `${bd}T00:00:00`, IsExcluded: false });
      if (as_) fields.push({ FieldName: "ActualStartDate", Value: `${as_}T00:00:00`, IsExcluded: false });
      if (ae) fields.push({ FieldName: "ActualCompletionDate", Value: `${ae}T00:00:00`, IsExcluded: false });
      if (fields.length === 0) {
        setError("No dates to update");
        setSaving(false);
        return;
      }
      await smartUpdate(opp.id, fields);
      onSaved(opp, {
        bidDate: bd ? fmtShort(bd) : (opp.rawBidDate ? fmtShort(opp.rawBidDate) : ""),
        actualStart: as_ ? fmtShort(as_) : (opp.rawActualStart ? fmtShort(opp.rawActualStart) : ""),
        actualEnd: ae ? fmtShort(ae) : (opp.rawActualEnd ? fmtShort(opp.rawActualEnd) : ""),
        rawBidDate: bd || opp.rawBidDate,
        rawActualStart: as_ || opp.rawActualStart || "",
        rawActualEnd: ae || opp.rawActualEnd || "",
      });
      bustCache();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setSaving(false);
    }
  }

  if (!opp) return null;

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Edit opportunity schedule"
      onClick={() => { if (!saving) onClose(); }}
      style={{
        position: "fixed", inset: 0, zIndex: Z.MODAL,
        background: "rgba(0,0,0,0.55)",
        display: "flex", alignItems: "center", justifyContent: "center",
        padding: 16,
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          background: C.bg, border: `1px solid ${C.border}`,
          borderRadius: 16, width: "100%", maxWidth: 460,
          maxHeight: "90vh", display: "flex", flexDirection: "column",
          color: C.text,
        }}
      >
        {/* Header */}
        <div style={{
          display: "flex", alignItems: "center", justifyContent: "space-between",
          padding: "16px 20px", borderBottom: `1px solid ${C.borderSoft}`,
        }}>
          <div style={{ display: "flex", alignItems: "center", gap: 10, minWidth: 0 }}>
            <div style={{
              width: 32, height: 32, borderRadius: 8,
              background: C.orange + "30", display: "flex",
              alignItems: "center", justifyContent: "center",
            }}>
              <Calendar size={16} color={C.orange} />
            </div>
            <div style={{ minWidth: 0 }}>
              <div style={{ fontWeight: 700, fontSize: 15 }}>Opportunity Schedule</div>
              <div style={{
                fontSize: 11, color: C.muted, marginTop: 1,
                whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis",
                maxWidth: 320,
              }}>{opp.name}</div>
            </div>
          </div>
          <button
            ref={closeRef}
            onClick={onClose}
            disabled={saving}
            aria-label="Close"
            style={{
              background: "transparent", border: "none", cursor: saving ? "default" : "pointer",
              color: C.muted, padding: 4, display: "flex", alignItems: "center",
            }}
          >
            <X size={18} />
          </button>
        </div>

        {/* Body */}
        <div style={{
          padding: "16px 20px", overflowY: "auto", flex: 1, minHeight: 0,
        }}>
          <div style={{ fontSize: 11, color: C.muted, marginBottom: 14 }}>
            {opp.id}
          </div>

          {/* Bid Due Date */}
          <div style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 6, marginBottom: 6 }}>
            <span style={{ width: 10, height: 10, borderRadius: 5, background: C.text }} />
            <span style={{ fontSize: 13, fontWeight: 700 }}>Bid Due Date</span>
          </div>
          <div style={{ display: "flex", gap: 10, marginBottom: 14 }}>
            <DateInput label="Date" value={bd} onChange={setBd} disabled={saving} />
            <div style={{ flex: 1 }} />
          </div>

          {/* Schedule (formerly "Actual") */}
          <div style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 6, marginBottom: 6 }}>
            <span style={{ width: 10, height: 10, borderRadius: 5, background: C.orange }} />
            <span style={{ fontSize: 13, fontWeight: 700 }}>Schedule</span>
          </div>
          <div style={{ display: "flex", gap: 10, marginBottom: 14 }}>
            <DateInput label="Start" value={as_} onChange={setAs} disabled={saving} />
            <DateInput label="Completion" value={ae} onChange={setAe} disabled={saving} />
          </div>

          {error && (
            <div style={{
              background: C.red + "22", border: `1px solid ${C.red}55`,
              borderRadius: 8, padding: "8px 10px", marginTop: 8,
              fontSize: 12, color: C.red,
            }}>{error}</div>
          )}
        </div>

        {/* Footer */}
        <div style={{
          padding: "12px 20px", borderTop: `1px solid ${C.borderSoft}`,
          display: "flex", gap: 10,
        }}>
          <button
            onClick={onClose}
            disabled={saving}
            style={{
              flex: 1, padding: "10px 14px", borderRadius: 10,
              background: C.surface, border: `1px solid ${C.borderSoft}`,
              color: C.text, fontSize: 13, fontWeight: 600,
              cursor: saving ? "default" : "pointer",
            }}
          >Cancel</button>
          <button
            onClick={doSave}
            disabled={saving}
            style={{
              flex: 1, padding: "10px 14px", borderRadius: 10,
              background: C.green, border: "none",
              color: "#FFFFFF", fontSize: 13, fontWeight: 700,
              cursor: saving ? "default" : "pointer",
              display: "flex", alignItems: "center", justifyContent: "center", gap: 6,
              opacity: saving ? 0.6 : 1,
            }}
          >
            {saving ? <Loader2 size={14} className="animate-spin" /> : null}
            {saving ? "Saving…" : "Save Changes"}
          </button>
        </div>
      </div>
    </div>
  );
}

function DateInput({
  label, value, onChange, disabled,
}: {
  label: string; value: string; onChange: (v: string) => void; disabled: boolean;
}) {
  return (
    <div style={{ flex: 1 }}>
      <div style={{ fontSize: 11, color: C.muted, marginBottom: 4 }}>{label}</div>
      <DateField
        value={value}
        onChange={onChange}
        disabled={disabled}
        style={{
          padding: "10px 12px", borderRadius: 8,
          background: C.surface, border: `1px solid ${C.border}`,
          color: C.text, fontSize: 13,
        }}
      />
    </div>
  );
}
