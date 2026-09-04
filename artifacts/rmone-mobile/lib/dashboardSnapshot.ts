// See artifacts/rmone-web/src/lib/dashboardSnapshot.ts for full notes.
// Mirrors the same in-memory snapshot pattern on mobile so the home tab
// can publish what's on screen and the chat tab can forward it to
// api-server as `dashboardContext`.

let current: string | null = null;

export function setDashboardSnapshot(snapshot: string | null): void {
  if (snapshot === current) return;
  current = snapshot;
}

export function clearDashboardSnapshot(): void {
  current = null;
}

export function getDashboardSnapshot(): string | null {
  return current;
}
