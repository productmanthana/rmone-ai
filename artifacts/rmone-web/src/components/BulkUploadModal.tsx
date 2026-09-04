import { useMemo, useRef, useState } from "react";
import { X, Download, Upload, FileText, Loader2, Check, AlertCircle, CheckCircle2 } from "lucide-react";
import {
  BULK_SPECS, downloadTemplate, parseFile, runBulkCreate, countRows,
  type BulkEntity, type ParsedTemplate, type RowResult,
} from "@/lib/bulkCreate";
import { Z } from "@/lib/zLayers";

const EMPTY_PARSED: ParsedTemplate = { primary: [], team: [], schedule: [] };

const C = {
  bg: "#FFFFFF",
  border: "#D8E0E7",
  borderSoft: "#E8EDF2",
  green: "#6BA539",
  greenDark: "#5B8F30",
  orange: "#E87722",
  red: "#C0392B",
  text: "#253746",
  muted: "#6B7E8A",
  soft: "#F4F7F9",
};

interface Props {
  open: boolean;
  entity: BulkEntity;
  onClose: () => void;
  /** Called after a run that created at least one record, so the page can refresh. */
  onCreated?: () => void;
}

export default function BulkUploadModal({ open, entity, onClose, onCreated }: Props) {
  const spec = BULK_SPECS[entity];
  const fileRef = useRef<HTMLInputElement>(null);

  const [fileName, setFileName] = useState("");
  const [parsed, setParsed] = useState<ParsedTemplate>(EMPTY_PARSED);
  const [parseError, setParseError] = useState<string | null>(null);
  const [running, setRunning] = useState(false);
  const [building, setBuilding] = useState(false);
  const [parsing, setParsing] = useState(false);
  const [progress, setProgress] = useState({ done: 0, total: 0 });
  const [results, setResults] = useState<RowResult[] | null>(null);

  const totalRows = countRows(parsed);
  const primaryCount = parsed.primary.length;
  const childParts: string[] = [];
  if (parsed.team.length) childParts.push(`${parsed.team.length} team ${parsed.team.length === 1 ? "member" : "members"}`);
  if (parsed.schedule.length) childParts.push(`${parsed.schedule.length} schedule ${parsed.schedule.length === 1 ? "row" : "rows"}`);
  const singular = spec.label.toLowerCase().replace(/s$/, "");
  const primaryLabel = `${primaryCount} ${primaryCount === 1 ? singular : spec.label.toLowerCase()}`;

  const reset = () => {
    setFileName(""); setParsed(EMPTY_PARSED); setParseError(null);
    setRunning(false); setProgress({ done: 0, total: 0 }); setResults(null);
    if (fileRef.current) fileRef.current.value = "";
  };

  const close = () => { if (!running) { reset(); onClose(); } };

  async function downloadTpl() {
    if (building) return;
    setBuilding(true); setParseError(null);
    try {
      await downloadTemplate(spec);
    } catch {
      setParseError("Couldn't build the Excel template (the live option lists wouldn't load). Please try again.");
    } finally {
      setBuilding(false);
    }
  }

  async function onFile(file: File) {
    setParseError(null); setResults(null);
    setFileName(file.name);
    setParsing(true);
    try {
      const p = await parseFile(file, spec);
      if (countRows(p) === 0) {
        setParsed(EMPTY_PARSED);
        setParseError("No data rows found. Fill in the template under the header row and try again.");
        return;
      }
      setParsed(p);
    } catch {
      setParsed(EMPTY_PARSED);
      setParseError("Couldn't read that file. Please upload the Excel (.xlsx) template or a CSV with the same columns.");
    } finally {
      setParsing(false);
    }
  }

  async function run() {
    if (!totalRows || running) return;
    setRunning(true);
    setProgress({ done: 0, total: totalRows });
    try {
      const res = await runBulkCreate(entity, parsed, (p) => setProgress(p));
      setResults(res);
      if (res.some((r) => r.ok)) onCreated?.();
    } catch (e) {
      setParseError((e as Error)?.message || "Bulk upload failed.");
    } finally {
      setRunning(false);
    }
  }

  const summary = useMemo(() => {
    if (!results) return null;
    const ok = results.filter((r) => r.ok).length;
    return { ok, fail: results.length - ok };
  }, [results]);

  if (!open) return null;

  return (
    <div
      onClick={close}
      style={{
        position: "fixed", inset: 0, background: "rgba(15,30,42,0.55)", zIndex: Z.MODAL,
        display: "flex", alignItems: "flex-start", justifyContent: "center", padding: "6vh 16px",
        overflowY: "auto",
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          width: "100%", maxWidth: 560, background: C.bg, borderRadius: 16,
          boxShadow: "0 24px 60px rgba(0,0,0,0.35)", overflow: "hidden",
        }}
      >
        {/* Header */}
        <div style={{
          display: "flex", alignItems: "center", gap: 10, padding: "16px 18px",
          borderBottom: `1px solid ${C.borderSoft}`,
        }}>
          <div style={{
            width: 34, height: 34, borderRadius: 9, background: C.green + "1A",
            display: "flex", alignItems: "center", justifyContent: "center",
          }}>
            <Upload size={18} color={C.green} />
          </div>
          <div style={{ flex: 1 }}>
            <div style={{ fontSize: 15, fontWeight: 800, color: C.text }}>Bulk upload {spec.label.toLowerCase()}</div>
            <div style={{ fontSize: 11.5, color: C.muted }}>Add many {spec.label.toLowerCase()} at once from a template</div>
          </div>
          <button onClick={close} disabled={running} style={{ background: "none", border: "none", cursor: running ? "default" : "pointer", color: C.muted, opacity: running ? 0.5 : 1 }}>
            <X size={20} />
          </button>
        </div>

        <div style={{ padding: "18px 18px 20px" }}>
          {results ? (
            // ── Results view ──
            <div>
              <div style={{
                display: "flex", alignItems: "center", gap: 10, marginBottom: 14,
                padding: "12px 14px", borderRadius: 10,
                background: (summary?.fail ?? 0) > 0 ? C.orange + "12" : C.green + "12",
                border: `1px solid ${(summary?.fail ?? 0) > 0 ? C.orange + "44" : C.green + "44"}`,
              }}>
                <CheckCircle2 size={20} color={C.green} />
                <div style={{ fontSize: 13.5, color: C.text, fontWeight: 700 }}>
                  {summary?.ok ?? 0} created{(summary?.fail ?? 0) > 0 ? `, ${summary?.fail} skipped` : ""}
                </div>
              </div>
              <div style={{ maxHeight: 320, overflowY: "auto", display: "flex", flexDirection: "column", gap: 6 }}>
                {results.map((r, i) => (
                  <div key={`${r.section ?? ""}-${r.line}-${i}`} style={{
                    display: "flex", alignItems: "flex-start", gap: 8, padding: "9px 11px",
                    borderRadius: 9, background: C.soft, border: `1px solid ${C.borderSoft}`,
                  }}>
                    {r.ok
                      ? <Check size={15} color={C.green} style={{ flexShrink: 0, marginTop: 1 }} />
                      : <AlertCircle size={15} color={C.red} style={{ flexShrink: 0, marginTop: 1 }} />}
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontSize: 12.5, fontWeight: 700, color: C.text, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                        {r.section ? <span style={{ color: C.muted, fontWeight: 600 }}>{r.section}: </span> : null}{r.title}
                      </div>
                      {r.ok
                        ? (r.note
                            ? <div style={{ fontSize: 11, color: "#b97500" }}>Row {r.line}: {r.note}</div>
                            : <div style={{ fontSize: 11, color: C.muted }}>{r.id ? `Created · ${r.id}` : "Done"}</div>)
                        : <div style={{ fontSize: 11, color: C.red }}>Row {r.line}: {r.error}</div>}
                    </div>
                  </div>
                ))}
              </div>
              <div style={{ display: "flex", justifyContent: "flex-end", gap: 10, marginTop: 16 }}>
                <button onClick={reset} style={btnGhost}>Upload another</button>
                <button onClick={close} style={btnPrimary}>Done</button>
              </div>
            </div>
          ) : (
            // ── Upload view ──
            <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
              <div style={{ fontSize: 13, color: C.text, lineHeight: 1.55 }}>
                <strong>1.</strong> Download the Excel template &nbsp;·&nbsp; <strong>2.</strong> Fill in one row per {spec.singular} &nbsp;·&nbsp; <strong>3.</strong> Upload it below.
                <div style={{ fontSize: 11.5, color: C.muted, marginTop: 6 }}>
                  Selectable columns are built-in dropdowns showing the same live choices as the app. Hover a header for its example and whether it's required.
                </div>
              </div>

              <button onClick={() => void downloadTpl()} disabled={building} style={{ ...btnGhost, alignSelf: "flex-start", display: "inline-flex", alignItems: "center", gap: 7, opacity: building ? 0.6 : 1, cursor: building ? "default" : "pointer" }}>
                {building ? <Loader2 size={15} style={{ animation: "spin 0.8s linear infinite" }} /> : <Download size={15} />}
                {building ? "Building template…" : "Download Excel template"}
              </button>

              {/* Drop / pick */}
              <div
                onClick={() => fileRef.current?.click()}
                onDragOver={(e) => { e.preventDefault(); }}
                onDrop={(e) => { e.preventDefault(); const f = e.dataTransfer.files?.[0]; if (f) void onFile(f); }}
                style={{
                  border: `1.5px dashed ${totalRows ? C.green : C.border}`, borderRadius: 12,
                  padding: "22px 16px", textAlign: "center", cursor: "pointer",
                  background: totalRows ? C.green + "08" : C.soft,
                }}
              >
                <input
                  ref={fileRef}
                  type="file"
                  accept=".xlsx,.csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,text/csv"
                  style={{ display: "none" }}
                  onChange={(e) => { const f = e.target.files?.[0]; if (f) void onFile(f); }}
                />
                {parsing ? (
                  <div style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 9, color: C.muted }}>
                    <Loader2 size={18} style={{ animation: "spin 0.8s linear infinite" }} />
                    <span style={{ fontSize: 13, fontWeight: 600 }}>Reading {fileName}…</span>
                  </div>
                ) : totalRows ? (
                  <div style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 9, color: C.text }}>
                    <FileText size={18} color={C.green} />
                    <span style={{ fontSize: 13, fontWeight: 700 }}>{fileName}</span>
                    <span style={{ fontSize: 12, color: C.muted }}>· {primaryLabel}{childParts.length ? ` + ${childParts.join(" + ")}` : ""}</span>
                  </div>
                ) : (
                  <div style={{ color: C.muted }}>
                    <Upload size={20} style={{ marginBottom: 6 }} />
                    <div style={{ fontSize: 13, fontWeight: 600, color: C.text }}>Click to choose your filled-in Excel file</div>
                    <div style={{ fontSize: 11.5, marginTop: 2 }}>.xlsx or .csv · or drag &amp; drop it here</div>
                  </div>
                )}
              </div>

              {parseError && (
                <div style={{
                  display: "flex", gap: 8, padding: "10px 12px", borderRadius: 10,
                  background: C.red + "10", border: `1px solid ${C.red}44`, color: C.text, fontSize: 12.5,
                }}>
                  <AlertCircle size={15} color={C.red} style={{ flexShrink: 0, marginTop: 1 }} />
                  <span>{parseError}</span>
                </div>
              )}

              {running && (
                <div style={{ fontSize: 12.5, color: C.muted, display: "flex", alignItems: "center", gap: 8 }}>
                  <Loader2 size={15} className="spin" style={{ animation: "spin 0.8s linear infinite" }} />
                  Creating {progress.done} of {progress.total}…
                </div>
              )}

              <div style={{ display: "flex", justifyContent: "flex-end", gap: 10 }}>
                <button onClick={close} disabled={running} style={{ ...btnGhost, opacity: running ? 0.5 : 1 }}>Cancel</button>
                <button
                  onClick={run}
                  disabled={!primaryCount || running}
                  style={{ ...btnPrimary, opacity: !primaryCount || running ? 0.5 : 1, cursor: !primaryCount || running ? "default" : "pointer", display: "inline-flex", alignItems: "center", gap: 7 }}
                >
                  {running ? <Loader2 size={15} style={{ animation: "spin 0.8s linear infinite" }} /> : <Upload size={15} />}
                  Create {primaryCount ? primaryLabel : spec.label.toLowerCase()}
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

const btnPrimary: React.CSSProperties = {
  padding: "9px 16px", borderRadius: 10, border: "none", background: C.green,
  color: "#fff", fontSize: 13, fontWeight: 700, cursor: "pointer",
};
const btnGhost: React.CSSProperties = {
  padding: "9px 14px", borderRadius: 10, border: `1px solid ${C.border}`, background: "#fff",
  color: C.text, fontSize: 13, fontWeight: 700, cursor: "pointer",
};
