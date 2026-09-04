/**
 * AllocFormCard — light-theme web port of the mobile AllocationFormCard
 * (artifacts/rmone-mobile/app/(tabs)/chat.tsx ~line 719).
 *
 * Lightweight single-allocation form (Pct %, Start, End). On submit it sends
 * a chat message like "100% from 2025-01-01 to 2025-06-01" — no direct API
 * call. The chat backend then resolves it to an assignResource flow.
 */
import React from "react";
import { Send, AlertCircle } from "lucide-react";
import DateField from "@/components/DateField";

const C = {
  green: "#6BA539",
  text: "var(--rm-text)",
  textMuted: "var(--rm-text-muted)",
  border: "var(--rm-panel-border)",
  bg: "var(--rm-panel)",
  bgSoft: "var(--rm-panel-soft)",
  red: "#E03C3C",
  redSoft: "#FDECEC",
};

interface Props {
  personName: string;
  projectId: string;
  projectName: string;
  onSubmit: (msg: string) => void;
}

export function AllocFormCard({ personName, projectId, projectName, onSubmit }: Props) {
  const [pct, setPct] = React.useState("100");
  const [startDate, setStartDate] = React.useState("");
  const [endDate, setEndDate] = React.useState("");
  const [errors, setErrors] = React.useState<{ pct?: boolean; start?: boolean; end?: boolean }>({});
  const [errorMsg, setErrorMsg] = React.useState("");

  const handleSubmit = () => {
    const newErrors: typeof errors = {};
    if (!pct.trim()) newErrors.pct = true;
    if (!startDate.trim()) newErrors.start = true;
    if (!endDate.trim()) newErrors.end = true;
    if (Object.keys(newErrors).length > 0) {
      setErrors(newErrors);
      const missing: string[] = [];
      if (newErrors.pct) missing.push("allocation %");
      if (newErrors.start) missing.push("start date");
      if (newErrors.end) missing.push("end date");
      setErrorMsg(`Please enter ${missing.join(" and ")} before submitting.`);
      return;
    }
    setErrors({});
    setErrorMsg("");
    const p = parseInt(pct) || 100;
    onSubmit(`${p}% from ${startDate.trim()} to ${endDate.trim()}`);
  };

  const inputStyle = (hasError?: boolean): React.CSSProperties => ({
    background: C.bg,
    border: `1.5px solid ${hasError ? C.red : C.border}`,
    borderRadius: 8,
    color: C.text,
    fontWeight: 600,
    fontSize: 14,
    padding: "10px 12px",
    textAlign: "center",
    width: "100%",
    boxSizing: "border-box",
    outline: "none",
  });

  return (
    <div style={{
      margin: "10px 0", borderRadius: 12, overflow: "hidden",
      border: `1px solid ${C.green}40`, background: C.bg,
    }}>
      <div style={{ background: C.bgSoft, padding: "12px 14px" }}>
        <div style={{ color: C.textMuted, fontSize: 11, textTransform: "uppercase", letterSpacing: 0.5, fontWeight: 500 }}>
          Assign Resource
        </div>
        <div style={{ color: C.text, fontWeight: 700, fontSize: 15, marginTop: 4 }}>{personName}</div>
        <div style={{ color: C.text, fontWeight: 600, fontSize: 13, marginTop: 2 }}>
          {projectId} — {projectName}
        </div>
      </div>

      <div style={{ padding: 14, display: "flex", flexDirection: "column", gap: 12 }}>
        <div>
          <label style={{ color: C.textMuted, fontWeight: 600, fontSize: 11, marginBottom: 6, display: "block", textTransform: "uppercase", letterSpacing: 0.5 }}>
            Allocation %
          </label>
          <input
            type="number"
            value={pct}
            onChange={(e) => { setPct(e.target.value); if (errors.pct) { setErrors(p => ({ ...p, pct: false })); setErrorMsg(""); } }}
            placeholder="e.g. 100"
            style={inputStyle(errors.pct)}
          />
        </div>

        <div style={{ display: "flex", gap: 10 }}>
          <div style={{ flex: 1 }}>
            <label style={{ color: C.textMuted, fontWeight: 600, fontSize: 11, marginBottom: 6, display: "block", textTransform: "uppercase", letterSpacing: 0.5 }}>
              Start Date *
            </label>
            <DateField
              value={startDate}
              onChange={(v) => { setStartDate(v); if (errors.start) { setErrors(p => ({ ...p, start: false })); setErrorMsg(""); } }}
              style={inputStyle(errors.start)}
            />
          </div>
          <div style={{ flex: 1 }}>
            <label style={{ color: C.textMuted, fontWeight: 600, fontSize: 11, marginBottom: 6, display: "block", textTransform: "uppercase", letterSpacing: 0.5 }}>
              End Date *
            </label>
            <DateField
              value={endDate}
              onChange={(v) => { setEndDate(v); if (errors.end) { setErrors(p => ({ ...p, end: false })); setErrorMsg(""); } }}
              style={inputStyle(errors.end)}
            />
          </div>
        </div>

        {errorMsg ? (
          <div style={{
            background: C.redSoft, border: `1px solid ${C.red}`, borderRadius: 8,
            padding: "8px 12px", display: "flex", gap: 8, alignItems: "center",
          }}>
            <AlertCircle size={14} color={C.red} />
            <span style={{ color: C.red, fontWeight: 600, fontSize: 12 }}>{errorMsg}</span>
          </div>
        ) : null}

        <button
          onClick={handleSubmit}
          style={{
            background: C.green, color: "#fff", border: "none", borderRadius: 8,
            padding: "12px", fontWeight: 700, fontSize: 14, cursor: "pointer",
            display: "flex", justifyContent: "center", alignItems: "center", gap: 8,
          }}
        >
          <Send size={14} /> Submit Allocation
        </button>
      </div>
    </div>
  );
}
