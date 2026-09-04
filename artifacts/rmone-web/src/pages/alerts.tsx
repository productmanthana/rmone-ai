// Alerts route — full Operational Risk Feed for the active role with
// severity filter chips. Reuses the same RiskRow component the home page
// renders so the visual language is consistent.

import { useEffect, useMemo, useRef, useState } from "react";
import { useLocation } from "wouter";
import { useAuth } from "@/lib/useAuth";
// Dismissal store shared with the home risk feed (RoleHome). The alerts
// page no longer offers a dismiss button (the row popup's actions replace
// it), but previously-ignored alerts are still honoured and restorable.
import { loadDismissed, saveDismissed, alertDismissKey } from "@/lib/alertDismiss";
import { resolveActiveRole, rolePersonaFullName } from "@/lib/roleResolver";
import {
  ROLE_HOME_DATA,
  type RiskItem,
  type RiskTone,
  type WindowKey,
} from "@/lib/roleHomeData";
import { RiskRow, buildRiskExplanation } from "@/components/RoleHome";
import { setChatPrompt } from "@/lib/chatBridge";
import { fetchHomeOverlay, type LiveOverlay } from "@/lib/homeLiveData";
import { subscribeDataChanged } from "@/lib/dataSync";
import { overlayCache, overlayCacheKey, readOverlayCache, writeOverlayCache, currentUserScope } from "@/lib/overlayCache";
import { useBusinessRulesVersion } from "@/lib/businessRules";
import { RiskSidePanel } from "@/components/RiskSidePanel";
import { useStaffingQuickActions } from "@/hooks/useStaffingQuickActions";
import type { ActionDetail } from "@/lib/homeIntelligence";
import { classifyIssueTarget, extractTicketIds, stripLeadingTicket } from "@/lib/issueLink";
import { classifyRisk } from "@/lib/plainLanguage";

// Build the same popup detail table the home page shows when you tap a
// risk row. Prefers the live underlying-records table attached to the
// risk (e.g. demand rows, bench resources, exposed projects) so the
// popup shows real data instead of fabricated owners / due dates.
// Falls back to a minimal title/issue summary when no records exist.
function buildRiskDetail(fullName: string, risk: RiskItem): ActionDetail {
  // REAL-DATA-ONLY: use the records the overlay already attached to
  // this risk (populated by homeIntelligence → homeLiveData). Only
  // backend alert-feed rows arrive without records.
  if (risk.records && risk.records.rows.length > 0) {
    return risk.records;
  }
  const sub = risk.sub ?? "";
  // Extract EVERY ticket ID (both PMM-26-001234 and OPM-00195 formats)
  // so an alert that bundles several projects renders one selectable
  // row per project — never a single row listing them all.
  const ids = extractTicketIds(`${risk.title} ${sub}`);
  const issue = stripLeadingTicket(risk.title);
  // Extract a human-readable project name from the sub-text.
  const projectName = sub
    ? sub.replace(/\s*\([^)]*\)\s*$/, "").trim().slice(0, 60)
    : "";
  const cols = [
    { key: "record", label: "Record / Item" },
    { key: "issue", label: "Issue" },
  ];
  let rows: Record<string, string>[];
  if (ids.length > 1) {
    // Multi-project alert: one row per project, each carrying its own
    // _ticket so Go-to-issue and the AI hand-off target THAT record.
    rows = ids.map((rid) => ({ record: rid, issue, _ticket: rid }));
  } else if (ids.length === 1) {
    rows = [{
      record: projectName && projectName !== issue ? `${ids[0]} · ${projectName}` : ids[0],
      issue,
      _ticket: ids[0],
    }];
  } else {
    // No real ticket ID can be extracted — this is a portfolio-level
    // metric or a curated/sample row, not a single addressable project.
    // Tag it so the chat hand-off never sends the AI hunting for a
    // project that doesn't exist (see _aggregate check in handleModalConfirm).
    rows = [{ record: risk.title, issue: sub || "—", _aggregate: "true" }];
  }
  const tier = risk.tone === "high" ? "CRITICAL" : risk.tone === "info" ? "INFO" : "WARNING";
  return {
    title: risk.title,
    subtitle: `${tier} · ${fullName}${sub ? ` · ${sub}` : ""}`,
    columns: cols,
    rows,
  };
}

const BG = "var(--rm-bg)";
const CARD = "var(--rm-panel)";

// Module-level stale-while-revalidate cache for the live alerts overlay.
// Survives page navigations within the SPA session so the user doesn't
// see the "RM ONE agents are evaluating" loader every time they revisit
// /alerts. Cleared when the tab is closed or the app reloads.
// overlayCache moved to @/lib/overlayCache so the App-level CachePrewarm
// can seed it on login, making /alerts render instantly the first time
// the user opens it.

type Filter = "all" | RiskTone;

const FILTERS: Array<{ key: Filter; label: string; color: string }> = [
  { key: "all", label: "All Alerts", color: "#A9C23F" },
  { key: "high", label: "Critical", color: "#FF4D2E" },
  { key: "med", label: "Warning", color: "#E87722" },
  { key: "info", label: "Information", color: "#A9C23F" },
];

export default function AlertsPage() {
  const { user } = useAuth();
  const [, setLocation] = useLocation();
  const [role, setRole] = useState(() => resolveActiveRole(user?.userRoles, user?.username));
  useEffect(() => {
    setRole(resolveActiveRole(user?.userRoles, user?.username));
    const onChange = () => setRole(resolveActiveRole(user?.userRoles, user?.username));
    window.addEventListener("rmone:roleOverrideChanged", onChange);
    return () => window.removeEventListener("rmone:roleOverrideChanged", onChange);
  }, [user?.userRoles, user?.username]);

  const [filter, setFilter] = useState<Filter>("all");
  const fullName = rolePersonaFullName(role);

  // Always use the role's default window — identical to RoleHome and to
  // the App-level login prewarm (warmOverlayCache). The home has no
  // day-window picker any more, so the old per-role localStorage window
  // preference is legacy; reading it here produced a DIFFERENT overlay
  // cache key than the one the prewarm/home wrote, which made /alerts
  // cold-fetch (10-20 s loader) even though a warm payload existed.
  const data = ROLE_HOME_DATA[role];
  const currentWindow: WindowKey = data.defaultWindow;

  // Live-data overlay — same one the home screen consumes. REAL-DATA-ONLY:
  // only live risks (records flagged at-risk by status text) are shown;
  // no curated/illustrative backfill.
  //
  // Stale-while-revalidate cache — SAME persisted store the home page
  // uses (readOverlayCache/writeOverlayCache): in-memory map first (SPA
  // navigation), then localStorage (survives full page reload, login
  // redirect, browser restart). Previously this page only checked the
  // in-memory map, so every hard reload cold-fetched for 10-20 s even
  // though the home's persisted seed was sitting right there.
  //
  // The cache key embeds the business-rules fingerprint, which resolves
  // shortly after app boot; subscribing to the rules version re-renders
  // this page when it lands so the key flips to the one the prewarm /
  // home wrote and the persisted seed is found.
  const businessRulesVer = useBusinessRulesVersion();
  const cacheKey = overlayCacheKey(role, currentWindow, user?.username);
  const seeded = readOverlayCache(role, currentWindow, user?.username);
  const [overlay, setOverlay] = useState<LiveOverlay | null>(seeded);
  const [overlayLoading, setOverlayLoading] = useState(!seeded);

  // Latest overlay shown on screen — lets the effect below decide to
  // refresh silently (keep rows visible) instead of blanking back to the
  // full loader when the cache key changes (e.g. rules fingerprint lands).
  const overlayRef = useRef<LiveOverlay | null>(seeded);
  useEffect(() => { overlayRef.current = overlay; }, [overlay]);

  // How often to silently re-fetch the overlay while the user is on this page.
  const POLL_INTERVAL_MS = 2 * 60 * 1000; // 2 minutes

  useEffect(() => {
    let alive = true;

    // Fetch generation counter. The allocation-changed listener below can
    // start a refetch while an earlier (pre-save) request is still in
    // flight; without this guard the older request could resolve LAST and
    // overwrite both the screen and the cache with its stale snapshot —
    // undoing the immediate post-assign refresh. Only the newest request
    // may write.
    let fetchSeq = 0;
    const doFetch = (silent: boolean) => {
      const seq = ++fetchSeq;
      if (!silent) {
        setOverlay(null);
        setOverlayLoading(true);
      }
      // Identity snapshot at fetch start — the write below is dropped if a
      // different user/tenant signed in while the fetch was in flight.
      const scopeAtStart = currentUserScope(user?.username);
      fetchHomeOverlay(role, currentWindow, { username: user?.username })
        .then((o) => {
          if (seq !== fetchSeq) return; // superseded by a newer fetch
          // Persists to memory + localStorage; refuses partial/empty
          // payloads so a bad fetch can never evict a good seed.
          writeOverlayCache(role, currentWindow, user?.username, o, scopeAtStart);
          if (!alive) return;
          setOverlay(o);
          setOverlayLoading(false);
        })
        .catch(() => {
          if (!alive || seq !== fetchSeq) return;
          setOverlayLoading(false);
        });
    };

    const hit = readOverlayCache(role, currentWindow, user?.username);
    if (hit) {
      // Have a cached value → render instantly, refresh silently if stale.
      setOverlay(hit);
      setOverlayLoading(false);
      const mem = overlayCache.get(cacheKey);
      if (!mem || Date.now() - mem.fetchedAt >= 60_000) doFetch(true);
    } else {
      // No seed for this key. If rows are already on screen (key changed
      // mid-session), refresh silently behind them; only a true cold
      // start shows the full processing loader.
      doFetch(overlayRef.current != null);
    }

    // Poll every 2 minutes so data changes (project edits, new imports, etc.)
    // are reflected automatically without the user needing to navigate away.
    const timer = setInterval(() => { if (alive) doFetch(true); }, POLL_INTERVAL_MS);

    // Refetch IMMEDIATELY after ANY data write — editing hours, adding or
    // removing a team member, filling/creating an open position, changing a
    // record's status or fields, staff changes — via the unified data-sync
    // bus (lib/dataSync.ts). Without it this page waited for the 2-minute
    // poll, so a successful "Add Team Member" or a status change looked like
    // it required a manual browser refresh. The subscription also covers
    // writes made in another tab (scope-only storage marker).
    const unsubscribeSync = subscribeDataChanged("any", () => { if (alive) doFetch(true); });

    return () => {
      alive = false;
      clearInterval(timer);
      unsubscribeSync();
    };
  }, [cacheKey, role, currentWindow, user?.username, businessRulesVer]);

  // REAL-DATA-ONLY: the alerts feed renders exclusively live RM ONE risk
  // signals. Curated / illustrative ("SAMPLE") rows are never shown — an
  // empty result set falls back to an explicit empty state instead.
  const mergedRisks: RiskItem[] = useMemo(() => {
    return overlay?.liveRisks ?? [];
  }, [overlay]);

  const counts = useMemo(() => {
    const c: Record<Filter, number> = { all: mergedRisks.length, high: 0, med: 0, info: 0 };
    for (const r of mergedRisks) c[r.tone]++;
    return c;
  }, [mergedRisks]);

  // Header pill mirrors the "All Alerts" tab count so the two numbers
  // stay in sync (previously the header showed only live-from-RM ONE
  // alerts while the All Alerts pill included the curated sample
  // rows, which read as a bug to viewers — 9 in the header but 12
  // below).
  const liveAlertCount = mergedRisks.length;

  // Tap-on-row behaviour matches the home page: open a popup with the
  // row's affected records, then let the user click "Ask AI" to hand
  // off into chat. Avoids the surprise of an immediate jump out of
  // the alerts feed into a chat session before the user can preview.
  const [modal, setModal] = useState<{ risk: RiskItem; detail: ActionDetail } | null>(null);
  // Staffing quick actions shared with the home page's alert panels:
  // demand-coverage → Add Team Member (consumes the SELECTED open slot),
  // over-allocation → Edit Allocation. Never "Add Open Position" here — a
  // project that is already short of people needs a person, not another
  // unfilled slot.
  const staffingQA = useStaffingQuickActions({ onNavigate: (to) => setLocation(to) });
  const [dismissed, setDismissed] = useState<Record<string, string>>(() => loadDismissed());
  const [showDismissed, setShowDismissed] = useState(false);

  const filtered: RiskItem[] = useMemo(() => {
    const base = filter === "all" ? mergedRisks : mergedRisks.filter((r) => r.tone === filter);
    if (showDismissed) return base;
    return base.filter((r) => !dismissed[alertDismissKey(r)]);
  }, [mergedRisks, filter, dismissed, showDismissed]);

  const dismissedCount = useMemo(
    () => mergedRisks.filter((r) => !!dismissed[alertDismissKey(r)]).length,
    [mergedRisks, dismissed],
  );

  function restoreAll() {
    setDismissed({});
    saveDismissed({});
  }

  function handleRisk(r: RiskItem) {
    // Live risks (bench list, over-allocated person, demand slots, etc.)
    // ship a `records` ActionDetail with the underlying rows so the
    // popup can list every affected resource/project. For curated rows
    // and live rows without records (e.g. backend-feed sentinels), fall
    // back to a synthesized single-row summary.
    const detail = r.records ?? buildRiskDetail(fullName, r);
    setModal({ risk: r, detail });
  }

  function handleModalConfirm(payload?: { selectedIndexes: number[]; note: string }) {
    if (!modal || !modal.detail) return;
    const idx = payload?.selectedIndexes?.[0] ?? 0;
    const row = modal.detail.rows?.[idx];
    const ticketId: string = row
      ? String((row as Record<string, unknown>)._ticket ?? (row as Record<string, unknown>)._id ?? "").trim()
      : "";
    const isAggregate = row
      ? String((row as Record<string, unknown>)._aggregate ?? "") === "true"
      : false;
    const rowSummary = row
      ? Object.entries(row)
          .filter(([k]) => !k.startsWith("_"))
          .map(([k, v]) => `${k}: ${v}`)
          .join(" · ")
      : "";
    const ticketGuard = ticketId
      ? `TICKET ID: ${ticketId} — use this exact ID when calling any RM ONE lookup tool. Do NOT alter or substitute any other ID.`
      : isAggregate
      ? `NOTE: This item is a portfolio-level metric, not a single project record. Do NOT call search_projects for it — there is no project name to look up. Answer using only the figures already given above; recommend general next steps instead of naming a specific project.`
      : `IMPORTANT: If you need to look up a specific project by name, call search_projects with the name first and use the TicketId returned — NEVER guess or construct a ticket ID.`;
    const prompt = [
      `Acting as ${fullName}: there's an active alert on the operational risk feed — "${modal.risk.title}" (${modal.risk.sub ?? ""}).`,
      rowSummary ? `Focus on this affected record — ${rowSummary}.` : "",
      `Spell out the risk in one sentence, list who is affected by name, and recommend 2–3 specific mitigation steps with owners and deadlines.`,
      ticketGuard,
      `Use ONLY real names, project IDs, and figures you can verify from RM ONE tool results. NEVER output square-bracket placeholders. Omit a bullet if the data isn't available after a tool lookup.`,
    ].filter(Boolean).join(" ");
    setModal(null);
    setChatPrompt(prompt, { newSession: true, autoSend: true });
    setLocation("/chat");
  }

  return (
    <div className="min-h-full w-full" style={{ backgroundColor: BG, color: "var(--rm-text)" }}>
      <div className="max-w-[1100px] mx-auto px-4 md:px-8 pt-5 md:pt-8 pb-10 font-sans">
        <div className="mb-5">
          <h1 className="text-[22px] md:text-[26px] font-bold tracking-tight flex items-center gap-2">
            Alerts
            {overlayLoading ? (
              <span
                className="inline-flex items-center gap-1 text-[10px] font-bold tracking-wider px-1.5 py-0.5 rounded normal-case"
                style={{ color: "var(--rm-text-muted)", backgroundColor: "var(--rm-panel-hover)" }}
                data-testid="alerts-live-indicator"
              >
                <span
                  className="inline-block w-2 h-2 rounded-full border-2 border-t-transparent animate-spin"
                  style={{ borderColor: "#A9C23F80", borderTopColor: "transparent" }}
                />
                Updating
              </span>
            ) : liveAlertCount > 0 ? (
              <span
                className="inline-flex items-center gap-1 text-[10px] font-extrabold tracking-wider px-1.5 py-0.5 rounded normal-case"
                style={{ color: "#FFFFFF", backgroundColor: "var(--rm-green)" }}
                data-testid="alerts-live-indicator"
                title={`${liveAlertCount} alert${liveAlertCount === 1 ? "" : "s"} from live RM ONE data`}
              >
                <span className="w-1.5 h-1.5 rounded-full inline-block animate-pulse" style={{ backgroundColor: "#FFFFFF" }} />
                LIVE · {liveAlertCount}
              </span>
            ) : (
              <span
                className="inline-flex items-center gap-1 text-[10px] font-bold tracking-wider px-1.5 py-0.5 rounded normal-case"
                style={{ color: "var(--rm-text-muted)", backgroundColor: "var(--rm-panel-hover)" }}
                data-testid="alerts-live-indicator"
                title="No active risk signals from live RM ONE data"
              >
                NO ACTIVE ALERTS
              </span>
            )}
          </h1>
          <p className="text-[12px] md:text-[13px] mt-1" style={{ color: "var(--rm-text-muted)" }}>
            Operational risk feed · {fullName}
          </p>
        </div>

        {/* Severity filter tabs — four equal columns spanning the full page width */}
        <div className="grid grid-cols-4 gap-3 mb-4 w-full">
          {FILTERS.map((f) => {
            const active = filter === f.key;
            return (
              <button
                key={f.key}
                onClick={() => setFilter(f.key)}
                className="w-full text-[13px] font-semibold rounded-full px-4 py-2.5 transition-all border flex items-center justify-center gap-2 whitespace-nowrap"
                style={{
                  backgroundColor: active ? f.color : "var(--rm-panel-soft)",
                  borderColor: active ? f.color : "var(--rm-panel-border)",
                  color: active ? "#1B2B38" : "var(--rm-text)",
                }}
                data-testid={`filter-${f.key}`}
              >
                <span>{f.label}</span>
                <span
                  className="text-[11px] font-bold tabular-nums px-2 py-0.5 rounded-full"
                  style={{
                    color: active ? "#1B2B38" : "var(--rm-text)",
                    backgroundColor: active ? "rgba(27,43,56,0.18)" : "var(--rm-panel-border)",
                  }}
                >
                  {counts[f.key]}
                </span>
              </button>
            );
          })}
        </div>

        {overlayLoading && filtered.length === 0 ? (
          <div className="relative" aria-busy="true">
            {/* Prominent "RM ONE agents are evaluating" banner: tall card
                with a thick indeterminate progress bar, brand-coloured glow
                pulse, animated dots, and a slow shimmer sweep so it reads
                as a real, live processing state — not a placeholder. */}
            <style>{`
              @keyframes alertsLoaderSlide {
                0%   { transform: translateX(-100%); }
                100% { transform: translateX(260%); }
              }
              @keyframes alertsLoaderShimmer {
                0%   { transform: translateX(-100%); }
                100% { transform: translateX(100%); }
              }
              @keyframes alertsLoaderPulse {
                0%, 100% { opacity: 0.55; transform: scale(1); }
                50%      { opacity: 1;    transform: scale(1.08); }
              }
              @keyframes alertsLoaderDot {
                0%, 80%, 100% { opacity: 0.25; transform: translateY(0); }
                40%           { opacity: 1;    transform: translateY(-2px); }
              }
              @keyframes alertsLoaderRipple {
                0%   { transform: scale(0.6); opacity: 0.7; }
                100% { transform: scale(2.1); opacity: 0;   }
              }
            `}</style>

            <div
              className="relative overflow-hidden rounded-2xl"
              style={{
                backgroundColor: "var(--rm-panel)",
                border: "1px solid rgba(169,194,63,0.35)",
                boxShadow:
                  "0 12px 32px var(--rm-shadow), 0 0 0 1px rgba(169,194,63,0.08) inset",
                padding: "22px 24px",
              }}
            >
              {/* Shimmer sweep across the whole card */}
              <div
                aria-hidden="true"
                style={{
                  position: "absolute", inset: 0,
                  background:
                    "linear-gradient(110deg, transparent 30%, rgba(169,194,63,0.10) 50%, transparent 70%)",
                  animation: "alertsLoaderShimmer 2.4s ease-in-out infinite",
                  pointerEvents: "none",
                }}
              />

              <div className="relative flex items-center gap-4">
                {/* Pulsing brand orb with concentric ripples */}
                <div
                  style={{
                    position: "relative",
                    width: 44, height: 44, flexShrink: 0,
                    display: "flex", alignItems: "center", justifyContent: "center",
                  }}
                >
                  <span
                    aria-hidden="true"
                    style={{
                      position: "absolute", inset: 0, borderRadius: "9999px",
                      border: "2px solid #A9C23F",
                      animation: "alertsLoaderRipple 1.8s ease-out infinite",
                    }}
                  />
                  <span
                    aria-hidden="true"
                    style={{
                      position: "absolute", inset: 0, borderRadius: "9999px",
                      border: "2px solid #A9C23F",
                      animation: "alertsLoaderRipple 1.8s ease-out 0.6s infinite",
                    }}
                  />
                  <span
                    style={{
                      width: 18, height: 18, borderRadius: "9999px",
                      backgroundColor: "#A9C23F",
                      boxShadow: "0 0 14px rgba(169,194,63,0.65)",
                      animation: "alertsLoaderPulse 1.4s ease-in-out infinite",
                    }}
                  />
                </div>

                <div className="flex-1 min-w-0">
                  <div
                    className="flex items-baseline gap-1"
                    style={{
                      color: "var(--rm-text)",
                      fontSize: 15,
                      fontWeight: 800,
                      letterSpacing: "0.01em",
                    }}
                  >
                    <span>RM ONE agents are evaluating</span>
                    <span
                      style={{
                        display: "inline-block", marginLeft: 2,
                        animation: "alertsLoaderDot 1.4s ease-in-out infinite",
                      }}
                    >.</span>
                    <span
                      style={{
                        display: "inline-block",
                        animation: "alertsLoaderDot 1.4s ease-in-out 0.2s infinite",
                      }}
                    >.</span>
                    <span
                      style={{
                        display: "inline-block",
                        animation: "alertsLoaderDot 1.4s ease-in-out 0.4s infinite",
                      }}
                    >.</span>
                  </div>
                  <div
                    style={{
                      color: "var(--rm-text-muted)",
                      fontSize: 12,
                      marginTop: 3,
                      fontWeight: 500,
                    }}
                  >
                    Scanning live pipeline, schedules, and risk signals
                  </div>
                </div>
              </div>

              {/* Thick indeterminate progress bar */}
              <div
                className="rounded-full overflow-hidden"
                style={{
                  height: 8,
                  marginTop: 18,
                  backgroundColor: "rgba(169,194,63,0.14)",
                  position: "relative",
                }}
              >
                <div
                  style={{
                    width: "38%",
                    height: "100%",
                    borderRadius: 999,
                    background:
                      "linear-gradient(90deg, #6BA539 0%, #A9C23F 50%, #6BA539 100%)",
                    boxShadow: "0 0 12px rgba(169,194,63,0.55)",
                    animation: "alertsLoaderSlide 1.4s ease-in-out infinite",
                  }}
                />
              </div>
            </div>

            {/* Dark themed skeleton rows (no more white blocks) so the
                placeholder area blends with the rest of the dark UI. */}
            <div className="flex flex-col gap-2 mt-3">
              {[0, 1, 2, 3, 4, 5].map((i) => (
                <div
                  key={i}
                  className="rounded-xl animate-pulse overflow-hidden relative"
                  style={{
                    height: 56,
                    backgroundColor: "var(--rm-panel-soft)",
                    border: "1px solid var(--rm-panel-border)",
                    opacity: 0.85 - i * 0.10,
                  }}
                >
                  <div
                    aria-hidden="true"
                    style={{
                      position: "absolute", inset: 0,
                      background:
                        "linear-gradient(90deg, transparent 0%, var(--rm-panel-hover) 50%, transparent 100%)",
                      animation: "alertsLoaderShimmer 2.4s ease-in-out infinite",
                    }}
                  />
                </div>
              ))}
            </div>
          </div>
        ) : filtered.length === 0 && dismissedCount === 0 ? (
          <div
            className="rounded-xl p-6 text-center text-[13px]"
            style={{ backgroundColor: "#FFFFFF", border: "1px solid rgba(0,0,0,0.08)", color: "rgba(27,43,56,0.65)", boxShadow: "0 2px 12px rgba(0,0,0,0.18)" }}
          >
            No alerts at this severity for the active role.
          </div>
        ) : (
          <>
            {dismissedCount > 0 && (
              <div className="flex items-center gap-2 mb-3">
                <span style={{ fontSize: 12, color: "var(--rm-text-muted)" }}>
                  {dismissedCount} alert{dismissedCount === 1 ? "" : "s"} ignored
                </span>
                <button
                  onClick={() => setShowDismissed((v) => !v)}
                  style={{ fontSize: 11, padding: "2px 10px", borderRadius: 8, border: "1px solid var(--rm-panel-border)", backgroundColor: "var(--rm-panel-soft)", color: "var(--rm-text)", cursor: "pointer", fontWeight: 600 }}
                >
                  {showDismissed ? "Hide ignored" : "Show ignored"}
                </button>
                {showDismissed && (
                  <button
                    onClick={restoreAll}
                    style={{ fontSize: 11, padding: "2px 10px", borderRadius: 8, border: "1px solid #FF4D2E44", backgroundColor: "#FF4D2E11", color: "#FF4D2E", cursor: "pointer", fontWeight: 600 }}
                  >
                    Clear all
                  </button>
                )}
              </div>
            )}
            {filtered.length === 0 && (
              <div
                className="rounded-xl p-6 text-center text-[13px]"
                style={{ backgroundColor: "#FFFFFF", border: "1px solid rgba(0,0,0,0.08)", color: "rgba(27,43,56,0.65)", boxShadow: "0 2px 12px rgba(0,0,0,0.18)" }}
              >
                No alerts at this severity for the active role.
              </div>
            )}
            <div className="flex flex-col gap-3">
              {filtered.map((r, i) => {
                const isIgnored = !!dismissed[alertDismissKey(r)];
                // No per-row Resolve/dismiss buttons — clicking the row
                // opens the detail popup, which carries the correctly
                // routed "go to" action plus Close. One clear path.
                return (
                  <div key={i} style={{ display: "flex", alignItems: "center", gap: 8 }}>
                    <div style={{ flex: 1, minWidth: 0, opacity: isIgnored ? 0.45 : 1 }}>
                      <RiskRow r={r} onClick={() => !isIgnored && handleRisk(r)} />
                    </div>
                    {isIgnored && (
                      <div style={{ fontSize: 10, color: "var(--rm-text-muted)", fontStyle: "italic", maxWidth: 120, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", flexShrink: 0 }}>
                        ignored
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </>
        )}
      </div>

      {/* Same side-panel drill-down format used on the home page —
          explanation card + paginated affected-records table with a
          single-row pick for the AI hand-off. */}
      {modal && (
        <RiskSidePanel
          open
          title={modal.risk.title}
          subtitle={modal.risk.sub}
          tier={
            modal.risk.tone === "high"
              ? { label: "CRITICAL", color: "#DC2626" }
              : modal.risk.tone === "info"
                ? { label: "INFO", color: "#A9C23F" }
                : { label: "WARNING", color: "#E87722" }
          }
          kindLabel="Operational risk"
          explanation={buildRiskExplanation(modal.risk, modal.detail)}
          detail={modal.detail}
          onClose={() => setModal(null)}
          onAskAI={(payload) => handleModalConfirm({ ...payload, note: "" })}
          goTo={classifyIssueTarget({
            title: modal.risk.title,
            subtitle: modal.risk.sub,
            detail: modal.detail,
          })}
          onNavigate={(to) => setLocation(to)}
          quickAction={staffingQA.quickActionsFor(
            classifyRisk(undefined, modal.risk.title ?? "", modal.risk.sub ?? ""),
            () => setModal(null),
          )}
        />
      )}

      {staffingQA.modals}
    </div>
  );
}
