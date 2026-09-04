// ─────────────────────────────────────────────────────────────────────────────
// Open-slot auto-consume matching — PURE logic, no DB.
//
// getOpenRolesForProject (rds-provider.ts) collapses every open demand row of
// the same role into ONE display position: earliest start, latest end, and ALL
// backing ResourceAllocation IDs. That aggregation is right for DISPLAY, but
// destructive retirement must never use it directly: a project can hold two
// same-role slots with DISJOINT date windows (e.g. a Coordinator needed
// Jan–Mar and another needed Sep–Dec) that the "(N)" suffixing does not
// separate — the suffix only fires when duplicate rows share the SAME start
// date. Matching a member against the combined Jan–Dec window and then
// deleting EVERY backing row would silently retire the untouched future (or
// past) demand too.
//
// The functions here therefore re-split a collapsed slot's backing rows into
// CONTIGUOUS date windows and match the new member against each window
// independently. Only the matched window's row IDs are ever returned, so
// consumeOpenSlotsRds can never soft-delete a same-role window the member does
// not actually cover.
//
// Fail-closed rules (deletion is best-effort and invisible to the caller, so
// ambiguity must always mean "do nothing"):
//   • a row with an unparseable start or end date poisons its whole role
//     group — no windows, no match (an admin can still retire it manually);
//   • the member's OWN dates must parse, and overlap is MANDATORY;
//   • MORE THAN ONE window (across all same-role candidates) overlapping the
//     member's span is AMBIGUOUS → retire nothing. Two concurrent same-role
//     positions are indistinguishable here — picking "the earliest" could
//     silently consume the slot someone else was hired for. Only an exact,
//     unique match may be retired (which also enforces "one person retires at
//     most one position").
// ─────────────────────────────────────────────────────────────────────────────

import { parseDateStrict } from "./openSlotAutoConsume.js";

export interface OpenSlotRow { id: number; start: string; end: string }
export interface OpenSlotWindow { startMs: number; endMs: number; ids: number[] }

/** Weekly demand rows are back-to-back date-only Mon–Sun spans: the next row
 *  starts exactly ONE day after the previous ends. Only truly touching or
 *  overlapping rows merge (next start ≤ prev end + 1 day) — ANY real gap, even
 *  a single skipped day, starts a new window. Merging across a gap would let a
 *  member who only overlaps the gap "match" the merged span and consume rows
 *  they never covered. */
const MAX_GAP_MS = 1 * 86400000;

/** Split one role group's backing rows into contiguous date windows.
 *  Returns [] (no windows → never matched) when ANY row's dates fail to
 *  parse — fail closed, see module doc. */
export function splitSlotWindows(rows: OpenSlotRow[]): OpenSlotWindow[] {
  if (!rows.length) return [];
  const parsed: { id: number; s: number; e: number }[] = [];
  for (const r of rows) {
    // STRICT parsing (see openSlotAutoConsume.parseDateStrict): new Date()
    // alone normalizes impossible dates and accepts junk — never gate
    // destructive writes on it.
    const s = parseDateStrict(r.start);
    // Single-day rows sometimes carry no end — treat end as the start day.
    const e = r.end ? parseDateStrict(r.end) : s;
    if (!Number.isFinite(s) || !Number.isFinite(e) || e < s) return [];
    parsed.push({ id: r.id, s, e });
  }
  parsed.sort((a, b) => a.s - b.s || a.e - b.e);
  const out: OpenSlotWindow[] = [];
  let cur: OpenSlotWindow | null = null;
  for (const p of parsed) {
    if (cur && p.s <= cur.endMs + MAX_GAP_MS) {
      cur.endMs = Math.max(cur.endMs, p.e);
      cur.ids.push(p.id);
    } else {
      cur = { startMs: p.s, endMs: p.e, ids: [p.id] };
      out.push(cur);
    }
  }
  return out;
}

export interface OpenSlotCandidate { role: string; raRows: OpenSlotRow[] }

/** Pick the ONE window to retire for a member spanning [memberStartMs,
 *  memberEndMs]. Returns the match ONLY when exactly one window (across all
 *  candidates) overlaps the member's span; null when the member dates don't
 *  parse, nothing overlaps, or MORE than one window overlaps (ambiguous
 *  concurrent same-role demand) — fail closed in every uncertain case. */
export function pickAutoConsumeWindow(
  candidates: OpenSlotCandidate[],
  memberStartMs: number,
  memberEndMs: number,
): { raIds: number[]; role: string } | null {
  if (!Number.isFinite(memberStartMs) || !Number.isFinite(memberEndMs)) return null;
  const hits: { raIds: number[]; role: string }[] = [];
  for (const c of candidates) {
    for (const w of splitSlotWindows(c.raRows)) {
      if (!(memberStartMs <= w.endMs && w.startMs <= memberEndMs)) continue; // mandatory overlap
      hits.push({ raIds: w.ids, role: c.role });
      if (hits.length > 1) return null; // ambiguous — never guess between concurrent slots
    }
  }
  return hits.length === 1 ? hits[0] : null;
}
