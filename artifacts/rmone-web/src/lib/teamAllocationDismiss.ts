export type TeamAllocationDismissPath =
  | "cancel"
  | "backdrop"
  | "escape";

export interface TeamAllocationDismissState {
  isAllocationWorkspace: boolean;
  submitting: boolean;
  assignmentSaved: boolean;
}

/**
 * The direct add workspace coordinates two writes. Once either write is in
 * flight — and especially after the core assignment has succeeded — no user
 * dismissal path may abandon the required weekly-hours save.
 */
export function canDismissTeamAllocation(
  state: TeamAllocationDismissState,
  path: TeamAllocationDismissPath,
): boolean {
  switch (path) {
    case "cancel":
    case "backdrop":
    case "escape":
      return !state.isAllocationWorkspace || (!state.submitting && !state.assignmentSaved);
  }
}