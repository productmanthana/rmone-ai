// Shared post-save refresh for the project team cache.
//
// After ANY team change (member added/removed, allocation edited, open
// position added — from the Projects page, the Team modal, or a chat tool):
// fetch a FRESH team snapshot and push it straight into the React Query
// cache so every TEAM badge / Team modal updates instantly.
//
// getProjectTeam(id, true) busts the local `cached()` entry AND sends
// fresh=1 so no server cluster worker can serve a pre-save copy.
//
// A bare qc.invalidateQueries(["project-team", id]) is NOT enough: its
// refetch is served from the still-warm 5-minute client `cached()` layer
// (and possibly a stale server worker cache), so the pre-save count sticks
// around until a full page refresh.
import type { QueryClient } from "@tanstack/react-query";
import { getProjectTeam, type ProjectTeamResponse, type WeeklyHourEntry } from "@/lib/api";
import { memSeed } from "@/lib/memSeed";

export interface OptimisticProjectTeamMember {
  id: string;
  name: string;
  role: string;
  bu: string;
  title: string;
  startDate: string;
  endDate: string;
  pct: number;
  hours?: number;
  weeklyHours?: WeeklyHourEntry[];
}

/** Confirmed member-hour readback returned by the weekly-hours save. */
export interface ProjectMemberHoursUpdate {
  memberId: string;
  weeklyHours: WeeklyHourEntry[];
  eacHrs: number;
  etcHrs: number;
}

/**
 * Write a confirmed weekly-hours save directly into the open Project Team
 * snapshot. This makes the team row reflect a successful edit immediately,
 * while refreshProjectTeamCache still performs a fresh server reconciliation.
 */
export function applyProjectMemberHours(
  qc: QueryClient,
  projectId: string,
  update: ProjectMemberHoursUpdate,
) {
  const memberId = update.memberId.trim().toLowerCase();
  let changed = false;
  const next = qc.setQueryData<ProjectTeamResponse>(["project-team", projectId], (current) => {
    if (!current) return current;
    const team = current.team.map((member) => {
      const resourceId = member.resourceId?.trim().toLowerCase();
      // Weekly-hour writes are GUID-scoped. Name matching is only a legacy
      // fallback for old team snapshots that have no resource ID at all.
      const matches = resourceId
        ? resourceId === memberId
        : member.name.trim().toLowerCase() === memberId;
      if (!matches) return member;
      changed = true;
      return {
        ...member,
        weeklyHours: update.weeklyHours,
        eacHrs: update.eacHrs,
        etcHrs: update.etcHrs,
      };
    });
    return changed ? { ...current, team } : current;
  });

  if (changed && next) {
    // Keep the instant-render seed used by a reopened Team modal aligned with
    // the React Query snapshot, not just the eventual fresh verification read.
    try {
      memSeed.setItem(`rmone:v1:teamraw:${projectId}`, JSON.stringify({ data: next, ts: Date.now() }));
    } catch { /* ignore seed persistence failures */ }
  }
}

/**
 * Mirror a confirmed add/edit into the shared team snapshot immediately.
 * GUID identity is authoritative; names are labels and are never used to
 * merge two people who may legitimately share a display name.
 */
export function applyOptimisticProjectTeamMember(
  qc: QueryClient,
  projectId: string,
  optimistic: OptimisticProjectTeamMember,
) {
  const wantedId = optimistic.id.trim().toLowerCase();
  const weeklyHours = optimistic.weeklyHours;
  const weeklyTotal = weeklyHours?.reduce((sum, row) => sum + row.hours, 0);
  let changed = false;
  const next = qc.setQueryData<ProjectTeamResponse>(["project-team", projectId], (current) => {
    if (!current) return current;
    const memberIndex = current.team.findIndex((member) =>
      !!wantedId && member.resourceId?.trim().toLowerCase() === wantedId
    );
    if (memberIndex >= 0) {
      const member = current.team[memberIndex];
      const team = [...current.team];
      team[memberIndex] = {
        ...member,
        role: optimistic.role || member.role,
        bu: optimistic.bu || member.bu,
        title: optimistic.title || member.title,
        startDate: optimistic.startDate || member.startDate,
        endDate: optimistic.endDate || member.endDate,
        pctAllocation: optimistic.pct,
        ...(weeklyHours ? {
          weeklyHours,
          eacHrs: weeklyTotal ?? member.eacHrs,
          etcHrs: weeklyTotal ?? member.etcHrs,
        } : {}),
      };
      changed = true;
      return { ...current, team };
    }

    const hours = weeklyTotal ?? optimistic.hours ?? optimistic.pct ?? 0;
    changed = true;
    return {
      ...current,
      team: [...current.team, {
        name: optimistic.name,
        role: optimistic.role,
        bu: optimistic.bu,
        title: optimistic.title,
        eacHrs: hours,
        etcHrs: hours,
        costRate: 0,
        laborRate: 0,
        eacCost: 0,
        etcCost: 0,
        ncHrs: 0,
        ncCost: 0,
        pctAllocation: optimistic.pct,
        startDate: optimistic.startDate,
        endDate: optimistic.endDate,
        resourceId: optimistic.id,
        weeklyHours: weeklyHours ?? [],
      }],
    };
  });

  if (changed && next) {
    try {
      memSeed.setItem(`rmone:v1:teamraw:${projectId}`, JSON.stringify({ data: next, ts: Date.now() }));
    } catch { /* ignore seed persistence failures */ }
  }
}

export function refreshProjectTeamCache(qc: QueryClient, projectId: string) {
  void getProjectTeam(projectId, true)
    .then(fresh => {
      qc.setQueryData(["project-team", projectId], fresh);
      // Keep the instant-render seed (used by the Team modal's
      // placeholderData) in lockstep so a re-open never flashes stale data.
      try { memSeed.setItem(`rmone:v1:teamraw:${projectId}`, JSON.stringify({ data: fresh, ts: Date.now() })); } catch { /* ignore */ }
    })
    .catch(() => {
      // Fresh fetch failed — fall back to a plain invalidate so the next
      // observer refetch can still repair the cache. Never write an empty.
      void qc.invalidateQueries({ queryKey: ["project-team", projectId] });
    });
}
