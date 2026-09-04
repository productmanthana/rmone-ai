// ── Conversion prefill seed ───────────────────────────────────────────────────
// When the user clicks "To Opportunity" (lead detail) or "To Project" (opp
// detail), the FULL record is already rendered on screen — refetching it on
// the create page just makes the user stare at "Loading lead…" over an empty
// form. The detail page writes its in-memory rawFields here right before
// navigating, and the create page consumes the seed synchronously so the form
// is pre-filled on first paint.
//
// Safety rails:
// - sessionStorage (per-tab, gone on browser close) + a 60 s TTL: the seed is
//   only trusted for the immediate click→navigate hop. A later history
//   navigation or direct URL falls back to the normal fetch (with its own
//   loading overlay), so a stale seed can never prefill outdated values.
// - Tenant-scoped key BY CONSTRUCTION (tenantScopedKey) so a tenant switch in
//   the same tab can never leak one tenant's record into another's form.
// - One-shot: the seed is removed on successful read. The fetch path remains
//   the source of truth for every other entry point.
import { tenantScopedKey } from "./api";

const MAX_AGE_MS = 60_000;

const key = (recordId: string) =>
  tenantScopedKey(`rmone:convertSeed:${recordId.trim().toLowerCase()}`);

// Module-level memo of consumed seeds. The sessionStorage entry is one-shot
// (removed on first read), but a double-mounted effect (StrictMode / remount
// quirks) would then miss the seed on its second pass and fall back to a
// pointless refetch. Reads within the TTL are served from here instead.
const consumed = new Map<string, { t: number; raw: Record<string, unknown> }>();

export function writeConvertSeed(recordId: string, raw: Record<string, unknown>): void {
  // An empty seed would "load" instantly with nothing in it AND suppress the
  // fetch fallback — refuse to write one so the create page always refetches.
  if (!recordId || !raw || typeof raw !== "object" || Object.keys(raw).length === 0) return;
  try {
    sessionStorage.setItem(key(recordId), JSON.stringify({ t: Date.now(), raw }));
  } catch {
    // Quota/private-mode failure — the create page's fetch path covers it.
  }
}

export function readConvertSeed(recordId: string): Record<string, unknown> | null {
  if (!recordId) return null;
  try {
    const k = key(recordId);
    const s = sessionStorage.getItem(k);
    if (!s) {
      const memo = consumed.get(k);
      if (memo && Date.now() - memo.t <= MAX_AGE_MS) return memo.raw;
      if (memo) consumed.delete(k);
      return null;
    }
    sessionStorage.removeItem(k); // one-shot — later visits refetch
    const p = JSON.parse(s) as { t?: number; raw?: unknown };
    if (!p || typeof p !== "object" || !p.raw || typeof p.raw !== "object") return null;
    if (Object.keys(p.raw as object).length === 0) return null; // empty seed → refetch
    if (Date.now() - Number(p.t ?? 0) > MAX_AGE_MS) return null;
    const raw = p.raw as Record<string, unknown>;
    consumed.set(k, { t: Number(p.t) || Date.now(), raw });
    return raw;
  } catch {
    return null;
  }
}
