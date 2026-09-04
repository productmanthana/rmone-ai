// Shown between upload and run: lists file problems found by the server-side
// preflight (POST /api/onboarding/preflight) so the user can fix the file
// BEFORE the import writes anything. Errors = values the database will reject;
// warnings = values that import in a surprising way (e.g. hours with no end
// date all land in the start week). Uses fixed colors (not theme vars) so the
// dialog reads correctly on both the light Import page and the dark Pipeline page.
export interface PreflightIssue {
  kind: string;
  severity: "error" | "warning";
  table?: string;
  column?: string;
  message: string;
  count: number;
  samples: string[];
  /** Excel row numbers of the offending rows (schedule_id issues). */
  rows?: number[];
}

export default function PreflightIssuesDialog({
  issues, busy, onCancel, onContinue,
}: {
  issues: PreflightIssue[];
  busy?: boolean;
  onCancel: () => void;
  onContinue: () => void;
}) {
  const errors   = issues.filter(i => i.severity === "error");
  const warnings = issues.filter(i => i.severity === "warning");

  const section = (title: string, list: PreflightIssue[], color: string, bg: string, border: string) =>
    list.length > 0 && (
      <div style={{ marginBottom: 14 }}>
        <div style={{ fontSize: 11, fontWeight: 700, color, textTransform: "uppercase", letterSpacing: 0.5, marginBottom: 6 }}>
          {title}
        </div>
        {list.map((iss, i) => (
          <div key={i} style={{
            padding: "9px 12px", marginBottom: 6, borderRadius: 8,
            background: bg, border: `1px solid ${border}`,
            fontSize: 12.5, color: "#333", lineHeight: 1.55,
          }}>
            {iss.message}
            {/* Schedule ID issues carry per-row detail — show the first few
                rows verbatim so the user can find the exact cells to fix. */}
            {iss.kind === "schedule_id" && iss.samples.length > 0 && (
              <ul style={{ margin: "6px 0 0", paddingLeft: 18, color: "#5b6b7c", fontSize: 12 }}>
                {iss.samples.map((s, j) => <li key={j} style={{ marginBottom: 2 }}>{s}</li>)}
              </ul>
            )}
          </div>
        ))}
      </div>
    );

  return (
    <div style={{ position: "fixed", inset: 0, zIndex: 80, background: "rgba(0,0,0,0.5)", display: "flex", alignItems: "center", justifyContent: "center" }}>
      <div onClick={e => e.stopPropagation()} style={{
        background: "#fff", borderRadius: 12, padding: 28, maxWidth: 580, width: "92%",
        maxHeight: "82vh", overflowY: "auto", boxShadow: "0 12px 40px rgba(0,0,0,0.35)",
      }}>
        <div style={{ fontSize: 16, fontWeight: 700, color: "#1d2733", marginBottom: 6 }}>
          {errors.length > 0 ? "Your file has problems that will block some data" : "Check your file before importing"}
        </div>
        <div style={{ fontSize: 12.5, color: "#5b6b7c", marginBottom: 16, lineHeight: 1.6 }}>
          Nothing has been imported yet. You can cancel, fix the file and upload it
          again — or continue anyway, in which case the rows below may not save the
          way you expect.
        </div>

        {section(`Errors — these values cannot be saved (${errors.length})`, errors, "#c0392b", "#fff2f0", "#f2c5c0")}
        {section(`Warnings — will import, but check these (${warnings.length})`, warnings, "#b0731c", "#fff9ec", "#efd9ae")}

        <div style={{ display: "flex", gap: 10, justifyContent: "flex-end", marginTop: 18 }}>
          <button
            onClick={onCancel}
            disabled={busy}
            style={{
              padding: "8px 18px", fontSize: 12.5, fontWeight: 700, borderRadius: 7,
              background: "#eef1f4", color: "#37424e", border: "1px solid #d5dbe1",
              cursor: busy ? "default" : "pointer",
            }}
          >
            Cancel — I'll fix the file
          </button>
          <button
            onClick={onContinue}
            disabled={busy}
            style={{
              padding: "8px 18px", fontSize: 12.5, fontWeight: 700, borderRadius: 7,
              background: errors.length > 0 ? "#c0392b" : "#e8a33d", color: "#fff", border: "none",
              cursor: busy ? "default" : "pointer", opacity: busy ? 0.7 : 1,
            }}
          >
            {busy ? "Starting…" : "Import anyway"}
          </button>
        </div>
      </div>
    </div>
  );
}
