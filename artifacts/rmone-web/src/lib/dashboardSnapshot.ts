// Tiny in-memory store for the home-screen "snapshot" — what the user is
// currently looking at on the home dashboard (role, window, sub-driver
// tiles, risk feed, recommended actions). RoleHome.tsx publishes the
// snapshot on every render; chat.tsx reads it on every message send and
// forwards it to api-server as `dashboardContext`. The api-server then
// injects it into the LLM system prompt so the assistant can answer
// questions like "How confident are you in the Phoenix overload
// forecast?" by referencing the exact tile/risk row the user sees.
//
// Kept deliberately framework-free (plain module scope) so any caller
// — RoleHome, alerts page, future widgets — can publish or read without
// importing React context or hooks.

let current: string | null = null;

export function setDashboardSnapshot(snapshot: string | null): void {
  // Dedupe: publishers (RoleHome useEffect) re-fire on every render because
  // the merged sub/risk/action arrays are recomputed each pass; skipping
  // the assignment when the value is unchanged makes that loop a no-op.
  if (snapshot === current) return;
  current = snapshot;
}

/** Clear the snapshot — call on logout / role-account switch so a stale
 *  view from the previous user can never be forwarded to the LLM. */
export function clearDashboardSnapshot(): void {
  current = null;
}

export function getDashboardSnapshot(): string | null {
  return current;
}
