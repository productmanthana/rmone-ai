// ── Pure model behind GroupAccessLevelPopup ──────────────────────────────
// The popup's suggested-level opt-in rules live here so they are testable
// without React. Key invariant (architect review, Aug 2026): ✕-removing a
// suggested level must mean "don't create it" — even if a SAME-NAMED draft
// is typed later via "+ New level", it is only created when a group actually
// picks it (the picked-only rule), never auto-created by the stale opt-in.

/** A level defined in the popup: name + caller-defined capability ticks. */
export interface LevelDraft<C> {
  name: string;
  caps: C;
}

/** File-detected level names that truly don't exist yet — deduped
 *  case-insensitively (first casing wins) and checked against built-ins and
 *  tenant customs, so case-variants can never seed two colliding drafts. */
export function buildSuggestedSeed(
  suggestedLevels: string[] | undefined,
  customLevels: string[],
  builtins: readonly string[],
): string[] {
  const seen = new Map<string, string>();
  for (const raw of suggestedLevels ?? []) {
    const n = raw.trim().slice(0, 80);
    if (!n || [...builtins, ...customLevels].some(x => x.trim().toLowerCase() === n.toLowerCase())) continue;
    if (!seen.has(n.toLowerCase())) seen.set(n.toLowerCase(), n);
  }
  return [...seen.values()];
}

/** ✕ on a suggested chip drops its LIVE opt-in too — returns the same Set
 *  when the name wasn't opted in (referential no-op for React state). */
export function removeSuggestedOptIn(optedIn: Set<string>, name: string): Set<string> {
  const k = name.trim().toLowerCase();
  if (!optedIn.has(k)) return optedIn;
  const next = new Set(optedIn);
  next.delete(k);
  return next;
}

/** Committing a "+ New level" draft. When the name already exists among the
 *  offered levels (built-in, tenant custom, or typed a moment ago) the
 *  existing one is selected instead of minting a duplicate. NOTE: this never
 *  touches the suggested opt-in set — a ✕-removed suggestion stays removed. */
export function commitDraftLevel<C>(
  offeredLevels: string[],
  created: LevelDraft<C>[],
  rawName: string,
  caps: C,
): { created: LevelDraft<C>[]; pick: string | null } {
  const name = rawName.trim().slice(0, 80); // server caps names at 80 chars
  if (!name) return { created, pick: null };
  const existing = offeredLevels.find(l => l.toLowerCase() === name.toLowerCase());
  if (existing) return { created, pick: existing };
  return { created: [...created, { name, caps }], pick: name };
}

/** Levels that actually get created on confirm: ones a group picked, plus
 *  file-suggested ones the user left opted in (their rows carry the name
 *  directly). A draft typed then never used is discarded — no junk levels. */
export function computeUsedNewLevels<C>(
  created: LevelDraft<C>[],
  picks: Record<string, string>,
  optedInSuggested: Set<string>,
): LevelDraft<C>[] {
  return created.filter(c =>
    Object.values(picks).includes(c.name) || optedInSuggested.has(c.name.trim().toLowerCase()),
  );
}
