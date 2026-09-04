import { getStoredUser } from "@/lib/api";
import { memSeed } from "@/lib/memSeed";

/* =============================================================
   Project Detail cache (MEMORY-ONLY)

   Caches two kinds of payloads per ticketId so a return visit
   WITHIN the same session renders the project page instantly from
   the last good data while the normal background refresh fetches
   fresh data:

     • "proj"  — the fully-built ProjectData state (record fields,
                 team allocations, health) + open roles.
     • "sec:*" — the raw sub-section payloads (Business Units,
                 Budget & Costs, Schedule) that each section card
                 otherwise fetches on first open.

   Customer requirement: no app data may occupy browser storage, so
   this cache lives in an in-memory store (memSeed) and vanishes on
   page reload — nothing is ever persisted to localStorage.

   Keys are tenant+user scoped BY CONSTRUCTION (never rely on
   clearing at login/logout): a different company or user signing in
   on the same browser reads/writes entirely different keys, so
   cross-tenant data can never leak through this cache.
   ============================================================= */

// Bump when a cached shape changes so old entries miss.
const CODE_VER = "v1";

const PREFIX = `rmone:pd:${CODE_VER}:`;

// A cached payload older than this is ignored as a seed. The page always
// revalidates in the background, so this only bounds how stale the
// instantly-shown page can be. Matches the Forecast/Home seed TTL.
const MAX_SEED_AGE_MS = 4 * 60 * 60 * 1000;

// Keep only the most recent N project snapshots so a power user clicking
// through hundreds of projects can't balloon browser memory.
const MAX_ENTRIES = 60;

type Entry = { data: unknown; ts: number };

function scope(): string | null {
  const u = getStoredUser();
  if (!u) return null;
  return `${u.tenant.toLowerCase()}:${u.username.toLowerCase()}`;
}

function fullKey(kind: string, ticketId: string): string | null {
  const s = scope();
  if (!s || !ticketId) return null;
  return `${PREFIX}${s}:${kind}:${ticketId.toUpperCase()}`;
}

function readEntry<T>(kind: string, ticketId: string): T | undefined {
  const key = fullKey(kind, ticketId);
  if (!key) return undefined;
  try {
    const raw = memSeed.getItem(key);
    if (!raw) return undefined;
    const parsed = JSON.parse(raw) as Entry;
    if (!parsed || parsed.data == null) return undefined;
    if (Date.now() - parsed.ts > MAX_SEED_AGE_MS) return undefined;
    return parsed.data as T;
  } catch {
    return undefined;
  }
}

/** All project-detail cache keys (any tenant/user/version), oldest first. */
function allKeysOldestFirst(): { key: string; ts: number }[] {
  const out: { key: string; ts: number }[] = [];
  try {
    for (const k of memSeed.keys()) {
      if (!k.startsWith("rmone:pd:")) continue;
      let ts = 0;
      try { ts = (JSON.parse(memSeed.getItem(k) || "{}") as Entry).ts || 0; } catch { /* ignore */ }
      out.push({ key: k, ts });
    }
    out.sort((a, b) => a.ts - b.ts);
  } catch { /* ignore */ }
  return out;
}

function trimOldest(keepAtMost: number): void {
  try {
    const all = allKeysOldestFirst();
    for (let i = 0; i < all.length - keepAtMost; i++) {
      memSeed.removeItem(all[i].key);
    }
  } catch { /* ignore */ }
}

function writeEntry(kind: string, ticketId: string, data: unknown): void {
  const key = fullKey(kind, ticketId);
  if (!key || data == null) return;
  let raw: string;
  try {
    raw = JSON.stringify({ data, ts: Date.now() } satisfies Entry);
  } catch {
    return; // non-serializable — never throw into the caller
  }
  // Oversized payloads would balloon memory for one entry — skip.
  if (raw.length > 1_500_000) return;
  memSeed.setItem(key, raw);
  trimOldest(MAX_ENTRIES);
}

/* ── Project snapshot (page-level state) ─────────────────────── */

export function readProjectSnapshot<T>(ticketId: string): T | undefined {
  return readEntry<T>("proj", ticketId);
}

export function writeProjectSnapshot(ticketId: string, snap: unknown): void {
  writeEntry("proj", ticketId, snap);
}

/**
 * Evict all project-detail cache entries for the current tenant+user.
 * Call this whenever org data (BU, Division, Dept) is renamed or deleted
 * so that project detail pages don't seed from a snapshot with stale names.
 */
export function bustProjectDetailCache(): void {
  const s = scope();
  if (!s) return;
  const scopedPrefix = `${PREFIX}${s}:`;
  try {
    for (const k of memSeed.keys()) {
      if (k.startsWith(scopedPrefix)) memSeed.removeItem(k);
    }
  } catch { /* ignore */ }
}

/* ── Sub-section seeds (raw section payloads) ────────────────── */

export function readSectionSeed<T>(section: string, ticketId: string): T | undefined {
  return readEntry<T>(`sec:${section}`, ticketId);
}

export function writeSectionSeed(section: string, ticketId: string, data: unknown): void {
  writeEntry(`sec:${section}`, ticketId, data);
}
