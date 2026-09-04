/**
 * Superadmin Recycle Bin — lists recently soft-deleted records (PMM / OPM / LEM)
 * for the current tenant and lets superadmins restore them.
 *
 * Gate: only visible to root-allowlist accounts (isSuperAdmin). The server
 * enforces the same gate on both /deleted-records and /restore-record, so a
 * user who circumvents the client nav is still blocked at the API.
 *
 * Note: PMMTasks (schedule / task dates) were HARD-deleted and cannot be
 * recovered. The restore UI makes this explicit before the user confirms.
 */
import React, { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  RotateCcw, Trash2, AlertTriangle, RefreshCw,
  Search, ChevronDown, Info,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle,
  DialogDescription, DialogFooter,
} from "@/components/ui/dialog";
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useToast } from "@/hooks/use-toast";
import { listDeletedRecords, restoreRecord, type DeletedRecord } from "@/lib/api";

// ── helpers ───────────────────────────────────────────────────────────────────

function moduleLabel(mod: string): string {
  if (mod === "PMM") return "Project";
  if (mod === "OPM") return "Opportunity";
  if (mod === "LEM") return "Lead";
  return mod;
}

function moduleBadgeColor(mod: string): string {
  if (mod === "PMM") return "bg-blue-100 text-blue-800 dark:bg-blue-900/40 dark:text-blue-200";
  if (mod === "OPM") return "bg-purple-100 text-purple-800 dark:bg-purple-900/40 dark:text-purple-200";
  if (mod === "LEM") return "bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-200";
  return "";
}

function formatDeletedAt(iso: string | null): string {
  if (!iso) return "Unknown (pre-migration)";
  try {
    return new Date(iso).toLocaleString(undefined, {
      year: "numeric", month: "short", day: "numeric",
      hour: "2-digit", minute: "2-digit",
    });
  } catch {
    return iso;
  }
}

const DAY_OPTIONS = [
  { label: "Last 30 days",  value: 30  },
  { label: "Last 90 days",  value: 90  },
  { label: "Last 180 days", value: 180 },
  { label: "Last year",     value: 365 },
  { label: "All time",      value: 3650 },
];

const MODULE_OPTIONS: { label: string; value: "PMM" | "OPM" | "LEM" | "" }[] = [
  { label: "All modules",    value: ""    },
  { label: "Projects",       value: "PMM" },
  { label: "Opportunities",  value: "OPM" },
  { label: "Leads",          value: "LEM" },
];

// ── component ────────────────────────────────────────────────────────────────

export default function SuperadminRecycleBinPage() {
  const { toast } = useToast();
  const qc = useQueryClient();

  const [days, setDays] = useState(90);
  const [modFilter, setModFilter] = useState<"PMM" | "OPM" | "LEM" | "">("");
  const [search, setSearch] = useState("");
  const [restoring, setRestoring] = useState<DeletedRecord | null>(null);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [restoreInProgress, setRestoreInProgress] = useState(false);

  // ── data ──────────────────────────────────────────────────────────────────

  const queryKey = ["deleted-records", days, modFilter];
  const { data, isLoading, isError, refetch } = useQuery({
    queryKey,
    queryFn: () => listDeletedRecords({
      days,
      module: modFilter || undefined,
    }),
    staleTime: 30_000,
  });

  // ── filtering (client-side search) ───────────────────────────────────────

  const rows: DeletedRecord[] = data ?? [];
  const q = search.trim().toLowerCase();
  const filtered = q
    ? rows.filter(
        (r) =>
          r.ticketId.toLowerCase().includes(q) ||
          r.title.toLowerCase().includes(q) ||
          moduleLabel(r.module).toLowerCase().includes(q),
      )
    : rows;

  // ── restore flow ─────────────────────────────────────────────────────────

  function requestRestore(row: DeletedRecord) {
    setRestoring(row);
    setConfirmOpen(true);
  }

  async function handleConfirmRestore() {
    if (!restoring) return;
    setRestoreInProgress(true);
    try {
      const result = await restoreRecord(restoring.id, restoring.module);
      toast({
        title: "Record Restored",
        description: `"${result.title}" (${result.ticketId}) has been restored with ${result.allocations} allocation${result.allocations !== 1 ? "s" : ""} and ${result.workItems} team member${result.workItems !== 1 ? "s" : ""}. The schedule was not recovered.`,
      });
      setConfirmOpen(false);
      setRestoring(null);
      // Remove from list immediately then refetch to reflect server state.
      void qc.invalidateQueries({ queryKey });
      void refetch();
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : "Could not restore the record.";
      // Conflict (409) surfaces a clear user-facing message.
      const isConflict =
        typeof msg === "string" &&
        (msg.includes("already exists") || msg.includes("conflict"));
      toast({
        title: isConflict ? "Cannot Restore" : "Restore Failed",
        description: isConflict
          ? msg
          : `Restore failed: ${msg}`,
        variant: "destructive",
      });
      if (isConflict) {
        setConfirmOpen(false);
        setRestoring(null);
      }
    } finally {
      setRestoreInProgress(false);
    }
  }

  // ── render ────────────────────────────────────────────────────────────────

  const selectedDayOpt  = DAY_OPTIONS.find((o) => o.value === days)  ?? DAY_OPTIONS[1];
  const selectedModOpt  = MODULE_OPTIONS.find((o) => o.value === modFilter) ?? MODULE_OPTIONS[0];

  return (
    <div className="p-6 max-w-5xl mx-auto space-y-6">
      {/* Header */}
      <div className="flex items-center gap-3">
        <div className="p-2 rounded-lg bg-rose-100 dark:bg-rose-900/30">
          <Trash2 className="w-5 h-5 text-rose-600 dark:text-rose-400" />
        </div>
        <div>
          <h1 className="text-xl font-semibold text-foreground">Recycle Bin</h1>
          <p className="text-sm text-muted-foreground">
            Recently deleted projects, opportunities, and leads. Restoring a record also
            recovers its team assignments — but <strong>not</strong> its schedule.
          </p>
        </div>
      </div>

      {/* Schedule warning banner */}
      <div className="flex items-start gap-2 rounded-lg border border-amber-200 bg-amber-50 dark:border-amber-800 dark:bg-amber-950/30 px-4 py-3 text-sm text-amber-800 dark:text-amber-200">
        <Info className="w-4 h-4 mt-0.5 shrink-0" />
        <span>
          <strong>Schedule cannot be recovered.</strong> When a record is deleted, its
          task dates and phases are permanently removed. Restoring brings back the record
          and its team assignments only.
        </span>
      </div>

      {/* Toolbar */}
      <div className="flex flex-wrap items-center gap-2">
        {/* Search */}
        <div className="relative flex-1 min-w-48">
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground pointer-events-none" />
          <Input
            className="pl-8 h-8 text-sm"
            placeholder="Search by title or ticket ID…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>

        {/* Module filter */}
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="outline" size="sm" className="h-8 text-xs gap-1">
              {selectedModOpt.label}
              <ChevronDown className="w-3 h-3" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            {MODULE_OPTIONS.map((o) => (
              <DropdownMenuItem key={o.value} onClick={() => setModFilter(o.value)}>
                {o.label}
              </DropdownMenuItem>
            ))}
          </DropdownMenuContent>
        </DropdownMenu>

        {/* Date window */}
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="outline" size="sm" className="h-8 text-xs gap-1">
              {selectedDayOpt.label}
              <ChevronDown className="w-3 h-3" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            {DAY_OPTIONS.map((o) => (
              <DropdownMenuItem key={o.value} onClick={() => setDays(o.value)}>
                {o.label}
              </DropdownMenuItem>
            ))}
          </DropdownMenuContent>
        </DropdownMenu>

        {/* Refresh */}
        <Button
          variant="outline"
          size="sm"
          className="h-8 w-8 p-0"
          onClick={() => void refetch()}
          title="Refresh list"
        >
          <RefreshCw className="w-3.5 h-3.5" />
        </Button>
      </div>

      {/* Table */}
      <div className="rounded-lg border border-border overflow-hidden">
        {isLoading ? (
          <div className="flex items-center justify-center py-16 text-sm text-muted-foreground">
            Loading deleted records…
          </div>
        ) : isError ? (
          <div className="flex items-center justify-center gap-2 py-16 text-sm text-destructive">
            <AlertTriangle className="w-4 h-4" />
            Failed to load deleted records. Check server logs.
          </div>
        ) : filtered.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-16 gap-2 text-sm text-muted-foreground">
            <Trash2 className="w-8 h-8 opacity-30" />
            {rows.length === 0
              ? `No deleted records found in the last ${selectedDayOpt.label.toLowerCase()}.`
              : "No results match your search."}
          </div>
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border bg-muted/40">
                <th className="px-4 py-2.5 text-left font-medium text-muted-foreground w-32">Ticket ID</th>
                <th className="px-4 py-2.5 text-left font-medium text-muted-foreground">Title</th>
                <th className="px-4 py-2.5 text-left font-medium text-muted-foreground w-28">Module</th>
                <th className="px-4 py-2.5 text-left font-medium text-muted-foreground w-44">Deleted</th>
                <th className="px-4 py-2.5 text-right font-medium text-muted-foreground w-24">Action</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((row, idx) => (
                <tr
                  key={`${row.module}-${row.id}`}
                  className={`border-b border-border last:border-0 ${
                    idx % 2 === 0 ? "" : "bg-muted/20"
                  }`}
                >
                  <td className="px-4 py-2.5 font-mono text-xs text-muted-foreground">
                    {row.ticketId}
                  </td>
                  <td className="px-4 py-2.5 font-medium max-w-xs truncate" title={row.title}>
                    {row.title || <span className="text-muted-foreground italic">Untitled</span>}
                  </td>
                  <td className="px-4 py-2.5">
                    <span className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-medium ${moduleBadgeColor(row.module)}`}>
                      {moduleLabel(row.module)}
                    </span>
                  </td>
                  <td className="px-4 py-2.5 text-xs text-muted-foreground whitespace-nowrap">
                    {row.deletedAt === null ? (
                      <span title="Deleted before the restore feature was added — team assignments will be restored but the timestamp window cannot be used for generation-scoping.">
                        Unknown <span className="text-amber-500">⚠</span>
                      </span>
                    ) : (
                      formatDeletedAt(row.deletedAt)
                    )}
                  </td>
                  <td className="px-4 py-2.5 text-right">
                    <Button
                      variant="outline"
                      size="sm"
                      className="h-7 text-xs gap-1 text-emerald-700 border-emerald-300 hover:bg-emerald-50 dark:text-emerald-400 dark:border-emerald-700 dark:hover:bg-emerald-950/40"
                      onClick={() => requestRestore(row)}
                    >
                      <RotateCcw className="w-3 h-3" />
                      Restore
                    </Button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {/* Count */}
      {!isLoading && !isError && filtered.length > 0 && (
        <p className="text-xs text-muted-foreground text-right">
          {filtered.length} record{filtered.length !== 1 ? "s" : ""}
          {q ? ` matching "${search}"` : ""}
        </p>
      )}

      {/* Confirm restore dialog */}
      <Dialog open={confirmOpen} onOpenChange={(open) => { if (!restoreInProgress) setConfirmOpen(open); }}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <RotateCcw className="w-4 h-4 text-emerald-600" />
              Restore Record?
            </DialogTitle>
            <DialogDescription asChild>
              <div className="space-y-3 pt-1">
                <p>
                  This will restore <strong>{restoring?.title || restoring?.ticketId}</strong>{" "}
                  ({restoring?.ticketId}) and its team assignments.
                </p>
                <div className="flex items-start gap-2 rounded-md border border-amber-200 bg-amber-50 dark:border-amber-800 dark:bg-amber-950/40 px-3 py-2 text-xs text-amber-800 dark:text-amber-200">
                  <AlertTriangle className="w-3.5 h-3.5 mt-0.5 shrink-0" />
                  <span>
                    <strong>Schedule not recovered.</strong> The task dates and phases for
                    this record were permanently deleted and cannot be restored. The record
                    will reappear without a schedule.
                  </span>
                </div>
                {restoring?.deletedAt === null && (
                  <div className="flex items-start gap-2 rounded-md border border-amber-200 bg-amber-50 dark:border-amber-800 dark:bg-amber-950/40 px-3 py-2 text-xs text-amber-800 dark:text-amber-200">
                    <AlertTriangle className="w-3.5 h-3.5 mt-0.5 shrink-0" />
                    <span>
                      <strong>Pre-migration delete.</strong> The exact deletion time is
                      unknown, so <em>all</em> deleted team assignments for this ticket ID
                      will be restored — including any from earlier deleted generations.
                    </span>
                  </div>
                )}
              </div>
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button
              variant="outline"
              size="sm"
              disabled={restoreInProgress}
              onClick={() => setConfirmOpen(false)}
            >
              Cancel
            </Button>
            <Button
              size="sm"
              disabled={restoreInProgress}
              className="gap-1.5 bg-emerald-600 hover:bg-emerald-700 text-white"
              onClick={() => void handleConfirmRestore()}
            >
              {restoreInProgress ? (
                <>
                  <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                  Restoring…
                </>
              ) : (
                <>
                  <RotateCcw className="w-3.5 h-3.5" />
                  Restore Record
                </>
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
