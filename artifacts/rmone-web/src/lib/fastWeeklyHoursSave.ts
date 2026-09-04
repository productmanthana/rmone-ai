/**
 * runFastWeeklyHoursSave — the perceived-speed fast path around
 * saveMemberWeeklyHours, extracted from useAssignMemberCascade's
 * persistDirectWeeklyHours so the accepted-then-failed contract is
 * unit-testable with injected deps.
 *
 * Contract
 * ────────
 * • The returned promise resolves as soon as the server ACCEPTS the exact
 *   week map (the /hours-allocation POST succeeded → onAccepted fired). The
 *   helper's forced-fresh verification read continues in the BACKGROUND.
 * • Every pre-acceptance failure (validation, past-week lock, NotOnTeam,
 *   server "Error") rejects the returned promise so the caller's modal stays
 *   open for retry, exactly as before the fast path existed.
 * • A post-acceptance failure — the server confirmed the write but the fresh
 *   verification read failed or mismatched — must NEVER be silent: it busts
 *   caches and fires the loud warning surface (deps.warnVerificationFailed).
 *   This is the hours-integrity guarantee: a silently-wrong week map is worse
 *   than a scary toast.
 * • Defensive: if acceptance never fired but the save fully verified, resolve
 *   rather than hanging the caller's submit.
 */

import {
  saveMemberWeeklyHours,
  type AcceptedMemberWeeklyHoursWrite,
  type SaveMemberWeeklyHoursOptions,
  type SaveMemberWeeklyHoursResult,
} from "./saveMemberWeeklyHours";

/** Options for the underlying save — onAccepted is owned by the fast path. */
export type FastWeeklyHoursSaveOptions = Omit<SaveMemberWeeklyHoursOptions, "onAccepted">;

export interface FastWeeklyHoursSaveDeps {
  /** The underlying save. Injectable for tests; production uses the real helper. */
  save?: (opts: SaveMemberWeeklyHoursOptions) => Promise<SaveMemberWeeklyHoursResult>;
  /** Paint the server-accepted value before the background verification read. */
  onAccepted?: (write: AcceptedMemberWeeklyHoursWrite) => void;
  /** Called when the background authoritative read confirms the accepted map. */
  onVerified?: (result: SaveMemberWeeklyHoursResult) => void;
  /** Force fresh reads after a post-acceptance verification failure. */
  bustCache: () => void;
  /**
   * Loud warning surface for the accepted-then-failed path (amber toast in
   * production). Receives the verification error so the caller can compose a
   * friendly message. Must never be skipped when acceptance already fired.
   */
  warnVerificationFailed: (error: unknown) => void;
}

export function runFastWeeklyHoursSave(
  opts: FastWeeklyHoursSaveOptions,
  deps: FastWeeklyHoursSaveDeps,
): Promise<void> {
  const save = deps.save ?? saveMemberWeeklyHours;
  return new Promise<void>((resolve, reject) => {
    let accepted = false;
    save({
      ...opts,
      onAccepted: (write) => {
        accepted = true;
        try { deps.onAccepted?.(write); } catch { /* UI listeners never affect persistence */ }
        resolve();
      },
    }).then((result) => {
      try { deps.onVerified?.(result); } catch { /* UI listeners never affect persistence */ }
      // Defensive: if acceptance never fired but the save fully verified,
      // resolve now rather than hanging the submit.
      if (!accepted) resolve();
    }).catch((err) => {
      if (!accepted) {
        reject(err instanceof Error ? err : new Error(String(err)));
        return;
      }
      // Post-acceptance verification failure. The modal is already closed —
      // force fresh reads and tell the user loudly; never fail silently.
      deps.bustCache();
      deps.warnVerificationFailed(err);
    });
  });
}
