import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Loader2, Search } from "lucide-react";
import {
  getModuleRecords,
  getProjectDetails,
  getProjectTeam,
  getTaskData,
  tenantScopedKey,
  type LiveResourceProxy,
} from "@/lib/api";
import {
  firstQuickString,
  mapQuickModuleRecord,
  quickExistingAllocations,
  type QuickSearchItem,
} from "@/lib/quickActions";
import { derivePlannerSchedule } from "@/lib/phaseHours";
import { AddTeamMemberModal } from "@/components/AddTeamMemberModal";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

export type StaffAssignmentTarget = "PMM" | "OPM" | "LEM";

const META: Record<StaffAssignmentTarget, { label: string; noun: string }> = {
  PMM: { label: "Add to project", noun: "project" },
  OPM: { label: "Add to opportunity", noun: "opportunity" },
  LEM: { label: "Add to lead", noun: "lead" },
};

function unwrapRecordFields(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  const record = value as Record<string, unknown>;
  if (record.Status === true && record.Data && typeof record.Data === "object" && !Array.isArray(record.Data)) {
    return record.Data as Record<string, unknown>;
  }
  return record;
}

export function StaffRecordAssignmentModal({
  target,
  resource,
  onClose,
  onAssigned,
}: {
  target: StaffAssignmentTarget;
  resource: LiveResourceProxy;
  onClose: () => void;
  onAssigned: () => void;
}) {
  const [query, setQuery] = useState("");
  const [pickedRecord, setPickedRecord] = useState<QuickSearchItem | null>(null);
  const meta = META[target];

  const recordsQuery = useQuery({
    queryKey: [tenantScopedKey("resource-staff-assignment-records"), target],
    queryFn: () => getModuleRecords(target),
    staleTime: 300_000,
  });

  const matches = useMemo(() => {
    const rows = ((recordsQuery.data?.data ?? []) as Record<string, unknown>[])
      .map((record) => mapQuickModuleRecord(record, target))
      .filter((record) => record.id && record.title);
    const needle = query.trim().toLowerCase();
    return (needle
      ? rows.filter((record) =>
          [record.id, record.title, record.client].some((value) =>
            (value ?? "").toLowerCase().includes(needle),
          ))
      : rows
    ).slice(0, 30);
  }, [query, recordsQuery.data, target]);

  const prepQuery = useQuery({
    queryKey: ["resources", "staff-assignment-prep", target, pickedRecord?.id ?? ""],
    enabled: pickedRecord !== null,
    staleTime: 0,
    queryFn: async () => {
      if (!pickedRecord) throw new Error("No record selected.");
      const [detailsRaw, team, tasks] = await Promise.all([
        getProjectDetails(pickedRecord.id, { module: target, fresh: true }),
        getProjectTeam(pickedRecord.id, true),
        target === "LEM" ? Promise.resolve(null) : getTaskData(pickedRecord.id, "0").catch(() => null),
      ]);
      let bounds = { start: "", end: "" };
      if (tasks) {
        const schedule = derivePlannerSchedule(tasks);
        if (schedule.state === "ready" && schedule.phases.length > 0) {
          bounds = {
            start: schedule.phases.reduce(
              (earliest, phase) => phase.start && phase.start < earliest ? phase.start : earliest,
              schedule.phases[0].start,
            ),
            end: schedule.phases.reduce(
              (latest, phase) => phase.end && phase.end > latest ? phase.end : latest,
              schedule.phases[0].end,
            ),
          };
        }
      }
      return { details: unwrapRecordFields(detailsRaw), team, bounds };
    },
  });

  const closeAll = () => {
    setPickedRecord(null);
    onClose();
  };
  const today = new Date().toISOString().slice(0, 10);
  const oneYear = new Date(Date.now() + 365 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
  const targetStart = prepQuery.data
    ? firstQuickString(prepQuery.data.details.TargetStartDate).slice(0, 10)
    : "";
  const targetEnd = prepQuery.data
    ? firstQuickString(prepQuery.data.details.TargetCompletionDate).slice(0, 10)
    : "";

  return (
    <>
      <Dialog open={!pickedRecord || !prepQuery.data} onOpenChange={(open) => { if (!open) closeAll(); }}>
        <DialogContent className="max-w-2xl" data-testid="resources-staff-record-picker">
          <DialogHeader>
            <DialogTitle>{meta.label}</DialogTitle>
            <DialogDescription>
              Pick the {meta.noun} for {resource.name}. Their staff details will be prefilled.
            </DialogDescription>
          </DialogHeader>

          {pickedRecord ? (
            prepQuery.isError ? (
              <div className="rounded-xl border border-[var(--rm-panel-border)] bg-[var(--rm-bg)] p-5 text-sm text-[var(--rm-text-muted)]">
                <p>We couldn’t prepare {pickedRecord.title}. No changes were made.</p>
                <div className="mt-3 flex gap-2">
                  <button type="button" onClick={() => void prepQuery.refetch()} className="rounded-lg bg-[var(--rm-green)] px-4 py-2 font-bold text-white">Try again</button>
                  <button type="button" onClick={() => setPickedRecord(null)} className="rounded-lg border border-[var(--rm-panel-border)] px-4 py-2 font-bold">Pick another</button>
                </div>
              </div>
            ) : (
              <div className="flex min-h-[140px] flex-col items-center justify-center gap-3 text-sm text-[var(--rm-text-muted)]">
                <Loader2 className="h-6 w-6 animate-spin text-[var(--rm-green)]" />
                Preparing {pickedRecord.title}…
              </div>
            )
          ) : (
            <>
              <div className="relative">
                <Search className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-[var(--rm-text-faint)]" />
                <input
                  autoFocus
                  value={query}
                  onChange={(event) => setQuery(event.target.value)}
                  placeholder={`Search ${meta.noun}s by name, ID, or client…`}
                  className="w-full rounded-xl border border-[var(--rm-panel-border)] bg-[var(--rm-bg)] py-2.5 pl-10 pr-4 text-sm outline-none focus:border-[var(--rm-green)]"
                />
              </div>
              <div className="mt-3 max-h-[58vh] overflow-y-auto">
                {recordsQuery.isLoading ? (
                  <div className="flex min-h-[140px] items-center justify-center"><Loader2 className="h-6 w-6 animate-spin text-[var(--rm-green)]" /></div>
                ) : recordsQuery.isError ? (
                  <div className="rounded-xl border border-[var(--rm-panel-border)] bg-[var(--rm-bg)] p-5 text-sm text-[var(--rm-text-muted)]">We couldn’t load the list. Try again.</div>
                ) : matches.length === 0 ? (
                  <div className="rounded-xl border border-[var(--rm-panel-border)] bg-[var(--rm-bg)] p-5 text-sm text-[var(--rm-text-muted)]">No matching {meta.noun}s found.</div>
                ) : (
                  <div className="grid gap-2">
                    {matches.map((record) => (
                      <button
                        key={record.id}
                        type="button"
                        onClick={() => setPickedRecord(record)}
                        className="flex w-full items-center gap-3 rounded-xl border border-[var(--rm-panel-border)] bg-[var(--rm-bg)] p-3 text-left transition hover:border-[var(--rm-green)] hover:shadow-sm"
                      >
                        <span className="min-w-0 flex-1">
                          <span className="block truncate text-sm font-bold text-[var(--rm-text)]">{record.title}</span>
                          <span className="mt-0.5 block truncate font-mono text-[11px] text-[var(--rm-text-faint)]">{record.id}{record.client ? ` · ${record.client}` : ""}</span>
                        </span>
                        {record.status ? <span className="shrink-0 text-xs text-[var(--rm-text-muted)]">{record.status}</span> : null}
                      </button>
                    ))}
                  </div>
                )}
              </div>
            </>
          )}
        </DialogContent>
      </Dialog>

      {pickedRecord && prepQuery.data && (
        <AddTeamMemberModal
          open
          onClose={closeAll}
          projectId={pickedRecord.id}
          module={target}
          projectName={pickedRecord.title}
          projectStartDate={prepQuery.data.bounds.start || targetStart || today}
          projectEndDate={prepQuery.data.bounds.end || targetEnd || oneYear}
          scheduleStart={prepQuery.data.bounds.start || undefined}
          scheduleEnd={prepQuery.data.bounds.end || undefined}
          existingAllocations={quickExistingAllocations(prepQuery.data.team.team)}
          openRoles={prepQuery.data.team.openRoles}
          seedPersonId={resource.id || undefined}
          personOnly={target === "LEM"}
          onAssigned={() => {
            onAssigned();
            closeAll();
          }}
        />
      )}
    </>
  );
}