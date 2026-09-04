import { useState, useRef, useMemo, useEffect, lazy, Suspense, type ElementType, type CSSProperties } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useLocation, useSearch } from "wouter";
import { InlineDataGrid, downloadCardTemplate } from "@/components/InlineDataGrid";
import type { ImportMode } from "@/components/InlineDataGrid";
import PreflightIssuesDialog, { type PreflightIssue } from "@/components/PreflightIssuesDialog";
import ImportRunningDialog from "@/components/ImportRunningDialog";
import BillingRatesPage from "@/pages/billing-rates";
import InviteMembersDialog from "@/components/InviteMembersDialog";
import CleanedFilesDialog from "@/components/CleanedFilesDialog";
import { useAuth } from "@/lib/useAuth";
import { getModuleRecords, getResourceAllocations, downloadRateCard, previewRateCard, applyRateCard, authHeaders, activeImportKey, type RateCardPreview, type RateCardPreviewRow } from "@/lib/api";
import { getCachedCleanedFile, putCachedCleanedFile } from "@/lib/cleanedFileCache";
import { uploadFileSmart } from "@/lib/chunkedUpload";
import { deriveForcedTabType, buildTabTypeOverrides } from "@/lib/importServerFields";
import {
  FolderKanban, Users, Briefcase, Tag, BadgeDollarSign,
  History, HelpCircle, ShieldCheck, BookMarked, UserPlus, FileSpreadsheet,
  PanelLeftClose, PanelLeftOpen, Download, Upload, Loader2, Settings2,
  UsersRound, CalendarRange, Building2,
} from "lucide-react";


interface ModCard { id: string; label: string; icon: ElementType; multiTab: boolean; }

const MODULE_CARDS: ModCard[] = [
  { id: "team",          label: "Resources",        icon: Users,         multiTab: false },
  // Companies: bulk-create/update CRM companies directly (client request —
  // placed right after Resources). Grid + template + "Companies" sheet
  // routing already exist (same card the onboarding surfaces use).
  { id: "companies",     label: "Companies",        icon: Building2,     multiTab: false },
  { id: "leads",         label: "Leads",            icon: Tag,           multiTab: false },
  { id: "opportunities", label: "Opportunities",    icon: Briefcase,     multiTab: false },
  { id: "projects",      label: "Projects",         icon: FolderKanban,  multiTab: false },
  // Standalone cards: assignment/schedule rows reference EXISTING Projects
  // (PMM-…) or Opportunities (OPM-…) by ID — one upload can mix both. Old
  // multi-sheet workbooks still work: uploading a file with Team Assignments
  // / Schedule sheets into Projects or Opportunities sprouts those tabs
  // dynamically, exactly like the Staff and Leads cards do today.
  { id: "assignments",   label: "Team Assignments", icon: UsersRound,    multiTab: false },
  { id: "schedule",      label: "Schedule",         icon: CalendarRange, multiTab: false },
];

const MODULE_TO_RECORD_TYPE: Record<string, string> = {
  opportunities: "Opportunity",
  projects:      "Project",
  leads:         "Lead",
};

interface ActiveJobResp {
  active: boolean;
  uploadId?: string;
  fileName?: string;
  status?: string;
  modules?: string[];
}

// ── Rate Card upload helpers ──────────────────────────────────────────────
const toRateApplyRow = (r: RateCardPreviewRow) => ({
  roleName: r.roleName, roleId: r.roleId, deptId: r.deptId, deptName: r.deptName,
  billing: r.incoming.billing, labor: r.incoming.labor, cost: r.incoming.cost,
});

// Build the post-apply summary banner text (counts + first few warnings).
function rateCardSummaryMsg(
  res: { saved: number; created: number; errors: string[] },
  pv: RateCardPreview,
  keptExisting: number,
): { ok: boolean; text: string } {
  const parts: string[] = [];
  if (res.saved   > 0) parts.push(`${res.saved} rate${res.saved === 1 ? "" : "s"} updated`);
  if (res.created > 0) parts.push(`${res.created} new role${res.created === 1 ? "" : "s"} created`);
  if (keptExisting > 0) parts.push(`${keptExisting} kept ${keptExisting === 1 ? "its" : "their"} existing rate`);
  const unchanged = pv.rows.filter(r => r.status === "unchanged").length;
  if (unchanged > 0) parts.push(`${unchanged} already up to date`);
  const summary = parts.length ? parts.join(", ") + "." : "No rates changed.";
  const notes = [...pv.warnings, ...(res.errors ?? [])];
  const noteText = notes.length ? ` Notes: ${notes.slice(0, 3).join("; ")}` : "";
  const hasErr = (res.errors ?? []).length > 0;
  return { ok: !hasErr || res.saved > 0 || res.created > 0, text: summary + noteText };
}

const ratePillStyle = (active: boolean, green: boolean): CSSProperties => ({
  padding: "4px 12px", fontSize: 11, fontWeight: 700, borderRadius: 6, cursor: "pointer",
  border: `1px solid ${active ? (green ? "#6BA539" : "#c0392b") : "var(--rm-panel-border)"}`,
  background: active ? (green ? "#6BA539" : "#fff0f0") : "var(--rm-panel-soft)",
  color: active ? (green ? "#fff" : "#c0392b") : "var(--rm-text-muted)",
});

export default function ImportDataPage() {
  const [, navigate]    = useLocation();
  const search          = useSearch();
  const { user }        = useAuth();
  const queryClient     = useQueryClient();
  const [inviteOpen,    setInviteOpen]  = useState(false);
  const [cleanFilesOpen, setCleanFilesOpen] = useState(false);
  const initialModule   = useMemo(() => {
    const p = new URLSearchParams(search);
    const m = p.get("module") ?? "";
    return MODULE_CARDS.some(c => c.id === m) ? m : "projects";
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
  const [activeId,      setActiveId]    = useState<string>(initialModule);
  // ── Data-Cleaning handoff ─────────────────────────────────────────────
  // /import?module=X&cleaned=<sessionId> → fetch the cleaned workbook and
  // load it straight into the grid (no download / re-upload). Re-fetching by
  // sessionId keeps this refresh-safe. The File lives in state so its
  // identity is stable — the grid's auto-load effect is keyed on it.
  const cleanedSid = useMemo(() => new URLSearchParams(search).get("cleaned"), []); // eslint-disable-line react-hooks/exhaustive-deps
  const cleanedTenant = useMemo(() => new URLSearchParams(search).get("tenant"), []); // eslint-disable-line react-hooks/exhaustive-deps
  const [cleanedFile, setCleanedFile] = useState<File | null>(null);
  const [cleanedError, setCleanedError] = useState<string | null>(null);
  useEffect(() => {
    if (!cleanedSid) return;
    let cancelled = false;
    (async () => {
      try {
        // Local-first: a refresh of this handoff URL restores from the
        // on-device cache instantly; the server download is the fallback.
        let blob = (await getCachedCleanedFile(cleanedSid))?.blob ?? null;
        if (!blob) {
          const q = cleanedTenant ? `?tenantId=${encodeURIComponent(cleanedTenant)}` : "";
          const r = await fetch(`/api/data-cleaning/download/${cleanedSid}${q}`, { headers: authHeaders() as Record<string, string> });
          if (!r.ok) throw new Error(`fetch failed (${r.status})`);
          blob = await r.blob();
          // Cache the workbook on this device so later visits to /import
          // restore the grid instantly instead of re-downloading it.
          void putCachedCleanedFile(cleanedSid, blob, "cleaned-data.xlsx");
        }
        if (!cancelled) {
          setCleanedFile(new File([blob], "cleaned-data.xlsx", {
            type: blob.type || "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
          }));
        }
      } catch {
        if (!cancelled) setCleanedError("Couldn't load the cleaned file from Data Cleaning — the session may have expired. Clean the file again, or download it there and upload it here manually.");
      }
    })();
    return () => { cancelled = true; };
  }, [cleanedSid, cleanedTenant]);
  const [uploading,     setUploading]   = useState(false);
  const [showHowTo,     setShowHowTo]   = useState(false);
  const [sidebarOpen,   setSidebarOpen] = useState(true);
  const [billingUploading, setBillingUploading] = useState(false);
  const [billingDownloading, setBillingDownloading] = useState(false);
  const [billingMsg,       setBillingMsg]       = useState<{ ok: boolean; text: string } | null>(null);
  const billingFileRef = useRef<HTMLInputElement>(null);
  // Rate Card conflict review: preview result + per-row include/skip decisions
  // (keyed by row idx, true = update to the file's rate). Only rows whose rate
  // DIFFERS from what's stored land here — identical rows replace silently.
  const [billingReview, setBillingReview] = useState<{ preview: RateCardPreview; decisions: Record<number, boolean> } | null>(null);
  const [billingApplying, setBillingApplying] = useState(false);
  // Preflight issues found in an uploaded file, held while the user decides
  // whether to fix the file or import anyway. uploadId + mode let "Import
  // anyway" resume exactly where handleSubmit stopped.
  const [preflight, setPreflight] = useState<{ issues: PreflightIssue[]; uploadId: string; mode: string; forcedRecordType?: string } | null>(null);
  // "Import running" popup: uploadId of the job to show live progress for.
  // Opens automatically ONCE per job while anything is processing
  // (autoPopupRef stops it re-opening on every 3s poll after the user closes
  // it), and re-opens on any blocked upload attempt — a local click while
  // running, or the server's IMPORT_IN_PROGRESS 409.
  const [runningDlg, setRunningDlg] = useState<string | null>(null);
  // In-wizard processing: set when /run is accepted for a grid submit — the
  // grid's wizard renders its final "Processing" step (live terminal, Cancel
  // Upload, Done) instead of navigating away to /onboarding/status/:id.
  // Tagged with the module card that submitted it, so switching cards mid-run
  // doesn't show (or on Done, reset) the wrong card's grid.
  // cardId = module card hosting the wizard's Processing step. external =
  // the run was started elsewhere (other tab / refresh / another user) and
  // this card is only WATCHING it — Done must never clear that card's grid.
  const [wizardRun, setWizardRun] = useState<{ uploadId: string; cardId: string; external?: boolean } | null>(null);
  const autoPopupRef = useRef<string | null>(null);

  // Phase 2 of the Rate Card upload after the user reviewed conflicts: apply
  // all non-conflicting rows plus the conflicts they chose to update.
  const applyBillingReview = async () => {
    if (!billingReview) return;
    const { preview, decisions } = billingReview;
    const conflicts = preview.rows.filter(r => r.status === "conflict");
    const included  = conflicts.filter(c => decisions[c.idx]);
    const rowsToApply = [...preview.rows.filter(r => r.status === "new"), ...included];
    const kept = conflicts.length - included.length;
    setBillingApplying(true);
    try {
      if (rowsToApply.length === 0) {
        setBillingMsg({ ok: true, text: `Nothing changed — you kept the existing rate for all ${conflicts.length} differing row${conflicts.length === 1 ? "" : "s"}.` });
        setBillingReview(null);
        return;
      }
      const res = await applyRateCard(rowsToApply.map(toRateApplyRow));
      setBillingMsg(rateCardSummaryMsg(res, preview, kept));
      setBillingReview(null);
    } catch (err: unknown) {
      // Prefer the server's human-readable message over the raw `400: {json}` blob.
      const friendly = (err as { friendlyMessage?: string })?.friendlyMessage;
      setBillingMsg({ ok: false, text: friendly || (err instanceof Error ? err.message : "Applying the rate changes failed.") });
    } finally {
      setBillingApplying(false);
    }
  };

  const pmm = useQuery({ queryKey: ["pmm"],       queryFn: () => getModuleRecords("PMM"), staleTime: 0 });
  const opm = useQuery({ queryKey: ["opm"],       queryFn: () => getModuleRecords("OPM"), staleTime: 0 });
  const lem = useQuery({ queryKey: ["lem"],       queryFn: () => getModuleRecords("LEM"), staleTime: 0 });
  const res = useQuery({ queryKey: ["resources"], queryFn: getResourceAllocations,        staleTime: 0 });

  // Per-area existing-data counts straight from the backend DB (core2). This
  // is the authoritative gate for the import-mode question — the list queries
  // above stay as sidebar badges and as a fallback (they always include the
  // viewer's own login account, so they must not gate the question alone).
  const summaryQ = useQuery<Record<string, number> | null>({
    // Include cleanedTenant in the key so a superadmin switching between
    // companies gets a fresh probe for each target tenant.
    queryKey: ["import-data-summary", cleanedTenant ?? ""],
    queryFn: async () => {
      const q = cleanedTenant ? `?tenant=${encodeURIComponent(cleanedTenant)}` : "";
      // 20s timeout: this probe gates the import-mode question, and a fetch
      // that never settles used to leave the flow stuck on "checking"
      // indefinitely when the server was busy. Timeout → throw → React Query
      // retries; if it still can't answer, the query errors out and the gate
      // falls back to fail-closed (ask the question) instead of hanging.
      const r = await fetch(`/api/onboarding/data-summary${q}`, {
        headers: authHeaders() as Record<string, string>,
        signal: AbortSignal.timeout(20_000),
      });
      if (!r.ok) return null; // unavailable → fail closed (ask the question)
      return r.json();
    },
    retry: 2,
    staleTime: 0,
    refetchOnWindowFocus: false,
  });

  // Poll for any running import job for this tenant every 3 s.
  // Existing Project + Opportunity ticket IDs — powers the standalone Team
  // Assignments / Schedule cards' as-you-type ID checking and separator/case
  // auto-correction. null (failed or still loading) = the grid skips the
  // client-side check; the server's ghost-reference guard still applies.
  //
  // Large-tenant optimization: when the tenant has >10 000 IDs the server
  // returns { ids: [], count, large: true } instead of the full list to avoid
  // shipping 500KB+ over the wire. The grid falls back to a server-side batch
  // check (POST /check-ticket-ids) at submit time via checkTicketIds below.
  const ticketIdsQ = useQuery<{ ids: string[]; count?: number; large?: boolean } | null>({
    queryKey: ["import-ticket-ids", cleanedTenant ?? ""],
    queryFn: async () => {
      const q = cleanedTenant ? `?tenant=${encodeURIComponent(cleanedTenant)}` : "";
      const r = await fetch(`/api/onboarding/ticket-ids${q}`, {
        headers: authHeaders() as Record<string, string>,
        signal: AbortSignal.timeout(20_000), // hung fetch must not stall the grid's ID checking forever
      });
      if (!r.ok) return null; // fail open — the server guard is the backstop
      return (await r.json()) as { ids: string[]; count?: number; large?: boolean };
    },
    staleTime: 15_000,
    enabled: activeId === "assignments" || activeId === "schedule",
  });

  // Batch server-side ID check for large tenants — called at submit time when
  // the full ID list wasn't downloaded. Returns a Set of IDs (lowercased)
  // that exist in the tenant's DB, so the grid can highlight unknowns in the
  // review step. Never throws: returns an empty Set on network/server error
  // (fail open — the server's ghost-reference guard remains the backstop).
  const checkTicketIds = useMemo(() => {
    if (!ticketIdsQ.data?.large) return undefined;
    return async (ids: string[]): Promise<Set<string>> => {
      if (!ids.length) return new Set<string>();
      try {
        const q = cleanedTenant ? `?tenant=${encodeURIComponent(cleanedTenant)}` : "";
        const r = await fetch(`/api/onboarding/check-ticket-ids${q}`, {
          method: "POST",
          headers: { "Content-Type": "application/json", ...(authHeaders() as Record<string, string>) },
          body: JSON.stringify({ ids, ...(cleanedTenant ? { tenant: cleanedTenant } : {}) }),
          signal: AbortSignal.timeout(30_000), // bounded — catch below fails open on timeout
        });
        if (!r.ok) return new Set<string>();
        const data = (await r.json()) as { found?: string[] };
        return new Set((data.found ?? []).map(id => id.toLowerCase()));
      } catch {
        return new Set<string>(); // fail open
      }
    };
  }, [ticketIdsQ.data?.large, cleanedTenant]);

  const activeJobQ = useQuery<ActiveJobResp>({
    queryKey: ["onboarding-active"],
    queryFn: async () => {
      // 10s cap so a hung poll can't wedge this query — on timeout React
      // Query keeps the previous answer and the next 3s tick tries again.
      const r = await fetch("/api/onboarding/active", {
        headers: authHeaders() as Record<string, string>,
        signal: AbortSignal.timeout(10_000),
      });
      if (!r.ok) return { active: false };
      return r.json();
    },
    refetchInterval: 3_000,
    staleTime: 0,
  });

  // Seed from the tenant-scoped localStorage marker (set the moment an import
  // is started; the App-level watcher clears it when the job reaches a
  // terminal state). On a hard refresh or back-navigation this renders the
  // "Import running" banner instantly instead of flashing the idle page while
  // the first /active poll is in flight — which looked like the import had
  // stopped even though it keeps running on the server.
  const [seedUploadId] = useState<string | null>(() => {
    try { return localStorage.getItem(activeImportKey()); } catch { return null; }
  });
  const seedJob: ActiveJobResp | null =
    seedUploadId ? { active: true, uploadId: seedUploadId } : null;

  // Trust the server once it has answered; the seed only bridges the initial
  // in-flight window (data === undefined). If the server says the job is done,
  // the seed is ignored immediately — no stale banner.
  const activeJob   = activeJobQ.data !== undefined
    ? (activeJobQ.data.active ? activeJobQ.data : null)
    : seedJob;
  const runningMods = new Set<string>(activeJob?.modules ?? []);
  const anyRunning  = !!activeJob;

  // Auto-open the running-import popup ONCE per job when the user lands on
  // (or navigates back to) this page while an import is processing — the
  // banner alone was easy to miss, and users tried to upload a second file
  // while their first one was still running.
  useEffect(() => {
    const id = activeJob?.uploadId;
    // Skip while the wizard's own Processing step is showing this run — the
    // popup would open right on top of the identical live terminal.
    if (id && autoPopupRef.current !== id && wizardRun?.uploadId !== id) {
      autoPopupRef.current = id;
      setRunningDlg(id);
    }
  }, [activeJob?.uploadId, wizardRun?.uploadId]);

  // When a running import reaches a terminal state, re-probe the backend
  // data summary so the module cards' has-data state reflects the rows that
  // were just imported (ref-guarded: fires only on the true→false
  // transition, never on mount).
  const wasRunningRef = useRef(false);
  useEffect(() => {
    if (wasRunningRef.current && !anyRunning) {
      void queryClient.invalidateQueries({ queryKey: ["import-data-summary"] });
      // The import may have created Projects/Opps — refresh the ID list the
      // standalone Assignments/Schedule cards validate against.
      void queryClient.invalidateQueries({ queryKey: ["import-ticket-ids"] });
    }
    wasRunningRef.current = anyRunning;
  }, [anyRunning, queryClient]);

  // Sidebar badges. The tenant's OWN login account always appears in the
  // resources list, so exclude self — only OTHER people count as existing
  // team data (a brand-new tenant would otherwise always show team=1).
  const selfKey = (user?.username ?? "").trim().toLowerCase();
  const teamOthers = (res.data?.resources ?? []).filter(
    (r) => (r.username ?? "").trim().toLowerCase() !== selfKey,
  ).length;
  const counts: Record<string, number | undefined> = {
    projects:      pmm.data?.total as number | undefined,
    opportunities: opm.data?.total as number | undefined,
    leads:         lem.data?.total as number | undefined,
    team:          teamOthers || undefined,
  };
  // Which backend data areas gate each module card's import-mode question.
  // Client mandate (TN-48 follow-up): each module counts ONLY its own primary
  // records — an Opportunities upload must not be asked just because a
  // PROJECTS import previously created assignments / schedules / companies.
  // Shared side-tables (assignments, allocations, schedules, companies) are
  // deliberately excluded: they are populated by other modules' imports and
  // caused false popups. Data safety never depends on this gate — the server
  // upgrades create→update on its own when the tenant already has data, and
  // update mode upserts (nothing is deleted without an explicit Replace).
  const MODULE_AREAS: Record<string, string[]> = {
    projects:      ["projects"],
    opportunities: ["opportunities"],
    leads:         ["leads"],
    team:          ["staff"],
    // Standalone cards: assignments/schedules ARE these cards' primary
    // records — the side-table exclusion above is about OTHER modules not
    // gating on them.
    assignments:   ["assignments", "allocations"],
    schedule:      ["schedules"],
    // Companies ARE this card's primary records (the side-table exclusion
    // above is about OTHER modules not gating on them). A tenant with data
    // but 0 companies still can't mis-run: the server upgrades create→update
    // on its own whenever the tenant already has data.
    companies:     ["companies"],
  };
  const summary = summaryQ.data ?? null;
  const tenantHasData = summary
    ? (MODULE_AREAS[activeId] ?? []).some(k => (summary[k] ?? 0) > 0)
    // Backend probe unavailable — fall back to the coarse list counts. If any
    // of those queries FAILED too (e.g. a DB blip), we cannot prove the tenant
    // is fresh, so err toward ASKING; silently fast-pathing to "create" is the
    // exact bug this gate exists to prevent. Only a fallback that positively
    // shows zero data everywhere may skip the question.
    : (pmm.isError || opm.isError || lem.isError || res.isError)
      ? true
      : Object.values(counts).some(c => (c ?? 0) > 0);
  // While the probe is still loading (cold queries can take several seconds),
  // we can't tell a fresh tenant from an existing one. Default to ASKING the
  // import mode in that window — silently fast-pathing to "create" is the bug
  // this fixes. For a genuinely fresh tenant the server maps any answer back
  // to "create", so nothing can go wrong.
  const countsLoading = summaryQ.isLoading
    || (summary === null && !summaryQ.isLoading
        && (pmm.isLoading || opm.isLoading || lem.isLoading || res.isLoading));

  // Starts the actual import run for an already-uploaded file, then navigates
  // to the status page. Split out of handleSubmit so the preflight dialog's
  // "Import anyway" can resume from here.
  async function startRun(uploadId: string, effectiveMode: string, forcedRecordType?: string) {
    // The mappings bound to THIS upload at submit time (null for uploads that
    // didn't come with grid mappings, e.g. the schedule card).
    const gm = gridMappingsByUpload.current.get(uploadId) ?? null;
    let runRes: Response;
    try {
      runRes = await fetch("/api/onboarding/run", {
        method: "POST",
        headers: { "Content-Type": "application/json", ...(authHeaders() as Record<string, string>) },
        body: JSON.stringify({
          uploadId,
          // The grid's own header→server-field map (when this run came from the
          // grid). mappingsSource:"grid" = apply them, but never save them as
          // the client's recurring-upload template or learned synonyms.
          columnMappings: gm ?? {},
          ...(gm ? {
            mappingsSource: "grid",
            tabTypeOverrides: buildTabTypeOverrides(gm),
          } : {}),
          importMode:    effectiveMode,
          ...(forcedRecordType ? { forcedRecordType } : {}),
        }),
        // A hung kickoff must fail loudly, never spin the wizard forever. The
        // uploaded file is already parked server-side; if this start request
        // is lost, the stray pending row auto-cancels within 5 minutes.
        signal: AbortSignal.timeout(60_000),
      });
    } catch (e) {
      console.error("[import] run kickoff failed", e);
      alert("Could not start the import — the connection dropped or timed out. Please submit the upload again.");
      return;
    }
    if (!runRes.ok) {
      let runErr: any = {};
      try { runErr = await runRes.json(); } catch { /* non-JSON */ }
      // One-at-a-time guard tripped server-side (an import started from
      // another tab/page/user between /active polls) — show the live
      // progress popup instead of a raw error.
      if (runErr?.code === "IMPORT_IN_PROGRESS" && runErr?.activeUploadId) {
        setRunningDlg(String(runErr.activeUploadId));
        return;
      }
      alert(runErr?.error ?? `Import failed to start (HTTP ${runRes.status})`);
      return;
    }
    // Mark the import as running the moment the server accepts it, so any
    // page that mounts later (refresh, back-navigation, other tabs) shows
    // the running banner instantly. The App-level completion watcher
    // clears this key once the job reaches a terminal state.
    try { localStorage.setItem(activeImportKey(), uploadId); } catch { /* storage unavailable */ }
    // Import runs in the background — stay INSIDE the wizard: its final
    // "Processing" step shows the same live terminal as the status page and
    // only offers completion actions once the server confirms a terminal
    // state (user request: the flow must end in the wizard, not on a
    // separate page the user gets dumped onto).
    setWizardRun({ uploadId, cardId: activeCard?.id ?? "" });
  }

  // Grid header→server-field maps BOUND to the upload they were submitted
  // with (uploadId → mappings). startRun — including the preflight dialog's
  // delayed "Import anyway" — must read the mappings of THAT upload; a
  // mutable "latest submission" value could be overwritten by a second
  // submission attempt while the dialog is still open, cross-wiring one
  // upload's file with another's mappings.
  const gridMappingsByUpload = useRef(new Map<string, Record<string, Record<string, string>>>());

  async function handleSubmit(file: File, mode: ImportMode, gridMappings?: Record<string, Record<string, string>>) {
    const gm = gridMappings && Object.keys(gridMappings).length > 0 ? gridMappings : null;
    // One-import-at-a-time per company: if anything is still processing,
    // show the live-progress popup instead of starting a second upload
    // (the server would 409 it anyway — this just answers faster).
    if (activeJob?.uploadId) { setRunningDlg(activeJob.uploadId); return; }
    setUploading(true);
    try {
      // Size-safe upload: big grid exports are sent in pieces so the
      // production edge's ~32MB per-request cap can never 413 them.
      // Grid submissions pin the upload to the tab type the grid already
      // knows — after the explicit header renames below the server's content
      // scoring can no-op (canonical headers look like a raw DB export), and
      // the job-level forcedTabType is the documented fallback that keeps
      // those sheets on the simplified import path.
      const pinnedTab = gm ? deriveForcedTabType(gm) : null;
      // Tell the server which module card this upload came from — /active's
      // sidebar "Importing…" badges then light up ONLY this module instead
      // of every client module (Projects/Opportunities/Leads) at once.
      const pinnedRecordType = MODULE_TO_RECORD_TYPE[activeId] ?? null;
      const uploadExtra: Record<string, string> = {
        ...(pinnedTab ? { forcedTabType: pinnedTab } : {}),
        ...(pinnedRecordType ? { forcedRecordType: pinnedRecordType } : {}),
      };
      const r = await uploadFileSmart({
        url: "/api/onboarding/upload",
        file,
        ...(Object.keys(uploadExtra).length > 0 ? { extra: uploadExtra } : {}),
        headers: authHeaders() as Record<string, string>,
      });
      let data: any = {};
      try { data = await r.json(); } catch { /* non-JSON or empty response */ }
      if (!r.ok) {
        // One-at-a-time guard tripped server-side (an import started from
        // another tab/page/user between /active polls) — show the live
        // progress popup instead of a raw error.
        if (data?.code === "IMPORT_IN_PROGRESS" && data?.activeUploadId) {
          setRunningDlg(String(data.activeUploadId));
          return;
        }
        alert(data?.error ?? `Upload failed (HTTP ${r.status})`);
        return;
      }
      if (data?.uploadId) {
        // Bind this submission's mappings to its upload — resume paths look
        // them up by uploadId, never by "whatever was submitted last".
        if (gm) gridMappingsByUpload.current.set(String(data.uploadId), gm);
        // Merge-only uploads: existing clients always merge ("update" — add new
        // rows, update matched ones, never remove). "create" is reserved for a
        // brand-new tenant's first load; the server rejects a stray "create"
        // for an existing client with a 409, so resolve it here.
        const effectiveMode: string = data.existingClient ? "update" : "create";
        // Preflight: match the file's values against the live schema BEFORE
        // starting the import, so type mismatches and missing end dates show
        // now instead of as after-import notices on the status page. A
        // preflight infra failure must never block the import.
        let pf: any = null;
        try {
          const pfRes = await fetch("/api/onboarding/preflight", {
            method: "POST",
            headers: { "Content-Type": "application/json", ...(authHeaders() as Record<string, string>) },
            // Preflight mirrors /run: send the grid's header→field map so its
            // checks see the same columns the import will actually use.
            body: JSON.stringify({
              uploadId: data.uploadId,
              // Effective mode lets the server run its update-mode schedule
              // ID checks at review time (task #420).
              importMode: effectiveMode,
              ...(gm ? { columnMappings: gm } : {}),
            }),
            // Advisory only — a hung preflight must not wedge the submit flow.
            signal: AbortSignal.timeout(30_000),
          });
          if (pfRes.ok) pf = await pfRes.json();
        } catch { /* preflight is advisory only */ }
        const forcedRecordType = MODULE_TO_RECORD_TYPE[activeId];
        if (pf && Array.isArray(pf.issues) && pf.issues.length > 0) {
          setPreflight({ issues: pf.issues, uploadId: data.uploadId, mode: effectiveMode, forcedRecordType });
          return; // the dialog's buttons decide what happens next
        }
        await startRun(data.uploadId, effectiveMode, forcedRecordType);
      }
    } catch (e) {
      // A network-level throw (connection drop, stale tab) used to close the
      // overlay silently — surface it so a failed upload is never a mystery.
      console.error("[import] upload failed", e);
      const timedOut = e instanceof DOMException && (e.name === "TimeoutError" || e.name === "AbortError");
      alert(timedOut
        ? "Sending your file took too long — the connection may have dropped. Please refresh the page; if the import doesn't show as in progress, upload the file again."
        : `Upload failed: ${e instanceof Error ? e.message : String(e)}\n\nPlease check your connection and try again.`);
    } finally {
      setUploading(false);
    }
  }

  const activeCard = MODULE_CARDS.find(c => c.id === activeId);

  // Every "view progress" affordance lands HERE: the run is shown inside the
  // page as the wizard's Processing step (user request — never dump the user
  // onto the standalone status page from the import flow).
  function openRunView(uploadId: string, preferCard?: string) {
    setRunningDlg(null);
    // The wizard that submitted this run is still mounted — return to its tab.
    if (wizardRun?.uploadId === uploadId) {
      setActiveId(wizardRun.cardId);
      setSidebarOpen(true);
      return;
    }
    // Run started elsewhere (refresh / other tab / another user) — host a
    // watch-only Processing step on a module card that can render it.
    const canHost = (id?: string | null): id is string => !!id && MODULE_CARDS.some(c => c.id === id);
    const card = canHost(preferCard) ? preferCard
      : canHost(activeId) ? activeId
      : (activeJob?.modules ?? []).find(canHost) ?? "projects";
    setActiveId(card);
    setSidebarOpen(true);
    setWizardRun({ uploadId, cardId: card, external: true });
  }

  function SidebarModule({ mod, isBilling = false, isConfig = false }: { mod?: ModCard; isBilling?: boolean; isConfig?: boolean }) {
    const id      = isConfig ? "configuration" : isBilling ? "billing" : mod!.id;
    const label   = isConfig ? "Configuration" : isBilling ? "Billing Rates" : mod!.label;
    const Icon    = isConfig ? Settings2 : isBilling ? BadgeDollarSign : mod!.icon;
    const count   = (isBilling || isConfig) ? undefined : counts[id];
    const active  = id === activeId;
    const running = !isBilling && !isConfig && runningMods.has(id);

    return (
      <div style={{ display: "flex", flexDirection: "column" }}>
        <button
          onClick={() => {
            if (isConfig) { navigate("/onboarding/settings"); return; }
            if (running && activeJob?.uploadId) { openRunView(activeJob.uploadId, id); } else { setActiveId(id); }
          }}
          style={{
            display: "flex", alignItems: "center", gap: 10,
            padding: "9px 12px 4px",
            background: active ? "var(--rm-green-soft)" : "transparent",
            border: "none", borderLeft: active ? "3px solid var(--rm-green)" : "3px solid transparent",
            cursor: "pointer", textAlign: "left", width: "100%", transition: "background 0.12s",
          }}
          onMouseEnter={e => { if (!active) e.currentTarget.style.background = "var(--rm-panel-hover)"; }}
          onMouseLeave={e => { if (!active) e.currentTarget.style.background = "transparent"; }}
        >
          <Icon size={15} style={{ color: running ? "#e07b10" : active ? "var(--rm-green)" : "var(--rm-text-muted)", flexShrink: 0 }} />
          <div style={{ minWidth: 0, flex: 1 }}>
            <div style={{ fontSize: 13, fontWeight: active ? 700 : 500, color: running ? "#c96a00" : active ? "var(--rm-green)" : "var(--rm-text)", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
              {label}
            </div>
            <div style={{ fontSize: 10, color: running ? "#e07b10" : "var(--rm-text-faint)", marginTop: 1 }}>
              {isConfig
                ? "Defaults & settings"
                : isBilling
                  ? "Billing rates per role"
                  : running
                    ? "Importing…"
                    : ""}
            </div>
          </div>
          {running && (
            <span style={{ flexShrink: 0 }}>
              <Loader2 size={12} style={{ color: "#e07b10", animation: "spin 1s linear infinite" }} />
            </span>
          )}
        </button>
        {/* Progress bar shown while this module is running */}
        {running && (
          <div style={{ height: 3, background: "var(--rm-panel-border)", overflow: "hidden", marginLeft: 3 }}>
            <div style={{
              height: "100%",
              background: "linear-gradient(90deg, transparent 0%, #e07b10 50%, transparent 100%)",
              backgroundSize: "200% 100%",
              animation: "shimmer 1.4s infinite",
            }} />
          </div>
        )}
      </div>
    );
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100vh", background: "var(--rm-bg)", overflow: "hidden" }}>

      {/* Shimmer keyframe injected once */}
      <style>{`
        @keyframes shimmer { 0%{background-position:200% 0} 100%{background-position:-200% 0} }
      `}</style>

      {/* Page header */}
      <div style={{ background: "var(--rm-chrome-header-bg)", borderBottom: "1px solid var(--rm-panel-border)", padding: "14px 24px 10px", flexShrink: 0 }}>
        <div style={{ fontSize: 10, fontWeight: 700, color: "var(--rm-green)", letterSpacing: "0.1em", textTransform: "uppercase", marginBottom: 2 }}>Import Data</div>
        <div style={{ fontSize: 20, fontWeight: 800, color: "var(--rm-chrome-fg)", lineHeight: 1, marginBottom: 10 }}>Your data</div>
        <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
          {([
            { icon: HelpCircle,  label: "How it works?",  act: () => setShowHowTo(true) },
            { icon: History,     label: "Import history",  act: () => navigate(`/onboarding/history${user?.tenant ? `?tenantId=${encodeURIComponent(user.tenant)}` : ""}`) },
            { icon: BookMarked,  label: "Synonyms",        act: () => navigate("/onboarding/synonyms") },
            // CLEANING_HIDDEN: { icon: FileSpreadsheet, label: "Cleaned files", act: () => setCleanFilesOpen(true) },
            { icon: UserPlus,    label: "Manage Staff",     act: () => setInviteOpen(true) },
            // Data Cleaning AI Assistant hidden: { icon: Sparkles, label: "Data Cleaning AI", act: () => navigate("/data-cleaning") },
          ] as { icon: ElementType; label: string; act: () => void }[]).map(({ icon: Icon, label, act }) => (
            <button key={label} onClick={act} style={{
              display: "flex", alignItems: "center", gap: 6,
              padding: "5px 12px", fontSize: 12, fontWeight: 500, borderRadius: 6,
              background: "transparent", border: "1px solid var(--rm-panel-border)",
              color: "var(--rm-text-muted)", cursor: "pointer",
            }}
              onMouseEnter={e => { e.currentTarget.style.background = "var(--rm-panel-hover)"; e.currentTarget.style.color = "var(--rm-text)"; }}
              onMouseLeave={e => { e.currentTarget.style.background = "transparent"; e.currentTarget.style.color = "var(--rm-text-muted)"; }}
            >
              <Icon size={12} /> {label}
            </button>
          ))}
        </div>
      </div>

      {/* Running-job banner */}
      {anyRunning && (
        <div
          onClick={() => { if (activeJob?.uploadId) openRunView(activeJob.uploadId); }}
          style={{
            display: "flex", alignItems: "center", gap: 10,
            padding: "8px 24px",
            background: "#fff8ee",
            borderBottom: "1px solid #f5d9a8",
            fontSize: 12, color: "#8a5500", flexShrink: 0,
            cursor: "pointer",
          }}
        >
          <Loader2 size={13} style={{ color: "#e07b10", animation: "spin 1s linear infinite", flexShrink: 0 }} />
          <span>
            <strong>Import running</strong> — {activeJob!.fileName
              ? <><em>{activeJob!.fileName}</em> is being processed in the background.</>
              : <>your file is being processed in the background.</>}
          </span>
          <span style={{ marginLeft: "auto", fontSize: 11, fontWeight: 600, color: "#8a5500", whiteSpace: "nowrap" }}>
            View progress →
          </span>
        </div>
      )}

      {/* Body */}
      <div style={{ display: "flex", flex: 1, minHeight: 0, overflow: "hidden" }}>

        {/* Sidebar — expanded or collapsed rail */}
        {sidebarOpen ? (
          <aside style={{ width: 220, flexShrink: 0, display: "flex", flexDirection: "column", borderRight: "1px solid var(--rm-panel-border)", background: "var(--rm-panel)", overflowY: "auto" }}>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "10px 12px 6px", borderBottom: "1px solid var(--rm-panel-border)", flexShrink: 0 }}>
              <span style={{ fontSize: 10, fontWeight: 800, letterSpacing: "0.1em", color: "var(--rm-text-muted)", textTransform: "uppercase" }}>Modules</span>
              <button onClick={() => setSidebarOpen(false)} title="Collapse sidebar" style={{ background: "none", border: "none", cursor: "pointer", color: "var(--rm-text-faint)", display: "flex", alignItems: "center", padding: 2 }}>
                <PanelLeftClose size={15} />
              </button>
            </div>
            <div style={{ padding: "6px 0", flex: 1 }}>
              {MODULE_CARDS.map(mod => <SidebarModule key={mod.id} mod={mod} />)}
              <SidebarModule isBilling />
            </div>
          </aside>
        ) : (
          <aside style={{ width: 40, flexShrink: 0, display: "flex", flexDirection: "column", alignItems: "center", borderRight: "1px solid var(--rm-panel-border)", background: "var(--rm-panel)", gap: 2, paddingTop: 6 }}>
            <button
              onClick={() => setSidebarOpen(true)}
              title="Show modules"
              style={{ background: "none", border: "none", cursor: "pointer", color: "var(--rm-text-faint)", display: "flex", alignItems: "center", justifyContent: "center", width: 28, height: 28, borderRadius: 6 }}
              onMouseEnter={e => { e.currentTarget.style.background = "var(--rm-panel-hover)"; e.currentTarget.style.color = "var(--rm-text)"; }}
              onMouseLeave={e => { e.currentTarget.style.background = "none"; e.currentTarget.style.color = "var(--rm-text-faint)"; }}
            >
              <PanelLeftOpen size={15} />
            </button>
            {MODULE_CARDS.map(mod => {
              const Icon    = mod.icon;
              const active  = mod.id === activeId;
              const running = runningMods.has(mod.id);
              return (
                <button
                  key={mod.id}
                  onClick={() => { if (running && activeJob?.uploadId) { openRunView(activeJob.uploadId, mod.id); } else { setActiveId(mod.id); setSidebarOpen(true); } }}
                  title={`${mod.label}${running ? " — importing…" : ""}`}
                  style={{ background: "none", border: "none", cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", width: 28, height: 28, borderRadius: 6, color: running ? "#e07b10" : active ? "var(--rm-green)" : "var(--rm-text-faint)" }}
                  onMouseEnter={e => { e.currentTarget.style.background = "var(--rm-panel-hover)"; if (!active && !running) e.currentTarget.style.color = "var(--rm-text)"; }}
                  onMouseLeave={e => { e.currentTarget.style.background = "none"; e.currentTarget.style.color = running ? "#e07b10" : active ? "var(--rm-green)" : "var(--rm-text-faint)"; }}
                >
                  <Icon size={14} />
                </button>
              );
            })}
            <button
              onClick={() => { setActiveId("billing"); setSidebarOpen(true); }}
              title="Billing Rates"
              style={{ background: "none", border: "none", cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", width: 28, height: 28, borderRadius: 6, color: activeId === "billing" ? "var(--rm-green)" : "var(--rm-text-faint)" }}
              onMouseEnter={e => { e.currentTarget.style.background = "var(--rm-panel-hover)"; if (activeId !== "billing") e.currentTarget.style.color = "var(--rm-text)"; }}
              onMouseLeave={e => { e.currentTarget.style.background = "none"; e.currentTarget.style.color = activeId === "billing" ? "var(--rm-green)" : "var(--rm-text-faint)"; }}
            >
              <BadgeDollarSign size={14} />
            </button>
          </aside>
        )}

        {/* Right panel */}
        <div style={{ flex: 1, display: "flex", flexDirection: "column", minWidth: 0, minHeight: 0, overflow: "hidden", position: "relative" }}>

          {activeId === "billing" ? (
            <div style={{ flex: 1, overflowY: "auto", display: "flex", flexDirection: "column" }}>
              <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "14px 32px", borderBottom: "1px solid var(--rm-panel-border)", flexShrink: 0 }}>
                <span style={{ fontSize: 14, fontWeight: 600, color: "var(--rm-text)", flex: 1 }}>Billing Rates</span>
                <button
                  disabled={billingDownloading}
                  onClick={async () => {
                    setBillingDownloading(true);
                    try { await downloadRateCard(); }
                    catch (e) { console.error("Rate card download failed", e); }
                    finally { setBillingDownloading(false); }
                  }}
                  style={{ display: "flex", alignItems: "center", gap: 6, padding: "6px 14px", borderRadius: 7, fontSize: 12, fontWeight: 600, background: "var(--rm-panel)", border: "1px solid var(--rm-panel-border)", color: billingDownloading ? "var(--rm-text-muted)" : "var(--rm-text-muted)", cursor: billingDownloading ? "not-allowed" : "pointer", opacity: billingDownloading ? 0.7 : 1 }}
                  onMouseEnter={e => { if (!billingDownloading) e.currentTarget.style.color = "var(--rm-text)"; }}
                  onMouseLeave={e => { e.currentTarget.style.color = "var(--rm-text-muted)"; }}
                  title="Download Rate Card template (Excel)"
                >
                  {billingDownloading
                    ? <><Loader2 size={13} style={{ animation: "spin 1s linear infinite" }} /> Downloading…</>
                    : <><Download size={13} /> Download template</>}
                </button>
                <button
                  onClick={() => billingFileRef.current?.click()}
                  disabled={billingUploading}
                  style={{ display: "flex", alignItems: "center", gap: 6, padding: "6px 14px", borderRadius: 7, fontSize: 12, fontWeight: 600, background: "#6BA539", border: "none", color: "#fff", cursor: billingUploading ? "not-allowed" : "pointer", opacity: billingUploading ? 0.7 : 1 }}
                  title="Upload an Excel Rate Card file"
                >
                  {billingUploading ? <Loader2 size={13} style={{ animation: "spin 1s linear infinite" }} /> : <Upload size={13} />}
                  {billingUploading ? "Uploading…" : "Upload File"}
                </button>
                <input
                  ref={billingFileRef}
                  type="file"
                  accept=".xlsx,.xls,.csv"
                  style={{ display: "none" }}
                  onChange={async (e) => {
                    const file = e.target.files?.[0];
                    e.target.value = "";
                    if (!file) return;
                    setBillingUploading(true);
                    setBillingMsg(null);
                    try {
                      // Phase 1 — preview only: nothing is written, no roles created.
                      const pv = await previewRateCard(file);
                      const conflicts = pv.rows.filter(r => r.status === "conflict");
                      if (conflicts.length > 0) {
                        // Same role + same scope but a different rate → let the
                        // user decide per row before anything is saved.
                        setBillingReview({ preview: pv, decisions: Object.fromEntries(conflicts.map(c => [c.idx, true])) });
                        return;
                      }
                      const actionable = pv.rows.filter(r => r.status !== "unchanged");
                      if (actionable.length === 0) {
                        const extra = pv.warnings.length ? ` Notes: ${pv.warnings.slice(0, 2).join("; ")}` : "";
                        setBillingMsg({ ok: true, text: "No changes — every rate in the file matches what's already saved." + extra });
                        return;
                      }
                      // Phase 2 — no conflicts, apply immediately.
                      const res = await applyRateCard(actionable.map(toRateApplyRow));
                      setBillingMsg(rateCardSummaryMsg(res, pv, 0));
                    } catch (err: unknown) {
                      const friendly = (err as { friendlyMessage?: string })?.friendlyMessage;
                      setBillingMsg({ ok: false, text: friendly || (err instanceof Error ? err.message : "Upload failed.") });
                    } finally {
                      setBillingUploading(false);
                    }
                  }}
                />
              </div>
              {billingMsg && (
                <div style={{ margin: "10px 32px 0", padding: "8px 14px", borderRadius: 7, fontSize: 12, fontWeight: 500, background: billingMsg.ok ? "#f0fce8" : "#fff0f0", color: billingMsg.ok ? "#3a7d18" : "#c0392b", border: `1px solid ${billingMsg.ok ? "#b3e89a" : "#f5c6c6"}` }}>
                  {billingMsg.text}
                  <button onClick={() => setBillingMsg(null)} style={{ float: "right", background: "none", border: "none", cursor: "pointer", fontSize: 14, lineHeight: 1, color: "inherit", opacity: 0.6 }}>×</button>
                </div>
              )}
              <div style={{ flex: 1, overflowY: "auto", padding: "24px 32px" }}>
                <BillingRatesPage embedded />
              </div>
            </div>
          ) : activeCard ? (
            <>
              {cleanedError && activeCard.id === initialModule && (
                <div style={{ margin: "12px 24px 0", padding: "10px 14px", borderRadius: 8, background: "rgba(178,106,0,0.12)", border: "1px solid rgba(178,106,0,0.4)", color: "#b26a00", fontSize: 12.5, fontWeight: 600, flexShrink: 0 }}>
                  {cleanedError}
                </div>
              )}
              <InlineDataGrid
              key={activeId}
              cardId={activeCard.id}
              cardLabel={activeCard.label}
              multiTab={activeCard.multiTab}
              embedded={true}
              strictKeys={true}
              isSubmitting={uploading}
              jobRunning={anyRunning}
              thisModRunning={runningMods.has(activeCard.id)}
              forceCreate={!countsLoading && !tenantHasData}
              clientHasData={countsLoading || tenantHasData}
              existingTicketIds={ticketIdsQ.data?.large ? null : (ticketIdsQ.data?.ids ?? null)}
              checkTicketIds={checkTicketIds}
              onClose={() => {}}
              onSubmit={handleSubmit}
              runningUploadId={wizardRun && wizardRun.cardId === activeCard.id ? wizardRun.uploadId : null}
              runIsExternal={wizardRun?.external === true}
              onRunClosed={() => setWizardRun(null)}
              onJobRunningClick={() => { if (activeJob?.uploadId) setRunningDlg(activeJob.uploadId); }}
              onClear={() => {
                void queryClient.invalidateQueries({ queryKey: ["pmm"] });
                void queryClient.invalidateQueries({ queryKey: ["opm"] });
                void queryClient.invalidateQueries({ queryKey: ["lem"] });
                void queryClient.invalidateQueries({ queryKey: ["resources"] });
                void queryClient.invalidateQueries({ queryKey: ["import-data-summary"] });
                void queryClient.invalidateQueries({ queryKey: ["import-ticket-ids"] });
              }}
              onDownloadTemplate={(rows) => void downloadCardTemplate(activeCard.id, activeCard.multiTab, rows)}
              initialFile={activeCard.id === initialModule ? cleanedFile ?? undefined : undefined}
              cleanSessionId={activeCard.id === initialModule ? cleanedSid : undefined}
              cleanTenant={activeCard.id === initialModule ? cleanedTenant : undefined}
              />
            </>
          ) : null}
        </div>
      </div>

      {/* How it works modal */}
      {showHowTo && (
        <div onClick={() => setShowHowTo(false)} style={{ position: "fixed", inset: 0, zIndex: 60, background: "rgba(0,0,0,0.45)", display: "flex", alignItems: "center", justifyContent: "center" }}>
          <div onClick={e => e.stopPropagation()} style={{ background: "var(--rm-panel)", borderRadius: 12, padding: 28, maxWidth: 420, width: "90%", boxShadow: "var(--rm-shadow)" }}>
            <div style={{ fontSize: 16, fontWeight: 700, color: "var(--rm-text)", marginBottom: 16 }}>How importing works</div>
            {[
              ["1. Choose a module", "Pick Projects, Opportunities, Team Assignments, Schedule, Resources, Companies, Leads or Billing Rates from the sidebar."],
              ["2. Type or paste", "Click any cell to edit, or paste rows from Excel — columns are matched automatically."],
              ["3. Download template", "Use the Download template link for a pre-formatted Excel file with dropdowns."],
              ["4. Upload a file", "Click Upload File to load an existing Excel or CSV file."],
              ["5. Import", "Review the data then click Import to bring it into RM ONE."],
            ].map(([title, body]) => (
              <div key={title as string} style={{ marginBottom: 14 }}>
                <div style={{ fontSize: 12, fontWeight: 700, color: "var(--rm-green)", marginBottom: 3 }}>{title}</div>
                <div style={{ fontSize: 12, color: "var(--rm-text-muted)", lineHeight: 1.6 }}>{body}</div>
              </div>
            ))}
            <button onClick={() => setShowHowTo(false)} style={{ marginTop: 8, padding: "7px 20px", fontSize: 12, fontWeight: 700, borderRadius: 6, background: "var(--rm-green)", color: "#fff", border: "none", cursor: "pointer" }}>Got it</button>
          </div>
        </div>
      )}

      {/* Rate Card conflict review modal — same role + scope, different rate */}
      {billingReview && (() => {
        const conflicts = billingReview.preview.rows.filter(r => r.status === "conflict");
        const includedCount = conflicts.filter(c => billingReview.decisions[c.idx]).length;
        const newCount = billingReview.preview.rows.filter(r => r.status === "new").length;
        const fmtR = (n: number | null) => (n == null ? "—" : `$${n}`);
        const FIELD_LABEL: Record<string, string> = { billing: "Billing", labor: "Labor", cost: "Cost" };
        const setAll = (v: boolean) => setBillingReview(prev => prev && ({ ...prev, decisions: Object.fromEntries(conflicts.map(c => [c.idx, v])) }));
        const setOne = (idx: number, v: boolean) => setBillingReview(prev => prev && ({ ...prev, decisions: { ...prev.decisions, [idx]: v } }));
        return (
          <div style={{ position: "fixed", inset: 0, zIndex: 60, background: "rgba(0,0,0,0.45)", display: "flex", alignItems: "center", justifyContent: "center" }}>
            <div style={{ background: "var(--rm-panel)", borderRadius: 12, padding: 24, maxWidth: 680, width: "94%", maxHeight: "84vh", display: "flex", flexDirection: "column", boxShadow: "var(--rm-shadow)" }}>
              <div style={{ fontSize: 16, fontWeight: 700, color: "var(--rm-text)" }}>Review rate changes</div>
              <div style={{ fontSize: 12, color: "var(--rm-text-muted)", margin: "6px 0 12px", lineHeight: 1.55 }}>
                {conflicts.length === 1 ? "1 row in your file has" : `${conflicts.length} rows in your file have`} a different
                rate than what's currently saved. Choose <b>Update</b> to use the file's rate or <b>Skip</b> to keep the existing one.
                {newCount > 0 ? ` ${newCount} other row${newCount === 1 ? "" : "s"} (new or previously blank rates) will be applied automatically.` : ""}
              </div>
              <div style={{ display: "flex", gap: 8, marginBottom: 8 }}>
                <button onClick={() => setAll(true)}  style={{ padding: "4px 12px", fontSize: 11, fontWeight: 700, borderRadius: 6, cursor: "pointer", border: "1px solid var(--rm-panel-border)", background: "var(--rm-panel-soft)", color: "var(--rm-text)" }}>Update all</button>
                <button onClick={() => setAll(false)} style={{ padding: "4px 12px", fontSize: 11, fontWeight: 700, borderRadius: 6, cursor: "pointer", border: "1px solid var(--rm-panel-border)", background: "var(--rm-panel-soft)", color: "var(--rm-text)" }}>Skip all</button>
              </div>
              <div style={{ overflowY: "auto", border: "1px solid var(--rm-panel-border)", borderRadius: 8, minHeight: 0 }}>
                <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12 }}>
                  <thead>
                    <tr style={{ position: "sticky", top: 0, background: "var(--rm-panel-soft)", zIndex: 1 }}>
                      {["Role", "Applies to", "Rate change", "Decision"].map(h => (
                        <th key={h} style={{ textAlign: "left", padding: "8px 10px", fontSize: 10.5, fontWeight: 700, textTransform: "uppercase", letterSpacing: 0.4, color: "var(--rm-text-muted)" }}>{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {conflicts.map(c => (
                      <tr key={c.idx} style={{ borderTop: "1px solid var(--rm-panel-border)" }}>
                        <td style={{ padding: "8px 10px", fontWeight: 600, color: "var(--rm-text)" }}>{c.roleName || c.roleId}</td>
                        <td style={{ padding: "8px 10px", color: "var(--rm-text-muted)" }}>{c.scope}</td>
                        <td style={{ padding: "8px 10px", color: "var(--rm-text)" }}>
                          {c.conflictFields.map(f => (
                            <div key={f} style={{ whiteSpace: "nowrap" }}>
                              {FIELD_LABEL[f]}: <span style={{ textDecoration: "line-through", opacity: 0.55 }}>{fmtR(c.existing?.[f] ?? null)}</span>
                              {" → "}<b>{fmtR(c.incoming[f])}</b>/hr
                            </div>
                          ))}
                        </td>
                        <td style={{ padding: "8px 10px", whiteSpace: "nowrap" }}>
                          <button onClick={() => setOne(c.idx, true)}  style={{ ...ratePillStyle(!!billingReview.decisions[c.idx], true), marginRight: 6 }}>Update</button>
                          <button onClick={() => setOne(c.idx, false)} style={ratePillStyle(!billingReview.decisions[c.idx], false)}>Skip</button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              {billingReview.preview.warnings.length > 0 && (
                <div style={{ fontSize: 11, color: "#b26a00", marginTop: 8, lineHeight: 1.5 }}>
                  {billingReview.preview.warnings.slice(0, 3).join(" · ")}
                </div>
              )}
              <div style={{ display: "flex", justifyContent: "flex-end", alignItems: "center", gap: 10, marginTop: 14 }}>
                <button
                  disabled={billingApplying}
                  onClick={() => { setBillingReview(null); setBillingMsg({ ok: true, text: "Upload cancelled — nothing was changed." }); }}
                  style={{ padding: "7px 16px", fontSize: 12, fontWeight: 700, borderRadius: 6, background: "var(--rm-panel-soft)", color: "var(--rm-text)", border: "1px solid var(--rm-panel-border)", cursor: billingApplying ? "not-allowed" : "pointer", opacity: billingApplying ? 0.6 : 1 }}
                >
                  Cancel upload
                </button>
                <button
                  disabled={billingApplying}
                  onClick={() => void applyBillingReview()}
                  style={{ display: "flex", alignItems: "center", gap: 6, padding: "7px 18px", fontSize: 12, fontWeight: 700, borderRadius: 6, background: "#6BA539", color: "#fff", border: "none", cursor: billingApplying ? "not-allowed" : "pointer", opacity: billingApplying ? 0.7 : 1 }}
                >
                  {billingApplying && <Loader2 size={13} style={{ animation: "spin 1s linear infinite" }} />}
                  {billingApplying
                    ? "Applying…"
                    : `Apply (${includedCount} update${includedCount === 1 ? "" : "s"}${newCount > 0 ? ` + ${newCount} new` : ""})`}
                </button>
              </div>
            </div>
          </div>
        );
      })()}

      {preflight && (
        <PreflightIssuesDialog
          issues={preflight.issues}
          busy={uploading}
          onCancel={() => {
            const p = preflight;
            setPreflight(null);
            // The upload already created a pending job server-side — cancel it
            // so it never lingers as an "active import" (fire-and-forget).
            if (p?.uploadId) {
              fetch(`/api/onboarding/cancel/${p.uploadId}`, { method: "POST", headers: authHeaders() as Record<string, string> }).catch(() => {});
            }
          }}
          onContinue={async () => {
            const p = preflight;
            setPreflight(null);
            setUploading(true);
            try { await startRun(p.uploadId, p.mode, p.forcedRecordType); } finally { setUploading(false); }
          }}
        />
      )}

      {/* Live "import running" popup — same /status API + terminal look as
          the full progress page, in a modal so returning users immediately
          see their import is still processing. */}
      {runningDlg && (
        <ImportRunningDialog
          uploadId={runningDlg}
          onClose={() => setRunningDlg(null)}
          onViewFull={() => { if (runningDlg) openRunView(runningDlg); }}
        />
      )}

      <InviteMembersDialog
        tenantId={user?.tenant ?? ""}
        open={inviteOpen}
        onOpenChange={setInviteOpen}
      />

      {/* CLEANING_HIDDEN: "Cleaned files" dialog — restore by un-commenting
      <CleanedFilesDialog
        open={cleanFilesOpen}
        onClose={() => setCleanFilesOpen(false)}
        tenantOverride={cleanedTenant}
      /> */}
    </div>
  );
}
