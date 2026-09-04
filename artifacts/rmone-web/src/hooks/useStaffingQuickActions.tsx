// ── useStaffingQuickActions ──────────────────────────────────────────────────
// Shared staffing quick actions for RiskSidePanel footers on the Alerts page
// and the Daily Briefing. Mirrors the home page's behavior exactly:
//
//  - demand-coverage rows → "Add Team Member", prefilled with the SELECTED
//    row's project + role and carrying that row's exact open-slot RA id
//    (_raId). The save then consumes that precise position regardless of the
//    chosen person's own job title — never "Add Open Position", which would
//    create yet another unfilled slot on a project already short of people.
//  - over-allocation rows → "Edit Allocation", opening the team-grid popup
//    for the selected person's project so hours can be rebalanced in place.
//
// The home page (RoleHome) keeps its own copy of this wiring because its
// onAssigned additionally retires the consumed rows from the in-memory home
// overlay. Keep the row-parsing rules here in lockstep with RoleHome's
// selectedProject()/demandRaId()/recoverUniqueOpenSlotRaIds().

import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { AddTeamMemberModal } from "@/components/AddTeamMemberModal";
import { AddOpenPositionModal } from "@/components/AddOpenPositionModal";
import { QuickActionsTeamModal } from "@/components/QuickActionsTeamModal";
import { ExistingWorkTimelineModal } from "@/components/ExistingWorkTimelineModal";
import {
  getProjectDetails, getProjectTeam, getTaskData,
  getResourceAllocations, getResourceWeekAllocations,
} from "@/lib/api";
import { derivePlannerSchedule } from "@/lib/phaseHours";
import { firstQuickString, quickExistingAllocations } from "@/lib/quickActions";

export type PanelQuickAction = {
  label: string;
  onClick: (row: Record<string, string | number> | null) => void;
};

type PanelRow = Record<string, string | number> | null;

function unwrapRecordFields(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  const record = value as Record<string, unknown>;
  if (record.Status === true && record.Data && typeof record.Data === "object" && !Array.isArray(record.Data)) {
    return record.Data as Record<string, unknown>;
  }
  return record;
}

function rowRaId(value: unknown): number | null {
  const id = Number(value);
  return Number.isInteger(id) && id > 0 ? id : null;
}

/** Recover an exact open-slot ID only for alert rows cached before they began
 * carrying _raId. More than one matching role is deliberately left untouched:
 * the user must choose a particular slot rather than silently retiring a
 * different position with the same label. */
function recoverUniqueSlotRaIds(
  openRoles: readonly { role?: string; title?: string; raIds?: number[] }[] | undefined,
  role: string,
): number[] | undefined {
  const normalized = role.trim().toLowerCase().replace(/\s*\(\d+\)$/, "").replace(/\s+/g, " ");
  if (!normalized || !openRoles) return undefined;
  const matches = openRoles.filter((slot) =>
    [slot.role, slot.title].some((label) =>
      String(label ?? "").trim().toLowerCase().replace(/\s*\(\d+\)$/, "").replace(/\s+/g, " ") === normalized,
    ) && (slot.raIds?.length ?? 0) > 0,
  );
  return matches.length === 1 ? matches[0].raIds : undefined;
}

export function useStaffingQuickActions(opts: { onNavigate: (to: string) => void }) {
  const { onNavigate } = opts;

  const [qaOpenPos, setQaOpenPos] = useState<{ projectId: string; projectName: string } | null>(null);
  const [qaAddMember, setQaAddMember] = useState<{
    projectId: string;
    projectName: string;
    role: string;
    consumeRaIds?: number[];
  } | null>(null);
  const qaAddMemberPrepQuery = useQuery({
    queryKey: ["staffing-qa", "add-member-prep", qaAddMember?.projectId ?? ""],
    enabled: qaAddMember !== null,
    staleTime: 0,
    refetchOnMount: "always",
    queryFn: async () => {
      const target = qaAddMember;
      if (!target) throw new Error("No project selected for adding a team member.");
      const module = /^OPM(?:[-_]|$)/i.test(target.projectId) ? "OPM" : "PMM";
      const [details, team, tasks] = await Promise.all([
        getProjectDetails(target.projectId, { module, fresh: true }),
        getProjectTeam(target.projectId, true),
        getTaskData(target.projectId, "0").catch(() => null),
      ]);
      const fields = unwrapRecordFields(details);
      let scheduleBounds = { start: "", end: "" };
      if (tasks) {
        const schedule = derivePlannerSchedule(tasks);
        if (schedule.state === "ready" && schedule.phases.length > 0) {
          scheduleBounds = {
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
      return {
        team,
        openRoles: team.openRoles,
        scheduleBounds,
        targetStart: firstQuickString(fields.TargetStartDate).slice(0, 10),
        targetEnd: firstQuickString(fields.TargetCompletionDate).slice(0, 10),
      };
    },
  });
  // New alert rows carry an explicit RA id. The recovery narrowly supports a
  // panel that was already in memory before that payload shape existed.
  const qaAddMemberConsumeRaIds = qaAddMember?.consumeRaIds
    ?? recoverUniqueSlotRaIds(qaAddMemberPrepQuery.data?.openRoles, qaAddMember?.role ?? "");

  const [qaTeamModal, setQaTeamModal] = useState<{
    projectId: string; projectName: string; module: "PMM" | "OPM";
  } | null>(null);
  // Multi-project overloads must be rebalanced against the person's WHOLE
  // workload. Keep that timeline as a modal over the alert page — navigating
  // to Resources loses the risk context and made this action feel broken.
  const [qaTimeline, setQaTimeline] = useState<{ personName: string; personId?: string } | null>(null);
  const qaTimelineResourceQuery = useQuery({
    queryKey: ["staffing-qa", "overload-resource", qaTimeline?.personId ?? "", qaTimeline?.personName ?? ""],
    enabled: qaTimeline !== null,
    staleTime: 60_000,
    queryFn: async () => {
      const personId = qaTimeline?.personId?.trim().toLowerCase();
      const name = qaTimeline?.personName.trim().toLowerCase();
      if (!personId && !name) return null;
      const response = await getResourceAllocations();
      if (personId) {
        const exact = response.resources.find((resource) =>
          String(resource.id ?? "").trim().toLowerCase() === personId ||
          String(resource.username ?? "").trim().toLowerCase() === personId,
        );
        if (exact) return exact;
      }
      // Legacy cards did not contain the stable id. Refuse a non-unique
      // display-name match rather than editing another person with the same
      // name; newly built alert rows always take the GUID-first branch.
      const named = response.resources.filter((resource) =>
        String(resource.name ?? "").trim().toLowerCase() === name,
      );
      return named.length === 1 ? named[0] : null;
    },
  });
  const qaTimelineWorkloadQuery = useQuery({
    queryKey: ["staffing-qa", "overload-workload", qaTimelineResourceQuery.data?.id ?? ""],
    enabled: qaTimeline !== null && !!qaTimelineResourceQuery.data?.id,
    staleTime: 0,
    queryFn: () => {
      const start = new Date(); start.setFullYear(start.getFullYear() - 1);
      const end = new Date(); end.setFullYear(end.getFullYear() + 1);
      return getResourceWeekAllocations(
        qaTimelineResourceQuery.data!.id,
        start.toISOString().slice(0, 10),
        end.toISOString().slice(0, 10),
      );
    },
  });
  const qaTeamModalQuery = useQuery({
    queryKey: ["staffing-qa", "team-modal", qaTeamModal?.projectId ?? ""],
    enabled: qaTeamModal !== null,
    staleTime: 0,
    refetchOnMount: "always",
    queryFn: async () => {
      const target = qaTeamModal;
      if (!target) throw new Error("No project selected for team modal.");
      const [team, tasks] = await Promise.all([
        getProjectTeam(target.projectId, true),
        getTaskData(target.projectId, "0").catch(() => null),
      ]);
      let scheduleBounds = { start: "", end: "" };
      if (tasks) {
        const schedule = derivePlannerSchedule(tasks);
        if (schedule.state === "ready" && schedule.phases.length > 0) {
          scheduleBounds = {
            start: schedule.phases.reduce(
              (e, p) => p.start && p.start < e ? p.start : e,
              schedule.phases[0].start,
            ),
            end: schedule.phases.reduce(
              (l, p) => p.end && p.end > l ? p.end : l,
              schedule.phases[0].end,
            ),
          };
        }
      }
      return { team, scheduleBounds };
    },
  });

  /** Footer quick actions for a risk side panel, keyed on the classified risk
   *  kind. Returns undefined for kinds with no direct staffing action. */
  const quickActionsFor = (
    riskKind: string | null | undefined,
    closePanel: () => void,
  ): PanelQuickAction[] | undefined => {
    if (riskKind === "demand-coverage") {
      return [
        {
          label: "Add Team Member",
          onClick: (row: PanelRow) => {
            const raId = rowRaId(row?.["_raId"]) ?? rowRaId(row?.["RaId"]) ?? rowRaId(row?.["RAId"]);
            const projectId = String(row?.ticket ?? row?.["_ticket"] ?? "").trim();
            const projectName = String(row?.title ?? row?.record ?? "").trim();
            const role = String(row?.role ?? row?.["Role"] ?? "").trim();
            if (!projectId || projectId === "—") {
              // Role-aggregate rows spanning several projects carry no
              // single position id. Never no-op: route to the demand book
              // so the operator can pick the exact position there.
              closePanel();
              onNavigate("/resources?view=Demand");
              return;
            }
            // The add-member workspace is its own modal. Close the alert
            // panel first so the chooser is never nested behind a dimmed
            // risk popup.
            closePanel();
            setQaAddMember({
              projectId,
              projectName,
              role,
              // The operator selected this exact demand row. Preserve its ID
              // all the way through save instead of later matching the newly
              // added member's role against open positions.
              ...(raId !== null ? { consumeRaIds: [raId] } : {}),
            });
          },
        },
      ];
    }
    // Over-allocation risks → Edit Allocation. Single-project rows use
    // _ticket; multi-project rows use _firstTicket so their person-level
    // timeline link remains intact. Keep the label parser only as a
    // compatibility fallback for older/custom row payloads.
    if (riskKind === "over-allocation") {
      return [
        {
          label: "Edit Allocation",
          onClick: (row: PanelRow) => {
            if (!row) return;
            // A person over-allocated across SEVERAL projects can't be
            // rebalanced inside one project's team grid — open their full
            // timeline popup instead (all projects side by side, weekly
            // hours editable, over weeks highlighted). Single-project rows
            // keep the direct team-grid popup.
            const singleTicket = String(row["_ticket"] ?? "").trim();
            const person = String(row["_person"] ?? row["person"] ?? "").trim();
            const personId = String(row["_personId"] ?? "").trim();
            if ((!singleTicket || singleTicket === "—") && person && person !== "—") {
              closePanel();
              setQaTimeline({ personName: person, ...(personId ? { personId } : {}) });
              return;
            }
            let projectId = singleTicket || String(row["_firstTicket"] ?? "").trim();
            if (!projectId || projectId === "—") {
              const m = String(row["projects"] ?? "").match(/([A-Z]{2,6}-\d{2,4}-\d{1,8})/);
              projectId = m?.[1] ?? "";
            }
            if (!projectId) return;
            const module = /^OPM(?:[-_]|$)/i.test(projectId) ? "OPM" : "PMM";
            const projectName = String(row["title"] ?? row["record"] ?? row["project"] ?? projectId).trim();
            closePanel();
            setQaTeamModal({ projectId, projectName, module });
          },
        },
      ];
    }
    return undefined;
  };

  const modals = (
    <>
      {qaOpenPos && (
        <AddOpenPositionModal
          open
          onClose={() => setQaOpenPos(null)}
          projectId={qaOpenPos.projectId}
          projectName={qaOpenPos.projectName}
          defaultStartDate=""
          defaultEndDate=""
          onCreated={() => setQaOpenPos(null)}
        />
      )}

      {qaTeamModal && (
        <QuickActionsTeamModal
          open
          projectId={qaTeamModal.projectId}
          projectName={qaTeamModal.projectName || qaTeamModal.projectId}
          module={qaTeamModal.module}
          projectStartDate={
            qaTeamModalQuery.data?.scheduleBounds.start ||
            new Date().toISOString().slice(0, 10)
          }
          projectEndDate={
            qaTeamModalQuery.data?.scheduleBounds.end ||
            new Date(new Date().setFullYear(new Date().getFullYear() + 1)).toISOString().slice(0, 10)
          }
          scheduleStart={qaTeamModalQuery.data?.scheduleBounds.start || undefined}
          scheduleEnd={qaTeamModalQuery.data?.scheduleBounds.end || undefined}
          team={qaTeamModalQuery.data?.team.team ?? []}
          openRoles={qaTeamModalQuery.data?.team.openRoles ?? []}
          existingAllocations={quickExistingAllocations(qaTeamModalQuery.data?.team.team ?? [])}
          canEdit
          canManageStaff
          onClose={() => setQaTeamModal(null)}
          onOpenProject={() => {
            const projectId = qaTeamModal.projectId;
            setQaTeamModal(null);
            onNavigate(`/project/${encodeURIComponent(projectId)}`);
          }}
          onReload={() => { void qaTeamModalQuery.refetch(); }}
          onAddMember={(seed) => {
            // The full member picker is a child workspace, not an overlay on
            // top of the team-grid popup. Close the grid before opening it.
            setQaTeamModal(null);
            setQaAddMember({
              projectId: qaTeamModal.projectId,
              projectName: qaTeamModal.projectName,
              role: seed?.title ?? "",
            });
          }}
          onMemberAdded={() => { void qaTeamModalQuery.refetch(); }}
          onAddOpenPosition={() => {
            setQaOpenPos({
              projectId: qaTeamModal.projectId,
              projectName: qaTeamModal.projectName,
            });
          }}
        />
      )}

      {qaTimeline && qaTimelineResourceQuery.data && (
        <ExistingWorkTimelineModal
          personName={qaTimelineResourceQuery.data.name || qaTimeline.personName}
          personId={qaTimelineResourceQuery.data.id}
          personRole={qaTimelineResourceQuery.data.roleName || qaTimelineResourceQuery.data.role || ""}
          workload={qaTimelineWorkloadQuery.data ?? null}
          weekStarts={(qaTimelineWorkloadQuery.data?.weeks ?? []).map((week) => week.weekStart)}
          canEdit
          variant="resource"
          onClose={() => setQaTimeline(null)}
          onOpenProject={(projectId) => {
            setQaTimeline(null);
            onNavigate(`/project/${encodeURIComponent(projectId)}`);
          }}
          onSaved={() => { void qaTimelineWorkloadQuery.refetch(); }}
        />
      )}

      {qaAddMember && (
        <AddTeamMemberModal
          key={`${qaAddMember.projectId}:${qaAddMember.consumeRaIds?.join(",") ?? qaAddMember.role}`}
          open
          onClose={() => setQaAddMember(null)}
          projectId={qaAddMember.projectId}
          // Same OPM-vs-PMM inference this flow already uses for its prep
          // fetch of this exact record — keeps the modal's window rule
          // consistent with the data it displays.
          module={/^OPM(?:[-_]|$)/i.test(qaAddMember.projectId) ? "OPM" : "PMM"}
          projectName={qaAddMember.projectName || qaAddMember.projectId}
          projectStartDate={
            qaAddMemberPrepQuery.data?.scheduleBounds.start ||
            qaAddMemberPrepQuery.data?.targetStart ||
            new Date().toISOString().slice(0, 10)
          }
          projectEndDate={
            qaAddMemberPrepQuery.data?.scheduleBounds.end ||
            qaAddMemberPrepQuery.data?.targetEnd ||
            new Date(new Date().setFullYear(new Date().getFullYear() + 1)).toISOString().slice(0, 10)
          }
          scheduleStart={qaAddMemberPrepQuery.data?.scheduleBounds.start || undefined}
          scheduleEnd={qaAddMemberPrepQuery.data?.scheduleBounds.end || undefined}
          existingAllocations={quickExistingAllocations(qaAddMemberPrepQuery.data?.team.team ?? [])}
          openRoles={qaAddMemberPrepQuery.data?.openRoles}
          prefillRole={qaAddMember.role || undefined}
          consumeRaIds={qaAddMemberConsumeRaIds}
          onAssigned={() => setQaAddMember(null)}
          onOpenProject={(projectId) => {
            setQaAddMember(null);
            onNavigate(`/project/${encodeURIComponent(projectId)}`);
          }}
          onSetupSchedule={() => {
            const projectId = qaAddMember.projectId;
            setQaAddMember(null);
            onNavigate(`/project/${encodeURIComponent(projectId)}#schedule-section`);
          }}
        />
      )}
    </>
  );

  /** Directly open the Add Team Member workspace for a KNOWN open position
   *  (e.g. a Demand-tab row), carrying its exact RA ids so the save consumes
   *  that position. An empty id list is passed as undefined so the
   *  unique-role recovery above can still kick in. */
  const openAddMember = (target: {
    projectId: string;
    projectName: string;
    role: string;
    consumeRaIds?: number[];
  }) => {
    if (!target.projectId.trim()) return;
    setQaAddMember({
      projectId: target.projectId.trim(),
      projectName: target.projectName,
      role: target.role,
      ...(target.consumeRaIds && target.consumeRaIds.length > 0
        ? { consumeRaIds: target.consumeRaIds }
        : {}),
    });
  };

  return { quickActionsFor, openAddMember, modals };
}
