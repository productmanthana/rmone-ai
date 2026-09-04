/**
 * saveMemberWeeklyHours — reusable helper for saving one member's COMPLETE
 * weekly allocation map from any surface outside the TeamScheduleGrid.
 *
 * Design invariants
 * ─────────────────
 * • Serialized per-member via memberWriteQueue (projectId + memberId key), so
 *   a write from EditAllocationModal, a sidebar, or any other non-grid surface
 *   queues behind — never races — any in-flight grid write for the same person.
 * • At queue turn: force-refresh project team (fresh=true) so the full week
 *   map is authoritative server truth, never a stale local snapshot.
 * • Member identity resolved GUID-first: resourceId is preferred over name
 *   whenever a GUID is available.  GUID-shaped memberId with no exact match
 *   NEVER falls back to name — it throws NotOnTeamError.  Name fallback is
 *   only allowed when memberId is empty / not GUID-shaped.
 * • The caller may supply one of: weekPatch (one-week change), fullWeekMap
 *   (complete replacement), or weekPatches (partial patch map applied to the
 *   authoritative server map at queue turn).  All are mutually exclusive.
 * • Numbers are validated via weeklyHoursValidation — new or worsening values
 *   >168 are REJECTED (friendly error thrown), never silently clamped. A
 *   pre-existing over-cap row may round-trip or be reduced so an old bad row
 *   cannot prevent a corrective edit elsewhere in the same complete map.
 * • Calls buildDirectWeeklyAllocations → updateHoursAllocation for the
 *   actual POST.
 * • Raw Error objects propagate as failures (never swallowed).
 * • On success/failure: notifyMemberWrite so the grid(s) can advance their
 *   confirmed base / schedule a re-read.
 * • Post-save: force-refetch server truth and return the confirmed member
 *   weeklyHours map.
 * • Throws specific friendly errors for NOT_ON_TEAM, locked allocation, and
 *   save-mismatch conditions.
 */

import {
  getFullProjectAllocations,
  getProjectTeam,
  notifyAllocationConfirmed,
  updateHoursAllocation,
  type ProjectTeamMember,
} from "./api";
import {
  buildTeamWeeklyAllocations,
  matchMemberAlloc,
  type AllocationsResponse,
} from "./phaseHours";
import {
  queueProjectMemberWrite,
  notifyMemberWrite,
} from "./memberWriteQueue";
import {
  findWeeklyHoursViolation,
  weeklyHoursViolationMessage,
} from "./weeklyHoursValidation";
import {
  getPastWeekEditStateFor,
  PAST_WEEK_LOCKED_REASON,
} from "./businessRules";

// ── Public types ───────────────────────────────────────────────────────────────

/** A one-week patch — merged onto the authoritative full map at queue turn. */
export interface WeekPatch {
  week: string;   // ISO "YYYY-MM-DD" (Monday of the week)
  hours: number;
}

/** Emitted synchronously after the weekly POST is accepted, before the
 * authoritative verification read. Consumers may display this exact value
 * optimistically, but must retain their normal verification/rollback path. */
export interface AcceptedMemberWeeklyHoursWrite {
  projectId: string;
  memberId: string;
  memberName: string;
  previousWeekMap: Record<string, number>;
  acceptedWeekMap: Record<string, number>;
}

/** Regex that recognises a standard GUID / UUID. */
const GUID_SHAPE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Options accepted by saveMemberWeeklyHours. */
export interface SaveMemberWeeklyHoursOptions {
  projectId: string;
  /** GUID is strongly preferred; supply it whenever available. */
  memberId: string;
  memberName: string;
  memberRole: string;
  /**
   * Exactly one of weekPatch, fullWeekMap, or weekPatches must be supplied.
   *
   * weekPatch   — one-week change applied to the authoritative full map.
   * fullWeekMap — complete replacement map (all weeks for the member).
   * weekPatches — partial patch map (ISO week → hours); merged onto the
   *               authoritative fresh-server map at queue turn so every
   *               untouched week retains its stored value.  Mutually exclusive
   *               with weekPatch and fullWeekMap.
   */
  weekPatch?: WeekPatch;
  fullWeekMap?: Record<string, number>;
  weekPatches?: Record<string, number>;
  /** Fires after the POST succeeds and before the fresh verification read. */
  onAccepted?: (write: AcceptedMemberWeeklyHoursWrite) => void;
}

/** Confirmed result returned on success. */
export interface SaveMemberWeeklyHoursResult {
  /** The full week→hours map as confirmed by the server post-save refetch. */
  confirmedWeekMap: Record<string, number>;
  /** The raw server team member row for this person (post-save). */
  member: ProjectTeamMember;
}

// ── Friendly error classes ─────────────────────────────────────────────────────

export class NotOnTeamError extends Error {
  constructor(memberName: string) {
    super(
      `${memberName} is not on this project's team. Refresh the page to see the current team before editing hours.`,
    );
    this.name = "NotOnTeamError";
  }
}

export class AllocationLockedError extends Error {
  constructor(memberName: string) {
    super(
      `${memberName}'s allocation is locked — unlock it from the FLAGS column before changing hours.`,
    );
    this.name = "AllocationLockedError";
  }
}

export class PastWeekLockedError extends Error {
  readonly weeks: string[];

  constructor(weeks: string[]) {
    const unique = [...new Set(weeks)].sort();
    super(
      `${PAST_WEEK_LOCKED_REASON}. ${unique.length === 1
        ? `The blocked week is ${unique[0]}.`
        : `The blocked weeks are ${unique.join(", ")}.`}`,
    );
    this.name = "PastWeekLockedError";
    this.weeks = unique;
  }
}

export class SaveMismatchError extends Error {
  constructor(memberName: string, mismatches: Array<{ week: string; intended: number; got: number }>) {
    const detail = mismatches
      .slice(0, 3)
      .map(m => `${m.week}: sent ${m.intended}h, server has ${m.got}h`)
      .join("; ");
    super(
      `Hours for ${memberName} did not match after saving (${detail}). ` +
      "Reload the page to see the current values.",
    );
    this.name = "SaveMismatchError";
  }
}

// ── Internal helpers ───────────────────────────────────────────────────────────

const VERIFY_READ_RETRY_DELAYS_MS = [120, 360] as const;

function waitForVerificationRead(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function weekMapMismatches(
  intendedMap: Record<string, number>,
  confirmedMap: Record<string, number>,
): Array<{ week: string; intended: number; got: number }> {
  return Object.entries(intendedMap)
    .filter(([week, intended]) => (confirmedMap[week] ?? 0) !== intended)
    .map(([week, intended]) => ({ week, intended, got: confirmedMap[week] ?? 0 }));
}

/**
 * Locate a team member by GUID-first, then (optionally) by name.
 *
 * GUID identity rule:
 *   – If memberId is GUID-shaped AND no team member's resourceId matches,
 *     return undefined immediately (never fall through to name matching).
 *   – Name fallback is allowed ONLY when memberId is absent or not GUID-shaped.
 */
export function findMember(
  team: ProjectTeamMember[],
  memberId: string,
  memberName: string,
): ProjectTeamMember | undefined {
  const isGuid = GUID_SHAPE.test(memberId);

  if (memberId) {
    const byId = team.find(
      m => (m.resourceId ?? "").toLowerCase() === memberId.toLowerCase(),
    );
    if (byId) return byId;
    // If memberId was GUID-shaped but matched nothing, NEVER fall back by name.
    if (isGuid) return undefined;
  }

  // Name fallback — only when memberId is absent or not GUID-shaped.
  const normTarget = memberName.trim().toLowerCase();
  return team.find(m => m.name.trim().toLowerCase() === normTarget);
}

/** Extract the full week→hours map from a team member row. */
export function weekMapFromMember(m: ProjectTeamMember): Record<string, number> {
  return Object.fromEntries((m.weeklyHours ?? []).map(wh => [wh.week, wh.hours]));
}

/**
 * Validate a complete replacement map without letting a pre-existing legacy
 * over-cap row trap the user. Complete-map saves must carry every server row,
 * including historical rows that were written before the current 168-hour
 * guard existed. Those rows are safe to carry forward or reduce; they may
 * never be increased, and every newly invalid value is still rejected.
 */
function findWorseningWeeklyHoursViolation(
  serverMap: Record<string, number>,
  targetMap: Record<string, number>,
) {
  for (const [week, hours] of Object.entries(targetMap)) {
    const violation = findWeeklyHoursViolation([[week, hours]]);
    if (!violation) continue;
    if (
      violation.reason === "over_limit" &&
      (serverMap[week] ?? 0) > 168 &&
      hours <= (serverMap[week] ?? 0)
    ) {
      continue;
    }
    return violation;
  }
  return null;
}

// ── Dependency-injectable factory ──────────────────────────────────────────────

/**
 * Injectable dependencies — the real implementations are the defaults; tests
 * can supply stubs for the network calls while keeping all other logic real.
 */
export interface SaveMemberWeeklyHoursDeps {
  getProjectTeam: (projectId: string, fresh: boolean) => Promise<{ team: ProjectTeamMember[] }>;
  getFullProjectAllocations: (projectId: string, fresh: boolean) => Promise<AllocationsResponse>;
  updateHoursAllocation: (payload: {
    ProjectID: string;
    Allocations: Record<string, unknown>[];
  }) => Promise<unknown>;
  queueProjectMemberWrite: (
    projectId: string,
    memberId: string,
    fn: () => Promise<void>,
  ) => Promise<void>;
  notifyMemberWrite: (
    projectId: string,
    ev: { memberId: string; weekMap: Record<string, number> | null; ok: boolean },
  ) => void;
  /** In-tab signal emitted only after the post-save read matches the write. */
  notifyAllocationConfirmed: (projectId: string) => void;
  /** Shared Settings → Hours grid rule. Injectable so tests can fix the clock/rule. */
  isPastWeekLocked: (weekKey: string, projectId: string) => boolean;
}

const defaultDeps: SaveMemberWeeklyHoursDeps = {
  getProjectTeam: (projectId, fresh) => getProjectTeam(projectId, fresh),
  getFullProjectAllocations: (projectId, fresh) =>
    getFullProjectAllocations(projectId, { fresh }) as Promise<AllocationsResponse>,
  updateHoursAllocation: (payload) => updateHoursAllocation(payload),
  queueProjectMemberWrite,
  notifyMemberWrite,
  notifyAllocationConfirmed,
  isPastWeekLocked: (weekKey, projectId) =>
    getPastWeekEditStateFor(weekKey, projectId).locked,
};

/**
 * Create a bound version of saveMemberWeeklyHours that uses the given
 * dependency implementations.  The returned function is the EXACT same
 * production logic — no reimplementation — so tests exercise the real code.
 */
export function createSaveMemberWeeklyHours(
  deps: Partial<SaveMemberWeeklyHoursDeps> = {},
): (opts: SaveMemberWeeklyHoursOptions) => Promise<SaveMemberWeeklyHoursResult> {
  const d: SaveMemberWeeklyHoursDeps = { ...defaultDeps, ...deps };

  return async function saveMemberWeeklyHoursImpl(
    opts: SaveMemberWeeklyHoursOptions,
  ): Promise<SaveMemberWeeklyHoursResult> {
    const { projectId, memberId, memberName, memberRole, weekPatch, fullWeekMap, weekPatches, onAccepted } = opts;

    // ── Argument validation ──────────────────────────────────────────────────
    const patchCount = [weekPatch, fullWeekMap, weekPatches].filter(Boolean).length;
    if (patchCount === 0) {
      throw new Error("saveMemberWeeklyHours: supply either weekPatch, fullWeekMap, or weekPatches.");
    }
    if (patchCount > 1) {
      throw new Error("saveMemberWeeklyHours: supply weekPatch OR fullWeekMap OR weekPatches, not both.");
    }

    // The queue callback is typed as Promise<void>, so capture its confirmed
    // result locally and return it only after the queued turn has completed.
    // Do not create a second, detached promise here: a failed queue turn would
    // reject both promises and leave one rejection unobserved in the browser.
    let confirmedResult: SaveMemberWeeklyHoursResult | null = null;

    await d.queueProjectMemberWrite(projectId, memberId, async () => {
      try {
        // ── Step 1: Force-refresh project team to get authoritative member data ──
        // Use the same fresh allocation source as the working Project/Opportunity
        // Team editor. The team row supplies the confirmed week map; the full
        // allocation row supplies the exact server identity/org metadata carried
        // by Team Edit's updateHoursAllocation payload.
        const [freshTeamRes, fullAllocations] = await Promise.all([
          d.getProjectTeam(projectId, /* fresh= */ true),
          d.getFullProjectAllocations(projectId, /* fresh= */ true),
        ]);
        const freshTeam = freshTeamRes.team;

        // ── Step 2: Locate the member GUID-first ──────────────────────────────
        const member = findMember(freshTeam, memberId, memberName);
        if (!member) {
          throw new NotOnTeamError(memberName);
        }

        // ── Step 3: Check locked flag ─────────────────────────────────────────
        if (member.isLocked) {
          throw new AllocationLockedError(member.name);
        }

        // ── Step 4: Build the complete week map ───────────────────────────────
        const serverMap = weekMapFromMember(member);
        let targetMap: Record<string, number>;

        if (fullWeekMap) {
          // Caller supplied the complete replacement map.
          targetMap = { ...fullWeekMap };
        } else if (weekPatches) {
          // Caller supplied a partial patch map — merge onto authoritative server truth.
          targetMap = { ...serverMap, ...weekPatches };
        } else {
          // Caller supplied a one-week patch — apply to server truth.
          targetMap = { ...serverMap, [weekPatch!.week]: weekPatch!.hours };
        }

        // ── Step 5: Apply the same past-week policy as Project Team ───────────
        // Full replacement callers carry historical rows forward. Those rows
        // are allowed only when they are unchanged from fresh server truth.
        const changedLockedWeeks = new Set([
          ...Object.keys(serverMap),
          ...Object.keys(targetMap),
        ].filter((week) =>
          d.isPastWeekLocked(week, projectId) &&
          (targetMap[week] ?? 0) !== (serverMap[week] ?? 0),
        ));
        if (changedLockedWeeks.size > 0) {
          throw new PastWeekLockedError([...changedLockedWeeks]);
        }

        // ── Step 6: Validate all numbers ─────────────────────────────────────
        // A complete map includes every existing server row. Let a legacy
        // over-cap row round-trip (or be reduced) so clearing another week to
        // zero remains possible; block every new or worsening over-cap value.
        const violation = findWorseningWeeklyHoursViolation(serverMap, targetMap);
        if (violation) {
          throw new Error(weeklyHoursViolationMessage(violation));
        }

        // ── Step 7: Build Allocations payload and POST ────────────────────────
        const resolvedId = member.resourceId ?? memberId;
        const resolvedName = member.name;
        const resolvedRole = member.role || memberRole;

        const memberAlloc = matchMemberAlloc(
          fullAllocations,
          { name: resolvedName, resourceId: resolvedId },
          projectId,
        );
        if (!memberAlloc) {
          throw new Error(
            `Couldn't find the allocation record for ${resolvedName}. Reload the page and try again.`,
          );
        }
        // This is the same canonical payload builder used by TeamScheduleGrid's
        // working Project/Opportunity Team edit path.
        const allocations = buildTeamWeeklyAllocations(targetMap, {
          ...memberAlloc,
          AssignedTo: resolvedId,
          AssignedToName: resolvedName,
          TypeName: memberAlloc.TypeName || resolvedRole,
          RoleName: memberAlloc.RoleName || resolvedRole,
        });

        const result = await d.updateHoursAllocation({
          ProjectID: projectId,
          Allocations: allocations,
        });

        // ── Step 7: Treat raw Error response as failure ───────────────────────
        if (
          (result as Record<string, unknown> | null)?.raw === "Error" ||
          (result as Record<string, unknown> | null)?.raw === "error" ||
          result === "Error"
        ) {
          throw new Error(
            `Save rejected for ${resolvedName} — the allocation record may be incomplete. ` +
            "Edit this member's assignment once (pencil icon on the member card) to repair it, then try again.",
          );
        }

        // The server accepted the exact full-map write. Surface that accepted
        // value before the slower verification read so all mounted Resources
        // views can agree immediately. A listener bug must never turn a
        // successfully accepted save into a failed/ambiguous write.
        try {
          onAccepted?.({
            projectId,
            memberId: resolvedId,
            memberName: resolvedName,
            previousWeekMap: { ...serverMap },
            acceptedWeekMap: { ...targetMap },
          });
        } catch { /* optimistic listener failures do not affect persistence */ }

        // ── Step 8: Notify listeners of success ───────────────────────────────
        d.notifyMemberWrite(projectId, {
          memberId: resolvedId,
          weekMap: { ...targetMap },
          ok: true,
        });

        // ── Step 9: Force-refetch server truth and verify ─────────────────────
        let verifyRes = await d.getProjectTeam(projectId, /* fresh= */ true);
        let verifyMember = findMember(verifyRes.team, resolvedId, resolvedName);

        if (!verifyMember) {
          // Member no longer on team post-save — surface as failure.
          throw new NotOnTeamError(resolvedName);
        }

        let confirmedMap = weekMapFromMember(verifyMember);
        let mismatches = weekMapMismatches(targetMap, confirmedMap);

        // The write endpoint is transactional, but a read routed through a
        // different worker can briefly see the pre-save snapshot even with
        // fresh=1. Never turn that short propagation window into a false
        // rollback in the editor. Re-read the same authoritative route before
        // declaring the accepted write inconsistent.
        for (const delay of VERIFY_READ_RETRY_DELAYS_MS) {
          if (mismatches.length === 0) break;
          await waitForVerificationRead(delay);
          verifyRes = await d.getProjectTeam(projectId, /* fresh= */ true);
          verifyMember = findMember(verifyRes.team, resolvedId, resolvedName);
          if (!verifyMember) throw new NotOnTeamError(resolvedName);
          confirmedMap = weekMapFromMember(verifyMember);
          mismatches = weekMapMismatches(targetMap, confirmedMap);
        }

        if (mismatches.length > 0) {
          throw new SaveMismatchError(resolvedName, mismatches);
        }

        confirmedResult = { confirmedWeekMap: confirmedMap, member: verifyMember };
        // The initial allocation-change signal fires immediately after the POST.
        // This second, separate signal is deliberately delayed until a fresh
        // server read proves the intended week map actually persisted.
        d.notifyAllocationConfirmed(projectId);
      } catch (e) {
        // Notify failure — grid(s) will schedule a re-read for this member.
        d.notifyMemberWrite(projectId, {
          memberId,
          weekMap: null,
          ok: false,
        });
        // Re-throw so the queue's settle-safe tail wrapper catches it.
        throw e;
      }
    });

    if (!confirmedResult) {
      throw new Error("Allocation save completed without confirmed server truth.");
    }
    return confirmedResult;
  };
}

// ── Main exported function ─────────────────────────────────────────────────────

/**
 * Save one member's complete weekly allocation map, serialized through the
 * shared memberWriteQueue so concurrent writes from any surface don't race.
 *
 * @throws NotOnTeamError          – member not found in the fresh team list
 * @throws AllocationLockedError   – member's isLocked flag is set
 * @throws WeeklyHoursViolation    – a week exceeds 168h or is negative/NaN
 * @throws SaveMismatchError       – server truth doesn't match what was POSTed
 * @throws Error                   – any other network / server failure
 */
export const saveMemberWeeklyHours = createSaveMemberWeeklyHours();
