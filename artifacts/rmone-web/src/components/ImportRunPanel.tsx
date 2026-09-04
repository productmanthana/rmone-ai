// ImportRunPanel — the import wizard's final "Processing" step.
//
// Previously Confirm & Upload navigated to /onboarding/status/<id>, dumping
// the user out of the wizard they had just walked through (user request:
// the flow must END inside the wizard). This panel embeds the SAME
// TerminalStatusCard the status page renders — same streamed step lines
// (shared per-upload sessionStorage log), same real+simulated progress
// model — plus the status page's Cancel Upload action and a Done button
// once the run reaches a terminal state.
import { useEffect, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { CheckCircle2, Loader2, OctagonX, XCircle } from "lucide-react";
import { activeImportKey, authHeaders, bustCache, importResultKey, IN_WIZARD_RUN_FLAG } from "@/lib/api";
import { TerminalStatusCard, useImportTerminalProgress, type TermStatusData } from "@/components/TerminalStatusCard";
import { NeedsAttentionInline } from "@/components/NeedsAttentionCard";

export default function ImportRunPanel({ uploadId, onDone }: {
  uploadId: string;
  /** Leave the Processing step. ok = finished successfully (incl. partial). */
  onDone: (ok: boolean) => void;
}) {
  const qc = useQueryClient();
  const [st, setSt] = useState<TermStatusData | null>(null);
  const [gone, setGone] = useState(false);
  const [cancelConfirm, setCancelConfirm] = useState(false);
  const [cancelling, setCancelling] = useState(false);
  // Set the moment a cancel request succeeds — stale "running" polls already
  // in flight must not briefly revive the animation (same trick as the
  // status page).
  const cancelRequestedRef = useRef(false);

  // Tell the App-level completion watcher this run is being watched RIGHT
  // HERE — it must not pop its own "import finished" dialog on top of the
  // wizard. Per-tab on purpose (sessionStorage): other tabs keep the popup.
  useEffect(() => {
    try { sessionStorage.setItem(IN_WIZARD_RUN_FLAG, uploadId); } catch { /* ignore */ }
    return () => { try { sessionStorage.removeItem(IN_WIZARD_RUN_FLAG); } catch { /* ignore */ } };
  }, [uploadId]);

  // Same 2s cadence + endpoint as the status page / running-import popup.
  // Polling stops on any terminal state and on 403/404/410 (job vanished).
  useEffect(() => {
    setSt(null); setGone(false); setCancelConfirm(false); setCancelling(false);
    cancelRequestedRef.current = false;
    let stopped = false;
    let timer: ReturnType<typeof setInterval> | null = null;
    const stop = () => { if (timer) { clearInterval(timer); timer = null; } };
    const poll = async () => {
      try {
        const r = await fetch(`/api/onboarding/status/${uploadId}`, { headers: authHeaders() as Record<string, string> });
        if (stopped) return;
        if (r.status === 403 || r.status === 404 || r.status === 410) { setGone(true); stop(); return; }
        if (!r.ok) return; // transient hiccup — keep the last known state
        const data = (await r.json()) as TermStatusData;
        if (stopped) return;
        if (cancelRequestedRef.current && (data.status === "running" || data.status === "pending")) return;
        setSt(data);
        if (data.status && data.status !== "running" && data.status !== "pending") {
          stop();
          // This panel is the acknowledging surface (the user is watching):
          // retire the global watcher marker so no late "finished" popup
          // chases them after Done, and refresh caches the same way that
          // watcher would have (whole-app bust — an import touches
          // everything, not just the import page's own queries).
          try { localStorage.removeItem(activeImportKey()); } catch { /* ignore */ }
          if (data.status === "success" || data.status === "partial") {
            bustCache();
            void qc.invalidateQueries();
          }
        }
      } catch { /* transient network error — keep polling */ }
    };
    void poll();
    timer = setInterval(() => { void poll(); }, 2000);
    return () => { stopped = true; stop(); };
  }, [uploadId]);

  const { isLive, isDone: progDone, pct, phaseLabel, phaseIsReal, phaseDetail } = useImportTerminalProgress(st);
  const status = st?.status;
  const isDone = gone || progDone;
  const isOk = gone || status === "success" || status === "partial";

  async function doCancel() {
    setCancelling(true);
    try {
      const res = await fetch(`/api/onboarding/cancel/${uploadId}`, {
        method: "POST",
        headers: { ...(authHeaders() as Record<string, string>) },
      });
      if (res.ok) {
        cancelRequestedRef.current = true;
        // Flip to "cancelled" immediately — waiting for the next poll tick
        // leaves a confusing window where the terminal keeps animating a job
        // the user just stopped.
        setSt(prev => (prev ? { ...prev, status: "cancelled" } : prev));
        // The user cancelled it themselves — drop the global watcher markers
        // so no "import finished/cancelled" popup chases them afterwards.
        try { localStorage.removeItem(activeImportKey()); } catch { /* ignore */ }
        try { localStorage.removeItem(importResultKey()); } catch { /* ignore */ }
      }
    } catch { /* polling will pick up the status change */ }
    finally { setCancelling(false); setCancelConfirm(false); }
  }

  return (
    <div className="bg-white rounded-xl shadow-xl w-full mx-auto p-5 flex flex-col gap-4">
      {/* Status line */}
      <div className="flex items-start gap-2.5">
        {!isDone
          ? <Loader2 className="w-[18px] h-[18px] text-amber-600 animate-spin flex-shrink-0 mt-0.5" />
          : isOk
          ? <CheckCircle2 className="w-[18px] h-[18px] text-emerald-600 flex-shrink-0 mt-0.5" />
          : <XCircle className="w-[18px] h-[18px] text-red-500 flex-shrink-0 mt-0.5" />}
        <div className="min-w-0">
          <p className="text-sm font-semibold text-gray-900">
            {!isDone ? "Importing your file…"
              : gone ? "Import finished"
              : status === "cancelled" ? "Import cancelled"
              : isOk ? "Import finished"
              : "Import stopped"}
          </p>
          <p className="text-xs text-gray-500 mt-0.5 leading-relaxed">
            {!isDone
              ? "This runs in the background — leaving the page won't stop it."
              : gone
              ? "See Upload History for the result. You can upload your next file now."
              : status === "cancelled"
              ? "Anything this run had already written was rolled back. Your file is still loaded in the grid."
              : isOk
              ? "Your data is in RM ONE — press Done to finish."
              : "Nothing to worry about — your file is still loaded in the grid, so you can adjust and try again."}
          </p>
        </div>
      </div>

      {/* The SAME terminal as the status page — identical step lines and
          progress model, so what the user sees here is exactly what
          /onboarding/status/<id> would show. */}
      {!gone && (
        <TerminalStatusCard
          key={uploadId}
          status={st?.status ?? "pending"}
          fileName={st?.fileName ?? undefined}
          tenantId={st?.tenantId ?? undefined}
          isLive={isLive}
          pct={pct}
          phaseLabel={phaseLabel}
          phaseIsReal={phaseIsReal}
          phaseDetail={phaseDetail}
          data={st}
          uploadId={uploadId}
        />
      )}

      {/* Rows held for review ("needs attention") — surfaced right here so the
          wizard flow doesn't end with held rows invisible. Same card the
          status page shows; renders nothing when the queue is empty.
          force-light: this panel is hard-coded white, so pin the card's
          theme tokens to the light palette even when the app is in dark mode. */}
      {isDone && isOk && (
        <div className="force-light">
          <NeedsAttentionInline />
        </div>
      )}

      {/* Cancel confirm strip */}
      {cancelConfirm && !isDone && (
        <div className="flex items-center gap-3 flex-wrap rounded-lg border border-red-200 bg-red-50 px-3 py-2.5">
          <span className="text-xs font-medium text-red-800">
            Stop this import? Any data already written by this run is rolled back.
          </span>
          <div className="flex items-center gap-2 ml-auto">
            <button
              onClick={() => void doCancel()}
              disabled={cancelling}
              className="px-3 py-1.5 rounded-md text-[11px] font-bold text-white bg-red-600 hover:bg-red-700 disabled:opacity-60"
            >
              {cancelling ? "Cancelling…" : "Yes, stop it"}
            </button>
            <button
              onClick={() => setCancelConfirm(false)}
              disabled={cancelling}
              className="px-3 py-1.5 rounded-md text-[11px] font-semibold text-gray-600 border border-gray-200 bg-white hover:bg-gray-50"
            >
              Keep running
            </button>
          </div>
        </div>
      )}

      {/* Actions */}
      <div className="flex items-center gap-2 flex-wrap">
        {!isDone && !cancelConfirm && (
          <button
            onClick={() => setCancelConfirm(true)}
            className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-lg text-xs font-bold text-red-600 border border-red-200 bg-white hover:bg-red-50"
          >
            <OctagonX className="w-3.5 h-3.5" /> Cancel Upload
          </button>
        )}
        <div className="flex items-center gap-2 ml-auto">
          {isDone && (
            <button
              onClick={() => onDone(isOk)}
              className="px-5 py-2 rounded-lg text-xs font-bold text-white bg-indigo-600 hover:bg-indigo-700"
            >
              Done
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
