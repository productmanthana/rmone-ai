// TerminalStatusCard — the Apple-style dark import terminal, shared by the
// full status page (/onboarding/status/:id) AND the "an import is already
// running" popup on the Import page.
//
// Why shared: users see this exact terminal while their import runs; when the
// running-import popup showed a different, simpler bar (stuck at the server's
// raw 0% while the page simulated smooth progress) it looked like a different
// import — or a frozen one. One component + one progress hook means both
// surfaces show the SAME lines, SAME percentages and the SAME completed state.
// The streamed log is persisted per-upload in sessionStorage (rm_term_<id>),
// so the popup restores the very lines the status page already printed, and
// vice versa.
import { useEffect, useRef, useState } from "react";

export type ImportJobStatus =
  | "pending" | "running" | "success" | "partial" | "failed" | "cancelled";

export interface TermStepResult {
  table:        string;
  rowsInserted: number;
  /** In-place updates to existing records (update-mode data work). */
  rowsUpdated?: number;
  /** True for configuration/seed steps (setup writes, not data rows). */
  isConfig?:    boolean;
}

// Data-vs-setup step classification lives in a pure module so the server-side
// check:config-steps assertion exercises the exact logic the UI uses.
export { isConfigStep } from "@/lib/importSteps";
import { isConfigStep, sumDataRows, sumSetupRows, sumUpdatedRows } from "@/lib/importSteps";

export interface TermPipelineProgress {
  phase:  string;
  table?: string;
  pct:    number;
  done?:  number;
  total?: number;
}

// Minimal structural subset of the status page's StatusResponse — everything
// the terminal (and the progress hook) actually reads. The page's richer type
// is assignable to this.
export interface TermStatusData {
  status:         ImportJobStatus;
  fileName?:      string | null;
  tenantId?:      string | null;
  totalInserted?: number | null;
  /** Setup/config seed writes, reported separately from data rows (#390). */
  configInserted?: number | null;
  totalErrors?:   number | null;
  fatalError?:    string | null;
  progress?:      TermPipelineProgress | null;
  steps?:         TermStepResult[];
}

// While a job is running the animated bar never passes this — it only reaches
// 100% once the server reports the import is actually finished.
export const SOFT_CAP = 93;

// Cycling technical messages shown while the import runs — rotate every ~2s.
const PROCESSING_TICKERS = [
  "Resolving foreign key constraints…",
  "Normalising division hierarchy…",
  "Linking allocations to work items…",
  "Verifying tenant data isolation…",
  "Mapping schema field synonyms…",
  "Queuing row-level validation…",
  "Flushing write buffer to RM ONE…",
  "Cross-referencing role assignments…",
  "Computing allocation percentages…",
  "Rebuilding resource index…",
  "Validating project lifecycle links…",
  "Syncing opportunity stage definitions…",
  "Applying deferred constraint checks…",
  "Reconciling duplicate natural keys…",
  "Merging assumed field defaults…",
];

const TERM_TABLE_LABELS: Record<string, string> = {
  AspNetUsers:        "Team Members",
  CompanyDivisions:   "Divisions",
  Department:         "Departments",
  Roles:              "Roles",
  Jobtitle:           "Job Titles",
  CRMCompany:         "Client Companies",
  CRMContact:         "Client Contacts",
  PMM:                "Projects",
  Opportunity:        "Opportunities",
  ResourceWorkItems:  "Resource–Project Links",
  ResourceAllocation: "Allocations",
  ModuleTasks:        "Task Records",
  TicketHours:        "Hour Entries",
};

interface TermLogEntry {
  id:       number;
  kind:     "ok" | "err" | "active" | "info" | "sep" | "bar" | "warn";
  text:     string;
  barPct?:  number;
  barRows?: string;
}

function mkAsciiBar(pct: number, width = 22): string {
  const filled = Math.min(width, Math.round((pct / 100) * width));
  return "█".repeat(filled) + "░".repeat(width - filled);
}

// Fallback stage labels cycled while the server hasn't reported a real phase
// yet — mirrors the STAGES cycle on the full status page.
const TERM_STAGE_LABELS = [
  "People & roles", "Client companies", "Projects & pipeline", "Allocations",
] as const;

// ── useImportTerminalProgress ─────────────────────────────────────────────
// The status page's progress model, extracted for the running-import popup:
// real server progress leads; before the server reports row counts, a smooth
// simulated creep (eased toward SOFT_CAP) keeps the bar alive — so the popup
// shows the same "25%" the full page shows, never a frozen raw 0%.
export function useImportTerminalProgress(data: TermStatusData | null): {
  isLive:      boolean;
  isDone:      boolean;
  pct:         number;
  phaseLabel:  string;
  phaseIsReal: boolean;
  phaseDetail: string | null;
} {
  const isLive = data?.status === "pending" || data?.status === "running";
  const isDone = !!data && !isLive;
  const hasData = !!data;
  const dataStatus = data?.status;
  const steps = data?.steps ?? [];
  const liveProgress = data?.progress ?? null;
  // Real progress floor: prefer the server's reported percentage, else derive a
  // coarse floor from how many pipeline steps have already reported.
  const realPct = liveProgress
    ? Math.min(99, Math.max(0, Math.round(liveProgress.pct)))
    : steps.length > 0
      ? Math.round((steps.length / 13) * 100)
      : 0;

  // Simulated creep — same varied timing/increments as the status page.
  const [animPct, setAnimPct] = useState(0);
  useEffect(() => {
    if (isDone) {
      // Finished — fill the bar; a CANCELLED run freezes where it was instead.
      if (dataStatus !== "cancelled") setAnimPct(100);
      return;
    }
    // No status response yet — stay honest at 0 until the first real status
    // lands (the job may already be finished server-side).
    if (!hasData) return;
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout>;
    const tick = () => {
      if (cancelled) return;
      setAnimPct((prev) => {
        const base = Math.max(prev, realPct);
        if (base >= SOFT_CAP) return base;
        const remaining = SOFT_CAP - base;
        const inc = Math.max(0.6, remaining * (0.04 + Math.random() * 0.14));
        return Math.min(SOFT_CAP, base + inc);
      });
      timer = setTimeout(tick, 280 + Math.random() * 920);
    };
    timer = setTimeout(tick, 200);
    return () => { cancelled = true; clearTimeout(timer); };
  }, [isDone, realPct, hasData, dataStatus]);

  // Cycle the fallback stage label (~5s ± jitter) while no real phase exists.
  const [stageIdx, setStageIdx] = useState(0);
  useEffect(() => {
    if (!isLive) return;
    let cancelled = false;
    let t: ReturnType<typeof setTimeout>;
    const next = () => {
      if (cancelled) return;
      setStageIdx((i) => (i + 1) % TERM_STAGE_LABELS.length);
      t = setTimeout(next, 4200 + Math.random() * 1800);
    };
    t = setTimeout(next, 5000);
    return () => { cancelled = true; clearTimeout(t); };
  }, [isLive]);

  // Real progress leads; while the server is in its 0% setup window the creep
  // moves the bar up to a small cap so it never looks frozen. Monotonic via
  // Math.max once the first real pct arrives.
  const pct = dataStatus === "cancelled"
    ? realPct
    : isDone
    ? 100
    : liveProgress
      ? Math.max(realPct, Math.min(10, Math.round(animPct)))
      : Math.min(SOFT_CAP, Math.max(realPct, Math.round(animPct)));

  // Mirrors the status page: the real server phase leads; otherwise the timed
  // stage cycle keeps the very first ticks feeling alive. (The page's stronger
  // "Waiting to start…" state relies on its never-started heuristics, which
  // the popup doesn't have — the guard popup only opens for in-flight runs.)
  const phaseLabel = liveProgress?.phase ?? `${TERM_STAGE_LABELS[stageIdx]}…`;
  const phaseIsReal = liveProgress?.phase != null;
  const phaseDetail = liveProgress && liveProgress.total
    ? `${(liveProgress.done ?? 0).toLocaleString()} / ${liveProgress.total.toLocaleString()}`
    : null;

  return { isLive, isDone, pct, phaseLabel, phaseIsReal, phaseDetail };
}

// ── TerminalStatusCard ────────────────────────────────────────────────────
// Apple-style dark terminal — always dark, streaming log lines, per-table
// ASCII progress bars, continuously-updating ticker so the wait feels alive.
export function TerminalStatusCard({
  status, fileName, tenantId, isLive,
  pct, phaseLabel, phaseIsReal, phaseDetail, effectiveStageIdx: _esi, quoteIdx: _qi,
  data, uploadId,
}: {
  status:             ImportJobStatus;
  fileName:           string | undefined;
  tenantId:           string | undefined;
  isLive:             boolean;
  pct:                number;
  phaseLabel:         string;
  phaseIsReal:        boolean;
  phaseDetail:        string | null;
  effectiveStageIdx?: number;
  quoteIdx?:          number;
  data:               TermStatusData | null;
  uploadId:           string;
}) {
  const STORE_KEY = `rm_term_${uploadId}`;

  // ── Accumulated terminal log — restored from sessionStorage on remount ──
  const [termLog, setTermLog] = useState<TermLogEntry[]>(() => {
    try {
      const stored = sessionStorage.getItem(STORE_KEY);
      if (stored) {
        const parsed = JSON.parse(stored) as TermLogEntry[];
        if (parsed.length > 0) {
          // Convert any in-progress "active" entries to "ok" so a restored log
          // never shows a dangling spinner; the live poll will re-add the current
          // active phase the moment the next tick arrives.
          return parsed.map(e => e.kind === "active" ? { ...e, kind: "ok" as const } : e);
        }
      }
    } catch { /* sessionStorage unavailable — start fresh */ }
    return [];
  });

  // Derive highest existing id from restored log (if any) to avoid id collisions.
  const nextId    = useRef(termLog.length > 0 ? Math.max(...termLog.map(e => e.id)) + 1 : 0);
  const logRef    = useRef<HTMLDivElement>(null);

  // If we restored a non-empty log, skip the one-time init effects so we don't
  // append duplicate startup/filename lines.
  const initRef     = useRef(termLog.length > 0);
  const fileRef     = useRef(termLog.some(e => e.text?.startsWith("Parsing Excel:")));
  const inRetryRef  = useRef(false);
  // Seed lastPhaseRef from the last phase line in the restored log.
  const lastPhaseRef = useRef(
    termLog.filter(e => (e.kind === "ok" || e.kind === "active") && e.text?.startsWith("Running Data pipeline:"))
           .at(-1)?.text?.replace("Running Data pipeline: ", "") ?? ""
  );
  // Seed doneRef if the log already contains a terminal completion line.
  const doneRef = useRef(termLog.some(e => (e.kind === "ok" || e.kind === "err") && (e.text?.startsWith("Import complete") || e.text?.startsWith("Import failed") || e.text?.startsWith("Import cancelled"))));

  // ── Persist log to sessionStorage on every change ──────────────────────
  useEffect(() => {
    if (!uploadId || !termLog.length) return;
    try { sessionStorage.setItem(STORE_KEY, JSON.stringify(termLog)); } catch { /* ignore */ }
  }, [STORE_KEY, termLog, uploadId]);

  // Cycling ticker — rotates every 2.2 s so there is always motion.
  const [tickerIdx, setTickerIdx] = useState(0);
  useEffect(() => {
    if (!isLive) return;
    const t = setInterval(
      () => setTickerIdx(i => (i + 1) % PROCESSING_TICKERS.length),
      2200,
    );
    return () => clearInterval(t);
  }, [isLive]);

  // ── Startup lines (once) ────────────────────────────────────────────────
  useEffect(() => {
    if (initRef.current) return;
    initRef.current = true;
    const mk = (kind: TermLogEntry["kind"], text: string): TermLogEntry =>
      ({ id: nextId.current++, kind, text });
    setTermLog([
      mk("info", "RM ONE Import Engine v2.4.1"),
      mk("sep",  "──────────────────────────────────"),
      mk("ok",   "Connecting to RM ONE database…"),
      mk("ok",   `Authenticating tenant [${tenantId ?? "…"}]…`),
      mk("ok",   "Schema validated (47 tables)"),
    ]);
  }, [tenantId]);

  // ── Add "Parsing Excel" line once fileName arrives ──────────────────────
  useEffect(() => {
    if (!fileName || fileRef.current) return;
    fileRef.current = true;
    setTermLog(prev => [
      ...prev,
      { id: nextId.current++, kind: "ok",   text: `Parsing Excel: ${fileName}` },
      { id: nextId.current++, kind: "ok",   text: "Detecting modules and row counts…" },
    ]);
  }, [fileName]);

  // ── Track phase changes → stream a new active line + bar ───────────────
  // Special-case "Hit a snag" retry announcements: show them as a yellow
  // warning separator so the user can see clearly that an attempt failed
  // and a new one is starting — rather than silently replaying all phases.
  useEffect(() => {
    if (!isLive || !phaseLabel) return;
    if (phaseLabel === lastPhaseRef.current) return;
    lastPhaseRef.current = phaseLabel;

    const isRetryAnnounce =
      phaseLabel.startsWith("Hit a snag") ||
      phaseLabel.startsWith("Restarting import") ||
      phaseLabel.includes("restarting");

    // Cosmetic fallback label (server hasn't reported a real phase yet): update
    // the current active line IN PLACE instead of appending a new line and
    // sealing the previous bar at 100% — otherwise the timed stage cycle looks
    // like the pipeline is re-running the same stages forever.
    if (!phaseIsReal && !isRetryAnnounce) {
      setTermLog(prev => {
        if (prev.some(l => l.kind === "active")) {
          return prev.map(l =>
            l.kind === "active" ? { ...l, text: `Running Data pipeline: ${phaseLabel}` } : l,
          );
        }
        return [
          ...prev,
          { id: nextId.current++, kind: "active" as const, text: `Running Data pipeline: ${phaseLabel}` },
          { id: nextId.current++, kind: "bar"    as const, text: "", barPct: 0 },
        ];
      });
      return;
    }

    setTermLog(prev => {
      // Seal the previous active line and its bar at 100%
      const sealed = prev.map(l =>
        l.kind === "active" ? { ...l, kind: "ok" as const }
        : l.kind === "bar" && (l.barPct ?? 0) < 100 ? { ...l, barPct: 100 }
        : l,
      );

      if (isRetryAnnounce) {
        // Don't add a progress bar — just a visible warning separator
        inRetryRef.current = true;
        return [
          ...sealed,
          { id: nextId.current++, kind: "sep"  as const, text: "──────────────────────────────────" },
          { id: nextId.current++, kind: "warn" as const, text: `⚠  ${phaseLabel}` },
        ];
      }

      const extras: TermLogEntry[] = [];
      if (inRetryRef.current) {
        // First normal phase after a retry announcement — add a separator to
        // make it visually clear the pipeline is restarting from the beginning.
        inRetryRef.current = false;
        extras.push({ id: nextId.current++, kind: "sep" as const, text: "──── ↻ Retrying from the beginning ────" });
      }
      return [
        ...sealed,
        ...extras,
        { id: nextId.current++, kind: "active", text: `Running Data pipeline: ${phaseLabel}` },
        { id: nextId.current++, kind: "bar",    text: "", barPct: 0 },
      ];
    });
  }, [phaseLabel, isLive, phaseIsReal]);

  // ── Keep the live bar in sync with real pct ─────────────────────────────
  useEffect(() => {
    if (!isLive) return;
    setTermLog(prev => prev.map(l =>
      l.kind === "bar" && (l.barPct ?? 0) < 100
        ? { ...l, barPct: pct, barRows: phaseDetail ?? l.barRows }
        : l,
    ));
  }, [pct, phaseDetail, isLive]);

  // ── On completion: seal everything, add summary line, clear store ────────
  useEffect(() => {
    if (isLive || doneRef.current || !data) return;
    doneRef.current = true;
    setTermLog(prev => {
      // Cancelled runs stop dead: the in-flight line is marked stopped and the
      // bars are frozen where they were — never sealed at 100%, which would
      // read as a successful "Import complete" over a cancelled job.
      const sealed = status === "cancelled"
        ? prev.map(l =>
            l.kind === "active" ? { ...l, kind: "err" as const, text: `${l.text.replace(/…$/, "")} — stopped` } : l,
          )
        : prev.map(l =>
            l.kind === "active" ? { ...l, kind: "ok" as const }
            : l.kind === "bar"  ? { ...l, barPct: 100 }
            : l,
          );
      const final = [
        ...sealed,
        {
          id:   nextId.current++,
          kind: (status === "failed" || status === "cancelled") ? "err" as const : "ok" as const,
          text: status === "failed"
            ? `Import failed: ${data.fatalError ?? "see details below"}`
            : status === "cancelled"
            ? "Import cancelled — the pipeline was stopped and nothing further was written."
            : (() => {
                // Data rows vs setup writes (#390): prefer summing the non-config
                // steps (correct for both new and old persisted jobs); fall back
                // to the server scalar when steps are absent.
                const steps = data.steps ?? [];
                const dataRows  = steps.length > 0 ? sumDataRows(steps)  : (data.totalInserted ?? 0);
                const updated   = sumUpdatedRows(steps);
                const setupRows = steps.length > 0 ? sumSetupRows(steps) : (data.configInserted ?? 0);
                const errTail = (data.totalErrors ?? 0) > 0 ? `, ${data.totalErrors} errors` : "";
                const updTail = updated > 0 ? `, ${updated} existing record${updated === 1 ? "" : "s"} updated` : "";
                if (dataRows === 0 && updated === 0) {
                  return `Import complete — 0 data rows imported${errTail}. No records from your file were written${setupRows > 0 ? ` (only ${setupRows} internal setup entr${setupRows === 1 ? "y" : "ies"})` : ""}.`;
                }
                return `Import complete — ${dataRows} new data row${dataRows === 1 ? "" : "s"} imported${updTail}${setupRows > 0 ? ` (+ ${setupRows} setup entr${setupRows === 1 ? "y" : "ies"})` : ""}${errTail}`;
              })(),
        },
      ];
      // Clear persisted log — a finished run doesn't need to be restored.
      try { sessionStorage.removeItem(STORE_KEY); } catch { /* ignore */ }
      return final;
    });
  }, [isLive, data, status, STORE_KEY]);

  // ── Auto-scroll to bottom on every log change ───────────────────────────
  useEffect(() => {
    const el = logRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  });

  // Completed steps for the tag strip — data steps and setup/config steps are
  // shown as distinct chips so seed writes never read as imported records (#390).
  const allCompleted   = (data?.steps ?? []).filter(s => s.rowsInserted > 0);
  const completedSteps = allCompleted.filter(s => !isConfigStep(s));
  const configSteps    = allCompleted.filter(isConfigStep);
  const dataRowsDone    = (data?.steps?.length ?? 0) > 0 ? sumDataRows(data?.steps ?? [])  : (data?.totalInserted ?? 0);
  const updatedRowsDone = sumUpdatedRows(data?.steps ?? []);
  const setupRowsDone   = (data?.steps?.length ?? 0) > 0 ? sumSetupRows(data?.steps ?? []) : (data?.configInserted ?? 0);
  const mainBar = mkAsciiBar(pct, 20);

  return (
    <div style={{
      borderRadius: 12,
      overflow: "hidden",
      border: "1px solid #1c2e1c",
      background: "#0d1510",
      boxShadow: "0 8px 40px rgba(0,0,0,0.55), 0 0 0 0.5px #0a1a0a",
      fontFamily: "'SF Mono','Fira Code','Cascadia Code','Menlo',monospace",
    }}>

      {/* ── Title bar — Apple traffic lights ─────────────────────── */}
      <div style={{
        display: "flex", alignItems: "center", gap: 8,
        padding: "10px 16px",
        background: "#141e13",
        borderBottom: "1px solid #1c2e1c",
        userSelect: "none",
      }}>
        <span style={{ width: 12, height: 12, borderRadius: "50%", background: "#ff5f57", display: "inline-block", flexShrink: 0, boxShadow: "0 0 0 0.5px rgba(0,0,0,0.35)" }} />
        <span style={{ width: 12, height: 12, borderRadius: "50%", background: "#febc2e", display: "inline-block", flexShrink: 0, boxShadow: "0 0 0 0.5px rgba(0,0,0,0.35)" }} />
        <span style={{ width: 12, height: 12, borderRadius: "50%", background: "#28c840", display: "inline-block", flexShrink: 0, boxShadow: "0 0 0 0.5px rgba(0,0,0,0.35)" }} />
        <span style={{ flex: 1, textAlign: "center", fontSize: 12, color: "#3d6b3d", letterSpacing: "0.01em" }}>
          rmone — import-data-pipeline — {tenantId ?? "…"}
        </span>
        <span style={{ fontSize: 11, color: "#2a4a2a" }}>bash</span>
      </div>

      {/* ── Scrolling log body ────────────────────────────────────── */}
      <style>{`
        .rm-term-log::-webkit-scrollbar { width: 4px; }
        .rm-term-log::-webkit-scrollbar-track { background: #0d1510; }
        .rm-term-log::-webkit-scrollbar-thumb { background: #1a4d1a; border-radius: 2px; }
        .rm-term-log::-webkit-scrollbar-thumb:hover { background: #22c55e44; }
      `}</style>
      <div
        ref={logRef}
        className="rm-term-log"
        style={{
          padding: "16px 24px 12px",
          minHeight: 220,
          maxHeight: 420,
          overflowY: "auto",
          background: "#0d1510",
          fontSize: 12.5,
          lineHeight: 1.8,
          color: "#4ade80",
          scrollBehavior: "smooth",
          scrollbarWidth: "thin",
          scrollbarColor: "#1a4d1a #0d1510",
        }}
      >
        {termLog.map(entry => {
          if (entry.kind === "sep") return (
            <div key={entry.id} style={{ color: "#1a3d1a", marginBottom: 2, userSelect: "none" }}>
              {entry.text}
            </div>
          );

          if (entry.kind === "info") return (
            <div key={entry.id} style={{ color: "#86efac", fontWeight: 700, marginBottom: 4 }}>
              {entry.text}
            </div>
          );

          if (entry.kind === "bar") {
            const bp = entry.barPct ?? 0;
            const bar = mkAsciiBar(bp, 22);
            const rowStr = entry.barRows ? ` (${entry.barRows})` : "";
            return (
              <div key={entry.id} style={{ paddingLeft: 18, marginBottom: 2, color: "#22c55e" }}>
                <span style={{ color: "#166534" }}>[</span>
                <span style={{
                  color: bp >= 100 ? "#4ade80" : "#22c55e",
                  letterSpacing: "-0.02em",
                  transition: "color 0.4s",
                }}>{bar}</span>
                <span style={{ color: "#166534" }}>]</span>
                {" "}<span style={{ color: "#86efac" }}>{bp}%</span>{rowStr}
              </div>
            );
          }

          if (entry.kind === "ok") return (
            <div key={entry.id} style={{ display: "flex", gap: 10, color: "#4ade80" }}>
              <span style={{ color: "#22c55e", flexShrink: 0 }}>✓</span>
              <span>{entry.text}</span>
            </div>
          );

          if (entry.kind === "err") return (
            <div key={entry.id} style={{ display: "flex", gap: 10, color: "#f87171" }}>
              <span style={{ flexShrink: 0 }}>✗</span>
              <span>{entry.text}</span>
            </div>
          );

          if (entry.kind === "warn") return (
            <div key={entry.id} style={{ display: "flex", gap: 10, color: "#fbbf24", fontWeight: 600 }}>
              <span>{entry.text}</span>
            </div>
          );

          // "active" — currently processing, with bouncing dots
          return (
            <div key={entry.id} style={{ display: "flex", gap: 10, alignItems: "center", color: "#fbbf24" }}>
              <span style={{ flexShrink: 0 }}>›</span>
              <span>{entry.text}</span>
              {isLive && (
                <span style={{ display: "inline-flex", gap: 3, marginLeft: 2, alignItems: "center" }}>
                  {[0, 1, 2].map(j => (
                    <span key={j} style={{
                      width: 4, height: 4, borderRadius: "50%",
                      background: "#fbbf24", opacity: 0.75,
                      animation: `dot-bounce 1.2s ${j * 0.2}s ease-in-out infinite`,
                      display: "inline-block",
                    }} />
                  ))}
                </span>
              )}
            </div>
          );
        })}

        {/* Cycling technical ticker — always has something moving */}
        {isLive && (
          <div
            key={`ticker-${tickerIdx}`}
            style={{
              display: "flex", gap: 10,
              color: "#166534",
              animation: "fadeInTicker 0.5s ease",
              marginTop: 2,
            }}
          >
            <span style={{ flexShrink: 0 }}>›</span>
            <span>{PROCESSING_TICKERS[tickerIdx]}</span>
          </div>
        )}
      </div>

      {/* ── Overall progress bar ──────────────────────────────────── */}
      <div style={{
        padding: "12px 20px 14px",
        borderTop: "1px solid #1c2e1c",
        background: "#0a1209",
      }}>
        <div style={{
          display: "flex", justifyContent: "space-between", alignItems: "baseline",
          marginBottom: 7,
        }}>
          <span style={{ fontSize: 11, fontWeight: 700, color: "#22c55e", letterSpacing: "0.12em", textTransform: "uppercase" }}>
            Import Progress
          </span>
          <span style={{ fontSize: 14, fontWeight: 700, color: "#4ade80", fontVariantNumeric: "tabular-nums" }}>
            {pct}%
          </span>
        </div>

        {/* ASCII main bar */}
        <div style={{ fontSize: 13, color: "#166534", letterSpacing: "0.04em", marginBottom: 10 }}>
          <span style={{ color: "#14532d" }}>[</span>
          <span style={{ color: "#22c55e", letterSpacing: "-0.02em", transition: "all 0.7s" }}>{mainBar}</span>
          <span style={{ color: "#14532d" }}>]</span>
          {"  "}<span style={{ color: "#4ade80" }}>{pct}%</span>
        </div>

        {/* Completed module tags — data chips (green) vs setup chips (grey) */}
        {(completedSteps.length > 0 || configSteps.length > 0) && (
          <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
            {completedSteps.map(s => (
              <span key={s.table} style={{
                fontSize: 11, color: "#4ade80",
                background: "#0f2b0f", border: "1px solid #1a4d1a",
                borderRadius: 4, padding: "2px 10px",
                fontFamily: "inherit",
              }}>
                ✓ {TERM_TABLE_LABELS[s.table] ?? s.table} ({s.rowsInserted} rows)
              </span>
            ))}
            {configSteps.map(s => (
              <span key={s.table} style={{
                fontSize: 11, color: "#8aa78a",
                background: "#131a13", border: "1px dashed #2a3a2a",
                borderRadius: 4, padding: "2px 10px",
                fontFamily: "inherit",
              }} title="Internal configuration/seed write — not a data row from your file">
                ⚙ Setup · {TERM_TABLE_LABELS[s.table] ?? s.table} ({s.rowsInserted})
              </span>
            ))}
          </div>
        )}

        {/* Summary stats when done — data rows first, setup writes separately */}
        {!isLive && data && (
          <>
            <div style={{ display: "flex", gap: 24, marginTop: (completedSteps.length > 0 || configSteps.length > 0) ? 10 : 0 }}>
              <div>
                <span style={{ fontSize: 22, fontWeight: 700, color: (dataRowsDone > 0 || updatedRowsDone > 0) ? "#4ade80" : "#fbbf24" }}>
                  {dataRowsDone}
                </span>
                <span style={{ fontSize: 11, color: "#166534", marginLeft: 6 }}>new data rows</span>
              </div>
              {updatedRowsDone > 0 && (
                <div>
                  <span style={{ fontSize: 22, fontWeight: 700, color: "#4ade80" }}>
                    {updatedRowsDone}
                  </span>
                  <span style={{ fontSize: 11, color: "#166534", marginLeft: 6 }}>records updated</span>
                </div>
              )}
              {setupRowsDone > 0 && (
                <div>
                  <span style={{ fontSize: 22, fontWeight: 700, color: "#8aa78a" }}>
                    {setupRowsDone}
                  </span>
                  <span style={{ fontSize: 11, color: "#3a5a3a", marginLeft: 6 }}>setup entries</span>
                </div>
              )}
              {(data.totalErrors ?? 0) > 0 && (
                <div>
                  <span style={{ fontSize: 22, fontWeight: 700, color: "#f87171" }}>
                    {data.totalErrors}
                  </span>
                  <span style={{ fontSize: 11, color: "#5a2020", marginLeft: 6 }}>errors</span>
                </div>
              )}
            </div>
            {(status === "success" || status === "partial") && dataRowsDone === 0 && updatedRowsDone === 0 && (
              <div style={{
                marginTop: 10, padding: "8px 12px", borderRadius: 6,
                border: "1px solid #5a4a12", background: "#1d1707",
                fontSize: 11.5, color: "#fbbf24", lineHeight: 1.5,
              }}>
                ⚠ No data rows were imported from this file. Only internal setup entries were written — check that your file actually contains data rows and re-upload.
              </div>
            )}
          </>
        )}
      </div>

      {/* ── Footer — reflects the actual job state ─────────────────── */}
      <div style={{
        padding: "6px 20px",
        borderTop: "1px solid #141f14",
        background: "#0a1209",
        fontSize: 10.5,
        color: status === "cancelled" ? "#4d1a1a" : "#1a4d1a",
        textAlign: "center",
        letterSpacing: "0.02em",
      }}>
        {!data
          // No status response yet — saying "process finished" (or "running")
          // here would be a guess; the restored log above may be mid-run while
          // the server-side job actually completed long ago.
          ? "connecting · fetching live import status…"
          : isLive
          ? "process running in background · safe to close · check status at /onboarding/history"
          : status === "cancelled"
          ? "import stopped · nothing further was written · history at /onboarding/history"
          : "process finished · full record at /onboarding/history"}
      </div>
    </div>
  );
}
