// ImportRunningDialog — the "an import is already running" popup on the
// Import page.
//
// Why: users who left the status page (back-navigation) and returned to
// /import kept trying to upload a second file while their first one was
// still processing — the passive banner was easy to miss. This modal opens
// automatically while an import is active, re-opens on any blocked upload
// attempt (including the server's IMPORT_IN_PROGRESS 409), and embeds the
// SAME TerminalStatusCard the full status page renders — same streamed step
// lines (restored from the shared per-upload sessionStorage log), same
// real+simulated progress model, same completed state — so what the user
// sees here is exactly what /onboarding/status/<id> shows, just inside a
// modal. One file per company at a time; the next upload unlocks the moment
// this one reaches a terminal state.
import { useEffect, useState } from "react";
import { CheckCircle2, ExternalLink, Loader2, XCircle } from "lucide-react";
import { authHeaders } from "@/lib/api";
import {
  TerminalStatusCard, useImportTerminalProgress, type TermStatusData,
} from "@/components/TerminalStatusCard";

export default function ImportRunningDialog({ uploadId, onClose, onViewFull }: {
  uploadId:   string;
  onClose:    () => void;
  onViewFull: () => void;
}) {
  const [st, setSt]     = useState<TermStatusData | null>(null);
  const [gone, setGone] = useState(false);

  // Same 2s cadence + same endpoint as the full status page. Polling stops on
  // any terminal state (the dialog keeps showing the final result until the
  // user closes it) and on 403/404/410 (job vanished — e.g. deleted from
  // history), which is shown as a neutral "finished" state.
  useEffect(() => {
    // Reset per-upload state: the dialog can stay mounted while the parent
    // swaps uploadId (e.g. a new import started after the previous one was
    // deleted) — stale `gone`/status from the old job must not leak into the
    // new one's display.
    setSt(null);
    setGone(false);
    let stopped = false;
    let timer: ReturnType<typeof setInterval> | null = null;
    const stop = () => { if (timer) { clearInterval(timer); timer = null; } };
    const poll = async () => {
      try {
        const r = await fetch(`/api/onboarding/status/${uploadId}`, { headers: authHeaders() as Record<string, string> });
        if (stopped) return;
        if (r.status === 403 || r.status === 404 || r.status === 410) { setGone(true); stop(); return; }
        if (!r.ok) return; // transient server hiccup — keep the last known state
        const data = (await r.json()) as TermStatusData;
        if (stopped) return;
        setSt(data);
        if (data.status && data.status !== "running" && data.status !== "pending") stop();
      } catch { /* transient network error — keep polling */ }
    };
    void poll();
    timer = setInterval(() => { void poll(); }, 2000);
    return () => { stopped = true; stop(); };
  }, [uploadId]);

  // Same progress model as the full status page: real server progress leads;
  // a smooth simulated creep covers the server's silent setup window — never
  // a frozen raw 0% here while the status page shows 25%.
  const { isLive, isDone: progDone, pct, phaseLabel, phaseIsReal, phaseDetail } =
    useImportTerminalProgress(st);

  const status = st?.status;
  const isDone = gone || progDone;
  const isOk   = gone || status === "success" || status === "partial";

  const title = !isDone ? "An import is already running"
    : isOk ? "Import finished"
    : "Import stopped";

  return (
    <div onClick={onClose} style={{ position: "fixed", inset: 0, zIndex: 60, background: "rgba(0,0,0,0.45)", display: "flex", alignItems: "center", justifyContent: "center" }}>
      <div onClick={e => e.stopPropagation()} style={{ background: "var(--rm-panel)", borderRadius: 12, padding: 24, maxWidth: 720, width: "94%", maxHeight: "90vh", overflowY: "auto", boxShadow: "var(--rm-shadow)" }}>

        {/* Heading */}
        <div style={{ display: "flex", alignItems: "flex-start", gap: 10, marginBottom: 6 }}>
          {!isDone
            ? <Loader2 size={18} style={{ color: "#e07b10", animation: "spin 1s linear infinite", flexShrink: 0, marginTop: 1 }} />
            : isOk
            ? <CheckCircle2 size={18} style={{ color: "var(--rm-green)", flexShrink: 0, marginTop: 1 }} />
            : <XCircle size={18} style={{ color: "#c0392b", flexShrink: 0, marginTop: 1 }} />}
          <div>
            <div style={{ fontSize: 15.5, fontWeight: 700, color: "var(--rm-text)" }}>{title}</div>
            <div style={{ fontSize: 12, color: "var(--rm-text-muted)", marginTop: 3, lineHeight: 1.55 }}>
              {!isDone ? (
                <>
                  <strong style={{ background: "#111", color: "#fff", fontWeight: 800, padding: "1px 6px", borderRadius: 4, whiteSpace: "nowrap" }}>
                    Only one file can be imported at a time.
                  </strong>{" "}
                  Please wait for this one to finish — you can upload your next file as soon as it completes.
                </>
              ) : gone ? (
                "Import finished — see Upload History for the result. You can upload your next file now."
              ) : isOk ? (
                "You can upload your next file now."
              ) : (
                "The import is no longer running — you can upload a file now."
              )}
            </div>
          </div>
        </div>

        {/* The SAME terminal as the full status page — identical step lines
            (shared per-upload sessionStorage log), identical live progress and
            completed state. Keyed by uploadId so a swapped-in new import
            starts a fresh log instead of inheriting the old one. */}
        {!gone && (
          <div style={{ marginTop: 12 }}>
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
          </div>
        )}

        {/* Actions */}
        <div style={{ display: "flex", justifyContent: "flex-end", gap: 10, marginTop: 16 }}>
          <button onClick={onClose} style={{ padding: "7px 16px", fontSize: 12, fontWeight: 700, borderRadius: 6, background: "var(--rm-panel-soft)", color: "var(--rm-text)", border: "1px solid var(--rm-panel-border)", cursor: "pointer" }}>
            {isDone ? "Close" : "I'll wait"}
          </button>
          {!gone && (
            <button onClick={onViewFull} style={{ display: "flex", alignItems: "center", gap: 6, padding: "7px 16px", fontSize: 12, fontWeight: 700, borderRadius: 6, background: "var(--rm-green)", color: "#fff", border: "none", cursor: "pointer" }}>
              <ExternalLink size={13} /> {isDone ? "View details" : "View full progress"}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
