/**
 * Per-audience exception rules (settings redesign) — client-side mirror of the
 * server parsers in api-server lib/onboarding-defaults.ts.
 *
 * Each audience-scoped setting keeps its base value (the "Everyone" row) in
 * its existing settings key, plus an ORDERED JSON list of exception rows:
 *   [{ ids: [groupId | org:bu/div/dept sentinel, …], …value }]
 * The FIRST row whose ids intersect the viewer's memberships wins; no match →
 * the base value applies. Matching is POSITIVE-ONLY (no "except" mode), so
 * unknown membership safely falls back to the base value. When a rules key is
 * non-empty the legacy ApplyMode/GroupIds pair for that setting is ignored
 * (the new Settings UI writes applyMode "everyone").
 */

export type DisplayModeValue = "full" | "no-schedule" | "no-schedule-no-hours" | "no-schedule-no-grid" | "schedule-no-grid";
export interface DisplayRule { ids: string[]; value: DisplayModeValue }
export interface PastEditRule { ids: string[]; allow: boolean; limitWeeks: number | null }
export interface DurationRule { ids: string[]; months: number }

const DISPLAY_MODES: DisplayModeValue[] =
  ["full", "no-schedule", "no-schedule-no-hours", "no-schedule-no-grid", "schedule-no-grid"];

/** Shared strict-parse scaffold: JSON array, ≤20 rows, each row needs ≥1 id
 *  and a valid value or the row is dropped. Malformed input → []. */
function parseRuleRows<T>(raw: unknown, coerce: (row: Record<string, unknown>, ids: string[]) => T | null): T[] {
  if (!raw || typeof raw !== "string") return [];
  let parsed: unknown;
  try { parsed = JSON.parse(raw); } catch { return []; }
  if (!Array.isArray(parsed)) return [];
  const out: T[] = [];
  for (const r of parsed.slice(0, 20)) {
    if (!r || typeof r !== "object") continue;
    const rr = r as Record<string, unknown>;
    const ids = Array.isArray(rr.ids)
      ? rr.ids.filter((x): x is string => typeof x === "string")
          .map((s) => s.trim().toLowerCase().slice(0, 80)).filter(Boolean).slice(0, 50)
      : [];
    if (ids.length === 0) continue;
    const row = coerce(rr, ids);
    if (row) out.push(row);
  }
  return out;
}

export function parseDisplayRules(raw: unknown): DisplayRule[] {
  return parseRuleRows<DisplayRule>(raw, (r, ids) =>
    DISPLAY_MODES.includes(r.value as DisplayModeValue) ? { ids, value: r.value as DisplayModeValue } : null);
}

export function parsePastEditRules(raw: unknown): PastEditRule[] {
  return parseRuleRows<PastEditRule>(raw, (r, ids) => {
    if (typeof r.allow !== "boolean") return null;
    let limitWeeks: number | null = null;
    if (typeof r.limitWeeks === "number" && Number.isFinite(r.limitWeeks)) {
      limitWeeks = Math.min(520, Math.max(1, Math.round(r.limitWeeks)));
    } else if (r.limitWeeks !== null && r.limitWeeks !== undefined) return null;
    return { ids, allow: r.allow, limitWeeks: r.allow ? limitWeeks : null };
  });
}

export function parseDurationRules(raw: unknown): DurationRule[] {
  return parseRuleRows<DurationRule>(raw, (r, ids) => {
    const m = typeof r.months === "number" && Number.isFinite(r.months) ? Math.min(120, Math.max(1, Math.round(r.months))) : null;
    return m === null ? null : { ids, months: m };
  });
}

/** First rule (in saved order) whose audience contains the viewer.
 *  `myIds` null (memberships unknown) → null: the base value applies. */
export function firstMatchingRule<T extends { ids: string[] }>(rules: T[], myIds: Set<string> | null): T | null {
  if (!myIds) return null;
  return rules.find((r) => r.ids.some((id) => myIds.has(id))) ?? null;
}
