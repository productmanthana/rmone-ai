/**
 * Data Cleaning Assistant — standalone page (own sidebar entry).
 *
 * Three surfaces:
 *  1. Assistant  — chat: attach a messy client Excel → backend cleans it
 *     deterministically (Claude Opus handles judgment calls) → download a
 *     file in the EXACT import-template format + a "Needs Review" tab.
 *  2. History    — every past cleaning run (stored in S3) with its counts.
 *  3. Results    — professional detail view of one run: what was processed,
 *     what was fixed, and every item that needs review, color-coded.
 *
 * Never writes to the database.
 */
import { useState, useRef, useEffect, useCallback, useMemo } from "react";
import { useLocation } from "wouter";
import { useAuth } from "@/lib/useAuth";
import { authHeaders } from "@/lib/api";
import { uploadFileSmart } from "@/lib/chunkedUpload";
import { isSuperAdmin } from "@/lib/roleResolver";
import { downloadCardTemplate } from "@/components/InlineDataGrid";
import {
  ArrowLeft, Paperclip, Send, Loader2, Download, Sparkles,
  FileSpreadsheet, AlertTriangle, CheckCircle2, History, MessageSquare,
  ChevronRight, ChevronDown, XCircle, ClipboardList, ArrowRight,
} from "lucide-react";

// ── Shapes (mirror the backend report) ──────────────────────────────────────

interface ReviewItem {
  sheet: string;
  row: number;
  issue: string;
  detail: string;
  action: string;
  level: "fix" | "check" | "info";
  record: string;
  data: string;
}
interface SheetReport {
  sourceSheet: string;
  module: string | null;
  targetSheet: string | null;
  totalRows: number;
  cleanRows: number;
  columnMap: { source: string; target: string | null; method: string }[];
  fixes: { dates: number; numbers: number; emails: number; trimmed: number; idsFilled: number };
  duplicates: { exactRemoved: number; conflictsResolved: number };
  crossRef?: { resolvedInFile: number; resolvedByAi: number; resolvedInDb: number; unresolved: number };
  notes: string[];
}
interface CleaningReport {
  fileName: string;
  startedAt?: string;
  finishedAt?: string;
  sheets: SheetReport[];
  reviewCount: number;
  reviewByIssue: Record<string, number>;
  review?: ReviewItem[];
  aiCalls: number;
  notes: string[];
}
interface DcSummary {
  sheets: number; rowsIn: number; rowsOut: number;
  fixed: number; dupes: number; review: number;
  fix: number; check: number; info: number;
}
interface SessionMeta {
  sessionId: string;
  stage: string;
  pct: number;
  message: string;
  updatedAt: string;
  error?: string;
  fileName?: string;
  summary?: DcSummary;
  reviewedAt?: string; // set once the user finished the import review — a decisions-applied file exists
}
interface StatusResp {
  stage: string; pct: number; message: string; error?: string;
  stale?: boolean; report?: CleaningReport | null; fileName?: string;
}

type Msg =
  | { role: "user" | "assistant"; kind?: undefined; content: string }
  | { role: "assistant"; kind: "progress"; content: string; pct: number; failed?: boolean }
  | { role: "assistant"; kind: "report"; content: string; report: CleaningReport; sessionId: string };

const WELCOME =
  "Hi! I'm the Data Cleaning Assistant. Attach a messy client Excel file and I'll:\n\n" +
  "• Map its columns onto RM ONE's exact import template (our column names, not the client's)\n" +
  "• Fix date, number and email formats\n" +
  "• Remove duplicate rows\n" +
  "• Cross-check Project IDs between tabs (and against the database)\n\n" +
  "When cleaning finishes, click \"Continue to Import\" and the clean rows load straight into the import grid — no download needed. Anything I couldn't safely fix is held back with a note explaining what's wrong; you fix those rows right on the import screen and add them back with one click. I never guess matches and I never change your live data.\n\n" +
  "Attach a file with the paperclip to get started — or ask me anything about how it works.";

// ── Import handoff ──────────────────────────────────────────────────────────
// Map a cleaning report to the import-page module card that should receive the
// cleaned file. Assignments/Schedule ride along with Projects (multi-tab card).
const CARD_FOR_MODULE: Record<string, string> = {
  projects: "projects", assignments: "projects", schedule: "projects",
  opportunities: "opportunities", team: "team", leads: "leads",
};
function importCardForReport(rep: CleaningReport): string | null {
  const cards = new Set<string>();
  for (const s of rep.sheets) {
    if (s.module && CARD_FOR_MODULE[s.module]) cards.add(CARD_FOR_MODULE[s.module]);
  }
  for (const c of ["projects", "opportunities", "team", "leads"]) {
    if (cards.has(c)) return c;
  }
  return null;
}

// Modules offered by the upfront "Download template" menu.
const TEMPLATE_MENU: { id: string; label: string; multiTab: boolean }[] = [
  { id: "team",          label: "Resources (People)",                      multiTab: false },
  { id: "leads",         label: "Leads",                                    multiTab: false },
  { id: "opportunities", label: "Opportunities",                            multiTab: true },
  { id: "projects",      label: "Projects (+ Team Assignments & Schedule)", multiTab: true },
];

// Same palette as the Excel "Needs Review" tab badges.
const LEVEL_META: Record<ReviewItem["level"], { label: string; fg: string; bg: string }> = {
  fix:   { label: "Action needed",  fg: "#c0392b", bg: "rgba(192, 57, 43, 0.13)" },
  check: { label: "Worth checking", fg: "#b26a00", bg: "rgba(178, 106, 0, 0.14)" },
  info:  { label: "FYI only",       fg: "#3b5bdb", bg: "rgba(59, 91, 219, 0.12)" },
};

const border = "1px solid var(--rm-panel-border)";

function fmtDate(iso?: string): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleString(undefined, { year: "numeric", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
}

function LevelBadge({ level }: { level: ReviewItem["level"] }) {
  const m = LEVEL_META[level];
  return (
    <span style={{
      display: "inline-block", padding: "2px 9px", borderRadius: 999,
      fontSize: 11, fontWeight: 700, color: m.fg, background: m.bg, whiteSpace: "nowrap",
    }}>
      {m.label}
    </span>
  );
}

function StatCard({ label, value, accent }: { label: string; value: string | number; accent?: string }) {
  return (
    <div style={{ flex: "1 1 130px", minWidth: 120, background: "var(--rm-panel-bg)", border, borderRadius: 10, padding: "12px 14px" }}>
      <div style={{ fontSize: 20, fontWeight: 800, color: accent ?? "var(--rm-text)", lineHeight: 1.2 }}>{value}</div>
      <div style={{ fontSize: 11, color: "var(--rm-text-muted)", marginTop: 3, fontWeight: 600, letterSpacing: "0.02em" }}>{label}</div>
    </div>
  );
}

// ── Continue-to-Import picker ────────────────────────────────────────────────
// Like the "Download template" menu: the user picks which import screen the
// clean rows load into. The module detected from the report is marked
// "Suggested" and listed first, but the choice is always the user's.
function ContinueImportMenu({ suggested, onPick, testIdPrefix, align = "left" }: {
  suggested: string | null;
  onPick: (card: string) => void;
  testIdPrefix: string;
  align?: "left" | "right";
}) {
  const [open, setOpen] = useState(false);
  const items = [...TEMPLATE_MENU].sort((a, b) =>
    Number(b.id === suggested) - Number(a.id === suggested));
  return (
    <div style={{ position: "relative", display: "inline-block" }}>
      <button onClick={() => setOpen(o => !o)} data-testid={`${testIdPrefix}-continue`} style={{ display: "flex", alignItems: "center", gap: 7, padding: "8px 16px", fontSize: 13, fontWeight: 600, borderRadius: 8, background: "var(--rm-green)", border: "none", color: "#fff", cursor: "pointer" }}>
        <ArrowRight size={14} /> Continue to Import <ChevronDown size={14} />
      </button>
      {open && (
        <>
          <div style={{ position: "fixed", inset: 0, zIndex: 40 }} onClick={() => setOpen(false)} />
          <div style={{ position: "absolute", top: "calc(100% + 6px)", [align]: 0, zIndex: 41, minWidth: 300, background: "var(--rm-panel-bg)", border, borderRadius: 10, boxShadow: "var(--rm-shadow, 0 8px 24px rgba(0,0,0,0.18))", overflow: "hidden" } as React.CSSProperties}>
            <div style={{ padding: "9px 14px 7px", fontSize: 11, fontWeight: 700, color: "var(--rm-text-muted)", letterSpacing: "0.04em", textTransform: "uppercase" }}>
              Load the clean rows into…
            </div>
            {items.map(t => (
              <button
                key={t.id}
                onClick={() => { setOpen(false); onPick(t.id); }}
                data-testid={`${testIdPrefix}-continue-${t.id}`}
                style={{ display: "flex", alignItems: "center", gap: 8, width: "100%", textAlign: "left", padding: "10px 14px", fontSize: 12.5, fontWeight: 600, background: "transparent", border: "none", borderTop: border, color: "var(--rm-text)", cursor: "pointer" }}
                onMouseEnter={e => { e.currentTarget.style.background = "var(--rm-panel-hover)"; }}
                onMouseLeave={e => { e.currentTarget.style.background = "transparent"; }}
              >
                <FileSpreadsheet size={14} color="var(--rm-green)" />
                <span style={{ flex: 1 }}>{t.label}</span>
                {t.id === suggested && (
                  <span style={{ fontSize: 10, fontWeight: 700, color: "var(--rm-green)", background: "rgba(107,165,57,0.14)", borderRadius: 999, padding: "2px 8px" }}>Suggested</span>
                )}
              </button>
            ))}
          </div>
        </>
      )}
    </div>
  );
}

// ── Results detail view ──────────────────────────────────────────────────────

function ResultsDetail({ report, sessionId, onBack, onDownload, onContinue }: {
  report: CleaningReport;
  sessionId: string;
  onBack: () => void;
  onDownload: (sid: string, fileName: string) => void;
  onContinue?: (card: string) => void;
}) {
  const [levelFilter, setLevelFilter] = useState<"all" | ReviewItem["level"]>("all");
  const [sheetFilter, setSheetFilter] = useState<string>("all");

  const cleaned = report.sheets.filter(s => s.module);
  const skipped = report.sheets.filter(s => !s.module);
  const review = report.review ?? [];

  const totals = useMemo(() => ({
    rowsIn:  cleaned.reduce((a, s) => a + s.totalRows, 0),
    rowsOut: cleaned.reduce((a, s) => a + s.cleanRows, 0),
    fixed:   cleaned.reduce((a, s) => a + s.fixes.dates + s.fixes.numbers + s.fixes.emails + s.fixes.idsFilled, 0),
    dupes:   cleaned.reduce((a, s) => a + s.duplicates.exactRemoved + s.duplicates.conflictsResolved, 0),
    fix:     review.filter(r => r.level === "fix").length,
    check:   review.filter(r => r.level === "check").length,
    info:    review.filter(r => r.level === "info").length,
  }), [report]); // eslint-disable-line react-hooks/exhaustive-deps

  const reviewSheets = useMemo(() => Array.from(new Set(review.map(r => r.sheet))).sort(), [report]); // eslint-disable-line react-hooks/exhaustive-deps

  const LEVEL_ORDER: Record<ReviewItem["level"], number> = { fix: 0, check: 1, info: 2 };
  const filtered = review
    .filter(r => (levelFilter === "all" || r.level === levelFilter) && (sheetFilter === "all" || r.sheet === sheetFilter))
    .sort((a, b) => LEVEL_ORDER[a.level] - LEVEL_ORDER[b.level] || a.sheet.localeCompare(b.sheet) || a.row - b.row);
  const RENDER_CAP = 400;
  const shown = filtered.slice(0, RENDER_CAP);

  const pill = (active: boolean, fg?: string) => ({
    padding: "5px 12px", fontSize: 12, fontWeight: 600, borderRadius: 999, cursor: "pointer",
    border: active ? `1.5px solid ${fg ?? "var(--rm-green)"}` : border,
    background: active ? (fg ? `${fg}18` : "rgba(107,165,57,0.12)") : "var(--rm-panel-bg)",
    color: active ? (fg ?? "var(--rm-green)") : "var(--rm-text-muted)",
  } as const);

  const sectionTitle = { fontSize: 13, fontWeight: 800, color: "var(--rm-text)", letterSpacing: "0.02em", marginBottom: 10 } as const;

  return (
    <div style={{ flex: 1, overflowY: "auto", minHeight: 0 }}>
      <div style={{ maxWidth: 980, margin: "0 auto", padding: "18px 24px 40px" }}>
        {/* Title bar */}
        <div style={{ display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap", marginBottom: 16 }}>
          <button onClick={onBack} data-testid="button-results-back" style={{ display: "flex", alignItems: "center", gap: 5, padding: "6px 11px", fontSize: 12, borderRadius: 6, background: "transparent", border, color: "var(--rm-text-muted)", cursor: "pointer" }}>
            <ArrowLeft size={13} /> Back
          </button>
          <div style={{ minWidth: 0 }}>
            <div style={{ fontSize: 17, fontWeight: 800, color: "var(--rm-text)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
              {report.fileName}
            </div>
            <div style={{ fontSize: 11.5, color: "var(--rm-text-muted)" }}>
              Cleaned {fmtDate(report.finishedAt)}{report.aiCalls > 0 ? ` · ${report.aiCalls} AI decision${report.aiCalls === 1 ? "" : "s"}` : ""}
            </div>
          </div>
          <div style={{ marginLeft: "auto", display: "flex", gap: 8, flexWrap: "wrap" }}>
            {onContinue && (
              <ContinueImportMenu
                suggested={importCardForReport(report)}
                onPick={onContinue}
                testIdPrefix="button-results"
                align="right"
              />
            )}
            <button onClick={() => onDownload(sessionId, report.fileName)} data-testid="button-results-download" style={{ display: "flex", alignItems: "center", gap: 7, padding: "8px 16px", fontSize: 13, fontWeight: 600, borderRadius: 8, background: "transparent", border: "1.5px solid var(--rm-green)", color: "var(--rm-green)", cursor: "pointer" }}>
              <Download size={14} /> Download cleaned file
            </button>
          </div>
        </div>

        {/* Stat cards */}
        <div style={{ display: "flex", gap: 10, flexWrap: "wrap", marginBottom: 22 }}>
          <StatCard label="Rows kept" value={`${totals.rowsOut.toLocaleString()} / ${totals.rowsIn.toLocaleString()}`} />
          <StatCard label="Values fixed" value={totals.fixed.toLocaleString()} accent="var(--rm-green)" />
          <StatCard label="Duplicates removed" value={totals.dupes.toLocaleString()} />
          <StatCard label="Action needed" value={totals.fix} accent={totals.fix > 0 ? LEVEL_META.fix.fg : undefined} />
          <StatCard label="Worth checking" value={totals.check} accent={totals.check > 0 ? LEVEL_META.check.fg : undefined} />
          <StatCard label="FYI only" value={totals.info} accent={totals.info > 0 ? LEVEL_META.info.fg : undefined} />
        </div>

        {/* What was processed */}
        <div style={sectionTitle}>WHAT WAS PROCESSED</div>
        <div style={{ background: "var(--rm-panel-bg)", border, borderRadius: 10, overflow: "hidden", marginBottom: 22 }}>
          {cleaned.map((s, i) => {
            const fixes = s.fixes.dates + s.fixes.numbers + s.fixes.emails + s.fixes.idsFilled;
            const dupes = s.duplicates.exactRemoved + s.duplicates.conflictsResolved;
            return (
              <div key={s.sourceSheet} style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap", padding: "11px 16px", borderTop: i > 0 ? border : "none" }}>
                <FileSpreadsheet size={15} color="var(--rm-text-muted)" style={{ flexShrink: 0 }} />
                <div style={{ fontWeight: 700, fontSize: 13, color: "var(--rm-text)" }}>{s.sourceSheet}</div>
                <ChevronRight size={13} color="var(--rm-text-muted)" />
                <div style={{ fontSize: 13, color: "var(--rm-text)" }}>{s.targetSheet}</div>
                <div style={{ marginLeft: "auto", display: "flex", gap: 14, fontSize: 12, color: "var(--rm-text-muted)", flexWrap: "wrap" }}>
                  <span><b style={{ color: "var(--rm-text)" }}>{s.cleanRows.toLocaleString()}</b> of {s.totalRows.toLocaleString()} rows kept</span>
                  <span><b style={{ color: "var(--rm-text)" }}>{fixes.toLocaleString()}</b> fixed</span>
                  {dupes > 0 && <span><b style={{ color: "var(--rm-text)" }}>{dupes}</b> dupes removed</span>}
                  {s.crossRef && s.crossRef.unresolved > 0 && (
                    <span style={{ color: LEVEL_META.check.fg, fontWeight: 600 }}>{s.crossRef.unresolved} unknown project refs</span>
                  )}
                </div>
              </div>
            );
          })}
          {skipped.map(s => (
            <div key={s.sourceSheet} style={{ display: "flex", alignItems: "center", gap: 10, padding: "11px 16px", borderTop: border, fontSize: 12.5, color: "var(--rm-text-muted)" }}>
              <AlertTriangle size={14} color={LEVEL_META.check.fg} style={{ flexShrink: 0 }} />
              "{s.sourceSheet}" wasn't recognised as a template tab — skipped ({s.totalRows.toLocaleString()} rows).
            </div>
          ))}
          {cleaned.length === 0 && skipped.length === 0 && (
            <div style={{ padding: "14px 16px", fontSize: 13, color: "var(--rm-text-muted)" }}>No sheets were processed.</div>
          )}
        </div>

        {/* Needs review */}
        <div style={{ display: "flex", alignItems: "baseline", gap: 10, flexWrap: "wrap", marginBottom: 10 }}>
          <div style={{ ...sectionTitle, marginBottom: 0 }}>NEEDS YOUR ATTENTION</div>
          <div style={{ fontSize: 12, color: "var(--rm-text-muted)" }}>
            {report.reviewCount === 0
              ? "Nothing needs review 🎉"
              : `${report.reviewCount.toLocaleString()} item${report.reviewCount === 1 ? "" : "s"} — rows needing a fix are on the "— Review" tabs of the downloaded file`}
          </div>
        </div>

        {report.reviewCount > 0 && (
          <>
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 12 }}>
              <button style={pill(levelFilter === "all")} onClick={() => setLevelFilter("all")} data-testid="pill-level-all">
                All ({review.length})
              </button>
              <button style={pill(levelFilter === "fix", LEVEL_META.fix.fg)} onClick={() => setLevelFilter("fix")} data-testid="pill-level-fix">
                Action needed ({totals.fix})
              </button>
              <button style={pill(levelFilter === "check", LEVEL_META.check.fg)} onClick={() => setLevelFilter("check")} data-testid="pill-level-check">
                Worth checking ({totals.check})
              </button>
              <button style={pill(levelFilter === "info", LEVEL_META.info.fg)} onClick={() => setLevelFilter("info")} data-testid="pill-level-info">
                FYI only ({totals.info})
              </button>
              {reviewSheets.length > 1 && (
                <select
                  value={sheetFilter}
                  onChange={e => setSheetFilter(e.target.value)}
                  data-testid="select-sheet-filter"
                  style={{ marginLeft: "auto", padding: "5px 10px", fontSize: 12, borderRadius: 8, border, background: "var(--rm-panel-bg)", color: "var(--rm-text)" }}
                >
                  <option value="all">All tabs</option>
                  {reviewSheets.map(s => <option key={s} value={s}>{s}</option>)}
                </select>
              )}
            </div>

            <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
              {shown.map((it, i) => (
                <div key={i} style={{ background: "var(--rm-panel-bg)", border, borderRadius: 10, padding: "11px 15px" }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap", marginBottom: 5 }}>
                    <LevelBadge level={it.level} />
                    <span style={{ fontSize: 13, fontWeight: 700, color: "var(--rm-text)" }}>{it.issue}</span>
                    <span style={{ fontSize: 11.5, color: "var(--rm-text-muted)" }}>{it.sheet} · Row {it.row}</span>
                    {it.record && (
                      <span style={{ marginLeft: "auto", fontSize: 11.5, color: "var(--rm-text-muted)", maxWidth: 320, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                        {it.record}
                      </span>
                    )}
                  </div>
                  <div style={{ fontSize: 12.5, color: "var(--rm-text)", lineHeight: 1.5 }}>{it.detail}</div>
                  {it.action && (
                    <div style={{ fontSize: 12.5, color: "var(--rm-text-muted)", lineHeight: 1.5, marginTop: 3 }}>
                      <b style={{ color: "var(--rm-text)" }}>What to do:</b> {it.action}
                    </div>
                  )}
                </div>
              ))}
            </div>

            {filtered.length > RENDER_CAP && (
              <div style={{ fontSize: 12, color: "var(--rm-text-muted)", marginTop: 10 }}>
                Showing the first {RENDER_CAP} of {filtered.length.toLocaleString()} items — the "— Review" tabs in the downloaded file carry every row that needs a fix.
              </div>
            )}
            {review.length === 0 && (
              <div style={{ fontSize: 12.5, color: "var(--rm-text-muted)" }}>
                The per-item detail wasn't stored for this run (it predates the results view) — the review tab in the downloaded file has the full list.
              </div>
            )}
          </>
        )}

        {/* Notes */}
        {report.notes.length > 0 && (
          <>
            <div style={{ ...sectionTitle, marginTop: 22 }}>NOTES</div>
            <div style={{ background: "var(--rm-panel-bg)", border, borderRadius: 10, padding: "12px 16px", display: "flex", flexDirection: "column", gap: 6 }}>
              {report.notes.map((n, i) => (
                <div key={i} style={{ fontSize: 12.5, color: "var(--rm-text-muted)", lineHeight: 1.5 }}>• {n}</div>
              ))}
            </div>
          </>
        )}
      </div>
    </div>
  );
}

// ── History view ─────────────────────────────────────────────────────────────

function HistoryView({ sessions, loading, error, onOpen, onDownload, onRefresh }: {
  sessions: SessionMeta[] | null;
  loading: boolean;
  error: string | null;
  onOpen: (s: SessionMeta) => void;
  onDownload: (sid: string, fileName: string, which?: "reviewed") => void;
  onRefresh: () => void;
}) {
  return (
    <div style={{ flex: 1, overflowY: "auto", minHeight: 0 }}>
      <div style={{ maxWidth: 980, margin: "0 auto", padding: "18px 24px 40px" }}>
        <div style={{ display: "flex", alignItems: "center", marginBottom: 14 }}>
          <div style={{ fontSize: 13, fontWeight: 800, color: "var(--rm-text)", letterSpacing: "0.02em" }}>PAST CLEANINGS</div>
          <button onClick={onRefresh} disabled={loading} data-testid="button-history-refresh" style={{ marginLeft: "auto", padding: "5px 12px", fontSize: 12, borderRadius: 6, border, background: "var(--rm-panel-bg)", color: "var(--rm-text-muted)", cursor: loading ? "default" : "pointer", opacity: loading ? 0.6 : 1 }}>
            {loading ? "Refreshing…" : "Refresh"}
          </button>
        </div>

        {error && (
          <div style={{ background: "var(--rm-panel-bg)", border, borderRadius: 10, padding: "14px 16px", fontSize: 13, color: LEVEL_META.fix.fg }}>
            Couldn't load history: {error}
          </div>
        )}
        {!error && loading && !sessions && (
          <div style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 13, color: "var(--rm-text-muted)", padding: "18px 4px" }}>
            <Loader2 size={15} style={{ animation: "spin 1s linear infinite" }} /> Loading history…
          </div>
        )}
        {!error && sessions && sessions.length === 0 && (
          <div style={{ background: "var(--rm-panel-bg)", border, borderRadius: 10, padding: "22px 16px", fontSize: 13, color: "var(--rm-text-muted)", textAlign: "center" }}>
            No cleanings yet. Attach a file in the Assistant tab to run your first one.
          </div>
        )}

        <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          {(sessions ?? []).map(s => {
            const done = s.stage === "done";
            const failed = s.stage === "failed";
            const running = !done && !failed;
            return (
              <div
                key={s.sessionId}
                onClick={() => { if (done) onOpen(s); }}
                data-testid={`history-row-${s.sessionId}`}
                style={{ background: "var(--rm-panel-bg)", border, borderRadius: 10, padding: "13px 16px", cursor: done ? "pointer" : "default" }}
              >
                <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
                  {done && <CheckCircle2 size={16} color="var(--rm-green)" style={{ flexShrink: 0 }} />}
                  {failed && <XCircle size={16} color={LEVEL_META.fix.fg} style={{ flexShrink: 0 }} />}
                  {running && <Loader2 size={16} color="var(--rm-text-muted)" style={{ flexShrink: 0, animation: "spin 1s linear infinite" }} />}
                  <div style={{ fontWeight: 700, fontSize: 13.5, color: "var(--rm-text)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", maxWidth: 380 }}>
                    {s.fileName ?? "Excel file"}
                  </div>
                  <div style={{ fontSize: 11.5, color: "var(--rm-text-muted)" }}>{fmtDate(s.updatedAt)}</div>
                  <div style={{ marginLeft: "auto", display: "flex", alignItems: "center", gap: 8 }}>
                    {done && (
                      <>
                        <button
                          onClick={e => { e.stopPropagation(); onDownload(s.sessionId, s.fileName ?? "file.xlsx"); }}
                          title="Download cleaned file"
                          data-testid={`button-history-download-${s.sessionId}`}
                          style={{ display: "flex", alignItems: "center", gap: 5, padding: "5px 11px", fontSize: 12, fontWeight: 600, borderRadius: 6, border, background: "transparent", color: "var(--rm-text)", cursor: "pointer" }}
                        >
                          <Download size={13} /> Cleaned
                        </button>
                        {s.reviewedAt && (
                          <button
                            onClick={e => { e.stopPropagation(); onDownload(s.sessionId, s.fileName ?? "file.xlsx", "reviewed"); }}
                            title="Download the reviewed file — your import-review decisions applied"
                            data-testid={`button-history-download-reviewed-${s.sessionId}`}
                            style={{ display: "flex", alignItems: "center", gap: 5, padding: "5px 11px", fontSize: 12, fontWeight: 600, borderRadius: 6, border: "1.5px solid var(--rm-green)", background: "transparent", color: "var(--rm-green)", cursor: "pointer" }}
                          >
                            <Download size={13} /> Reviewed
                          </button>
                        )}
                        <span style={{ display: "flex", alignItems: "center", gap: 4, fontSize: 12, fontWeight: 600, color: "var(--rm-green)" }}>
                          View results <ChevronRight size={14} />
                        </span>
                      </>
                    )}
                    {failed && <span style={{ fontSize: 12, fontWeight: 600, color: LEVEL_META.fix.fg }}>Failed</span>}
                    {running && <span style={{ fontSize: 12, color: "var(--rm-text-muted)" }}>{s.message || "Working…"} ({s.pct}%)</span>}
                  </div>
                </div>
                {done && s.summary && (
                  <div style={{ display: "flex", gap: 14, flexWrap: "wrap", fontSize: 12, color: "var(--rm-text-muted)", marginTop: 7, paddingLeft: 26 }}>
                    <span><b style={{ color: "var(--rm-text)" }}>{s.summary.rowsOut.toLocaleString()}</b> rows kept</span>
                    <span><b style={{ color: "var(--rm-text)" }}>{s.summary.fixed.toLocaleString()}</b> values fixed</span>
                    <span><b style={{ color: "var(--rm-text)" }}>{s.summary.dupes.toLocaleString()}</b> dupes removed</span>
                    {s.summary.fix > 0 && <span style={{ color: LEVEL_META.fix.fg, fontWeight: 600 }}>{s.summary.fix} action needed</span>}
                    {s.summary.check > 0 && <span style={{ color: LEVEL_META.check.fg, fontWeight: 600 }}>{s.summary.check} worth checking</span>}
                    {s.summary.info > 0 && <span style={{ color: LEVEL_META.info.fg, fontWeight: 600 }}>{s.summary.info} FYI</span>}
                  </div>
                )}
                {failed && s.error && (
                  <div style={{ fontSize: 12, color: "var(--rm-text-muted)", marginTop: 6, paddingLeft: 26 }}>{s.error}</div>
                )}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

// ── Page ─────────────────────────────────────────────────────────────────────

export default function DataCleaningPage() {
  const { user } = useAuth();
  const superAdmin = isSuperAdmin(user?.username, user?.tenant);

  const [view, setView] = useState<"chat" | "history">("chat");
  const [detail, setDetail] = useState<{ sessionId: string; report: CleaningReport; from: "chat" | "history" } | null>(null);
  const [detailLoading, setDetailLoading] = useState<string | null>(null);

  const [msgs, setMsgs] = useState<Msg[]>([{ role: "assistant", content: WELCOME }]);
  const [input, setInput] = useState("");
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [tenantOverride, setTenantOverride] = useState("");
  const [uploading, setUploading] = useState(false);
  const [polling, setPolling] = useState(false);
  const [chatBusy, setChatBusy] = useState(false);

  const [sessions, setSessions] = useState<SessionMeta[] | null>(null);
  const [sessionsLoading, setSessionsLoading] = useState(false);
  const [sessionsError, setSessionsError] = useState<string | null>(null);

  const fileRef = useRef<HTMLInputElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const pollTimer = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" });
  }, [msgs]);

  useEffect(() => () => { if (pollTimer.current) clearInterval(pollTimer.current); }, []);

  const tenantParam = superAdmin && tenantOverride.trim()
    ? `?tenantId=${encodeURIComponent(tenantOverride.trim())}` : "";

  const loadSessions = useCallback(async () => {
    setSessionsLoading(true);
    setSessionsError(null);
    try {
      const r = await fetch(`/api/data-cleaning/sessions${tenantParam}`, { headers: authHeaders() });
      const j = await r.json();
      if (!r.ok) throw new Error(j?.error ?? `Failed (${r.status})`);
      setSessions(Array.isArray(j.sessions) ? j.sessions : []);
    } catch (e) {
      setSessionsError(e instanceof Error ? e.message : String(e));
    } finally {
      setSessionsLoading(false);
    }
  }, [tenantParam]);

  useEffect(() => {
    if (view === "history") void loadSessions();
  }, [view, loadSessions]);

  const setProgress = useCallback((content: string, pct: number, failed = false) => {
    setMsgs(prev => {
      const next = [...prev];
      const i = next.findIndex(m => m.kind === "progress");
      const bubble: Msg = { role: "assistant", kind: "progress", content, pct, failed };
      if (i >= 0) next[i] = bubble; else next.push(bubble);
      return next;
    });
  }, []);

  const startPolling = useCallback((sid: string) => {
    setPolling(true);
    if (pollTimer.current) clearInterval(pollTimer.current);
    pollTimer.current = setInterval(async () => {
      try {
        const r = await fetch(`/api/data-cleaning/status/${sid}${tenantParam}`, { headers: authHeaders() });
        if (!r.ok) return;
        const st: StatusResp = await r.json();
        if (st.stage === "done" && st.report) {
          if (pollTimer.current) clearInterval(pollTimer.current);
          setPolling(false);
          setMsgs(prev => {
            const next = prev.filter(m => m.kind !== "progress");
            next.push({ role: "assistant", kind: "report", content: "", report: st.report!, sessionId: sid });
            return next;
          });
          setSessions(null); // history is stale now — refetch on next open
        } else if (st.stage === "failed") {
          if (pollTimer.current) clearInterval(pollTimer.current);
          setPolling(false);
          setProgress(`Cleaning failed: ${st.error ?? "unknown error"}. Please try the file again.`, 100, true);
        } else if (st.stale) {
          if (pollTimer.current) clearInterval(pollTimer.current);
          setPolling(false);
          setProgress("The cleaning run stopped responding (the server may have restarted). Please attach the file again.", 100, true);
        } else {
          setProgress(st.message || "Working…", st.pct ?? 0);
        }
      } catch { /* transient poll error — keep trying */ }
    }, 2000);
  }, [tenantParam, setProgress]);

  const handleFile = async (f: File) => {
    if (uploading || polling) return;
    setUploading(true);
    setMsgs(prev => [...prev.filter(m => m.kind !== "progress" && m.kind !== "report"),
      { role: "user", content: `📎 ${f.name}` }]);
    try {
      const r = await uploadFileSmart({
        url: "/api/data-cleaning/upload",
        file: f,
        extra: superAdmin && tenantOverride.trim() ? { tenantId: tenantOverride.trim() } : {},
        headers: authHeaders(),
      });
      const j = await r.json();
      if (!r.ok) throw new Error(j?.error ?? `Upload failed (${r.status})`);
      setSessionId(j.sessionId);
      setProgress("File received — starting analysis…", 2);
      startPolling(j.sessionId);
    } catch (e) {
      setMsgs(prev => [...prev, { role: "assistant", content: `Sorry — upload failed: ${e instanceof Error ? e.message : String(e)}` }]);
    } finally {
      setUploading(false);
      if (fileRef.current) fileRef.current.value = "";
    }
  };

  const sendChat = async () => {
    const text = input.trim();
    if (!text || chatBusy) return;
    setInput("");
    const history = msgs
      .filter(m => !m.kind)
      .map(m => ({ role: m.role, content: m.content }));
    setMsgs(prev => [...prev, { role: "user", content: text }, { role: "assistant", content: "" }]);
    setChatBusy(true);
    try {
      const r = await fetch("/api/data-cleaning/chat", {
        method: "POST",
        headers: { ...authHeaders(), "Content-Type": "application/json" },
        body: JSON.stringify({
          sessionId,
          messages: [...history, { role: "user", content: text }],
          ...(superAdmin && tenantOverride.trim() ? { tenantId: tenantOverride.trim() } : {}),
        }),
      });
      if (!r.ok || !r.body) throw new Error(`Chat failed (${r.status})`);
      const reader = r.body.getReader();
      const dec = new TextDecoder();
      let buf = "";
      let acc = "";
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        buf += dec.decode(value, { stream: true });
        const lines = buf.split("\n\n");
        buf = lines.pop() ?? "";
        for (const line of lines) {
          if (!line.startsWith("data:")) continue;
          try {
            const ev = JSON.parse(line.slice(5).trim());
            if (ev.content) {
              acc += ev.content;
              setMsgs(prev => {
                const next = [...prev];
                const last = next[next.length - 1];
                if (last && last.role === "assistant" && !last.kind) next[next.length - 1] = { role: "assistant", content: acc };
                return next;
              });
            }
            if (ev.error) throw new Error(ev.error);
          } catch (e) {
            if (e instanceof SyntaxError) continue;
            throw e;
          }
        }
      }
      if (!acc) {
        setMsgs(prev => {
          const next = [...prev];
          const last = next[next.length - 1];
          if (last && last.role === "assistant" && !last.kind && !last.content) {
            next[next.length - 1] = { role: "assistant", content: "Sorry — I didn't get a response. Please try again." };
          }
          return next;
        });
      }
    } catch (e) {
      setMsgs(prev => {
        const next = [...prev];
        const last = next[next.length - 1];
        const errText = `Sorry — something went wrong: ${e instanceof Error ? e.message : String(e)}`;
        if (last && last.role === "assistant" && !last.kind && !last.content) next[next.length - 1] = { role: "assistant", content: errText };
        else next.push({ role: "assistant", content: errText });
        return next;
      });
    } finally {
      setChatBusy(false);
    }
  };

  const download = async (sid: string, fileName: string, which?: "reviewed") => {
    try {
      const extra = which === "reviewed" ? `${tenantParam ? "&" : "?"}which=reviewed` : "";
      const r = await fetch(`/api/data-cleaning/download/${sid}${tenantParam}${extra}`, { headers: authHeaders() });
      if (!r.ok) throw new Error("File not ready");
      const blob = await r.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = fileName.replace(/\.(xlsx|xls)$/i, "") + (which === "reviewed" ? "-REVIEWED.xlsx" : "-CLEANED.xlsx");
      a.click();
      URL.revokeObjectURL(url);
    } catch (e) {
      setMsgs(prev => [...prev, { role: "assistant", content: `Download failed: ${e instanceof Error ? e.message : String(e)}` }]);
    }
  };

  const [, navigate] = useLocation();
  const [tplMenuOpen, setTplMenuOpen] = useState(false);
  const continueToImport = (sid: string, card: string) => {
    // Superadmin tenant override: the cleaning session lives under the
    // override tenant, so the import page must fetch it with the same tenant.
    const t = superAdmin && tenantOverride.trim()
      ? `&tenant=${encodeURIComponent(tenantOverride.trim())}` : "";
    navigate(`/import?module=${card}&cleaned=${sid}${t}`);
  };

  const openHistoryDetail = async (s: SessionMeta) => {
    setDetailLoading(s.sessionId);
    try {
      const r = await fetch(`/api/data-cleaning/report/${s.sessionId}${tenantParam}`, { headers: authHeaders() });
      const j = await r.json();
      if (!r.ok) throw new Error(j?.error ?? `Failed (${r.status})`);
      setDetail({ sessionId: s.sessionId, report: j.report as CleaningReport, from: "history" });
    } catch (e) {
      setSessionsError(e instanceof Error ? e.message : String(e));
    } finally {
      setDetailLoading(null);
    }
  };

  const tabBtn = (active: boolean) => ({
    display: "flex", alignItems: "center", gap: 6, padding: "7px 15px",
    fontSize: 12.5, fontWeight: 700, borderRadius: 8, cursor: "pointer",
    border: active ? "1.5px solid var(--rm-green)" : border,
    background: active ? "rgba(107,165,57,0.12)" : "transparent",
    color: active ? "var(--rm-green)" : "var(--rm-text-muted)",
  } as const);

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%", minHeight: 0, background: "var(--rm-bg)" }}>
      {/* Header */}
      <div style={{ background: "var(--rm-chrome-header-bg)", borderBottom: border, padding: "14px 24px 12px", flexShrink: 0, display: "flex", alignItems: "center", gap: 14, flexWrap: "wrap" }}>
        <div>
          <div style={{ fontSize: 10, fontWeight: 700, color: "var(--rm-green)", letterSpacing: "0.1em", textTransform: "uppercase", marginBottom: 2, display: "flex", alignItems: "center", gap: 5 }}>
            <Sparkles size={11} /> Data Cleaning
          </div>
          <div style={{ fontSize: 20, fontWeight: 800, color: "var(--rm-chrome-fg)", lineHeight: 1 }}>AI Assistant</div>
        </div>
        {!detail && (
          <div style={{ display: "flex", gap: 8, marginLeft: 14 }}>
            <button style={tabBtn(view === "chat")} onClick={() => setView("chat")} data-testid="tab-assistant">
              <MessageSquare size={13} /> Assistant
            </button>
            <button style={tabBtn(view === "history")} onClick={() => setView("history")} data-testid="tab-history">
              <History size={13} /> History
            </button>
            <div style={{ position: "relative" }}>
              <button style={tabBtn(tplMenuOpen)} onClick={() => setTplMenuOpen(o => !o)} data-testid="button-download-template">
                <FileSpreadsheet size={13} /> Download template
              </button>
              {tplMenuOpen && (
                <>
                  <div style={{ position: "fixed", inset: 0, zIndex: 40 }} onClick={() => setTplMenuOpen(false)} />
                  <div style={{ position: "absolute", top: "calc(100% + 6px)", left: 0, zIndex: 41, minWidth: 280, background: "var(--rm-panel-bg)", border, borderRadius: 10, boxShadow: "var(--rm-shadow, 0 8px 24px rgba(0,0,0,0.18))", overflow: "hidden" }}>
                    {TEMPLATE_MENU.map((t, i) => (
                      <button
                        key={t.id}
                        onClick={() => { setTplMenuOpen(false); void downloadCardTemplate(t.id, t.multiTab); }}
                        data-testid={`template-option-${t.id}`}
                        style={{ display: "flex", alignItems: "center", gap: 8, width: "100%", textAlign: "left", padding: "10px 14px", fontSize: 12.5, fontWeight: 600, background: "transparent", border: "none", borderTop: i > 0 ? border : "none", color: "var(--rm-text)", cursor: "pointer" }}
                        onMouseEnter={e => { e.currentTarget.style.background = "var(--rm-panel-hover)"; }}
                        onMouseLeave={e => { e.currentTarget.style.background = "transparent"; }}
                      >
                        <Download size={13} color="var(--rm-green)" /> {t.label}
                      </button>
                    ))}
                  </div>
                </>
              )}
            </div>
          </div>
        )}
        {detail && (
          <div style={{ display: "flex", alignItems: "center", gap: 6, marginLeft: 14, fontSize: 12.5, fontWeight: 700, color: "var(--rm-text-muted)" }}>
            <ClipboardList size={14} /> Cleaning results
          </div>
        )}
        {superAdmin && !detail && (
          <input
            value={tenantOverride}
            onChange={e => setTenantOverride(e.target.value)}
            placeholder="Tenant ID (optional — for DB cross-check)"
            data-testid="input-tenant-override"
            style={{ marginLeft: "auto", width: 300, padding: "6px 10px", fontSize: 12, borderRadius: 6, border, background: "var(--rm-panel-bg)", color: "var(--rm-text)" }}
          />
        )}
      </div>

      {/* Body */}
      {detail ? (
        <ResultsDetail
          report={detail.report}
          sessionId={detail.sessionId}
          onBack={() => { const from = detail.from; setDetail(null); setView(from); }}
          onDownload={download}
          onContinue={card => continueToImport(detail.sessionId, card)}
        />
      ) : view === "history" ? (
        <>
          <HistoryView
            sessions={sessions}
            loading={sessionsLoading || detailLoading !== null}
            error={sessionsError}
            onOpen={s => void openHistoryDetail(s)}
            onDownload={download}
            onRefresh={() => void loadSessions()}
          />
        </>
      ) : (
        <>
          {/* Messages */}
          <div ref={scrollRef} style={{ flex: 1, overflowY: "auto", padding: "18px 0" }}>
            <div style={{ maxWidth: 860, margin: "0 auto", padding: "0 24px", display: "flex", flexDirection: "column", gap: 12 }}>
              {msgs.map((m, i) => {
                if (m.kind === "progress") {
                  return (
                    <div key={i} style={{ alignSelf: "flex-start", maxWidth: "85%", background: "var(--rm-panel-bg)", border, borderRadius: 12, padding: "12px 16px" }}>
                      <div style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 13, color: m.failed ? "var(--rm-red, #d9534f)" : "var(--rm-text)" }}>
                        {m.failed ? <AlertTriangle size={15} /> : <Loader2 size={15} style={{ animation: "spin 1s linear infinite" }} />}
                        {m.content}
                      </div>
                      {!m.failed && (
                        <div style={{ marginTop: 8, height: 5, borderRadius: 3, background: "var(--rm-panel-hover)", overflow: "hidden" }}>
                          <div style={{ width: `${m.pct}%`, height: "100%", borderRadius: 3, background: "var(--rm-green)", transition: "width 0.6s" }} />
                        </div>
                      )}
                    </div>
                  );
                }
                if (m.kind === "report") {
                  const rep = m.report;
                  const cleaned = rep.sheets.filter(s => s.module);
                  const totalFix = cleaned.reduce((a, s) => a + s.fixes.dates + s.fixes.numbers + s.fixes.emails + s.fixes.idsFilled, 0);
                  const totalDup = cleaned.reduce((a, s) => a + s.duplicates.exactRemoved + s.duplicates.conflictsResolved, 0);
                  const fixCount = (rep.review ?? []).filter(r => r.level === "fix").length;
                  return (
                    <div key={i} style={{ alignSelf: "flex-start", maxWidth: "92%", background: "var(--rm-panel-bg)", border, borderRadius: 12, padding: "14px 18px" }}>
                      <div style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 14, fontWeight: 700, color: "var(--rm-text)", marginBottom: 8 }}>
                        <CheckCircle2 size={16} color="var(--rm-green)" /> Cleaning complete — {rep.fileName}
                      </div>
                      <div style={{ fontSize: 12.5, color: "var(--rm-text-muted)", marginBottom: 12 }}>
                        {totalFix.toLocaleString()} values fixed · {totalDup.toLocaleString()} duplicates removed
                        {rep.reviewCount > 0
                          ? <> · <span style={{ color: LEVEL_META.check.fg, fontWeight: 600 }}>{rep.reviewCount} items need review</span>
                              {fixCount > 0 && <> (<span style={{ color: LEVEL_META.fix.fg, fontWeight: 600 }}>{fixCount} need action</span>)</>}</>
                          : " · nothing needs review 🎉"}
                      </div>
                      <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
                        <ContinueImportMenu
                          suggested={importCardForReport(rep)}
                          onPick={card => continueToImport(m.sessionId, card)}
                          testIdPrefix="button-report"
                        />
                        <button
                          onClick={() => setDetail({ sessionId: m.sessionId, report: rep, from: "chat" })}
                          data-testid="button-view-results"
                          style={{ display: "flex", alignItems: "center", gap: 7, padding: "8px 16px", fontSize: 13, fontWeight: 600, borderRadius: 8, background: "transparent", border: `1.5px solid var(--rm-green)`, color: "var(--rm-green)", cursor: "pointer" }}
                        >
                          <ClipboardList size={14} /> View full results
                        </button>
                        <button
                          onClick={() => download(m.sessionId, rep.fileName)}
                          data-testid="button-download-cleaned"
                          style={{ display: "flex", alignItems: "center", gap: 7, padding: "8px 16px", fontSize: 13, fontWeight: 600, borderRadius: 8, background: "transparent", border: `1.5px solid var(--rm-green)`, color: "var(--rm-green)", cursor: "pointer" }}
                        >
                          <Download size={14} /> Download cleaned file
                        </button>
                      </div>
                      <div style={{ fontSize: 11.5, color: "var(--rm-text-muted)", marginTop: 8 }}>
                        Continue to Import lets you pick which import screen the clean rows load into — held-back rows can be fixed and added right there. Ask me anything about what was changed.
                      </div>
                    </div>
                  );
                }
                return (
                  <div key={i} style={{
                    alignSelf: m.role === "user" ? "flex-end" : "flex-start",
                    maxWidth: "85%",
                    background: m.role === "user" ? "var(--rm-green)" : "var(--rm-panel-bg)",
                    color: m.role === "user" ? "#fff" : "var(--rm-text)",
                    border: m.role === "user" ? "none" : border,
                    borderRadius: 12, padding: "10px 15px", fontSize: 13.5, lineHeight: 1.55,
                    whiteSpace: "pre-wrap", wordBreak: "break-word",
                  }}>
                    {m.content || (chatBusy && i === msgs.length - 1 ? <Loader2 size={14} style={{ animation: "spin 1s linear infinite" }} /> : m.content)}
                  </div>
                );
              })}
            </div>
          </div>

          {/* Composer */}
          <div style={{ borderTop: border, background: "var(--rm-chrome-header-bg)", padding: "12px 24px", flexShrink: 0 }}>
            <div style={{ maxWidth: 860, margin: "0 auto", display: "flex", alignItems: "center", gap: 10 }}>
              <input ref={fileRef} type="file" accept=".xlsx,.xls" style={{ display: "none" }}
                onChange={e => { const f = e.target.files?.[0]; if (f) void handleFile(f); }} />
              <button
                onClick={() => fileRef.current?.click()}
                disabled={uploading || polling}
                title="Attach an Excel file to clean"
                data-testid="button-attach-file"
                style={{ display: "flex", alignItems: "center", justifyContent: "center", width: 40, height: 40, borderRadius: 10, border, background: "var(--rm-panel-bg)", color: "var(--rm-text)", cursor: uploading || polling ? "not-allowed" : "pointer", opacity: uploading || polling ? 0.5 : 1 }}
              >
                {uploading ? <Loader2 size={17} style={{ animation: "spin 1s linear infinite" }} /> : <Paperclip size={17} />}
              </button>
              <input
                value={input}
                onChange={e => setInput(e.target.value)}
                onKeyDown={e => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); void sendChat(); } }}
                placeholder="Ask about the cleaning results, or attach a file…"
                data-testid="input-chat"
                style={{ flex: 1, padding: "10px 14px", fontSize: 13.5, borderRadius: 10, border, background: "var(--rm-panel-bg)", color: "var(--rm-text)" }}
              />
              <button
                onClick={() => void sendChat()}
                disabled={chatBusy || !input.trim()}
                data-testid="button-send-chat"
                style={{ display: "flex", alignItems: "center", justifyContent: "center", width: 40, height: 40, borderRadius: 10, border: "none", background: "var(--rm-green)", color: "#fff", cursor: chatBusy || !input.trim() ? "not-allowed" : "pointer", opacity: chatBusy || !input.trim() ? 0.5 : 1 }}
              >
                <Send size={16} />
              </button>
            </div>
          </div>
        </>
      )}
      <style>{`@keyframes spin { to { transform: rotate(360deg) } }`}</style>
    </div>
  );
}
