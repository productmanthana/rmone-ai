import { useMemo, useState, useCallback } from "react";
import { useLocation } from "wouter";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Clock, CheckCircle2, XCircle, AlertTriangle, Loader2, ExternalLink, MoreVertical, RefreshCw, PlusCircle, Trash2, Users, Building2, ArrowLeft, Download, List, Gauge, Upload, Table2, X, Search, Pencil } from "lucide-react";
import { RmOneProcessing } from "@/components/CommandCentreLoader";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu, DropdownMenuTrigger, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator,
} from "@/components/ui/dropdown-menu";
import InviteMembersDialog from "@/components/InviteMembersDialog";
import { InlineDataGrid } from "@/components/InlineDataGrid";
import { useAuth } from "@/lib/useAuth";
import { isSuperAdmin } from "@/lib/roleResolver";
import { authHeaders } from "@/lib/api";
import { getCachedHistoryFile, putCachedHistoryFile } from "@/lib/historyFileCache";

/** Derive the InlineDataGrid cardId from an uploaded file name. */
function cardIdFromFileName(name: string): { cardId: string; multiTab: boolean } {
  const n = name.toLowerCase();
  if (n.includes("lead"))                              return { cardId: "leads",         multiTab: false };
  if (n.includes("team") || n.includes("staff") || n.includes("people") || n.includes("roster"))
                                                        return { cardId: "team",          multiTab: false };
  if (n.includes("opp") || n.includes("opportunit"))  return { cardId: "opportunities", multiTab: false };
  if (n.includes("compan") || n.includes("client"))   return { cardId: "companies",      multiTab: false };
  return { cardId: "projects", multiTab: true };
}

const API = "/api/onboarding";

type ImportMode = "update" | "add" | "replace";

interface Job {
  uploadId:      string;
  tenantId:      string;
  /** Only present on phantom (provisioned-only) tenants discovered via core2
   *  that have no onboarding_jobs row. The backend stores the GUID as
   *  tenantId (so delete resolves correctly) and puts the human-readable
   *  CRMCompany name here. */
  displayName?:  string;
  fileName:      string;
  status:        "pending" | "running" | "success" | "partial" | "failed" | "cancelled" | "provisioned";
  createdAt:     string;
  createdBy?:    string;
  totalInserted: number;
  totalErrors:   number;
  warningsCount?: number;
  importMode?:   "create" | "update" | "add" | "replace" | string | null;
}

function normTenant(t: string): string {
  return t.trim().replace(/\s+/g, "_").toLowerCase();
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
function displayTenant(tenantId: string): string {
  return UUID_RE.test(tenantId.trim()) ? "Unnamed Company" : tenantId;
}

function WarningsBadge({ count }: { count: number | undefined }) {
  if (!count) return null;
  return (
    <Badge
      variant="outline"
      className="border-yellow-500 text-yellow-600 bg-yellow-50 dark:bg-yellow-950/30 gap-1 shrink-0"
      title={`${count} field write warning${count === 1 ? "" : "s"}`}
    >
      <AlertTriangle className="w-3 h-3" />
      {count} warning{count === 1 ? "" : "s"}
    </Badge>
  );
}

function NeedsAttentionBadge({ count }: { count: number | undefined }) {
  if (!count) return null;
  return (
    <Badge
      variant="outline"
      className="border-amber-500 text-amber-600 bg-amber-50 dark:bg-amber-950/30 gap-1 shrink-0"
      title={`${count} item${count === 1 ? "" : "s"} waiting for a decision — open this import to answer`}
    >
      <AlertTriangle className="w-3 h-3" />
      {count} to review
    </Badge>
  );
}

function ModeBadge({ mode }: { mode: Job["importMode"] }) {
  if (!mode) return <span className="text-muted-foreground text-xs">—</span>;
  if (mode === "create")
    return <Badge variant="outline" className="border-[#6BA539] text-[#6BA539] bg-[#6BA539]/10 gap-1"><Building2 className="w-3 h-3" />New Company</Badge>;
  if (mode === "update")
    return <Badge variant="outline" className="border-blue-500 text-blue-600 bg-blue-50 dark:bg-blue-950/30 gap-1"><RefreshCw className="w-3 h-3" />Update &amp; Add</Badge>;
  if (mode === "add")
    return <Badge variant="outline" className="border-green-500 text-green-600 bg-green-50 dark:bg-green-950/30 gap-1"><PlusCircle className="w-3 h-3" />Add New</Badge>;
  if (mode === "replace")
    return <Badge variant="outline" className="border-red-500 text-red-600 bg-red-50 dark:bg-red-950/30 gap-1"><Trash2 className="w-3 h-3" />Replace All</Badge>;
  return <span className="text-muted-foreground text-xs">{mode}</span>;
}

function StatusBadge({ status }: { status: Job["status"] }) {
  if (status === "success")     return <Badge className="bg-green-600 text-white"><CheckCircle2 className="w-3 h-3 mr-1" />Success</Badge>;
  if (status === "failed")      return <Badge variant="destructive"><XCircle className="w-3 h-3 mr-1" />Failed</Badge>;
  if (status === "cancelled")   return <Badge variant="outline" className="text-slate-500 border-slate-300 dark:border-slate-600"><XCircle className="w-3 h-3 mr-1" />Cancelled</Badge>;
  if (status === "partial")     return <Badge className="bg-yellow-500 text-black"><AlertTriangle className="w-3 h-3 mr-1" />Partial</Badge>;
  if (status === "pending")     return <Badge variant="outline" className="text-muted-foreground"><Clock className="w-3 h-3 mr-1" />Pending</Badge>;
  if (status === "provisioned") return <Badge variant="outline" className="border-blue-400 text-blue-600 bg-blue-50 dark:bg-blue-950/30"><Building2 className="w-3 h-3 mr-1" />Provisioned</Badge>;
  return <Badge variant="secondary"><Loader2 className="w-3 h-3 mr-1 animate-spin" />Running</Badge>;
}

// Inline-editable upload label. Shows filename with a hover pencil icon;
// clicking it drops into a small input. Saves on Enter/blur, cancels on Escape.
function EditableFileName({
  uploadId,
  displayedName,
  onRename,
}: {
  uploadId: string;
  displayedName: string;
  onRename: (uploadId: string, label: string) => Promise<void>;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState("");
  const [saving, setSaving] = useState(false);

  function startEdit(e: React.MouseEvent) {
    e.stopPropagation();
    setDraft(displayedName);
    setEditing(true);
  }

  async function commit() {
    const trimmed = draft.trim();
    if (!trimmed || trimmed === displayedName) { setEditing(false); return; }
    setSaving(true);
    try {
      await onRename(uploadId, trimmed);
    } catch (err) {
      alert(`Could not rename: ${(err as Error).message}`);
    } finally {
      setSaving(false);
      setEditing(false);
    }
  }

  if (editing) {
    return (
      <div className="flex items-center gap-1 w-full" onClick={e => e.stopPropagation()}>
        <input
          className="flex-1 min-w-0 border rounded px-1.5 py-0.5 text-sm focus:outline-none focus:ring-1 focus:ring-ring bg-background"
          value={draft}
          onChange={e => setDraft(e.target.value)}
          onKeyDown={e => {
            if (e.key === "Enter") { e.preventDefault(); void commit(); }
            if (e.key === "Escape") setEditing(false);
          }}
          onBlur={() => void commit()}
          autoFocus
          disabled={saving}
          maxLength={300}
        />
        {saving && <Loader2 className="w-3 h-3 animate-spin shrink-0 text-muted-foreground" />}
      </div>
    );
  }

  return (
    <div className="flex items-center gap-1 group/fname min-w-0 w-full">
      <Table2 className="w-3.5 h-3.5 text-muted-foreground/50 shrink-0" />
      <span className="truncate flex-1 min-w-0" title={displayedName}>{displayedName}</span>
      <button
        type="button"
        title="Rename this upload"
        className="shrink-0 opacity-0 group-hover/fname:opacity-100 transition-opacity p-0.5 rounded hover:bg-accent"
        onClick={startEdit}
      >
        <Pencil className="w-3 h-3 text-muted-foreground" />
      </button>
    </div>
  );
}

// Actions shown in the per-run table rows and the card action strip.
function RowActions({
  job,
  onView,
  onInvite,
  onReimport,
  onDelete,
  deleting,
}: {
  job: Job;
  onView: () => void;
  onInvite: () => void;
  onReimport: (mode: ImportMode) => void;
  onDelete?: () => void;
  deleting?: boolean;
}) {
  // Delete is offered only for runs that never completed: the backend
  // enforces the same failed/cancelled gate.
  const deletable = job.status === "failed" || job.status === "cancelled" || job.status === "provisioned";
  return (
    <div className="flex items-center gap-1">
      <Button variant="ghost" size="sm" title="View details" onClick={onView}>
        <ExternalLink className="w-3 h-3" />
      </Button>
      <Button
        variant="ghost"
        size="sm"
        title={`Download ${job.fileName}`}
        onClick={async () => {
          try {
            const res = await fetch(`${API}/file/${job.uploadId}`, { headers: authHeaders() });
            if (!res.ok) throw new Error(`Server returned ${res.status}`);
            const blob = await res.blob();
            const url = URL.createObjectURL(blob);
            const a = document.createElement("a");
            a.href = url;
            a.download = job.fileName;
            document.body.appendChild(a);
            a.click();
            document.body.removeChild(a);
            setTimeout(() => URL.revokeObjectURL(url), 10_000);
          } catch (e) {
            alert(`Could not download file: ${(e as Error).message}`);
          }
        }}
      >
        <Download className="w-3.5 h-3.5" />
      </Button>
      <Button
        variant="ghost"
        size="sm"
        title="Invite team members to set their password"
        className="text-[#6BA539] hover:text-[#5a8f30]"
        onClick={onInvite}
      >
        <Users className="w-3.5 h-3.5" />
      </Button>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="ghost" size="sm" title="More actions" disabled={job.status === "running"}>
            <MoreVertical className="w-4 h-4" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-72">
          <DropdownMenuItem onClick={onInvite}>
            <Users className="w-4 h-4 mr-2 text-[#6BA539]" />
            <div className="flex flex-col">
              <span>Invite team members</span>
              <span className="text-xs text-muted-foreground">Send a secure "set your own password" email.</span>
            </div>
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem onClick={() => onReimport("update")}>
            <RefreshCw className="w-4 h-4 mr-2 text-blue-600" />
            <div className="flex flex-col">
              <span>Re-import from a new file</span>
              <span className="text-xs text-muted-foreground">Pick a new file. Existing records are updated, new rows are added — nothing is removed.</span>
            </div>
          </DropdownMenuItem>
          {deletable && onDelete && (
            <>
              <DropdownMenuSeparator />
              <DropdownMenuItem
                className="text-destructive focus:text-destructive"
                disabled={deleting}
                onClick={onDelete}
              >
                {deleting
                  ? <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                  : <Trash2 className="w-4 h-4 mr-2" />}
                <div className="flex flex-col">
                  <span>Delete this run</span>
                  <span className="text-xs text-muted-foreground">
                    Remove this {job.status} run and its stored file from history.
                  </span>
                </div>
              </DropdownMenuItem>
            </>
          )}
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
}

export default function OnboardingHistoryPage({ embedded }: { embedded?: boolean } = {}) {
  const [, navigate] = useLocation();
  const { user } = useAuth();
  const queryClient = useQueryClient();

  // Open needs-attention items for this admin's company → per-upload badges.
  // Fail-quiet: non-admins (or fetch errors) simply see no badges.
  const { data: reviewOpen } = useQuery<{ items: { uploadId?: string | null }[] }>({
    queryKey: ["import-review-open"],
    queryFn: async () => {
      const res = await fetch(`${API}/review?status=open`, { headers: authHeaders() });
      if (!res.ok) return { items: [] };
      return res.json();
    },
    staleTime: 30_000,
    refetchOnWindowFocus: false,
  });
  const reviewByUpload = useMemo(() => {
    const m = new Map<string, number>();
    for (const it of reviewOpen?.items ?? []) {
      if (it?.uploadId) m.set(it.uploadId, (m.get(it.uploadId) ?? 0) + 1);
    }
    return m;
  }, [reviewOpen]);
  const [inviteTarget, setInviteTarget] = useState<{ tenantId: string } | null>(null);
  const [viewingJob, setViewingJob] = useState<Job | null>(null);
  const [viewingFile, setViewingFile] = useState<File | null>(null);
  const [viewFileLoading, setViewFileLoading] = useState<string | null>(null);
  const [viewProgress, setViewProgress] = useState<{ received: number; total: number } | null>(null);
  const [deletingTenantId, setDeletingTenantId] = useState<string | null>(null);
  const [bulkDeleting, setBulkDeleting] = useState(false);
  const [deletingRunId, setDeletingRunId] = useState<string | null>(null);
  const [labelOverrides, setLabelOverrides] = useState<Record<string, string>>({});

  const renameUpload = useCallback(async (uploadId: string, label: string) => {
    const res = await fetch(`${API}/history/${uploadId}/label`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json", ...authHeaders() },
      body: JSON.stringify({ label }),
    });
    if (!res.ok) {
      const d = await res.json().catch(() => ({})) as { error?: string };
      throw new Error(d.error ?? `Server error ${res.status}`);
    }
    setLabelOverrides(prev => ({ ...prev, [uploadId]: label }));
  }, []);

  // Delete a single failed/cancelled run: removes the history record and the
  // stored upload file. The backend also retries the safe create-mode rollback
  // if the automatic one errored out when the run failed.
  const deleteRun = useCallback(async (job: Job) => {
    if (!window.confirm(
      `Delete this ${job.status} run ("${job.fileName}") from history?\n\n` +
      `The stored copy of the uploaded file is removed too. This cannot be undone.`
    )) return;
    setDeletingRunId(job.uploadId);
    try {
      const res = await fetch(`${API}/history/${encodeURIComponent(job.uploadId)}`, {
        method: "DELETE",
        headers: authHeaders(),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok || body?.ok === false) {
        throw new Error(body?.error ?? `HTTP ${res.status}`);
      }
      await queryClient.invalidateQueries({ queryKey: ["onboarding-history"] });
    } catch (e: any) {
      alert(`Could not delete the run: ${e?.message ?? e}`);
    } finally {
      setDeletingRunId(null);
    }
  }, [queryClient]);

  // Core delete call — sends confirm token when provided. Returns true on
  // success, false on failure (error already alerted). When the server returns
  // confirm_required it means the company has real data even though the card
  // may look provisioned-only; in that case we escalate to the typed-name
  // prompt here rather than surfacing the server message as a plain error.
  const deleteTenant = useCallback(async (tenantId: string, label: string, confirm?: string) => {
    setDeletingTenantId(tenantId);
    try {
      const res = await fetch(`${API}/tenant/delete`, {
        method: "POST",
        headers: { "Content-Type": "application/json", ...authHeaders() },
        body: JSON.stringify(confirm ? { tenantId, confirm } : { tenantId }),
      });
      const body = await res.json().catch(() => ({}));
      // Server says this company has data and needs a typed confirm — show the
      // prompt regardless of which button triggered the delete (a provisioned
      // card can still have data rows if data was uploaded then partially wiped).
      if (res.status === 400 && body?.error === "confirm_required") {
        setDeletingTenantId(null);
        const typed = window.prompt(
          `Permanently delete "${label}" AND ALL ITS DATA?\n\n` +
          `This removes every project, opportunity, allocation, schedule, ` +
          `import history, invite AND all user logins for this company. ` +
          `A recovery snapshot is saved for support, but the app cannot undo this.\n\n` +
          `Type the company name to confirm:`);
        if (typed == null) return false; // cancelled
        if (!typed.trim() || typed.trim().toLowerCase() !== label.trim().toLowerCase()) {
          alert(`Name didn't match — nothing was deleted. Type "${label}" exactly to confirm.`);
          return false;
        }
        // Retry with the tenantId as the server confirm token. Display labels
        // (displayName, "Unnamed Company" fallback) can drift from the
        // underlying tenant label — tenantId always satisfies the server check.
        return deleteTenant(tenantId, label, tenantId);
      }
      if (!res.ok || body?.ok === false) {
        throw new Error(body?.message ?? body?.error ?? `HTTP ${res.status}`);
      }
      await queryClient.invalidateQueries({ queryKey: ["onboarding-history"] });
      return true;
    } catch (e: any) {
      alert(`Could not delete "${label}": ${e?.message ?? e}`);
      return false;
    } finally {
      setDeletingTenantId(null);
    }
  }, [queryClient]);

  const handleDeleteOne = useCallback((tenantId: string, label: string) => {
    if (!window.confirm(`Permanently delete "${label}"? This removes the tenant and cannot be undone.`)) return;
    void deleteTenant(tenantId, label);
  }, [deleteTenant]);

  // Delete a company that HAS uploaded data — pre-prompt before the first
  // network call so the user sees the full warning immediately. The server
  // may also return confirm_required on its own (handled inside deleteTenant)
  // if the card appeared provisioned but the tenant has residual data.
  const handleDeleteWithData = useCallback((tenantId: string, label: string) => {
    const typed = window.prompt(
      `Permanently delete "${label}" AND ALL ITS DATA?\n\n` +
      `This removes every project, opportunity, allocation, schedule, ` +
      `import history, invite AND all user logins for this company. ` +
      `A recovery snapshot is saved for support, but the app cannot undo this.\n\n` +
      `Type the company name to confirm:`);
    if (typed == null) return; // cancelled
    if (!typed.trim() || typed.trim().toLowerCase() !== label.trim().toLowerCase()) {
      alert(`Name didn't match — nothing was deleted. Type "${label}" exactly to confirm.`);
      return;
    }
    void deleteTenant(tenantId, label, tenantId);
  }, [deleteTenant]);

  const openFileView = useCallback(async (job: Job) => {
    const XLSX_MIME = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
    setViewFileLoading(job.uploadId);
    setViewProgress(null);
    // Defensive: never let a stale file from a previous view render while the
    // new one is still downloading.
    setViewingFile(null);
    // Show the full-screen loading view immediately — big files (50+ MB)
    // take a while to download and the row spinner alone is easy to miss.
    setViewingJob(job);
    try {
      // Local-first: the blob for an uploadId never changes, so a previously
      // viewed file opens straight from IndexedDB with no server round trip.
      const cacheKey = `${job.tenantId}:${job.uploadId}`;
      const hit = await getCachedHistoryFile(cacheKey);
      if (hit) {
        setViewingFile(new File([hit.blob], job.fileName, { type: hit.blob.type || XLSX_MIME }));
        return;
      }
      const res = await fetch(`${API}/file/${job.uploadId}`, { headers: authHeaders() });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      let blob: Blob;
      const total = Number(res.headers.get("content-length") ?? 0);
      if (res.body && total > 0) {
        // Stream the body so the loading screen can show real download
        // progress instead of an indefinite spinner (throttled to ~5/s).
        const reader = res.body.getReader();
        const chunks: BlobPart[] = [];
        let received = 0;
        let lastPaint = 0;
        for (;;) {
          const { done, value } = await reader.read();
          if (done) break;
          chunks.push(value);
          received += value.byteLength;
          const now = Date.now();
          if (now - lastPaint > 200 || received >= total) {
            lastPaint = now;
            setViewProgress({ received, total });
          }
        }
        blob = new Blob(chunks, { type: res.headers.get("content-type") || XLSX_MIME });
      } else {
        blob = await res.blob();
      }
      // Cache for next time (fail-soft; pruned to the few most recent files).
      void putCachedHistoryFile(cacheKey, blob, job.fileName);
      setViewingFile(new File([blob], job.fileName, { type: blob.type || XLSX_MIME }));
    } catch (e: any) {
      setViewingJob(null);
      setViewingFile(null);
      alert(`Could not load file: ${e?.message ?? e}`);
    } finally {
      setViewFileLoading(null);
      setViewProgress(null);
    }
  }, []);
  // Drilled-down company: when set, show that company's run table instead of the card grid.
  // Pre-seed from ?tenantId= query param so "Upload History" from status page jumps straight
  // to the right company card (useful when a superadmin uploads on behalf of a tenant).
  const [selectedCompany, setSelectedCompany] = useState<string | null>(() => {
    try { return new URLSearchParams(window.location.search).get("tenantId") ?? null; } catch { return null; }
  });
  const [searchQuery, setSearchQuery] = useState("");

  const superAdmin = isSuperAdmin(user?.username, user?.tenant);
  const myTenant = user?.tenant ?? "";

  // Scope the fetch to one company whenever one is selected. For a superadmin
  // the drilled-in company (card click or ?tenantId= seed) uses the
  // tenant-scoped server query: it returns in well under a second and carries
  // accurate per-run warning counts, while the all-companies query skips the
  // expensive warning parsing (50 s on the live DB) to stay fast. Company
  // users are always scoped to their own tenant server-side.
  const scopeTenant = superAdmin ? selectedCompany : myTenant;
  const { data, isLoading, isError, refetch } = useQuery({
    queryKey: ["onboarding-history", superAdmin ? (selectedCompany ?? "all") : myTenant],
    queryFn:  async () => {
      const url = scopeTenant
        ? `${API}/history?tenantId=${encodeURIComponent(scopeTenant)}`
        : `${API}/history`;
      // Abort after 20 s so the "Rendering history" spinner never hangs
      // indefinitely when the SQL Server pool is cold or the UNION query is slow.
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), 20_000);
      try {
        const r = await fetch(url, { headers: authHeaders(), signal: ctrl.signal });
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        return r.json() as Promise<{ jobs: Job[]; degraded?: boolean }>;
      } finally {
        clearTimeout(timer);
      }
    },
    // Poll fast (5 s) only while an import is actually running or pending so
    // live progress stays fresh; otherwise back off to 30 s — the list of
    // finished runs rarely changes and constant polling was hammering the
    // server-side history query.
    refetchInterval: (query) => {
      const js = query.state.data?.jobs ?? [];
      return js.some(j => j.status === "running" || j.status === "pending") ? 5000 : 30_000;
    },
    refetchIntervalInBackground: true,
    // 30-second stale window: navigating back to this page within 30 s serves
    // the cached list instantly (isLoading=false) instead of re-showing the
    // full "Rendering history" splash on every visit.
    staleTime: 30_000,
    retry: 1,
  });

  const allJobs: Job[] = data?.jobs ?? [];
  const jobs: Job[] = superAdmin
    ? allJobs
    : allJobs.filter(j => normTenant(j.tenantId) === normTenant(myTenant));

  const companies = useMemo(() => {
    const map = new Map<string, Job[]>();
    for (const j of jobs) {
      const list = map.get(j.tenantId) ?? [];
      list.push(j);
      map.set(j.tenantId, list);
    }
    return [...map.entries()]
      .map(([tenantId, runs]) => ({ tenantId, runs }))
      // Most recently created/provisioned company first (newest runs[0] date = latest activity)
      .sort((a, b) => b.runs[0].createdAt.localeCompare(a.runs[0].createdAt));
  }, [jobs]);

  const filteredCompanies = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    if (!q) return companies;
    return companies.filter(({ tenantId, runs }) => {
      // Also search by displayName (phantom tenants have GUID as tenantId)
      const name = runs[0]?.displayName ?? tenantId;
      return name.toLowerCase().includes(q) || tenantId.toLowerCase().includes(q);
    });
  }, [companies, searchQuery]);

  const provisionedOnlyTenants = useMemo(
    () => filteredCompanies
      .filter(({ runs }) => runs.every(r => r.status === "provisioned"))
      .map(({ tenantId, runs }) => ({
        tenantId,
        label: runs[0]?.displayName || displayTenant(tenantId),
      })),
    [filteredCompanies],
  );
  // Keep the plain ID list for the "delete all provisioned" count display.
  const provisionedOnlyTenantIds = useMemo(
    () => provisionedOnlyTenants.map(t => t.tenantId),
    [provisionedOnlyTenants],
  );

  const handleDeleteAllProvisioned = useCallback(async () => {
    if (!provisionedOnlyTenants.length) return;
    if (!window.confirm(
      `Permanently delete all ${provisionedOnlyTenants.length} provisioned (no-upload) companies? This cannot be undone.`,
    )) return;
    setBulkDeleting(true);
    try {
      for (const { tenantId, label } of provisionedOnlyTenants) {
        await deleteTenant(tenantId, label);
      }
    } finally {
      setBulkDeleting(false);
    }
  }, [provisionedOnlyTenants, deleteTenant]);

  function reimport(_job: Job, _mode: ImportMode) {
    navigate("/import");
  }

  // ── Company drill-down: all runs for a single company ─────────────────
  // Tolerant match: the ?tenantId= URL seed may carry the normalized login
  // key ("acme_construction") while rows store the display label
  // ("Acme Construction") — same normalization the server applies.
  const drillCompany = selectedCompany
    ? companies.find(c => normTenant(c.tenantId) === normTenant(selectedCompany))
    : null;

  // ── Full-screen file-data view ─────────────────────────────────────────
  // MUST be checked before drillCompany so that clicking a row in the
  // company runs-list actually renders the file view (drillCompany returns
  // early and would swallow the viewingJob state otherwise).
  if (viewingJob) {
    const closeView = () => { setViewingJob(null); setViewingFile(null); };

    if (!viewingFile) {
      const mb = (n: number) => (n / 1048576).toFixed(1);
      const pct = viewProgress && viewProgress.total > 0
        ? Math.min(100, Math.round((viewProgress.received / viewProgress.total) * 100))
        : null;
      return (
        <div className="fixed inset-0 z-50 bg-white flex flex-col items-center justify-center gap-3 text-gray-500">
          <div className="flex items-center gap-3">
            <Loader2 className="w-5 h-5 animate-spin" />
            <span className="text-sm">
              {viewProgress
                ? `Downloading ${viewingJob.fileName}… ${mb(viewProgress.received)} of ${mb(viewProgress.total)} MB`
                : `Loading ${viewingJob.fileName}…`}
            </span>
          </div>
          {pct !== null && (
            <div className="w-64 h-1.5 bg-gray-200 rounded-full overflow-hidden">
              <div className="h-full bg-indigo-500 rounded-full transition-all" style={{ width: `${pct}%` }} />
            </div>
          )}
          <span className="text-xs text-gray-400">
            Large files can take a minute the first time — they open instantly after that.
          </span>
        </div>
      );
    }

    const { cardId, multiTab } = cardIdFromFileName(viewingJob.fileName);
    return (
      <div className="fixed inset-0 z-50 flex flex-col bg-white">
        <InlineDataGrid
          embedded
          readOnly
          cardId={cardId}
          cardLabel={viewingJob.fileName}
          multiTab={multiTab}
          initialFile={viewingFile}
          onClose={closeView}
          onSubmit={() => {}}
        />
      </div>
    );
  }

  if (superAdmin && drillCompany) {
    return (
      <div className={embedded ? "space-y-6" : "p-6 max-w-6xl mx-auto space-y-6"}>
        <div className="flex items-center justify-between">
          <div className="flex items-start gap-3">
            <Button
              variant="ghost"
              size="icon"
              className="mt-0.5 shrink-0"
              onClick={() => setSelectedCompany(null)}
              title="Back to all companies"
            >
              <ArrowLeft size={18} />
            </Button>
            <div>
              <h1 className={embedded ? "text-lg font-semibold" : "text-2xl font-bold"}>
                {displayTenant(drillCompany.tenantId)}
              </h1>
              <p className="text-muted-foreground text-sm mt-0.5">
                {drillCompany.runs.length} upload run{drillCompany.runs.length === 1 ? "" : "s"}
              </p>
            </div>
          </div>
          <div className="flex gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={() => setInviteTarget({ tenantId: drillCompany.tenantId })}
            >
              <Users className="w-4 h-4 mr-1.5 text-[#6BA539]" />
              Invite members
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={() => navigate(`/onboarding/readiness?tenant=${encodeURIComponent(drillCompany.tenantId)}`)}
            >
              <Gauge className="w-4 h-4 mr-1.5" />
              Data Readiness
            </Button>
            <Button
              size="sm"
              onClick={() => navigate(`/onboarding?tenant=${encodeURIComponent(drillCompany.tenantId)}`)}
            >
              <Upload className="w-4 h-4 mr-1.5" />
              Upload File
            </Button>
          </div>
        </div>

        <Card>
          <CardContent className="p-0">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b text-xs text-muted-foreground uppercase tracking-wide">
                  <th className="text-left px-4 py-3 font-medium">File</th>
                  <th className="text-left px-4 py-3 font-medium">Status</th>
                  <th className="text-left px-4 py-3 font-medium">Mode</th>
                  <th className="text-right px-4 py-3 font-medium">Inserted</th>
                  <th className="text-right px-4 py-3 font-medium">Errors</th>
                  <th className="text-left px-4 py-3 font-medium">Date</th>
                  <th className="text-left px-4 py-3 font-medium">Actions</th>
                </tr>
              </thead>
              <tbody>
                {drillCompany.runs.map(job => (
                  <tr
                    key={job.uploadId}
                    className="border-b hover:bg-muted/30 transition-colors cursor-pointer"
                    onClick={() => navigate(`/onboarding/status/${job.uploadId}`)}
                  >
                    <td className="px-4 py-3 font-medium max-w-[240px]" onClick={e => e.stopPropagation()}>
                      <EditableFileName
                        uploadId={job.uploadId}
                        displayedName={labelOverrides[job.uploadId] ?? job.fileName}
                        onRename={renameUpload}
                      />
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-1.5 flex-wrap">
                        <StatusBadge status={job.status} />
                        <WarningsBadge count={job.warningsCount} />
                        <NeedsAttentionBadge count={reviewByUpload.get(job.uploadId)} />
                      </div>
                    </td>
                    <td className="px-4 py-3">
                      <ModeBadge mode={job.importMode} />
                    </td>
                    <td className="px-4 py-3 text-right font-semibold">
                      {(job.status === "success" || job.status === "partial") && (job.totalInserted ?? 0) === 0 ? (
                        job.importMode === "update" ? (
                          // Update-mode runs legitimately insert 0 NEW rows while
                          // updating existing records — say exactly that, never
                          // "no data".
                          <span
                            className="text-muted-foreground"
                            title="No new rows were inserted — existing records may have been updated in place (updates aren't counted in this column). Open the run for details."
                          >
                            0 <span className="text-[10px] font-medium uppercase">new</span>
                          </span>
                        ) : (
                          <span
                            className="text-amber-500"
                            title="This run completed but wrote no data rows from the file — only internal setup entries."
                          >
                            0 <span className="text-[10px] font-medium uppercase">no data</span>
                          </span>
                        )
                      ) : (
                        <span className="text-green-500">{job.totalInserted ?? "—"}</span>
                      )}
                    </td>
                    <td className={`px-4 py-3 text-right font-semibold ${(job.totalErrors ?? 0) > 0 ? "text-red-500" : "text-muted-foreground"}`}>
                      {job.totalErrors ?? "—"}
                    </td>
                    <td className="px-4 py-3 text-muted-foreground text-xs whitespace-nowrap">
                      {new Date(job.createdAt).toLocaleString()}
                    </td>
                    <td className="px-4 py-3" onClick={e => e.stopPropagation()}>
                      <RowActions
                        job={job}
                        onView={() => navigate(`/onboarding/status/${job.uploadId}`)}
                        onInvite={() => setInviteTarget({ tenantId: job.tenantId })}
                        onReimport={mode => reimport(job, mode)}
                        onDelete={() => deleteRun(job)}
                        deleting={deletingRunId === job.uploadId}
                      />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </CardContent>
        </Card>

        <InviteMembersDialog
          tenantId={inviteTarget?.tenantId ?? ""}
          tenantLabel={inviteTarget?.tenantId}
          open={!!inviteTarget}
          onOpenChange={open => !open && setInviteTarget(null)}
        />
      </div>
    );
  }

  // ── Main view ─────────────────────────────────────────────────────────
  return (
    <div className={embedded ? "space-y-6" : "p-6 max-w-6xl mx-auto space-y-6"}>
      <div className="flex flex-col gap-3">
        {/* Back button — only shown when accessed as a standalone page, not embedded */}
        {!embedded && (
          <button
            onClick={() => navigate("/import")}
            className="flex items-center gap-1.5 w-fit text-sm font-medium transition-opacity hover:opacity-70"
            style={{ color: "var(--rm-muted, #888)" }}
          >
            <ArrowLeft className="w-3.5 h-3.5" />
            Back to Import
          </button>
        )}
        <div className="flex items-start justify-between gap-4">
          <div className="flex-1 min-w-0">
            <h1 className={embedded ? "text-lg font-semibold" : "text-2xl font-bold"}>
              {superAdmin ? "All Companies" : "Upload History"}
            </h1>
            <p className="text-muted-foreground text-sm mt-0.5">
              {superAdmin
                ? "All companies' onboarding runs"
                : "Your company's onboarding runs"}
            </p>
          </div>
          <div className="flex gap-2 flex-shrink-0">
            {superAdmin && provisionedOnlyTenantIds.length > 0 && (
              <Button
                variant="outline"
                className="text-red-500 border-red-300 hover:bg-red-50 hover:text-red-600 dark:border-red-900 dark:hover:bg-red-950"
                onClick={handleDeleteAllProvisioned}
                disabled={bulkDeleting}
              >
                {bulkDeleting ? (
                  <Loader2 className="w-3.5 h-3.5 mr-1.5 animate-spin" />
                ) : (
                  <Trash2 className="w-3.5 h-3.5 mr-1.5" />
                )}
                Delete all provisioned ({provisionedOnlyTenantIds.length})
              </Button>
            )}
            {superAdmin && (
              <Button variant="outline" onClick={() => navigate("/onboarding/new-company")}>
                + New Company
              </Button>
            )}
            {!superAdmin && (
              <Button onClick={() => navigate("/import")}>New Upload</Button>
            )}
          </div>
        </div>

        {superAdmin && (
          <div className="relative max-w-sm">
            <Search
              className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 pointer-events-none"
              style={{ color: "var(--rm-muted, #888)" }}
            />
            <input
              type="text"
              value={searchQuery}
              onChange={e => setSearchQuery(e.target.value)}
              placeholder="Search companies…"
              className="w-full pl-9 pr-8 py-2 text-sm rounded-lg outline-none bg-white dark:bg-[#1a2035] text-gray-900 dark:text-white border border-gray-200 dark:border-[#2a3248] placeholder:text-gray-400 dark:placeholder:text-gray-500"
            />
            {searchQuery && (
              <button
                onClick={() => setSearchQuery("")}
                className="absolute right-2.5 top-1/2 -translate-y-1/2 opacity-50 hover:opacity-100 transition-opacity"
                title="Clear search"
              >
                <X className="w-3.5 h-3.5" style={{ color: "var(--rm-muted, #888)" }} />
              </button>
            )}
          </div>
        )}
      </div>

      {isLoading && !isError && (
        <RmOneProcessing
          label="Loading upload history…"
          sublabel="FETCHING IMPORT RECORDS"
          stages={[
            "Connecting to database",
            "Fetching upload records",
            "Loading import status",
            "Resolving company names",
            "Rendering history",
          ]}
          light
        />
      )}
      {isError && (
        <Card>
          <CardContent className="py-12 text-center">
            <AlertTriangle className="w-10 h-10 mx-auto mb-3 text-yellow-500 opacity-70" />
            <p className="text-muted-foreground text-sm mb-3">
              Could not load import history. The server may be starting up — please try again.
            </p>
            <Button variant="outline" size="sm" onClick={() => window.location.reload()}>
              Retry
            </Button>
          </CardContent>
        </Card>
      )}
      {!isLoading && !isError && jobs.length === 0 ? (
        data?.degraded ? (
          // The server couldn't reach the history database and fell back to an
          // (empty) in-memory list — this is NOT proof that no uploads exist,
          // so never show "No uploads yet" here; that reads as data loss.
          <Card>
            <CardContent className="py-16 text-center">
              <Clock className="w-12 h-12 mx-auto mb-4 text-muted-foreground opacity-40" />
              <p className="text-muted-foreground">
                Upload history is temporarily unavailable — the server couldn't reach the history database. Your past uploads are safe.
              </p>
              <Button variant="outline" className="mt-4" onClick={() => refetch()}>Try Again</Button>
            </CardContent>
          </Card>
        ) : (
        <Card>
          <CardContent className="py-16 text-center">
            <Clock className="w-12 h-12 mx-auto mb-4 text-muted-foreground opacity-40" />
            <p className="text-muted-foreground">
              {superAdmin ? "No uploads yet" : "No uploads yet for your company"}
            </p>
            <Button className="mt-4" onClick={() => navigate("/import")}>Start First Upload</Button>
          </CardContent>
        </Card>
        )
      ) : superAdmin ? (
        // ── Superadmin: one card per company ─────────────────────────────
        <>
          {filteredCompanies.length === 0 && searchQuery.trim() ? (
            <Card>
              <CardContent className="py-16 text-center">
                <Search className="w-10 h-10 mx-auto mb-3 opacity-25" />
                <p className="text-muted-foreground text-sm">No companies match <strong>"{searchQuery}"</strong></p>
                <button className="text-xs underline mt-2 opacity-60 hover:opacity-100" onClick={() => setSearchQuery("")}>Clear search</button>
              </CardContent>
            </Card>
          ) : (
          <div className="grid gap-5 grid-cols-1 sm:grid-cols-2 lg:grid-cols-3">
            {filteredCompanies.map(({ tenantId, runs }) => {
            const realRuns = runs.filter(r => r.status !== "provisioned");
            const latest = realRuns[0] ?? runs[0];
            const isProvisionedOnly = realRuns.length === 0;
            const inserted = realRuns.reduce((n, r) => n + (r.totalInserted ?? 0), 0);
            const errors = realRuns.reduce((n, r) => n + (r.totalErrors ?? 0), 0);
            // Earliest run (usually the provisioning sentinel row) tells us
            // when the company was created and, if known, which superadmin
            // created it.
            const created = runs.reduce((oldest, r) => (r.createdAt < oldest.createdAt ? r : oldest), runs[0]);
            // Phantom tenants (discovered via core2 with no job row) store the
            // GUID as tenantId and put the human-readable name in displayName.
            const companyLabel = runs[0]?.displayName || displayTenant(tenantId);
            // Epoch sentinel = creation date unknown (predates sentinel tracking)
            const UNKNOWN_DATE = "1970-01-01T00:00:00.000Z";
            const createdUnknown = created.createdAt === UNKNOWN_DATE;
            return (
              <Card
                key={tenantId}
                className="flex flex-col hover:border-[#6BA539]/60 transition-colors cursor-pointer"
                onClick={() => !isProvisionedOnly && setSelectedCompany(tenantId)}
              >
                <CardHeader className="pb-3">
                  <div className="flex items-start justify-between gap-2">
                    <div className="flex items-center gap-2 min-w-0">
                      <div className="w-9 h-9 rounded-md bg-[#6BA539]/15 flex items-center justify-center shrink-0">
                        <Building2 className="w-5 h-5 text-[#6BA539]" />
                      </div>
                      <div className="min-w-0">
                        <CardTitle className="text-base truncate">{companyLabel}</CardTitle>
                        <CardDescription className="text-xs">
                          {isProvisionedOnly ? "No uploads yet" : `${realRuns.length} run${realRuns.length === 1 ? "" : "s"}`}
                        </CardDescription>
                      </div>
                    </div>
                    <div className="flex flex-col items-end gap-1 shrink-0">
                      <StatusBadge status={latest.status} />
                      {!isProvisionedOnly && <WarningsBadge count={latest.warningsCount} />}
                    </div>
                  </div>
                </CardHeader>
                <CardContent className="flex flex-col gap-3 flex-1">
                  {isProvisionedOnly ? (
                    <p className="text-xs text-muted-foreground">
                      Tenant provisioned — ready for first upload.
                    </p>
                  ) : (
                    <>
                      <div className="grid grid-cols-2 gap-3 text-sm">
                        <div>
                          <div className="text-xs text-muted-foreground uppercase tracking-wide">Inserted</div>
                          <div className="font-semibold text-green-500">{inserted}</div>
                        </div>
                        <div>
                          <div className="text-xs text-muted-foreground uppercase tracking-wide">Errors</div>
                          <div className={`font-semibold ${errors > 0 ? "text-red-500" : "text-muted-foreground"}`}>{errors}</div>
                        </div>
                      </div>
                      <div className="text-xs text-muted-foreground">
                        <span className="block truncate font-medium text-foreground/80" title={latest.fileName}>{latest.fileName}</span>
                        Last run {new Date(latest.createdAt).toLocaleString()}
                      </div>
                    </>
                  )}
                  <div className="text-xs text-muted-foreground">
                    {createdUnknown
                      ? "Created: Unknown"
                      : <>Created {new Date(created.createdAt).toLocaleString()}{created.createdBy ? ` by ${created.createdBy}` : ""}</>}
                  </div>
                  <div className="mt-auto pt-2 border-t flex items-center justify-between" onClick={e => e.stopPropagation()}>
                    {isProvisionedOnly ? (
                      <div className="flex items-center gap-1">
                        <Button variant="ghost" size="sm" onClick={() => setInviteTarget({ tenantId })}>
                          <Users className="w-3.5 h-3.5 mr-1.5" /> Invite admin
                        </Button>
                        <Button
                          variant="ghost"
                          size="sm"
                          className="text-red-500 hover:text-red-600 hover:bg-red-50 dark:hover:bg-red-950"
                          onClick={() => handleDeleteOne(tenantId, companyLabel)}
                          disabled={deletingTenantId === tenantId || bulkDeleting}
                        >
                          {deletingTenantId === tenantId ? (
                            <Loader2 className="w-3.5 h-3.5 animate-spin" />
                          ) : (
                            <Trash2 className="w-3.5 h-3.5" />
                          )}
                        </Button>
                      </div>
                    ) : (
                      <div className="flex items-center gap-1">
                        <Button variant="ghost" size="sm" onClick={() => setSelectedCompany(tenantId)}>
                          <List className="w-3.5 h-3.5 mr-1.5" /> View runs
                        </Button>
                        <Button
                          variant="ghost"
                          size="sm"
                          title="Delete this company and ALL its data (incl. user logins)"
                          className="text-red-500 hover:text-red-600 hover:bg-red-50 dark:hover:bg-red-950"
                          onClick={() => handleDeleteWithData(tenantId, companyLabel)}
                          disabled={deletingTenantId === tenantId || bulkDeleting}
                        >
                          {deletingTenantId === tenantId ? (
                            <Loader2 className="w-3.5 h-3.5 animate-spin" />
                          ) : (
                            <Trash2 className="w-3.5 h-3.5" />
                          )}
                        </Button>
                      </div>
                    )}
                    {!isProvisionedOnly && (
                      <RowActions
                        job={latest}
                        onView={() => navigate(`/onboarding/status/${latest.uploadId}`)}
                        onInvite={() => setInviteTarget({ tenantId })}
                        onReimport={mode => reimport(latest, mode)}
                        onDelete={() => deleteRun(latest)}
                        deleting={deletingRunId === latest.uploadId}
                      />
                    )}
                  </div>
                </CardContent>
              </Card>
            );
            })}
          </div>
          )}
        </>
      ) : (
        // ── Regular company user: their own runs ──────────────────────────
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Your Runs</CardTitle>
            <CardDescription>{jobs.length} upload(s) total</CardDescription>
          </CardHeader>
          <CardContent className="p-0">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b text-xs text-muted-foreground uppercase tracking-wide">
                  <th className="text-left px-4 py-3 font-medium">File</th>
                  <th className="text-left px-4 py-3 font-medium">Status</th>
                  <th className="text-left px-4 py-3 font-medium">Mode</th>
                  <th className="text-right px-4 py-3 font-medium">Inserted</th>
                  <th className="text-right px-4 py-3 font-medium">Errors</th>
                  <th className="text-left px-4 py-3 font-medium">Date</th>
                  <th className="text-left px-4 py-3 font-medium">Actions</th>
                </tr>
              </thead>
              <tbody>
                {jobs.map(job => (
                  <tr
                    key={job.uploadId}
                    className="border-b hover:bg-muted/30 transition-colors cursor-pointer"
                    onClick={() => navigate(`/onboarding/status/${job.uploadId}`)}
                  >
                    <td className="px-4 py-3 font-medium max-w-[240px]" onClick={e => e.stopPropagation()}>
                      <EditableFileName
                        uploadId={job.uploadId}
                        displayedName={labelOverrides[job.uploadId] ?? job.fileName}
                        onRename={renameUpload}
                      />
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-1.5 flex-wrap">
                        <StatusBadge status={job.status} />
                        <WarningsBadge count={job.warningsCount} />
                        <NeedsAttentionBadge count={reviewByUpload.get(job.uploadId)} />
                      </div>
                    </td>
                    <td className="px-4 py-3">
                      <ModeBadge mode={job.importMode} />
                    </td>
                    <td className="px-4 py-3 text-right font-semibold">
                      {(job.status === "success" || job.status === "partial") && (job.totalInserted ?? 0) === 0 ? (
                        job.importMode === "update" ? (
                          // Update-mode runs legitimately insert 0 NEW rows while
                          // updating existing records — say exactly that, never
                          // "no data".
                          <span
                            className="text-muted-foreground"
                            title="No new rows were inserted — existing records may have been updated in place (updates aren't counted in this column). Open the run for details."
                          >
                            0 <span className="text-[10px] font-medium uppercase">new</span>
                          </span>
                        ) : (
                          <span
                            className="text-amber-500"
                            title="This run completed but wrote no data rows from the file — only internal setup entries."
                          >
                            0 <span className="text-[10px] font-medium uppercase">no data</span>
                          </span>
                        )
                      ) : (
                        <span className="text-green-500">{job.totalInserted ?? "—"}</span>
                      )}
                    </td>
                    <td className={`px-4 py-3 text-right font-semibold ${(job.totalErrors ?? 0) > 0 ? "text-red-500" : "text-muted-foreground"}`}>
                      {job.totalErrors ?? "—"}
                    </td>
                    <td className="px-4 py-3 text-muted-foreground text-xs">
                      {new Date(job.createdAt).toLocaleString()}
                    </td>
                    <td className="px-4 py-3" onClick={e => e.stopPropagation()}>
                      <RowActions
                        job={job}
                        onView={() => navigate(`/onboarding/status/${job.uploadId}`)}
                        onInvite={() => setInviteTarget({ tenantId: job.tenantId })}
                        onReimport={mode => reimport(job, mode)}
                        onDelete={() => deleteRun(job)}
                        deleting={deletingRunId === job.uploadId}
                      />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </CardContent>
        </Card>
      )}

      <InviteMembersDialog
        tenantId={inviteTarget?.tenantId ?? ""}
        tenantLabel={inviteTarget?.tenantId}
        open={!!inviteTarget}
        onOpenChange={open => !open && setInviteTarget(null)}
      />
    </div>
  );
}
