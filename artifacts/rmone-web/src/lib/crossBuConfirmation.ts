export type CrossBuPromptMode = "none" | "pending" | "open";

/**
 * A cross-BU person remains a normal selection until the user explicitly
 * starts the add operation. The UI uses this mode to avoid project mutations
 * while someone is merely browsing or can still cancel their selection.
 */
export function getCrossBuPromptMode(hasMismatch: boolean, promptOpen: boolean): CrossBuPromptMode {
  if (!hasMismatch) return "none";
  return promptOpen ? "open" : "pending";
}

/**
 * After the cross-BU popup's "Add" succeeds, the add flow continues on its
 * own — the user already pressed "Add to team" to open the popup, so a second
 * press would be duplicate consent. `armed` is a one-shot flag set only by a
 * successful BU add (never by Cancel or a failed write); the continuation
 * must also wait until the mismatch is fully cleared and no write is running.
 */
export function shouldAutoContinueAfterBuAdd(
  armed: boolean,
  hasMismatch: boolean,
  promptOpen: boolean,
  busy: boolean,
): boolean {
  return armed && !hasMismatch && !promptOpen && !busy;
}

/**
 * The compact weekly planner has no organization controls of its own. Its
 * project-derived division is context, not an explicit roster filter, so
 * cross-BU candidates must stay selectable there.
 */
export function shouldFilterPeopleByOrganization(isWeeklyPlanner: boolean): boolean {
  return !isWeeklyPlanner;
}