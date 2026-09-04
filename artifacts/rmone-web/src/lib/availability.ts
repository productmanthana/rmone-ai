// ── Window availability service ─────────────────────────────────────────────
// Answers "how free is each person between START and END?" from the tenant-wide
// allocation-utilization feed. Used by the role-first Add Member flow to rank
// people by free capacity and show "Free ~24h/wk" badges in the person picker.
//
// Response shape (verified against the live API): one row per resource with
// meta keys (ResourceUser = display name, UserId = GUID, Title) plus dynamic
// week columns like "Jun-29-26" whose value packs "P:75#H:30#C:6#F:0.75#A:25#S:Good"
// — P = percent utilization, H = booked hours, A = percent available.
//
// Honesty rules (see memory: intelligence-signal-honesty):
//  - A FAILED fetch is never cached and yields a rejected promise — callers
//    show NO badges rather than wrong ones.
//  - A person absent from a SUCCESSFUL response has no allocation rows in the
//    window — that is a real "no allocations" signal, not fabricated data.
import { getAllocationUtilization } from "@/lib/api";

export interface PersonAvailability {
  /** Average free hours per week across the window (0..capacity). */
  freeHrsPerWk: number;
  /** Average booked hours per week across the window. */
  bookedHrsPerWk: number;
  /** Distinct projects carrying an allocation somewhere in the window. When an
   * upstream row only supplies per-week counts, this is its highest concurrent
   * project count rather than an invented total. */
  projectCount: number;
  /** Number of week columns the window spans in the feed. */
  weeks: number;
}

export interface AvailabilityIndex {
  /** Keyed by lowercase UserId GUID (preferred join key). */
  byId: Map<string, PersonAvailability>;
  /** Keyed by lowercase display name (fallback when a row has no UserId). */
  byName: Map<string, PersonAvailability>;
  /** Total week columns in the window — a person absent from the maps has no
   *  allocation rows at all (free for the whole window). */
  windowWeeks: number;
}

/** Standard full-time week used to convert booked hours into free hours. */
export const WEEK_CAPACITY_HRS = 40;

const TTL_MS = 5 * 60_000;
// One in-flight/settled promise per (start,end) window — the feed is a heavy
// tenant-wide call, so every consumer of the same window shares one request.
const cache = new Map<string, { at: number; promise: Promise<AvailabilityIndex> }>();

// Meta (non-week) keys observed in the feed — mirrors forecastIntelligence.ts.
const META_KEYS = new Set([
  "UserId", "ResourceUser", "Name", "Title", "Department",
  "Discipline", "Role", "OfficeName", "ManagerName", "Total", "Id",
]);

function isPeriodKey(k: string): boolean {
  if (META_KEYS.has(k)) return false;
  if (/^[A-Z][a-z]{2}-\d{1,2}-\d{2,4}$/.test(k)) return true;  // "Jun-29-26"
  if (/^\d{1,2}-[A-Z][a-z]{2}-\d{2,4}$/.test(k)) return true;  // "29-Jun-26"
  return false;
}

/** Parse a week cell "P:75#H:30#…" → booked hours for that week. Prefers the
 *  explicit H (hours); falls back to P (percent of a standard week). */
function workloadCell(v: unknown): { hours: number; projectCount: number; projectIds: string[] } {
  if (v == null) return { hours: 0, projectCount: 0, projectIds: [] };
  const s = String(v);
  if (!s) return { hours: 0, projectCount: 0, projectIds: [] };
  let pct: number | null = null;
  let hours: number | null = null;
  let projectCount = 0;
  const projectIds: string[] = [];
  for (const part of s.split("#")) {
    const i = part.indexOf(":");
    if (i < 0) continue;
    const key = part.slice(0, i);
    if (key === "H") {
      const h = parseFloat(part.slice(i + 1));
      if (Number.isFinite(h)) hours = Math.max(0, h);
    } else if (key === "P") {
      const p = parseFloat(part.slice(i + 1));
      if (Number.isFinite(p)) pct = p;
    } else if (key === "C") {
      const count = parseInt(part.slice(i + 1), 10);
      if (Number.isFinite(count)) projectCount = Math.max(0, count);
    } else if (key === "IDS") {
      // RDS rows include an ID for every project in this week. Keep them
      // separate rather than counting cells, so a project spanning many weeks
      // is still shown once in the picker.
      for (const raw of part.slice(i + 1).split("|")) {
        const id = raw.split(":")[0]?.trim();
        if (id) projectIds.push(id);
      }
    }
  }
  return {
    hours: hours ?? (pct != null ? Math.max(0, (WEEK_CAPACITY_HRS * pct) / 100) : 0),
    projectCount,
    projectIds,
  };
}

export async function getWindowAvailability(startYmd: string, endYmd: string): Promise<AvailabilityIndex> {
  const key = `${startYmd}|${endYmd}`;
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < TTL_MS) return hit.promise;

  const promise = (async (): Promise<AvailabilityIndex> => {
    const rows = (await getAllocationUtilization({
      startDate: startYmd, endDate: endYmd, mode: "Weekly",
    })) as Record<string, unknown>[];
    const list = Array.isArray(rows) ? rows : [];

    // Week columns = UNION across all rows. Dividing each person's booked
    // total by the FULL window (not just their populated weeks) is what makes
    // "40h in one week of a 14-week window" read as mostly-free, not booked.
    const allWeekKeys = new Set<string>();
    for (const r of list) {
      for (const k of Object.keys(r)) if (isPeriodKey(k)) allWeekKeys.add(k);
    }
    const windowWeeks = allWeekKeys.size;

    const byId = new Map<string, PersonAvailability>();
    const byName = new Map<string, PersonAvailability>();
    if (windowWeeks > 0) {
      for (const r of list) {
        let booked = 0;
        let maxConcurrentProjects = 0;
        const projectIds = new Set<string>();
        for (const k of allWeekKeys) {
          if (!(k in r)) continue;
          const cell = workloadCell(r[k]);
          booked += cell.hours;
          maxConcurrentProjects = Math.max(maxConcurrentProjects, cell.projectCount);
          for (const id of cell.projectIds) projectIds.add(id);
        }
        const bookedPerWk = booked / windowWeeks;
        const entry: PersonAvailability = {
          freeHrsPerWk: Math.max(0, WEEK_CAPACITY_HRS - bookedPerWk),
          bookedHrsPerWk: bookedPerWk,
          projectCount: projectIds.size || maxConcurrentProjects,
          weeks: windowWeeks,
        };
        const id = String(r.UserId ?? "").trim().toLowerCase();
        const nm = String(r.ResourceUser ?? r.Name ?? "").trim().toLowerCase();
        if (id) byId.set(id, entry);
        // Name collisions: keep the FIRST row rather than silently merging —
        // the id join covers the normal case, the name map is only a fallback.
        if (nm && !byName.has(nm)) byName.set(nm, entry);
      }
    }
    return { byId, byName, windowWeeks };
  })();

  cache.set(key, { at: Date.now(), promise });
  // Never cache a failure — the next open retries instead of pinning an error.
  promise.catch(() => { if (cache.get(key)?.promise === promise) cache.delete(key); });
  return promise;
}

/** Human badge for a person's availability. `entry` undefined = the feed
 *  loaded but the person has no allocation rows in the window. */
export function availabilityBadge(entry: PersonAvailability | undefined): {
  label: string; tone: "free" | "tight" | "busy";
} {
  if (!entry) return { label: "No allocations in this window", tone: "free" };
  const free = entry.freeHrsPerWk;
  if (free >= 8) return { label: `Free ~${Math.round(free)}h/wk`, tone: "free" };
  if (free >= 1) return { label: `Only ~${Math.round(free)}h/wk free`, tone: "tight" };
  return { label: "Fully booked", tone: "busy" };
}
