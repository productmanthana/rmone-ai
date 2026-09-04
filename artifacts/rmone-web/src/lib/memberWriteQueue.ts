// Shared per-member HOURS write queue.
//
// Every hours save POSTs the member's FULL week map and the server replaces
// that member's allocations wholesale — so two racing writers means
// last-write-wins and silently resurrected old hours. TeamScheduleGrid
// serializes all of ITS writers (cell drains, quick actions, bulk save)
// through one promise tail per member; this module lifts that tail to module
// scope so writers living OUTSIDE the grid component (EditAllocationModal)
// chain onto the very same queue instead of racing it.
//
// Keys are `${projectId}|${memberId}` (memberId = resourceId ?? name — the
// grid's convention). Entries are never deleted: a settled promise costs
// nothing and deleting/re-registering opens races.

const tails = new Map<string, Promise<void>>();

function keyOf(projectId: string, memberId: string): string {
  return `${projectId}|${memberId}`;
}

/** Chain `fn` onto the member's write queue. Returns fn's own promise
    (rejections propagate to the caller); the stored tail is settle-safe so
    the next writer always proceeds. */
export function queueProjectMemberWrite(
  projectId: string,
  memberId: string,
  fn: () => Promise<void>,
): Promise<void> {
  const k = keyOf(projectId, memberId);
  const prev = tails.get(k) ?? Promise.resolve();
  const run = prev.then(fn, fn);
  tails.set(k, run.catch(() => { /* next writer proceeds */ }));
  return run;
}

/** All currently-registered queue tails for a project — used by the grid's
    bulk save to wait for every in-flight member write before rewriting the
    team wholesale. Tails are settle-safe (never reject). */
export function pendingProjectWrites(projectId: string): Promise<void>[] {
  const prefix = `${projectId}|`;
  const out: Promise<void>[] = [];
  for (const [k, p] of tails) if (k.startsWith(prefix)) out.push(p);
  return out;
}

// ── External-writer notifications ───────────────────────────────────────────
// The grid keeps per-member "confirmed base" bookkeeping (last full week map
// a successful POST acknowledged). Writers outside the component can't touch
// those refs directly, so they announce their outcome here and the mounted
// grid(s) advance the base (success) or flag the member for a server re-read
// (failure) — exactly what the grid's own writers do inline.

export type MemberWriteEvent = {
  memberId: string;
  /** ISO "YYYY-MM-DD" week → hours the write POSTed (full replace server-side).
      Null when the write failed (server state ambiguous). */
  weekMap: Record<string, number> | null;
  ok: boolean;
};

type Listener = (ev: MemberWriteEvent) => void;
const listeners = new Map<string, Set<Listener>>();

export function subscribeMemberWrites(projectId: string, fn: Listener): () => void {
  let set = listeners.get(projectId);
  if (!set) { set = new Set(); listeners.set(projectId, set); }
  set.add(fn);
  return () => { set!.delete(fn); };
}

export function notifyMemberWrite(projectId: string, ev: MemberWriteEvent): void {
  const set = listeners.get(projectId);
  if (!set) return;
  for (const fn of set) { try { fn(ev); } catch { /* listener bug must not break the save */ } }
}
