import { useEffect, useState, useCallback, useRef, useMemo } from "react";
import { useLocation } from "wouter";
import { useQueryClient } from "@tanstack/react-query";
import {
  CheckCircle2, XCircle, Loader2, AlertTriangle,
  Download, ArrowLeft, Database, RefreshCw, Plus, Gauge, UserPlus,
  Users, Building2, FolderKanban, CalendarCheck, ChevronRight,
  Pencil, Trash2, Check, X, Mail, ChevronDown, ChevronUp, StopCircle, Settings2,
} from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription,
} from "@/components/ui/dialog";
import InviteMembersDialog from "@/components/InviteMembersDialog";
import { AddStaffModal } from "@/components/AddStaffModal";
import { authHeaders, bustCache, activeImportKey, importResultKey } from "@/lib/api";
import { NeedsAttentionCard, type ReviewItem } from "@/components/NeedsAttentionCard";
import { InlineDataGrid } from "@/components/InlineDataGrid";
import { TerminalStatusCard, SOFT_CAP } from "@/components/TerminalStatusCard";

function cardIdFromFileName(name: string): { cardId: string; multiTab: boolean } {
  const n = name.toLowerCase();
  if (n.includes("lead"))                                             return { cardId: "leads",         multiTab: false };
  if (n.includes("team") || n.includes("staff") || n.includes("people") || n.includes("roster"))
                                                                      return { cardId: "team",          multiTab: false };
  if (n.includes("opp") || n.includes("opportunit"))                 return { cardId: "opportunities", multiTab: false };
  if (n.includes("compan") || n.includes("client"))                  return { cardId: "companies",      multiTab: false };
  return { cardId: "projects", multiTab: true };
}

const API = "/api/onboarding";

interface StepResult {
  step:          number;
  table:         string;
  rowsAttempted: number;
  rowsInserted:  number;
  rowsSkipped:   number;
  rowsUpdated?:  number;
  rowsNeedsAttention?: number;
  errors:        { table: string; rowIndex: number; message: string; title?: string }[];
}

interface PipelineProgress {
  phase:  string;
  table?: string;
  pct:    number;
  done?:  number;
  total?: number;
}

interface StatusResponse {
  uploadId:                 string;
  tenantId:                 string;
  fileName:                 string;
  status:                   "pending" | "running" | "success" | "partial" | "failed" | "cancelled";
  importMode?:              string | null;
  createdAt:                string;
  // Epoch-ms of the last pipeline progress event (null when the responding
  // worker isn't the one running the pipeline). Used for the stale warning.
  lastActivityAt?:          number | null;
  totalInserted:            number;
  totalErrors:              number;
  failureReason?:           string | null;
  fatalError?:              string | null;
  // True when the server rolled back (soft-deleted) everything this failed run
  // wrote — only happens for a first-ever "create" import.
  rolledBack?:              boolean;
  progress?:                PipelineProgress | null;
  steps:                    StepResult[] | undefined;
  // Pre-merged flat list of all row errors (step-level + top-level). Preferred
  // over computing from steps because some errors are only in result.errors.
  errors?:                  { table: string; rowIndex: number; message: string; title?: string }[];
  warnings?:                string[];
  constructionRetryEntries?: unknown[];
  needsAttention?:          number;
}

interface VerifyCount { label: string; count: number; }
interface VerifyResponse { tenantId: string; counts: VerifyCount[]; }
interface RowsResponse { table: string; tenantId: string; columns: string[]; rows: Record<string, unknown>[]; total: number; }


const LABEL_TO_TABLE: Record<string, string> = {
  "Team Members":           "AspNetUsers",
  "Divisions":              "CompanyDivisions",
  "Departments":            "Department",
  "Roles":                  "Roles",
  "Job Titles":             "Jobtitle",
  "Client Companies":       "CRMCompany",
  "Client Contacts":        "CRMContact",
  "Projects (PMM)":         "PMM",
  "Opportunities":          "Opportunity",
  "Resource-Project Links": "ResourceWorkItems",
  "Allocations":            "ResourceAllocation",
};

// Rotating messages shown under the progress bar while an import runs, so the
// wait feels purposeful instead of a frozen spinner. On-brand RM ONE / resource-
// planning lines — kept generic (no fabricated claims) and tasteful.
const RUNNING_QUOTES = [
  "Aligning your people, projects, and pipeline…",
  "Turning spreadsheets into a single source of truth.",
  "Mapping every team member to the right role and division.",
  "Great resource planning starts with clean data.",
  "Connecting allocations to the work that matters.",
  "Every project tells a story — we're reading yours.",
  "Good forecasting beats guesswork, every time.",
  "Building your command centre, one record at a time.",
  "Tip: you can review and edit assumed values once this finishes.",
  "Visibility today, smarter decisions tomorrow.",
] as const;

// Animated "stages" that cycle while an import runs. They illustrate the kind of
// work happening server-side (the backend reports no granular progress), so the
// screen feels alive and purposeful instead of frozen at the soft cap.
const STAGES = [
  { label: "People & roles",      Icon: Users },
  { label: "Client companies",    Icon: Building2 },
  { label: "Projects & pipeline", Icon: FolderKanban },
  { label: "Allocations",         Icon: CalendarCheck },
] as const;

// Map a live-progress core2 table → the STAGES pill it belongs to, so the active
// pill tracks the real current step instead of a timed cycle.
const STAGE_FOR_TABLE: Record<string, number> = {
  CompanyDivisions: 0, Department: 0, Roles: 0, Jobtitle: 0, AspNetUsers: 0,
  ResourceWorkItems: 0,
  CRMCompany: 1, CRMContact: 1,
  PMM: 2, Opportunity: 2,
  ResourceAllocation: 3, ModuleTasks: 3, TicketHours: 3, POR: 3,
  ResourceTimeSheet: 3, SVCRequests: 3, ACR: 3, Config_ConfigurationVariable: 3,
};

function StatusIcon({ status }: { status: StatusResponse["status"] }) {
  if (status === "success")   return <CheckCircle2 className="w-8 h-8 text-green-500"  />;
  if (status === "failed")    return <XCircle      className="w-8 h-8 text-red-500"    />;
  if (status === "cancelled") return <XCircle      className="w-8 h-8 text-slate-400"  />;
  if (status === "partial")   return <AlertTriangle className="w-8 h-8 text-yellow-500" />;
  return (
    <div className="relative flex items-center justify-center">
      <div className="rm-pulse-glow absolute inset-0 rounded-full bg-blue-500/40 blur-md" />
      <Loader2 className="relative w-8 h-8 text-blue-500 animate-spin" />
    </div>
  );
}

function statusColor(s: StatusResponse["status"]) {
  return s === "success"   ? "text-green-500"
       : s === "failed"    ? "text-red-500"
       : s === "cancelled" ? "text-slate-400"
       : s === "partial"   ? "text-yellow-500"
       : "text-blue-500";
}

type PipelineStep = { step: number; table: string; rowsInserted: number; rowsSkipped: number; rowsUpdated?: number; errors: { table: string; rowIndex: number; message: string; title?: string }[] };

function StepResults({ steps }: { steps: PipelineStep[] }) {
  const [expanded, setExpanded] = useState<string | null>(null);
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Pipeline Steps</CardTitle>
        <CardDescription>Each step corresponds to one RM ONE table insert</CardDescription>
      </CardHeader>
      <CardContent className="space-y-1.5">
        {steps.map(step => {
          const hasErrors = step.errors.length > 0;
          const isOpen = expanded === step.table;
          return (
            <div key={step.step} className="rounded border overflow-hidden">
              <button
                className={`w-full flex items-center justify-between px-4 py-2 text-sm text-left ${hasErrors ? "cursor-pointer hover:bg-red-500/5" : ""}`}
                onClick={() => hasErrors && setExpanded(isOpen ? null : step.table)}
                disabled={!hasErrors}
              >
                <div className="flex items-center gap-3">
                  {hasErrors
                    ? <XCircle className="w-4 h-4 text-red-500 shrink-0" />
                    : <CheckCircle2 className="w-4 h-4 text-green-500 shrink-0" />}
                  <span className="font-medium">{TABLE_LABELS[step.table] ?? step.table}</span>
                  <span className="text-xs text-muted-foreground">({step.table})</span>
                </div>
                <div className="flex items-center gap-3 text-xs text-muted-foreground">
                  {step.rowsInserted > 0 && <span className="text-green-600 font-semibold">{step.rowsInserted} inserted</span>}
                  {(step.rowsUpdated ?? 0) > 0 && <span className="text-green-600 font-semibold">{step.rowsUpdated} updated</span>}
                  {step.rowsSkipped > 0 && <span>{step.rowsSkipped} reused</span>}
                  {step.rowsInserted === 0 && (step.rowsUpdated ?? 0) === 0 && step.rowsSkipped === 0 && !hasErrors && <span>none in file</span>}
                  {hasErrors && <Badge variant="destructive" className="text-xs">{step.errors.length} error{step.errors.length > 1 ? "s" : ""}</Badge>}
                  {hasErrors && (isOpen ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />)}
                </div>
              </button>
              {isOpen && (
                <div className="border-t bg-red-500/5 px-4 py-3 space-y-2">
                  <p className="text-xs font-medium text-red-600 mb-2">Why these rows failed:</p>
                  {step.errors.map((e, i) => (
                    <div key={i} className="bg-background rounded px-3 py-2 border border-red-200 dark:border-red-900 space-y-0.5">
                      <div className="flex items-center gap-2 text-xs font-medium text-muted-foreground">
                        {e.rowIndex >= 0 && (
                          <span className="bg-red-100 dark:bg-red-900/40 text-red-600 rounded px-1.5 py-0.5 font-mono shrink-0">
                            Row {e.rowIndex + 1}
                          </span>
                        )}
                        {e.title && <span className="truncate">{e.title}</span>}
                      </div>
                      <p className="text-xs text-red-600">{e.message}</p>
                    </div>
                  ))}
                </div>
              )}
            </div>
          );
        })}
      </CardContent>
    </Card>
  );
}

const TABLE_LABELS: Record<string, string> = {
  CompanyDivisions:    "Divisions",
  Department:          "Departments",
  Roles:               "Roles",
  Jobtitle:            "Job Titles",
  AspNetUsers:         "Team Members",
  CRMCompany:          "Client Companies",
  CRMContact:          "Client Contacts",
  PMM:                 "Projects",
  Opportunity:         "Opportunities",
  ResourceWorkItems:   "Resource–Project Links",
  ResourceAllocation:  "Allocations",
};

const CATEGORY_ICON = {
  team:    <Users          className="w-4 h-4 text-blue-400"   />,
  clients: <Building2      className="w-4 h-4 text-purple-400" />,
  work:    <FolderKanban   className="w-4 h-4 text-orange-400" />,
  assign:  <CalendarCheck  className="w-4 h-4 text-green-400"  />,
};

const TABLE_CATEGORY: Record<string, keyof typeof CATEGORY_ICON> = {
  CompanyDivisions: "team", Department: "team", Roles: "team",
  Jobtitle: "team", AspNetUsers: "team",
  CRMCompany: "clients", CRMContact: "clients",
  PMM: "work", Opportunity: "work",
  ResourceWorkItems: "assign", ResourceAllocation: "assign",
};

interface ExtraRecordGroup {
  entityType: string;
  naturalKey: string;
  recordLabel: string;
  sheetName: string | null;
  fields: { fieldName: string; value: string | null }[];
}

// "Assumed Data" — values the wizard filled for fields a client left blank.
interface AssumedRecordGroup {
  entityType: string;
  naturalKey: string;
  recordLabel: string;
  sheetName: string | null;
  fields: { fieldName: string; value: string | null; confidence?: string | null }[];
}

// Append-only audit / version history of an assumed value.
interface AssumedHistoryEntry {
  id: number;
  entityType: string;
  naturalKey: string;
  recordLabel: string | null;
  fieldName: string;
  action: string;
  oldValue: string | null;
  newValue: string | null;
  confidence: string | null;
  actor: string | null;
  createdAt: string;
}

const EXTRA_ENTITY_LABELS: Record<string, string> = {
  person: "Team Member", company: "Client Company", contact: "Client Contact",
  project: "Project", opportunity: "Opportunity", assignment: "Assignment", record: "Record",
};

// ── PipelineFlow ──────────────────────────────────────────────────────────
// Animated 5-node data pipeline: People → Clients → Projects → Allocs → DB.
// The active node glows; the connecting pipe segments before it scroll with
// animated dots (CSS class rm-pipe-scroll defined in index.css).
function PipelineFlow({ activeIdx }: { activeIdx: number }) {
  const nodes = [
    { label: "People",   Icon: Users },
    { label: "Clients",  Icon: Building2 },
    { label: "Projects", Icon: FolderKanban },
    { label: "Allocs",   Icon: CalendarCheck },
    { label: "RM ONE DB", Icon: Database },
  ];
  const isDB = (i: number) => i === nodes.length - 1;
  return (
    <div className="flex items-end justify-between px-1 pb-1">
      {nodes.map((node, i) => (
        <div key={node.label} className="flex items-center flex-1 last:flex-none">
          {i > 0 && (
            <div
              className={`flex-1 h-1 mx-0.5 rounded-full transition-all duration-700 ${
                i <= activeIdx ? "rm-pipe-scroll" : "opacity-20 bg-border"
              }`}
            />
          )}
          <div className="relative flex flex-col items-center gap-1 shrink-0">
            {i === activeIdx && (
              <div className="rm-node-ring absolute -inset-2 rounded-full border-2 border-blue-400/50 pointer-events-none" />
            )}
            <div className={`relative flex items-center justify-center rounded-full border-2 transition-all duration-500 ${
              isDB(i)
                ? "w-10 h-10 bg-blue-600 border-blue-500 text-white shadow-[0_0_20px_-4px] shadow-blue-500/70"
                : i === activeIdx
                  ? "w-9 h-9 bg-blue-500/15 border-blue-500 text-blue-600 shadow-[0_0_14px_-4px] shadow-blue-400/60"
                  : i < activeIdx
                    ? "w-9 h-9 bg-green-500/10 border-green-500/40 text-green-600"
                    : "w-9 h-9 bg-muted/30 border-border/30 text-muted-foreground/30"
            }`}>
              <node.Icon className={isDB(i) ? "w-4 h-4" : "w-3.5 h-3.5"} />
              {i === activeIdx && (
                <span className="rm-pulse-glow absolute inset-0 rounded-full bg-blue-500/20 blur-sm pointer-events-none" />
              )}
            </div>
            <span className={`text-[9px] uppercase tracking-wide font-semibold ${
              i === activeIdx ? "text-blue-600 dark:text-blue-400"
              : i < activeIdx  ? "text-green-600/70"
              : "text-muted-foreground/40"
            }`}>{node.label}</span>
          </div>
        </div>
      ))}
    </div>
  );
}


export default function OnboardingStatusPage({ uploadId }: { uploadId: string }) {
  const [, navigate] = useLocation();

  // ── Auto-recover missing uploadId ─────────────────────────────────────────
  // If the user navigates directly to /onboarding/status (no :id), or the URL
  // was lost, try the last active import stored in localStorage. If nothing
  // there either, send them to history so they can pick the right job.
  useEffect(() => {
    if (uploadId) return;
    try {
      const saved = localStorage.getItem(activeImportKey());
      if (saved) { navigate(`/onboarding/status/${saved}`, { replace: true }); return; }
    } catch {}
    navigate("/onboarding/history", { replace: true });
  }, [uploadId, navigate]);

  const [data, setData]         = useState<StatusResponse | null>(null);
  const [verify, setVerify]       = useState<VerifyResponse | null>(null);
  const [verifying, setVerifying] = useState(false);
  const [verifyErr, setVerifyErr] = useState<string | null>(null);
  const [rowsModal, setRowsModal] = useState<{ label: string; data: RowsResponse } | null>(null);
  const [rowsLoading, setRowsLoading] = useState(false);
  const [extras, setExtras] = useState<ExtraRecordGroup[]>([]);
  const [extrasOpen, setExtrasOpen] = useState(false);
  const [assumed, setAssumed] = useState<AssumedRecordGroup[]>([]);
  const [assumedOpen, setAssumedOpen] = useState(false);
  const [assumedSearch, setAssumedSearch] = useState("");
  const [assumedTier, setAssumedTier] = useState<string>("all");
  const [history, setHistory] = useState<AssumedHistoryEntry[]>([]);
  const [historyShown, setHistoryShown] = useState(false);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [extrasVerifying, setExtrasVerifying] = useState(false);
  const [extrasVerified, setExtrasVerified] =
    useState<{ fields: number; records: number; at: string } | null>(null);
  // Inline edit state for a single kept extra field, keyed by entity/natural/field.
  const [editingField, setEditingField] = useState<{ key: string; value: string } | null>(null);
  const [savingField, setSavingField] = useState(false);
  // Secure invite ("set your own password") flow — handled by the reusable
  // InviteMembersDialog popup. It opens automatically once the import finishes
  // successfully, and can be re-opened from the invite card.
  const [inviteOpen, setInviteOpen] = useState(false);

  // Needs-attention review queue. Fail-quiet: non-admins simply see no card.
  const [reviewItems, setReviewItems]       = useState<ReviewItem[]>([]);
  const [reviewBusy, setReviewBusy]         = useState<number | null>(null);
  const [reviewResolved, setReviewResolved] = useState(0);

  const loadReview = useCallback(async () => {
    try {
      const res = await fetch(`${API}/review?status=open`, { headers: authHeaders() });
      if (!res.ok) return;
      const j = await res.json();
      setReviewItems(Array.isArray(j.items) ? j.items : []);
    } catch { /* fail-quiet */ }
  }, []);

  useEffect(() => { void loadReview(); }, [loadReview]);

  const resolveReview = useCallback(async (item: ReviewItem, action: string, targetKey?: string, targetLabel?: string) => {
    setReviewBusy(item.id);
    try {
      const res = await fetch(`${API}/review/${item.id}/resolve`, {
        method: "POST",
        headers: { "Content-Type": "application/json", ...authHeaders() },
        body: JSON.stringify({ action, targetKey, targetLabel }),
      });
      if (!res.ok) {
        const j = await res.json().catch(() => ({} as any));
        // 409 = already handled elsewhere — just refresh the list silently.
        if (res.status !== 409) alert(j?.error || "Could not save this decision — please try again.");
      } else if (action !== "dismiss") {
        setReviewResolved(n => n + 1);
      }
      await loadReview();
    } catch {
      alert("Could not save this decision — please try again.");
    } finally {
      setReviewBusy(null);
    }
  }, [loadReview]);
  const [errorsOpen, setErrorsOpen] = useState(false);
  const [addStaffOpen, setAddStaffOpen] = useState(false);
  const [cancelConfirm, setCancelConfirm] = useState(false);
  const [cancelling, setCancelling] = useState(false);
  const [staleWarning, setStaleWarning] = useState(false);
  const [neverStarted, setNeverStarted] = useState(false);
  const [retrying, setRetrying] = useState(false);
  const [retryResult, setRetryResult] = useState<{ message: string; ok: boolean } | null>(null);
  const [previewFile, setPreviewFile] = useState<File | null>(null);

  async function handleRetryConstruction() {
    setRetrying(true);
    setRetryResult(null);
    try {
      const res = await fetch(`${API}/retry-construction/${uploadId}`, {
        method: "POST",
        headers: { ...authHeaders() },
      });
      const json = await res.json();
      setRetryResult({ ok: json.ok ?? false, message: json.message ?? (json.error ?? "Retry failed") });
      if (json.ok) {
        // Refresh status so the warnings list and retry entries reflect the new state
        const statusRes = await fetch(`${API}/status/${uploadId}`, { headers: authHeaders() });
        if (statusRes.ok) setData(await statusRes.json());
      }
    } catch (e: any) {
      setRetryResult({ ok: false, message: e.message ?? "Retry failed" });
    } finally {
      setRetrying(false);
    }
  }

  async function handleCancel() {
    setCancelling(true);
    try {
      const res = await fetch(`${API}/cancel/${uploadId}`, {
        method: "POST",
        headers: { ...authHeaders() },
      });
      if (res.ok) {
        cancelRequestedRef.current = true;
        // Flip the UI to "cancelled" IMMEDIATELY — waiting for the next poll
        // tick leaves a confusing window where the terminal keeps animating a
        // job the user just stopped. The poll confirms the real state after.
        setData(prev => (prev ? { ...prev, status: "cancelled" } : prev));
        setNeverStarted(false);
        // The user cancelled it themselves — drop the global watcher marker so
        // no "Import cancelled" popup chases them around the app afterwards.
        try { localStorage.removeItem(activeImportKey()); } catch { /* ignore */ }
        try { localStorage.removeItem(importResultKey()); } catch { /* ignore */ }
      }
    } catch { /* polling will pick up the status change */ }
    finally {
      setCancelling(false);
      setCancelConfirm(false);
    }
  }

  const autoInviteShownRef = useRef(false);
  // Set the moment the user's cancel request succeeds. The status poll uses it
  // to ignore stale "running"/"pending" responses that were already in flight
  // when the cancel landed — otherwise they briefly revive the animation.
  const cancelRequestedRef = useRef(false);
  // When this page was opened — the "never started" banner must also wait for
  // the page itself to have watched the job for a while, or a stale "pending"
  // served by a cluster worker that hasn't seen the /run yet flashes the
  // banner right after the user clicks "Import anyway".
  const pageOpenedAtRef = useRef(Date.now());
  // Track whether the run was already finished when the page first loaded.
  // If so, skip the auto-open — the user navigated here deliberately (e.g.
  // from history) and doesn't need the popup forced on them.
  const firstLoadTerminalRef = useRef<boolean | null>(null);
  // Once ANY poll has seen the job running (or finished), the "never started"
  // banner is permanently off the table: a run cannot go back to pending. In
  // prod the API runs as several instances behind a load balancer — right
  // after /run, polls that land on a non-owning instance still read a stale
  // "pending" DB row (the initial multi-MB blob INSERT hasn't committed yet),
  // so a pending response NEVER proves the pipeline didn't start.
  const everRanRef = useRef(false);
  const qc = useQueryClient();
  const cacheBustedRef = useRef(false);

  // When the import completes successfully, immediately:
  // 1. Invalidate the setup-gate query → sidebar unlocks without a refresh
  // 2. Bust the api.ts in-memory cache so the next fetch is truly fresh
  // 3. EAGERLY refetch all module data queries in the background so the
  //    cache is warm with real data BEFORE the user navigates to Projects /
  //    Opportunities / People. Using refetchQueries (not just invalidateQueries)
  //    triggers an active fetch immediately — invalidateQueries alone only marks
  //    as stale, meaning the user would see old empty data on first page visit
  //    until the background refetch completes.
  useEffect(() => {
    if (cacheBustedRef.current) return;
    if (data?.status !== "success" && data?.status !== "partial") return;
    cacheBustedRef.current = true;
    // Clear the api.ts request cache (in-memory + persisted) so EVERY module —
// Projects, Opportunities, Leads, Staff, Billing Rates, Organization (BUs /
    // Divisions / Departments), Forecast, Alerts, Home — refetches fresh data.
    bustCache();
    // Invalidate ALL React Query caches (no filter). Imports can touch any
    // module plus the org structure, so a targeted list always under-refreshes;
    // pages the user isn't on simply refetch on their next mount.
    void qc.invalidateQueries();
    void qc.refetchQueries({ queryKey: ["onboarding-history"] });
  }, [data?.status, qc]);

  // ── Auto-redirect after import completes ─────────────────────────────────
  // Pick the most relevant module page based on what was imported.
  // Priority: Projects (PMM) > Opportunities > Leads > Resources > fallback.
  const primaryModulePath = useMemo(() => {
    const steps = data?.steps ?? [];
    const touched = (s: PipelineStep) => s.rowsInserted > 0 || (s.rowsUpdated ?? 0) > 0;
    if (steps.some(s => s.table === "PMM"         && touched(s))) return "/projects";
    if (steps.some(s => s.table === "Opportunity" && touched(s))) return "/projects";
    if (steps.some(s => s.table === "Lead"        && touched(s))) return "/projects";
    if (steps.some(s => s.table === "AspNetUsers" && touched(s))) return "/resources";
    return "/projects";
  }, [data?.steps]);
  const primaryModuleLabel = primaryModulePath === "/resources" ? "Resources" : "Projects";

  const [redirectCountdown, setRedirectCountdown] = useState<number | null>(null);
  const countdownStartedRef = useRef(false);
  const inviteWasOpenRef    = useRef(false);
  const errorsWasOpenRef    = useRef(false);

  const startCountdown = useCallback(() => {
    if (countdownStartedRef.current) return;
    countdownStartedRef.current = true;
    setRedirectCountdown(10);
  }, []);

  // Start countdown when invite modal closes after having been opened.
  useEffect(() => {
    if (inviteOpen) { inviteWasOpenRef.current = true; return; }
    if (inviteWasOpenRef.current) startCountdown();
  }, [inviteOpen, startCountdown]);

  // Start countdown when errors modal closes after having been opened.
  useEffect(() => {
    if (errorsOpen) { errorsWasOpenRef.current = true; return; }
    if (errorsWasOpenRef.current) startCountdown();
  }, [errorsOpen, startCountdown]);

  // If import finishes but no modal was auto-opened (e.g. no team to invite),
  // start countdown automatically after a short grace period.
  useEffect(() => {
    if (data?.status !== "success" && data?.status !== "partial") return;
    if (firstLoadTerminalRef.current === true) return; // arrived at already-done run → no auto-redirect
    const t = setTimeout(() => {
      if (!inviteOpen && !countdownStartedRef.current) startCountdown();
    }, 1500);
    return () => clearTimeout(t);
  }, [data?.status, inviteOpen, startCountdown]);

  // Tick the countdown and navigate when it reaches zero.
  useEffect(() => {
    if (redirectCountdown === null) return;
    if (redirectCountdown <= 0) { navigate(primaryModulePath); return; }
    const t = setTimeout(() => setRedirectCountdown(n => (n !== null ? n - 1 : null)), 1000);
    return () => clearTimeout(t);
  }, [redirectCountdown, primaryModulePath, navigate]);

  useEffect(() => {
    if (!uploadId) return;
    let timer: ReturnType<typeof setInterval>;
    let consecutiveFailures = 0;
    const STALE_JOB_MS  = 25 * 60 * 1000; // 25 min → show stale warning
    const MAX_FAILURES  = 10;              // ~20s of failed polls → go to history

    const poll = async () => {
      try {
        const res = await fetch(`${API}/status/${uploadId}`, { headers: authHeaders() });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const d = await res.json() as StatusResponse;
        consecutiveFailures = 0;

        // Record on the very first response whether the run was already done.
        if (firstLoadTerminalRef.current === null) {
          firstLoadTerminalRef.current = d.status !== "pending" && d.status !== "running";
        }
        // Once the user has requested a cancel, ignore stale non-terminal
        // responses (a poll dispatched just before the cancel POST resolved
        // can come back "running" and briefly revive the terminal animation).
        if (cancelRequestedRef.current && (d.status === "pending" || d.status === "running")) {
          return;
        }
        setData(d);

        // Detect a stale "running" job (server never marked it done). Measure
        // from the last pipeline activity when the server provides it — big
        // imports legitimately run past any fixed age, so age-since-created
        // alone would flag a healthy long run as stale.
        if (d.status === "running") {
          const lastAct = d.lastActivityAt ?? (d.createdAt ? new Date(d.createdAt).getTime() : null);
          if (lastAct !== null) {
            const idleMs = Date.now() - lastAct;
            if (idleMs > STALE_JOB_MS) setStaleWarning(true); else setStaleWarning(false);
          }
        }

        // Detect a job whose import never actually started: the upload exists
        // but /run either failed or was never called, so the job is stuck in
        // "pending". Deliberately conservative: (a) once any poll has reported
        // running/terminal the banner is permanently suppressed, and (b) the
        // watch threshold is 75s — in prod, cross-instance polls can read a
        // stale "pending" DB row for a while after a successful /run (the
        // upload's file-blob INSERT is still committing), and a false banner
        // is dangerous: its "back to Upload" action cancels the job.
        if (d.status !== "pending") everRanRef.current = true;
        if (d.status === "pending" && d.createdAt && !everRanRef.current) {
          const ageMs     = Date.now() - new Date(d.createdAt).getTime();
          const watchedMs = Date.now() - pageOpenedAtRef.current;
          setNeverStarted(ageMs > 75_000 && watchedMs > 75_000);
        } else {
          setNeverStarted(false);
        }

        if (d.status !== "pending" && d.status !== "running") {
          clearInterval(timer);
          // Only write the completion-result key when this page WATCHED the job
          // finish (firstLoadTerminalRef.current === false). When the user arrives
          // at an already-completed run (e.g. from import history), we must NOT
          // write the key or the global watcher will fire the "Import successful"
          // popup every time they return from history. Cancelled runs never
          // write the key either — a cancel is always user-initiated, so a
          // delayed "Import cancelled" popup elsewhere in the app is just noise.
          if (firstLoadTerminalRef.current === false && d.status !== "cancelled") {
            try {
              localStorage.setItem(importResultKey(), JSON.stringify({
                uploadId: d.uploadId,
                status: d.status,
                fileName: d.fileName,
                totalInserted: d.totalInserted ?? 0,
                totalErrors: d.totalErrors ?? 0,
              }));
              localStorage.removeItem(activeImportKey());
            } catch {}
          } else if (d.status === "cancelled" && firstLoadTerminalRef.current === false) {
            // Still clear the active-import marker so the global watcher and
            // the import page stop tracking a job that no longer runs.
            try { localStorage.removeItem(activeImportKey()); } catch {}
          }
        }
      } catch {
        consecutiveFailures++;
        // After ~20s of failed polls (bad uploadId, server restarted, etc.)
        // stop spinning forever and send the user to history instead.
        if (consecutiveFailures >= MAX_FAILURES) {
          clearInterval(timer);
          try { localStorage.removeItem(activeImportKey()); } catch {}
          navigate("/onboarding/history");
        }
      }
    };
    poll();
    timer = setInterval(poll, 2000);
    return () => clearInterval(timer);
  }, [uploadId, navigate]);

  // Once the import has finished, load any "extra" columns the user chose to keep
  // in our own database so they can be displayed next to the matching records.
  useEffect(() => {
    if (!data || (data.status !== "success" && data.status !== "partial")) return;
    if (!data.tenantId) return;
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(`${API}/extra-fields?tenantId=${encodeURIComponent(data.tenantId)}`, { headers: authHeaders() });
        if (!res.ok) return;
        const d = await res.json() as { records: ExtraRecordGroup[] };
        if (!cancelled) setExtras(d.records ?? []);
      } catch { /* ignore */ }
    })();
    return () => { cancelled = true; };
  }, [data?.status, data?.tenantId]);

  // Load any "Assumed Data" — values the wizard filled in for fields the client
  // left blank — so the user can see exactly what was system-generated.
  useEffect(() => {
    if (!data || (data.status !== "success" && data.status !== "partial")) return;
    if (!data.tenantId) return;
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(`${API}/assumed?tenantId=${encodeURIComponent(data.tenantId)}`, { headers: authHeaders() });
        if (!res.ok) return;
        const d = await res.json() as { records: AssumedRecordGroup[] };
        if (!cancelled) setAssumed(d.records ?? []);
      } catch { /* ignore */ }
    })();
    return () => { cancelled = true; };
  }, [data?.status, data?.tenantId]);

  // Fetch the original uploaded file so it can be previewed in the data grid.
  useEffect(() => {
    if (!uploadId) return;
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(`${API}/file/${uploadId}`, { headers: authHeaders() });
        if (!res.ok || cancelled) return;
        const blob = await res.blob();
        const name = data?.fileName ?? "upload.xlsx";
        if (!cancelled) setPreviewFile(new File([blob], name, { type: blob.type }));
      } catch { /* ignore — grid just stays hidden */ }
    })();
    return () => { cancelled = true; };
  }, [uploadId, data?.fileName]);

  // Load the append-only audit / version history of assumed values for this
  // tenant on demand (when the user expands "Audit history" in the dialog).
  const loadHistory = useCallback(async () => {
    const tid = data?.tenantId ?? "";
    if (!tid) return;
    setHistoryLoading(true);
    try {
      const res = await fetch(
        `${API}/assumed/history?tenantId=${encodeURIComponent(tid)}`,
        { headers: authHeaders() },
      );
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const d = await res.json() as { history?: AssumedHistoryEntry[] };
      setHistory(d.history ?? []);
      setHistoryShown(true);
    } catch { /* ignore */ }
    finally { setHistoryLoading(false); }
  }, [data?.tenantId]);

  // Client-side CSV export of the (filtered) assumed values. Builds the file
  // from already-loaded data so it works without the gated export API.
  const exportAssumedCsv = useCallback((groups: AssumedRecordGroup[]) => {
    const esc = (v: unknown) => {
      const s = v == null ? "" : String(v);
      return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
    };
    const header = ["entityType", "recordLabel", "naturalKey", "fieldName", "value", "confidence", "sheetName"];
    const lines = [header.join(",")];
    for (const g of groups) {
      for (const f of g.fields) {
        lines.push([g.entityType, g.recordLabel || g.naturalKey, g.naturalKey, f.fieldName, f.value, f.confidence ?? "", g.sheetName].map(esc).join(","));
      }
    }
    const blob = new Blob([lines.join("\n")], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `assumed-${(data?.tenantId ?? "tenant").replace(/[^a-z0-9_-]+/gi, "_")}.csv`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  }, [data?.tenantId]);

  // Live re-read the kept extra fields straight from our database to confirm
  // they are actually stored (mirrors the "Verify in secure cloud" check, but
  // for the extra columns we keep in our own DB rather than in RM ONE).
  const verifyExtras = useCallback(async () => {
    const tid = data?.tenantId ?? "";
    if (!tid) return;
    setExtrasVerifying(true);
    try {
      const res = await fetch(`${API}/extra-fields?tenantId=${encodeURIComponent(tid)}`, { headers: authHeaders() });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const d = await res.json() as { records?: ExtraRecordGroup[]; count?: number };
      const records = d.records ?? [];
      setExtras(records);
      setExtrasVerified({
        fields: d.count ?? records.reduce((n, r) => n + r.fields.length, 0),
        records: records.length,
        at: new Date().toLocaleTimeString(),
      });
    } catch (e: any) {
      alert(`Could not verify extra fields: ${e.message}`);
    } finally {
      setExtrasVerifying(false);
    }
  }, [data?.tenantId]);

  // Persist an edited value for a kept extra field, then update local state.
  const saveExtraField = useCallback(async (
    rec: ExtraRecordGroup, fieldName: string, value: string,
  ) => {
    const tid = data?.tenantId ?? "";
    setSavingField(true);
    try {
      const res = await fetch(`${API}/extra-fields`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json", ...authHeaders() },
        body: JSON.stringify({
          tenantId: tid, entityType: rec.entityType,
          naturalKey: rec.naturalKey, fieldName, value,
        }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      setExtras(prev => prev.map(r =>
        r.entityType === rec.entityType && r.naturalKey === rec.naturalKey
          ? { ...r, fields: r.fields.map(f => f.fieldName === fieldName ? { ...f, value } : f) }
          : r));
      setEditingField(null);
    } catch (e: any) {
      alert(`Failed to save: ${e.message}`);
    } finally {
      setSavingField(false);
    }
  }, [data?.tenantId]);

  // Remove a kept extra field, then prune it (and any now-empty record) locally.
  const deleteExtraField = useCallback(async (
    rec: ExtraRecordGroup, fieldName: string,
  ) => {
    if (!window.confirm(`Remove the kept field "${fieldName}" from ${rec.recordLabel || rec.naturalKey}?`)) return;
    const tid = data?.tenantId ?? "";
    try {
      const res = await fetch(`${API}/extra-fields`, {
        method: "DELETE",
        headers: { "Content-Type": "application/json", ...authHeaders() },
        body: JSON.stringify({
          tenantId: tid, entityType: rec.entityType,
          naturalKey: rec.naturalKey, fieldName,
        }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      setExtras(prev => prev
        .map(r =>
          r.entityType === rec.entityType && r.naturalKey === rec.naturalKey
            ? { ...r, fields: r.fields.filter(f => f.fieldName !== fieldName) }
            : r)
        .filter(r => r.fields.length > 0));
    } catch (e: any) {
      alert(`Failed to remove: ${e.message}`);
    }
  }, [data?.tenantId]);

  const fetchRows = useCallback(async (label: string) => {
    const table = LABEL_TO_TABLE[label];
    if (!table) return;
    const tid = data?.tenantId ?? "";
    setRowsLoading(true);
    try {
      const res = await fetch(
        `${API}/verify/${uploadId}/rows?tenantId=${encodeURIComponent(tid)}&table=${encodeURIComponent(table)}`,
        { headers: authHeaders() },
      );
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const rows: RowsResponse = await res.json();
      setRowsModal({ label, data: rows });
    } catch (e: any) {
      alert(`Failed to load ${label}: ${e.message}`);
    } finally {
      setRowsLoading(false);
    }
  }, [uploadId, data?.tenantId]);

  const runVerify = useCallback(async () => {
    setVerifying(true);
    setVerifyErr(null);
    try {
      const tid = data?.tenantId ?? "";
      const res = await fetch(`${API}/verify/${uploadId}?tenantId=${encodeURIComponent(tid)}`, { headers: authHeaders() });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      setVerify(await res.json());
    } catch (e: any) {
      setVerifyErr(e.message ?? "Verification failed");
    } finally {
      setVerifying(false);
    }
  }, [uploadId, data?.tenantId]);

  // Auto-open of invite/errors popups intentionally removed — the countdown
  // starts automatically and the user can open them manually via the buttons.

  const isLive = data?.status === "pending" || data?.status === "running";
  // The import has actually finished (terminal status) — distinct from the
  // initial "no data yet" state, where `data` is still null.
  const isDone = !!data && !isLive;
  const steps = data?.steps ?? [];
  // Live, server-reported progress (true current table + row counts). When
  // present this drives the bar for real; otherwise we fall back to the smooth
  // simulated creep below so very early ticks still feel alive.
  const liveProgress = data?.progress ?? null;
  // Real progress floor: prefer the server's reported percentage, else derive a
  // coarse floor from how many pipeline steps have already reported.
  const realPct = liveProgress
    ? Math.min(99, Math.max(0, Math.round(liveProgress.pct)))
    : steps.length > 0
      ? Math.round((steps.length / 13) * 100)
      : 0;

  // Simulated progress: the server reports nothing until the run finishes, so a
  // raw bar would sit at 0% then jump straight to 100%. We animate a smooth bar
  // that creeps up with varied timing/increments (so it never looks mechanical),
  // eases toward a soft cap while running, and only snaps to 100% once the import
  // has truly finished. Crucially we DON'T fill the bar in the initial
  // not-loaded-yet state — otherwise it would be pinned at 100% before the
  // "running" status ever arrives.
  const [animPct, setAnimPct] = useState(0);
  useEffect(() => {
    if (isDone) {
      // Finished (success / partial / failed) — fill the bar. A CANCELLED run
      // is the exception: it stopped, it didn't finish, so the bar must freeze
      // where it was instead of triumphantly snapping to 100%.
      if (data?.status !== "cancelled") setAnimPct(100);
      return;
    }
    // A job stuck in "pending" never started — freeze the bar instead of
    // playing a fake creep underneath the "hasn't started" warning banner.
    if (neverStarted) return;
    // No status response yet — the job may already be finished on the server
    // (user arrived from history and the fetch is still in flight / slow).
    // Creeping the bar here painted a fake "running at 55%" over a run that
    // actually succeeded; stay honest at 0 until the first real status lands.
    if (!data) return;
    // Still loading the first status, or actively running → keep creeping.
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout>;
    const tick = () => {
      if (cancelled) return;
      setAnimPct((prev) => {
        const base = Math.max(prev, realPct);
        if (base >= SOFT_CAP) return base;
        const remaining = SOFT_CAP - base;
        // Ease-out: random fraction of the remaining gap → big early jumps,
        // smaller as it nears the cap.
        const inc = Math.max(0.6, remaining * (0.04 + Math.random() * 0.14));
        return Math.min(SOFT_CAP, base + inc);
      });
      // Varied cadence so the motion feels organic, not clock-like.
      timer = setTimeout(tick, 280 + Math.random() * 920);
    };
    timer = setTimeout(tick, 200);
    return () => { cancelled = true; clearTimeout(timer); };
  }, [isDone, realPct, neverStarted, data?.status]);

  // Rotate the encouraging messages under the bar while the import is live.
  const [quoteIdx, setQuoteIdx] = useState(0);
  useEffect(() => {
    if (!isLive || neverStarted) return;
    const t = setInterval(
      () => setQuoteIdx((i) => (i + 1) % RUNNING_QUOTES.length),
      4200,
    );
    return () => clearInterval(t);
  }, [isLive, neverStarted]);

  // Cycle the animated work-stage pills roughly every 5s, with a little random
  // jitter so the motion feels organic (not a mechanical clock-tick).
  const [stageIdx, setStageIdx] = useState(0);
  useEffect(() => {
    if (!isLive || neverStarted) return;
    let cancelled = false;
    let t: ReturnType<typeof setTimeout>;
    const next = () => {
      if (cancelled) return;
      setStageIdx((i) => (i + 1) % STAGES.length);
      t = setTimeout(next, 4200 + Math.random() * 1800); // ~5s ± jitter
    };
    t = setTimeout(next, 5000);
    return () => { cancelled = true; clearTimeout(t); };
  }, [isLive, neverStarted]);

  // While the job is live the bar is held below 100% (soft cap) so it visibly
  // climbs step by step; it only reaches 100% once the server confirms it's done.
  // When the server reports real, record-based progress, show it directly so the
  // bar tracks the true processed/total row count. Only before any live tick (or
  // when the server is silent) do we fall back to the smooth simulated creep, so a
  // very early bar still feels alive instead of frozen at 0%.
  const pct = neverStarted
    // The pipeline never started — show an honest 0 instead of freezing the
    // cosmetic creep at whatever fake value it had reached.
    ? 0
    : data?.status === "cancelled"
    // Cancelled — show the REAL progress the pipeline reached when it was
    // stopped (0 for a run that never started), never a triumphant 100%.
    ? realPct
    : isDone
    ? 100
    : liveProgress
      // Real progress leads, but while the server is still in its 0% setup
      // window (file analysis / column matching before the pipeline reports
      // row counts) let the simulated creep move the bar up to a small cap so
      // it never looks frozen at 0%. Math.max keeps the bar monotonic when
      // the first real pct arrives.
      ? Math.max(realPct, Math.min(10, Math.round(animPct)))
      : Math.min(SOFT_CAP, Math.max(realPct, Math.round(animPct)));

  // When the server reports live progress, the active pill follows the real
  // current table and the label/detail come from the server; otherwise we fall
  // back to the timed cycle so the very first ticks still feel alive.
  const effectiveStageIdx = liveProgress?.table != null
    ? (STAGE_FOR_TABLE[liveProgress.table] ?? stageIdx)
    : stageIdx;
  const phaseLabel = neverStarted
    ? "Waiting to start…"
    : (liveProgress?.phase ?? `${STAGES[stageIdx].label}…`);
  const phaseDetail = liveProgress && liveProgress.total
    ? `${(liveProgress.done ?? 0).toLocaleString()} / ${liveProgress.total.toLocaleString()}`
    : null;

  const stepsByCategory = steps.reduce<Record<string, StepResult[]>>((acc, s) => {
    const cat = TABLE_CATEGORY[s.table] ?? "team";
    (acc[cat] ??= []).push(s);
    return acc;
  }, {}) ?? {};

  return (
    <div className="p-6 max-w-6xl mx-auto space-y-6">
      <div className="flex items-center justify-between mb-2">
        {/* Once the run is CONFIRMED live the only exit offered is Cancel
            Upload below — "Back to Upload" mid-run invited starting a second
            competing run. It returns as soon as the import reaches a terminal
            state. While the status is still unknown (first poll in flight, or
            the fetch keeps failing → data stays null: not live, not done) the
            exit MUST stay available or the user is stranded with no way off
            this page. */}
        {!isLive ? (
          <Button variant="ghost" size="sm" onClick={() => navigate("/import")}>
            <ArrowLeft className="w-4 h-4 mr-1" /> Back to Upload
          </Button>
        ) : (
          <div />
        )}
      </div>

      {/* Never-started warning — the upload exists but the pipeline never kicked off */}
      {neverStarted && data?.status === "pending" && (
        <div className="rounded-lg px-4 py-3 flex items-start gap-3"
          style={{ background: "#fef2f2", border: "1px solid #ef4444" }}>
          <AlertTriangle className="w-4 h-4 mt-0.5 shrink-0 text-red-600" />
          <div>
            <p className="text-sm font-semibold text-red-800">
              This import hasn't started
            </p>
            <p className="text-xs text-red-700 mt-0.5">
              The file was uploaded, but the data pipeline never kicked off — most often because
              this company name is already onboarded (pick <span className="font-medium">"update existing client"</span> instead
              of creating a new one), or the start request failed. Head{" "}
              <button
                className="underline font-medium"
                disabled={cancelling}
                onClick={async () => {
                  // Clear the dead job first — a stuck-pending job still counts
                  // as "active" server-side, which blocks new uploads. Cancel it
                  // so the upload page is usable the moment we land there.
                  await handleCancel();
                  navigate("/import");
                }}
              >
                back to Upload
              </button>{" "}
              and start the import again.
            </p>
          </div>
        </div>
      )}

      {/* Stale-job warning — shown when the import has been "running" for >25 min */}
      {staleWarning && isLive && (
        <div className="rounded-lg px-4 py-3 flex items-start gap-3"
          style={{ background: "#fffbeb", border: "1px solid #f59e0b" }}>
          <AlertTriangle className="w-4 h-4 mt-0.5 shrink-0 text-yellow-600" />
          <div>
            <p className="text-sm font-semibold text-yellow-800">
              This import is taking longer than usual
            </p>
            <p className="text-xs text-yellow-700 mt-0.5">
              The process is still running server-side — it hasn't stopped. Large datasets can take 30+ minutes.
              You can safely close this window and check back on the{" "}
              <button className="underline font-medium" onClick={() => navigate("/onboarding/history")}>
                All Companies
              </button>{" "}
              page. If it still shows "running" after an hour, try cancelling and re-importing.
            </p>
          </div>
        </div>
      )}

      {/* ── Uploaded file data grid — hidden while import is running, and for
           cancelled runs (the user stopped this import; popping a full data
           grid over the cancelled state is disorienting, not helpful) ── */}
      {previewFile && data?.fileName && !isLive && data?.status !== "cancelled" && (() => {
        const { cardId, multiTab } = cardIdFromFileName(data.fileName);
        return (
          <div className="rounded-xl border border-gray-200 overflow-hidden" style={{ minHeight: 300 }}>
            <InlineDataGrid
              embedded
              readOnly
              cardId={cardId}
              cardLabel={data.fileName}
              multiTab={multiTab}
              initialFile={previewFile}
              onClose={() => setPreviewFile(null)}
              onSubmit={() => {}}
            />
          </div>
        );
      })()}

      {/* ── Terminal-styled status card (dark = terminal, light = clean) ── */}
      <TerminalStatusCard
        status={data?.status ?? "pending"}
        fileName={data?.fileName}
        tenantId={data?.tenantId}
        isLive={isLive}
        pct={pct}
        phaseLabel={phaseLabel}
        phaseIsReal={liveProgress?.phase != null}
        phaseDetail={phaseDetail}
        effectiveStageIdx={effectiveStageIdx}
        quoteIdx={quoteIdx}
        data={data}
        uploadId={uploadId}
      />

      {/* Action buttons — only Cancel Upload while running; full set once done */}
      {isLive ? (
        <div className="flex items-center gap-3">
          <Button
            variant="outline"
            size="sm"
            className="text-red-600 border-red-200 hover:bg-red-50 dark:border-red-800/50 dark:hover:bg-red-950/30"
            onClick={() => setCancelConfirm(true)}
          >
            <StopCircle className="w-4 h-4 mr-1.5" /> Cancel Upload
          </Button>
          <p className="text-xs text-muted-foreground">
            Stops the import and rolls back any data already written for this company.
          </p>
        </div>
      ) : data?.status === "cancelled" ? (
        <div className="flex flex-wrap items-center gap-3">
          <Button variant="outline" size="sm" onClick={() => navigate("/import")}>
            <ArrowLeft className="w-4 h-4 mr-1.5" /> Start a new import
          </Button>
          <p className="text-xs text-muted-foreground">
            This import was cancelled — nothing further was written for this company.
          </p>
        </div>
      ) : (
        <div className="flex flex-wrap items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={() => setInviteOpen(true)}
          >
            <UserPlus className="w-4 h-4 mr-1.5" /> Add Members
          </Button>
        </div>
      )}

      {/* Needs-attention review queue */}
      <NeedsAttentionCard
        items={reviewItems}
        busyId={reviewBusy}
        justResolved={reviewResolved}
        onAction={resolveReview}
      />

      {/* Step-by-step results */}
      {data && (data.steps?.length ?? 0) > 0 && (
        <StepResults steps={data.steps ?? []} />
      )}

      {/* Fatal error box — shown when the pipeline crashed before any row errors */}
      {data?.status === "failed" && data.fatalError && (data.totalErrors ?? 0) === 0 && (
        <Card className="border-red-500/40">
          <CardHeader className="pb-2">
            <CardTitle className="text-base text-red-500 flex items-center gap-2">
              <XCircle className="w-4 h-4" /> Import Error
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-xs font-mono bg-red-500/8 border border-red-500/20 rounded px-3 py-2 text-red-400 break-words whitespace-pre-wrap">
              {data.fatalError}
            </div>
          </CardContent>
        </Card>
      )}

      {/* Row-level error details */}
      {data && (data.totalErrors ?? 0) > 0 && (
        <Card>
          <CardHeader>
            <div className="flex items-center justify-between">
              <CardTitle className="text-base text-red-500">Errors ({data.totalErrors})</CardTitle>
              <a href={`${API}/errors/${uploadId}?format=csv`} download>
                <Button variant="outline" size="sm">
                  <Download className="w-3 h-3 mr-1" /> Download CSV
                </Button>
              </a>
            </div>
          </CardHeader>
          <CardContent>
            <div className="space-y-1 max-h-64 overflow-y-auto text-xs font-mono">
              {(data.errors ?? (data.steps ?? []).flatMap(s => s.errors ?? [])).map((e, i) => (
                <div key={i} className="flex gap-2 text-red-400 bg-red-500/5 rounded px-2 py-1">
                  <span className="text-muted-foreground shrink-0">
                    [{e?.table ?? "?"} row {e?.rowIndex ?? "?"}]
                  </span>
                  <span>{e?.message ?? "Unknown error"}</span>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      {/* Failed — what to do next */}
      {data?.status === "failed" && (
        <Card className="border-red-500/30 bg-red-500/5">
          <CardHeader className="pb-3">
            <CardTitle className="text-base text-red-500 flex items-center gap-2">
              <XCircle className="w-4 h-4" /> What to do next
            </CardTitle>
            {(() => {
              if (data.failureReason === "db_lock_timeout") {
                return (
                  <CardDescription className="mt-1">
                    The database was briefly locked by a previous import — your file data
                    is fine.{" "}
                    {data.rolledBack && "The partial data from this run was removed. "}
                    <strong>Simply re-upload the same file</strong> and the import
                    will complete normally.
                  </CardDescription>
                );
              }
              const allErrors = (data.steps ?? []).flatMap(s => s.errors);
              const onlyPortalConfig = allErrors.length > 0 &&
                allErrors.every(e => e.table === "PortalConfig");
              const hasDataRows = (data.steps ?? [])
                .filter(s => s.table !== "PortalConfig" && s.table !== "Tenant")
                .some(s => s.rowsInserted > 0);
              if (onlyPortalConfig) {
                return (
                  <CardDescription className="mt-1">
                    The portal configuration step timed out or hit a conflict, but{" "}
                    {hasDataRows
                      ? "your team data was still inserted successfully."
                      : "no data rows were affected."
                    }{" "}
                    Upload your file again — the system will skip the configuration step
                    automatically if it was already completed, and retry if it wasn't.
                  </CardDescription>
                );
              }
              if ((data.totalErrors ?? 0) === 0) {
                return (
                  <CardDescription className="mt-1">
                    The import was stopped and will not retry automatically.{" "}
                    {data.fatalError
                      ? "See the error details above for the exact cause."
                      : "This may be a temporary connection issue."
                    }{" "}
                    <strong>Please upload your file again to retry.</strong> If the
                    problem persists, contact support.
                  </CardDescription>
                );
              }
              return (
                <CardDescription className="mt-1">
                  {data.rolledBack ? (
                    <>
                      The import was stopped and the partial data from this run was
                      removed. Fix the issues shown in the error list above, then
                      upload your corrected file again.
                    </>
                  ) : (
                    <>
                      Some rows could not be imported. Fix the issues shown in the error list
                      above, then upload your corrected file again. Rows that already
                      succeeded won't be duplicated.
                    </>
                  )}
                </CardDescription>
              );
            })()}
          </CardHeader>
          <CardContent className="flex flex-wrap gap-2">
            <Button onClick={() => navigate("/import")}>
              <RefreshCw className="w-3.5 h-3.5 mr-1.5" />
              {data.failureReason === "db_lock_timeout" ? "Re-upload File" : "Upload Again"}
            </Button>
            <Button variant="outline" onClick={() => navigate(`/onboarding/history${data.tenantId ? `?tenantId=${encodeURIComponent(data.tenantId)}` : ""}`)}>
              Upload History
            </Button>
            {(data.totalErrors ?? 0) > 0 && data.failureReason !== "db_lock_timeout" && (
              <a href={`${API}/errors/${uploadId}?format=csv`} download>
                <Button variant="outline">
                  <Download className="w-3.5 h-3.5 mr-1.5" /> Download Error Report
                </Button>
              </a>
            )}
          </CardContent>
        </Card>
      )}

      {/* Success actions */}
      {(data?.status === "success" || data?.status === "partial") && (
        <>
          {/* Import summary by category */}
          <Card className="border-green-500/30 bg-green-500/5">
            <CardHeader className="pb-3">
              <CardTitle className="text-base text-green-500">
                {data.status === "success" ? "Onboarding complete!" : "Onboarding completed with warnings"}
              </CardTitle>
              <CardDescription>
                Data was written securely to your <strong>RM ONE cloud database</strong>.
                The counts below reflect what was inserted in this import run.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              {(["team","clients","work","assign"] as const).map(cat => {
                const steps = stepsByCategory[cat];
                if (!steps?.length) return null;
                const catLabel = cat === "team" ? "Team" : cat === "clients" ? "Clients" : cat === "work" ? "Projects" : "Assignments";
                const total = steps.reduce((s, r) => s + r.rowsInserted, 0);
                return (
                  <div key={cat}>
                    <div className="flex items-center gap-2 mb-1.5 text-sm font-medium text-muted-foreground">
                      {CATEGORY_ICON[cat]}
                      {catLabel} — <span className="font-bold text-foreground">{total} rows</span>
                    </div>
                    <div className="grid grid-cols-2 sm:grid-cols-3 gap-1.5 pl-6">
                      {steps.map(s => (
                        <div key={s.table} className="flex items-center justify-between rounded bg-background border px-3 py-1.5 text-xs">
                          <span className="text-muted-foreground">{TABLE_LABELS[s.table] ?? s.table}</span>
                          <span className={`font-bold ml-2 ${s.rowsInserted > 0 ? "text-green-500" : "text-muted-foreground"}`}>
                            {s.rowsInserted}
                          </span>
                        </div>
                      ))}
                    </div>
                  </div>
                );
              })}

              <div className="flex gap-2 pt-2">
                <Button variant="outline" onClick={() => navigate(`/onboarding/history${data.tenantId ? `?tenantId=${encodeURIComponent(data.tenantId)}` : ""}`)}>
                  Upload History
                </Button>
                <Button variant="outline" onClick={() => navigate("/import")}>
                  <Plus className="w-3.5 h-3.5 mr-1" /> New Upload
                </Button>
              </div>
            </CardContent>
          </Card>

          {/* Configure Defaults — shown only for brand-new company (create mode) imports */}
          {data?.importMode === "create" && (
            <Card className="border-blue-500/30 bg-blue-500/5">
              <CardHeader className="pb-3">
                <CardTitle className="text-base flex items-center gap-2 text-blue-400">
                  <Settings2 className="w-4 h-4" /> Set up default configuration
                </CardTitle>
                <CardDescription className="mt-1">
                  Review and adjust the assumed values RM ONE will use for this company — things like default project
                  status, schedule start rules, and work-week hours. You can change these any time.
                </CardDescription>
              </CardHeader>
              <CardContent>
                <Button
                  variant="outline"
                  className="border-blue-500/40 text-blue-400 hover:text-blue-400"
                  onClick={() => navigate("/onboarding/settings")}
                >
                  <Settings2 className="w-3.5 h-3.5 mr-1.5" /> Open Configuration
                </Button>
              </CardContent>
            </Card>
          )}

          {/* Import warnings — non-fatal notices (construction field failures, lump-sum hours, etc.) */}
          {(data?.warnings ?? []).length > 0 && (
            <Card className="border-orange-500/30 bg-orange-500/5">
              <CardHeader className="pb-3">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <CardTitle className="text-base flex items-center gap-2 text-orange-500">
                      <AlertTriangle className="w-4 h-4" /> Import completed with notices
                    </CardTitle>
                    <CardDescription className="mt-1">
                      The import succeeded, but the items below need your attention.
                      {(data?.constructionRetryEntries ?? []).length > 0
                        ? <> Supplemental construction fields could not be written due to a
                            schema type mismatch — click <strong>Retry construction fields</strong>{" "}
                            to re-apply those without re-uploading the entire file.</>
                        : <> Review each item and make any adjustments needed in the app.</>}
                    </CardDescription>
                  </div>
                  {(data?.constructionRetryEntries ?? []).length > 0 && (
                    <div className="shrink-0 pt-0.5">
                      <Button
                        variant="outline"
                        size="sm"
                        className="border-orange-500/40 text-orange-500 hover:text-orange-500"
                        onClick={handleRetryConstruction}
                        disabled={retrying}
                      >
                        {retrying
                          ? <><Loader2 className="w-3.5 h-3.5 mr-1.5 animate-spin" />Retrying…</>
                          : <><RefreshCw className="w-3.5 h-3.5 mr-1.5" />Retry construction fields</>}
                      </Button>
                    </div>
                  )}
                </div>
              </CardHeader>
              <CardContent>
                {retryResult && (
                  <div className={`mb-3 rounded px-3 py-2 text-sm flex items-start gap-2 ${retryResult.ok ? "bg-green-500/10 text-green-400" : "bg-red-500/10 text-red-400"}`}>
                    {retryResult.ok
                      ? <CheckCircle2 className="w-4 h-4 shrink-0 mt-0.5" />
                      : <XCircle className="w-4 h-4 shrink-0 mt-0.5" />}
                    {retryResult.message}
                  </div>
                )}
                <div className="space-y-1 max-h-48 overflow-y-auto text-xs font-mono">
                  {(data.warnings ?? []).map((w, i) => (
                    <div key={i} className="text-orange-400 bg-orange-500/5 rounded px-2 py-1 break-words">
                      {w}
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>
          )}

          {/* Assumed Data — defaults the wizard filled for blank fields */}
          {assumed.length > 0 && (
            <Card className="border-amber-500/30 bg-amber-500/5">
              <CardHeader className="pb-3">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <CardTitle className="text-base flex items-center gap-2 text-amber-500">
                      <AlertTriangle className="w-4 h-4" /> Assumed data
                    </CardTitle>
                    <CardDescription className="mt-1">
                      {assumed.reduce((n, r) => n + r.fields.length, 0)} field
                      {assumed.reduce((n, r) => n + r.fields.length, 0) === 1 ? "" : "s"} across{" "}
                      {assumed.length} record{assumed.length === 1 ? "" : "s"} were blank in your file,
                      so the wizard filled a sensible default and flagged it here. Review these and
                      update them later if needed.
                    </CardDescription>
                  </div>
                  <div className="shrink-0">
                    <Button
                      variant="outline"
                      size="sm"
                      className="border-amber-500/40 text-amber-500 hover:text-amber-500"
                      onClick={() => setAssumedOpen(true)}
                    >
                      Review assumptions
                    </Button>
                  </div>
                </div>
              </CardHeader>
            </Card>
          )}

          {/* Assumed data popup */}
          <Dialog open={assumedOpen} onOpenChange={setAssumedOpen}>
            <DialogContent className="max-w-3xl w-full max-h-[85vh] flex flex-col">
              <DialogHeader>
                <DialogTitle className="flex items-center gap-2 text-amber-500">
                  <AlertTriangle className="w-4 h-4" /> Assumed data
                </DialogTitle>
                <DialogDescription>
                  These fields were blank in your file. The wizard filled each with a sensible
                  default so the import could complete. The defaults come from your onboarding
                  settings and can be changed there for future imports.
                </DialogDescription>
              </DialogHeader>
              <div className="flex items-center justify-between gap-2 border-b pb-2">
                <span className="text-xs text-muted-foreground">
                  {historyShown
                    ? `Audit history — ${history.length} change${history.length === 1 ? "" : "s"} recorded`
                    : "Every assumed value is recorded with an audit trail."}
                </span>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => (historyShown ? setHistoryShown(false) : loadHistory())}
                  disabled={historyLoading}
                >
                  {historyLoading
                    ? <Loader2 className="w-3.5 h-3.5 mr-1 animate-spin" />
                    : <RefreshCw className="w-3.5 h-3.5 mr-1" />}
                  {historyShown ? "Hide history" : "Audit history"}
                </Button>
              </div>
              <div className="overflow-auto flex-1 space-y-2.5 pr-1">
                {historyShown ? (
                  history.length === 0 ? (
                    <p className="text-sm text-muted-foreground py-6 text-center">
                      No history recorded yet.
                    </p>
                  ) : (
                    history.map(h => (
                      <div key={h.id} className="rounded-lg border bg-background px-3 py-2 text-xs">
                        <div className="flex items-center justify-between gap-2 mb-1">
                          <span className="font-medium text-foreground truncate">
                            {h.recordLabel || h.naturalKey} · {h.fieldName}
                          </span>
                          <span className="text-[10px] uppercase tracking-wide text-muted-foreground border rounded px-1.5 py-0.5 shrink-0">
                            {h.action}
                          </span>
                        </div>
                        <div className="flex items-center gap-1.5 text-muted-foreground">
                          <span className="line-through opacity-70">{h.oldValue ?? "—"}</span>
                          <span>→</span>
                          <span className="font-medium text-foreground">{h.newValue ?? "—"}</span>
                        </div>
                        <div className="mt-1 flex items-center gap-2 text-[11px] text-muted-foreground">
                          {h.confidence && <span>{h.confidence}</span>}
                          {h.actor && <span>· {h.actor}</span>}
                          <span>· {new Date(h.createdAt).toLocaleString()}</span>
                        </div>
                      </div>
                    ))
                  )
                ) : (
                <>
                {assumed.length === 0 && (
                  <p className="text-sm text-muted-foreground py-6 text-center">
                    No assumed data for this import.
                  </p>
                )}
                {assumed.length > 0 && (() => {
                  const tiers = Array.from(new Set(
                    assumed.flatMap(r => r.fields.map(f => f.confidence ?? "system_defaulted")),
                  )).sort();
                  const q = assumedSearch.trim().toLowerCase();
                  const filtered = assumed
                    .map(rec => ({
                      ...rec,
                      fields: rec.fields.filter(f => {
                        const tierOk = assumedTier === "all" || (f.confidence ?? "system_defaulted") === assumedTier;
                        const qOk = !q
                          || (rec.recordLabel || rec.naturalKey).toLowerCase().includes(q)
                          || f.fieldName.toLowerCase().includes(q)
                          || (f.value ?? "").toLowerCase().includes(q);
                        return tierOk && qOk;
                      }),
                    }))
                    .filter(rec => rec.fields.length > 0);
                  return (
                    <>
                      <div className="flex flex-wrap items-center gap-2 pb-1">
                        <input
                          type="text"
                          value={assumedSearch}
                          onChange={e => setAssumedSearch(e.target.value)}
                          placeholder="Search record, field or value…"
                          className="flex-1 min-w-[180px] h-8 rounded-md border bg-background px-2.5 text-xs"
                        />
                        <select
                          value={assumedTier}
                          onChange={e => setAssumedTier(e.target.value)}
                          className="h-8 rounded-md border bg-background px-2 text-xs"
                        >
                          <option value="all">All tiers</option>
                          {tiers.map(t => <option key={t} value={t}>{t}</option>)}
                        </select>
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => exportAssumedCsv(filtered)}
                          disabled={filtered.length === 0}
                        >
                          <Download className="w-3.5 h-3.5 mr-1" /> Export CSV
                        </Button>
                      </div>
                      {filtered.length === 0 && (
                        <p className="text-sm text-muted-foreground py-6 text-center">
                          No assumed values match your filter.
                        </p>
                      )}
                      {filtered.map(rec => (
                        <div key={`${rec.entityType}::${rec.naturalKey}`} className="rounded-lg border bg-background px-3 py-2.5">
                          <div className="flex items-center gap-2 mb-1.5 text-sm">
                            <span className="font-medium text-foreground">{rec.recordLabel || rec.naturalKey}</span>
                            <span className="text-[10px] uppercase tracking-wide text-muted-foreground border rounded px-1.5 py-0.5">
                              {EXTRA_ENTITY_LABELS[rec.entityType] ?? rec.entityType}
                            </span>
                          </div>
                          <div className="grid grid-cols-1 sm:grid-cols-2 gap-1.5">
                            {rec.fields.map(f => (
                              <div key={f.fieldName} className="flex items-center justify-between gap-2 rounded bg-amber-500/5 border border-amber-500/20 px-2.5 py-1 text-xs">
                                <span className="text-muted-foreground truncate shrink-0">{f.fieldName}</span>
                                <span className="font-medium text-foreground truncate text-right">{f.value ?? "—"}</span>
                              </div>
                            ))}
                          </div>
                        </div>
                      ))}
                    </>
                  );
                })()}
                </>
                )}
              </div>
            </DialogContent>
          </Dialog>

          {/* Extra columns kept in our own database */}
          {extras.length > 0 && (
            <Card className="border-blue-500/30 bg-blue-500/5">
              <CardHeader className="pb-3">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <CardTitle className="text-base flex items-center gap-2 text-blue-500">
                      <Database className="w-4 h-4" /> Extra fields kept in our database
                    </CardTitle>
                    <CardDescription className="mt-1">
                      {extras.reduce((n, r) => n + r.fields.length, 0)} field
                      {extras.reduce((n, r) => n + r.fields.length, 0) === 1 ? "" : "s"} across{" "}
                      {extras.length} record{extras.length === 1 ? "" : "s"} had no matching RM ONE field,
                      so you chose to keep them here. They're stored alongside the matching record and
                      are not sent to RM ONE.
                    </CardDescription>
                  </div>
                  <div className="flex flex-col items-end gap-1.5 shrink-0">
                    <div className="flex items-center gap-2">
                      <Button
                        variant="outline"
                        size="sm"
                        className="border-blue-500/40 text-blue-500 hover:text-blue-500"
                        onClick={verifyExtras}
                        disabled={extrasVerifying}
                      >
                        {extrasVerifying
                          ? <Loader2 className="w-3.5 h-3.5 mr-1 animate-spin" />
                          : <RefreshCw className="w-3.5 h-3.5 mr-1" />}
                        Verify stored
                      </Button>
                      <Button
                        variant="outline"
                        size="sm"
                        className="border-blue-500/40 text-blue-500 hover:text-blue-500"
                        onClick={() => setExtrasOpen(true)}
                      >
                        View &amp; manage
                      </Button>
                    </div>
                  </div>
                </div>
                {extrasVerified && (
                  <div className="mt-2 flex items-center gap-1.5 rounded-md border border-green-500/30 bg-green-500/10 px-2.5 py-1.5 text-xs text-green-600 dark:text-green-400">
                    <CheckCircle2 className="w-3.5 h-3.5 shrink-0" />
                    <span>
                      Confirmed live in our database:{" "}
                      <strong>{extrasVerified.fields}</strong> field
                      {extrasVerified.fields === 1 ? "" : "s"} across{" "}
                      <strong>{extrasVerified.records}</strong> record
                      {extrasVerified.records === 1 ? "" : "s"}{" "}
                      <span className="font-mono text-green-600/70 dark:text-green-400/70">
                        (onboarding_extra_fields)
                      </span>{" "}
                      · checked {extrasVerified.at}
                    </span>
                  </div>
                )}
              </CardHeader>
            </Card>
          )}

          {/* Extra fields popup */}
          <Dialog open={extrasOpen} onOpenChange={setExtrasOpen}>
            <DialogContent className="max-w-3xl w-full max-h-[85vh] flex flex-col">
              <DialogHeader>
                <DialogTitle className="flex items-center gap-2 text-blue-500">
                  <Database className="w-4 h-4" /> Extra fields kept in our database
                </DialogTitle>
                <DialogDescription>
                  These columns had no matching RM ONE field, so you chose to keep them here.
                  They're stored alongside the matching record and are not sent to RM ONE.
                </DialogDescription>
              </DialogHeader>
              <div className="overflow-auto flex-1 space-y-2.5 pr-1">
                {extras.length === 0 && (
                  <p className="text-sm text-muted-foreground py-6 text-center">
                    All extra fields have been removed.
                  </p>
                )}
                {extras.map(rec => (
                  <div key={`${rec.entityType}::${rec.naturalKey}`} className="rounded-lg border bg-background px-3 py-2.5">
                    <div className="flex items-center gap-2 mb-1.5 text-sm">
                      <span className="font-medium text-foreground">{rec.recordLabel || rec.naturalKey}</span>
                      <span className="text-[10px] uppercase tracking-wide text-muted-foreground border rounded px-1.5 py-0.5">
                        {EXTRA_ENTITY_LABELS[rec.entityType] ?? rec.entityType}
                      </span>
                    </div>
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-1.5">
                      {rec.fields.map(f => {
                        const fieldKey = `${rec.entityType}::${rec.naturalKey}::${f.fieldName}`;
                        const isEditing = editingField?.key === fieldKey;
                        return (
                          <div key={f.fieldName} className="flex items-center justify-between gap-2 rounded bg-muted/40 border px-2.5 py-1 text-xs">
                            <span className="text-muted-foreground truncate shrink-0">{f.fieldName}</span>
                            {isEditing ? (
                              <div className="flex items-center gap-1 flex-1 min-w-0 justify-end">
                                <input
                                  autoFocus
                                  className="flex-1 min-w-0 rounded border bg-background px-1.5 py-0.5 text-xs text-foreground"
                                  value={editingField.value}
                                  disabled={savingField}
                                  onChange={e => setEditingField({ key: fieldKey, value: e.target.value })}
                                  onKeyDown={e => {
                                    if (e.key === "Enter") saveExtraField(rec, f.fieldName, editingField.value);
                                    if (e.key === "Escape") setEditingField(null);
                                  }}
                                />
                                <button
                                  className="text-green-500 hover:text-green-400 disabled:opacity-50 shrink-0"
                                  disabled={savingField}
                                  title="Save"
                                  onClick={() => saveExtraField(rec, f.fieldName, editingField.value)}
                                >
                                  {savingField ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Check className="w-3.5 h-3.5" />}
                                </button>
                                <button
                                  className="text-muted-foreground hover:text-foreground disabled:opacity-50 shrink-0"
                                  disabled={savingField}
                                  title="Cancel"
                                  onClick={() => setEditingField(null)}
                                >
                                  <X className="w-3.5 h-3.5" />
                                </button>
                              </div>
                            ) : (
                              <div className="flex items-center gap-1.5 min-w-0 justify-end">
                                <span className="font-medium text-foreground truncate">{f.value ?? "—"}</span>
                                <button
                                  className="text-muted-foreground hover:text-blue-500 shrink-0"
                                  title="Edit value"
                                  onClick={() => setEditingField({ key: fieldKey, value: f.value ?? "" })}
                                >
                                  <Pencil className="w-3 h-3" />
                                </button>
                                <button
                                  className="text-muted-foreground hover:text-red-500 shrink-0"
                                  title="Remove field"
                                  onClick={() => deleteExtraField(rec, f.fieldName)}
                                >
                                  <Trash2 className="w-3 h-3" />
                                </button>
                              </div>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  </div>
                ))}
              </div>
            </DialogContent>
          </Dialog>

          {/* Live DB verification */}
          <Card>
            <CardHeader className="pb-3">
              <div className="flex items-center justify-between">
                <div>
                  <CardTitle className="text-base flex items-center gap-2">
                    <Database className="w-4 h-4" /> Verify in secure cloud
                  </CardTitle>
                  <CardDescription className="mt-1">
                    Run a live count to confirm the data is stored securely
                    in the cloud for tenant <strong>{data.tenantId}</strong>.
                  </CardDescription>
                </div>
                <Button variant="outline" size="sm" onClick={runVerify} disabled={verifying}>
                  {verifying
                    ? <Loader2 className="w-3.5 h-3.5 mr-1 animate-spin" />
                    : <RefreshCw className="w-3.5 h-3.5 mr-1" />}
                  {verify ? "Re-verify" : "Verify Now"}
                </Button>
              </div>
            </CardHeader>
            {(verify || verifyErr) && (
              <CardContent>
                {verifyErr && (
                  <p className="text-sm text-red-500">{verifyErr}</p>
                )}
                {verify && (
                  <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
                    {verify.counts.map(c => {
                      const table     = LABEL_TO_TABLE[c.label];
                      const clickable = c.count > 0 && !!table;
                      return (
                        <button
                          key={c.label}
                          disabled={!clickable || rowsLoading}
                          onClick={() => clickable && fetchRows(c.label)}
                          className={`flex items-center justify-between rounded border px-3 py-2 text-sm text-left w-full transition-colors
                            ${clickable ? "hover:bg-muted cursor-pointer hover:border-primary/50" : "cursor-default opacity-70"}`}
                        >
                          <span className="flex flex-col min-w-0">
                            <span className="text-muted-foreground text-xs truncate">{c.label}</span>
                            {table && (
                              <span
                                title={`Stored in cloud table dbo.${table}`}
                                className="mt-0.5 inline-flex w-fit items-center gap-1 rounded bg-muted px-1.5 py-0.5 font-mono text-[10px] text-muted-foreground/80"
                              >
                                <Database className="w-2.5 h-2.5" />
                                {table}
                              </span>
                            )}
                          </span>
                          <div className="flex items-center gap-1 ml-2 shrink-0">
                            <span className={`font-bold ${c.count > 0 ? "text-green-500" : c.count < 0 ? "text-muted-foreground" : "text-foreground"}`}>
                              {c.count < 0 ? "—" : c.count}
                            </span>
                            {clickable && <ChevronRight className="w-3 h-3 text-muted-foreground" />}
                          </div>
                        </button>
                      );
                    })}
                  </div>
                )}
                {verify && (
                  <p className="text-xs text-muted-foreground mt-1">
                    Click any row count to view the data directly from the secure cloud.
                  </p>
                )}
              </CardContent>
            )}
          </Card>

          {/* Secure invites — "set your own password" emails. The popup opens
              automatically on success (see auto-open effect) and can be
              re-opened from here. */}
          <Card>
            <CardHeader className="pb-3">
              <div className="flex items-center justify-between gap-3">
                <div>
                  <CardTitle className="text-base flex items-center gap-2">
                    <Mail className="w-4 h-4" /> Invite team members to set their password
                  </CardTitle>
                  <CardDescription className="mt-1">
                    Send each person a secure, one-time link to choose their own password.
                    No shared or default passwords — the link expires in 48 hours.
                  </CardDescription>
                </div>
                <Button variant="outline" size="sm" onClick={() => setInviteOpen(true)}>
                  <Users className="w-3.5 h-3.5 mr-1" />
                  Manage invites
                </Button>
              </div>
            </CardHeader>
          </Card>
        </>
      )}
      {/* ── Rows drill-down dialog ─────────────────────────────────── */}
      <Dialog open={!!rowsModal} onOpenChange={open => !open && setRowsModal(null)}>
        <DialogContent className="max-w-5xl w-full max-h-[85vh] flex flex-col">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Database className="w-4 h-4" />
              {rowsModal?.label}
              <Badge variant="outline" className="ml-1 text-xs">
                Secure cloud
              </Badge>
            </DialogTitle>
            <DialogDescription>
              {rowsModal?.data.total ?? 0} rows for tenant <strong>{rowsModal?.data.tenantId}</strong>
            </DialogDescription>
          </DialogHeader>

          {rowsModal && (
            <div className="overflow-auto flex-1 rounded border text-xs">
              <table className="w-full border-collapse min-w-max">
                <thead className="sticky top-0 bg-muted z-10">
                  <tr>
                    {rowsModal.data.columns.map(col => (
                      <th key={col} className="text-left px-3 py-2 border-b font-semibold whitespace-nowrap text-muted-foreground">
                        {col}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {rowsModal.data.rows.map((row, i) => (
                    <tr key={i} className="border-b hover:bg-muted/40 transition-colors">
                      {rowsModal.data.columns.map(col => {
                        const val = row[col];
                        const display = val === null || val === undefined
                          ? <span className="text-muted-foreground/40 italic">null</span>
                          : val instanceof Date || (typeof val === "string" && /^\d{4}-\d{2}-\d{2}T/.test(val))
                          ? new Date(val as string).toLocaleDateString()
                          : String(val);
                        return (
                          <td key={col} className="px-3 py-1.5 whitespace-nowrap max-w-[240px] overflow-hidden text-ellipsis" title={String(val ?? "")}>
                            {display}
                          </td>
                        );
                      })}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </DialogContent>
      </Dialog>

      <InviteMembersDialog
        tenantId={data?.tenantId ?? ""}
        tenantLabel={data?.tenantId}
        open={inviteOpen}
        onOpenChange={setInviteOpen}
      />

      <AddStaffModal
        open={addStaffOpen}
        onClose={() => setAddStaffOpen(false)}
        onCreated={(_name, inviteSent) => { setAddStaffOpen(false); if (!inviteSent) setInviteOpen(true); }}
        tenantId={data?.tenantId}
      />

      {/* Partial-import error details dialog */}
      <Dialog open={errorsOpen} onOpenChange={setErrorsOpen}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-yellow-600">
              <AlertTriangle className="w-5 h-5" />
              Import completed with {data?.totalErrors ?? 0} error{(data?.totalErrors ?? 0) !== 1 ? "s" : ""}
            </DialogTitle>
            <DialogDescription>
              {data?.totalInserted ?? 0} record{(data?.totalInserted ?? 0) !== 1 ? "s" : ""} were imported successfully.
              The rows below could not be saved — fix them in your file and re-upload.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-1.5 max-h-64 overflow-y-auto rounded border border-red-500/20 bg-red-500/5 p-2">
            {(data?.steps ?? []).flatMap(s => s.errors).map((e, i) => (
              <div key={i} className="bg-background rounded px-3 py-2 border border-red-200 dark:border-red-900 space-y-0.5">
                <div className="flex items-center gap-2 text-xs font-medium text-muted-foreground">
                  <span className="text-xs font-semibold text-muted-foreground shrink-0">{TABLE_LABELS[e.table] ?? e.table}</span>
                  {e.rowIndex >= 0 && (
                    <span className="bg-red-100 dark:bg-red-900/40 text-red-600 rounded px-1.5 py-0.5 font-mono text-xs shrink-0">
                      Row {e.rowIndex + 1}
                    </span>
                  )}
                  {e.title && <span className="truncate text-xs">{e.title}</span>}
                </div>
                <p className="text-xs text-red-600">{e.message}</p>
              </div>
            ))}
          </div>
          <div className="flex items-center justify-between gap-2 pt-1">
            <a href={`${API}/errors/${uploadId}?format=csv`} download>
              <Button variant="outline" size="sm">
                <Download className="w-3 h-3 mr-1.5" /> Download error CSV
              </Button>
            </a>
            <div className="flex gap-2">
              <Button variant="ghost" size="sm" onClick={() => setErrorsOpen(false)}>
                Dismiss
              </Button>
              <Button size="sm" onClick={() => { setErrorsOpen(false); navigate("/import"); }}>
                Fix &amp; Re-upload
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      {/* Cancel confirmation dialog */}
      <Dialog open={cancelConfirm} onOpenChange={v => { if (!cancelling) setCancelConfirm(v); }}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-red-600">
              <StopCircle className="w-5 h-5" /> Cancel this import?
            </DialogTitle>
            <DialogDescription>
              The import will stop and any data already written for this company will be rolled back.
              You can start a fresh upload at any time.
            </DialogDescription>
          </DialogHeader>
          <div className="flex justify-end gap-2 pt-2">
            <Button variant="ghost" size="sm" disabled={cancelling} onClick={() => setCancelConfirm(false)}>
              Keep running
            </Button>
            <Button
              variant="destructive"
              size="sm"
              disabled={cancelling}
              onClick={handleCancel}
            >
              {cancelling ? <><Loader2 className="w-4 h-4 mr-1.5 animate-spin" /> Cancelling…</> : "Yes, cancel"}
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      {/* Auto-redirect countdown banner */}
      {redirectCountdown !== null && (
        <div className="fixed bottom-6 left-1/2 -translate-x-1/2 z-50 flex items-center gap-3 px-5 py-3 rounded-xl bg-green-600 text-white shadow-2xl text-sm font-medium whitespace-nowrap">
          <CheckCircle2 className="w-4 h-4 shrink-0" />
          <span>Taking you to {primaryModuleLabel} in {redirectCountdown}s…</span>
          <button
            className="ml-2 underline text-white/80 hover:text-white text-xs"
            onClick={() => { setRedirectCountdown(null); }}
          >
            Stay here
          </button>
          <button
            className="ml-1 bg-white/20 hover:bg-white/30 px-3 py-1 rounded-lg text-xs"
            onClick={() => navigate(primaryModulePath)}
          >
            Go now →
          </button>
        </div>
      )}
    </div>
  );
}
