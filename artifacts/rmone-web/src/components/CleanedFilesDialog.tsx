// ── "Cleaned files" dialog ──────────────────────────────────────────────────
// Every data-cleaning run's workbook is kept on the server (12 months), so
// the cleaned Excel stays downloadable long after the import session's
// banner is gone. Lists past runs; each offers the cleaned file and — once
// the user finished a review — the reviewed copy with their decisions
// applied. Lives at the Import page level (header button), not inside the
// grid, so it works whether or not a file is loaded.
import { useEffect, useState } from "react";
import { authHeaders } from "@/lib/api";
import { History, X, Loader2, FileSpreadsheet, Download } from "lucide-react";

// One past cleaning run as returned by GET /api/data-cleaning/sessions.
interface CleanFileSession {
  sessionId: string;
  stage: string;
  updatedAt?: string;
  fileName?: string;
  /** Set once the user finished the import review — a decisions-applied
      "reviewed" workbook exists alongside the cleaned one. */
  reviewedAt?: string;
  summary?: { rowsOut?: number; fixed?: number; dupes?: number; review?: number };
}

export default function CleanedFilesDialog({ open, onClose, tenantOverride }: {
  open: boolean;
  onClose: () => void;
  /** Superadmin data-cleaning handoff for another tenant (rides ?tenantId=). */
  tenantOverride?: string | null;
}) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sessions, setSessions] = useState<CleanFileSession[] | null>(null);

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    setLoading(true);
    setError(null);
    (async () => {
      try {
        const q = tenantOverride ? `?tenantId=${encodeURIComponent(tenantOverride)}` : "";
        const r = await fetch(`/api/data-cleaning/sessions${q}`, { headers: authHeaders() as Record<string, string> });
        if (!r.ok) throw new Error(`the list could not be loaded (${r.status})`);
        const j = await r.json();
        const list = (Array.isArray(j.sessions) ? j.sessions : []) as CleanFileSession[];
        // Only finished runs have a cleaned workbook to download.
        if (!cancelled) setSessions(list.filter(s => s.stage === "done"));
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : String(e));
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [open, tenantOverride]);

  const downloadPastCleaned = async (sid: string, fileName: string, which?: "reviewed") => {
    try {
      const q = new URLSearchParams();
      if (which) q.set("which", which);
      if (tenantOverride) q.set("tenantId", tenantOverride);
      const qs = q.toString();
      const r = await fetch(`/api/data-cleaning/download/${sid}${qs ? `?${qs}` : ""}`, { headers: authHeaders() as Record<string, string> });
      if (!r.ok) throw new Error(`download failed (${r.status})`);
      const blob = await r.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `${fileName.replace(/\.(xlsx|xls)$/i, "")}-${which === "reviewed" ? "REVIEWED" : "CLEANED"}.xlsx`;
      a.click();
      URL.revokeObjectURL(url);
    } catch {
      alert("Could not download that file — please try again.");
    }
  };

  if (!open) return null;
  return (
    <div className="fixed inset-0 z-[120] flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/40" onClick={onClose} />
      <div className="relative bg-white rounded-2xl shadow-2xl w-full max-w-2xl max-h-[80vh] flex flex-col overflow-hidden">
        <div className="px-5 py-4 border-b border-gray-200 flex items-center gap-3">
          <div className="w-9 h-9 rounded-xl bg-emerald-50 border border-emerald-200 flex items-center justify-center shrink-0">
            <History className="w-4 h-4 text-emerald-700" />
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-sm font-bold text-gray-900">Cleaned files</p>
            <p className="text-[11px] text-gray-500 leading-relaxed">
              Every cleaning run is saved on the server for 12 months — download the cleaned Excel any time,
              even long after the upload. "Reviewed" is the same file with your review decisions applied.
            </p>
          </div>
          <button onClick={onClose}
            className="shrink-0 w-7 h-7 rounded-lg hover:bg-gray-100 flex items-center justify-center text-gray-400 hover:text-gray-600">
            <X className="w-4 h-4" />
          </button>
        </div>
        <div className="flex-1 overflow-y-auto px-5 py-3">
          {loading && (
            <div className="flex items-center justify-center gap-2 text-xs text-gray-500 py-8">
              <Loader2 className="w-4 h-4 animate-spin" /> Loading your cleaned files…
            </div>
          )}
          {!loading && error && (
            <div className="text-xs text-red-600 bg-red-50 border border-red-200 rounded-lg px-3 py-2">
              The list could not be loaded: {error}
            </div>
          )}
          {!loading && !error && (sessions?.length ?? 0) === 0 && (
            <p className="text-xs text-gray-500 py-8 text-center">
              No cleaned files yet — upload an Excel file and the cleaned copy is saved here automatically.
            </p>
          )}
          {!loading && !error && (sessions ?? []).map(s => (
            <div key={s.sessionId} className="flex items-center gap-3 py-2.5 border-b border-gray-100 last:border-b-0">
              <FileSpreadsheet className="w-4 h-4 text-emerald-600 shrink-0" />
              <div className="flex-1 min-w-0">
                <p className="text-xs font-semibold text-gray-900 truncate">{s.fileName ?? "file.xlsx"}</p>
                <p className="text-[10px] text-gray-500">
                  {s.updatedAt ? new Date(s.updatedAt).toLocaleString() : ""}
                  {typeof s.summary?.rowsOut === "number" ? ` · ${s.summary.rowsOut.toLocaleString()} rows` : ""}
                </p>
              </div>
              <button onClick={() => void downloadPastCleaned(s.sessionId, s.fileName ?? "file.xlsx")}
                title="The cleaned file exactly as the cleaner produced it"
                className="shrink-0 flex items-center gap-1 px-2.5 py-1.5 rounded-lg border border-emerald-300 bg-emerald-50 hover:bg-emerald-100 text-emerald-700 text-[11px] font-semibold">
                <Download className="w-3 h-3" /> Cleaned
              </button>
              {s.reviewedAt && (
                <button onClick={() => void downloadPastCleaned(s.sessionId, s.fileName ?? "file.xlsx", "reviewed")}
                  title="The cleaned file with your review decisions applied"
                  className="shrink-0 flex items-center gap-1 px-2.5 py-1.5 rounded-lg border border-indigo-300 bg-indigo-50 hover:bg-indigo-100 text-indigo-700 text-[11px] font-semibold">
                  <Download className="w-3 h-3" /> Reviewed
                </button>
              )}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
