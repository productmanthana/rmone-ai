// ── Import wizard gate latches ───────────────────────────────────────────
// The upload wizard has three sequential pause points ("gates") that run
// BEFORE an import: new groups on the staff card, new groups from the
// projects/opportunities Groups column, and new access levels (unknown
// Access Level values offered for creation). Each is guarded by a one-shot
// latch with precise semantics:
//   • set on popup confirm ONLY (so re-entry after confirm proceeds past
//     the gate instead of looping),
//   • re-armed by Back (going back means "offer me the step again"),
//   • reset at the start of every new submit pass (a brand-new submit must
//     re-offer every step).
// A wrong transition means either an infinite popup loop or a silently
// skipped step (the import would run WITHOUT creating the promised levels).
// Extracted from InlineDataGrid.tsx so the transitions are testable as pure
// state — InlineDataGrid holds ONE instance in a ref and must route every
// latch read/write through it (never keep parallel booleans).

export type GateKind = "staffGroups" | "recordGroups" | "newLevels";

/** What the submitted data snapshot actually contains — computed fresh on
 *  every walk of the gate sequence (confirm handlers re-enter with FILLED
 *  data, so a fact that was true before a confirm is usually false after). */
export interface GateFacts {
  /** Staff card: rows with Groups but no Access Level need group→level picks. */
  staffGroupsGate: boolean;
  /** Projects/opps card: the Groups / "Action User" column has content. */
  recordGroupsGate: boolean;
  /** Any Access Level cell names a level that doesn't exist yet. */
  hasNewLevels: boolean;
}

export class ImportGateLatches {
  private staffResolved = false;
  private recordGroupsResolved = false;
  private newLevelsResolved = false;
  private fixIssuesShown = false;

  /** Start of a brand-new submit pass (submitTemplateData / submitFileData):
   *  the Fix-issues marker and the New-levels one-shot are re-armed so a new
   *  pass re-offers the step. The two group latches are NOT touched here —
   *  they are cleared as the gate sequence walks past them (matching the
   *  original ref semantics: a confirm's latch must survive exactly until
   *  its gate is passed once). */
  startSubmitPass(): void {
    this.fixIssuesShown = false;
    this.newLevelsResolved = false;
  }

  /** The validation scan flagged issues this pass → Fix-issues step shown. */
  markFixIssuesShown(): void {
    this.fixIssuesShown = true;
  }

  /** Whether the groups/levels popup's "← Back" has an earlier step to land
   *  on: file mode always has Review matches; template mode only when the
   *  Fix-issues step was actually part of this pass. */
  canStepBack(fileMode: boolean): boolean {
    return fileMode || this.fixIssuesShown;
  }

  /**
   * One walk of the gate sequence (the top of finishSubmitInner). Returns
   * the first gate that should pause the flow, or null when the import may
   * proceed. Latches are consumed EXACTLY like the original inline refs:
   * a resolved latch skips its gate once and is cleared as the walk passes
   * it — never cleared for gates that sit AFTER the returned pause point.
   */
  next(facts: GateFacts): GateKind | null {
    if (!this.staffResolved && facts.staffGroupsGate) return "staffGroups";
    this.staffResolved = false;
    if (!this.recordGroupsResolved && facts.recordGroupsGate) return "recordGroups";
    this.recordGroupsResolved = false;
    if (!this.newLevelsResolved && facts.hasNewLevels) return "newLevels";
    this.newLevelsResolved = false;
    return null;
  }

  /** Staff group→level gate answered. viaPopupConfirm=true when the user
   *  pressed the popup's confirm — that popup ALSO carried the suggested
   *  new-levels chips, so the New-levels offer counts as answered too
   *  (✕-declined levels stay declined for the rest of this pass). Auto
   *  resolutions (all groups had stored defaults) never showed the chips,
   *  so they must NOT swallow the New-levels step. */
  resolveStaffGroups(opts?: { viaPopupConfirm?: boolean }): void {
    this.staffResolved = true;
    if (opts?.viaPopupConfirm) this.newLevelsResolved = true;
  }

  /** Record-groups gate answered — same viaPopupConfirm contract as above. */
  resolveRecordGroups(opts?: { viaPopupConfirm?: boolean }): void {
    this.recordGroupsResolved = true;
    if (opts?.viaPopupConfirm) this.newLevelsResolved = true;
  }

  /** "← Back" from a groups/levels popup: re-arm the New-levels offer so the
   *  next Continue pauses on the step again (the user went back for another
   *  look — silently skipping the step on the way forward would break the
   *  Fix-issues remark's promise). The group latches were never set (Back is
   *  only reachable while the popup is open, i.e. before its confirm). */
  stepBack(): void {
    this.newLevelsResolved = false;
  }

  /** Test/diagnostic snapshot of the raw latch state. */
  snapshot(): { staffResolved: boolean; recordGroupsResolved: boolean; newLevelsResolved: boolean; fixIssuesShown: boolean } {
    return {
      staffResolved: this.staffResolved,
      recordGroupsResolved: this.recordGroupsResolved,
      newLevelsResolved: this.newLevelsResolved,
      fixIssuesShown: this.fixIssuesShown,
    };
  }
}
