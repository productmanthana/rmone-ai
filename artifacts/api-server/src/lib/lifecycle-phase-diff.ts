export interface LifecyclePhaseRename {
  old: string;
  nw: string;
}

export interface LifecyclePhaseAddition {
  title: string;
  step: number;
}

export interface LifecyclePhasePropagationPlan {
  renames: LifecyclePhaseRename[];
  added: LifecyclePhaseAddition[];
  removed: string[];
  ordered: LifecyclePhaseAddition[];
  orderChanged: boolean;
}

interface PhaseEntry {
  title: string;
  key: string;
  index: number;
}

const phaseKey = (value: string): string => value.trim().toLowerCase();

/**
 * Plans how a lifecycle-template rewrite should be reflected in PMMTasks.
 *
 * Existing titles are identities, regardless of where they move. A title is
 * considered a rename only when an old-only and new-only title occupy the same
 * position. This makes the common one-row rename deterministic while ensuring
 * a middle insertion/deletion can never be mistaken for a chain of renames.
 */
export function planLifecyclePhasePropagation(
  oldPhases: string[],
  newPhases: string[],
): LifecyclePhasePropagationPlan {
  const toEntries = (values: string[]): PhaseEntry[] =>
    values
      .map((value, index) => ({ title: String(value ?? "").trim(), index }))
      .filter((entry) => entry.title.length > 0)
      .map((entry) => ({ ...entry, key: phaseKey(entry.title) }));

  const oldEntries = toEntries(oldPhases);
  const newEntries = toEntries(newPhases);
  const count = (entries: PhaseEntry[]): Map<string, number> => {
    const out = new Map<string, number>();
    for (const entry of entries) out.set(entry.key, (out.get(entry.key) ?? 0) + 1);
    return out;
  };
  const oldCounts = count(oldEntries);
  const newCounts = count(newEntries);
  const commonBudget = new Map<string, number>();
  for (const [key, oldCount] of oldCounts) {
    commonBudget.set(key, Math.min(oldCount, newCounts.get(key) ?? 0));
  }

  const unmatched = (entries: PhaseEntry[]): PhaseEntry[] => {
    const used = new Map<string, number>();
    return entries.filter((entry) => {
      const seen = used.get(entry.key) ?? 0;
      used.set(entry.key, seen + 1);
      return seen >= (commonBudget.get(entry.key) ?? 0);
    });
  };

  const oldOnly = unmatched(oldEntries);
  const newOnly = unmatched(newEntries);
  const newOnlyAt = new Map(newOnly.map((entry) => [entry.index, entry]));
  const pairedOld = new Set<number>();
  const pairedNew = new Set<number>();
  const renameByOldIndex = new Map<number, PhaseEntry>();
  const seenRenameSources = new Set<string>();
  const renames: LifecyclePhaseRename[] = [];

  // A one-row rename keeps its position. Do not pair shifted entries: those
  // are structural insertions/removals and must preserve every common title.
  for (const oldEntry of oldOnly) {
    const newEntry = newOnlyAt.get(oldEntry.index);
    if (!newEntry || seenRenameSources.has(oldEntry.key)) continue;
    pairedOld.add(oldEntry.index);
    pairedNew.add(newEntry.index);
    renameByOldIndex.set(oldEntry.index, newEntry);
    seenRenameSources.add(oldEntry.key);
    renames.push({ old: oldEntry.title, nw: newEntry.title });
  }

  // Preserve case-only title edits at the same position as explicit renames.
  for (let i = 0; i < Math.min(oldEntries.length, newEntries.length); i++) {
    const oldEntry = oldEntries[i];
    const newEntry = newEntries[i];
    if (
      oldEntry.key === newEntry.key
      && oldEntry.title !== newEntry.title
      && !seenRenameSources.has(oldEntry.key)
    ) {
      seenRenameSources.add(oldEntry.key);
      renames.push({ old: oldEntry.title, nw: newEntry.title });
    }
  }

  const removedEntries = oldOnly.filter((entry) => !pairedOld.has(entry.index));
  const addedEntries = newOnly.filter((entry) => !pairedNew.has(entry.index));
  const uniqueByKey = <T extends { key: string }>(entries: T[]): T[] => {
    const seen = new Set<string>();
    return entries.filter((entry) => {
      if (seen.has(entry.key)) return false;
      seen.add(entry.key);
      return true;
    });
  };
  const added = uniqueByKey(addedEntries).map((entry) => ({
    title: entry.title,
    step: entry.index + 1,
  }));
  const removed = uniqueByKey(removedEntries).map((entry) => entry.title);
  const ordered = uniqueByKey(newEntries).map((entry) => ({
    title: entry.title,
    step: entry.index + 1,
  }));

  // Track the original DB step for every row that survives (including renamed
  // rows). Middle insertions/deletions and pure reorders require a step sync;
  // tail-only structural changes and same-position renames do not.
  const removedIndexes = new Set(removedEntries.map((entry) => entry.index));
  const sourceIndexes = new Map<string, number[]>();
  for (const oldEntry of oldEntries) {
    if (removedIndexes.has(oldEntry.index)) continue;
    const projectedKey = renameByOldIndex.get(oldEntry.index)?.key ?? oldEntry.key;
    const indexes = sourceIndexes.get(projectedKey) ?? [];
    indexes.push(oldEntry.index);
    sourceIndexes.set(projectedKey, indexes);
  }
  const addedIndexes = new Set(addedEntries.map((entry) => entry.index));
  let orderChanged = false;
  for (const newEntry of newEntries) {
    if (addedIndexes.has(newEntry.index)) continue;
    const indexes = sourceIndexes.get(newEntry.key);
    const oldIndex = indexes?.shift();
    if (oldIndex !== undefined && oldIndex !== newEntry.index) orderChanged = true;
  }

  return { renames, added, removed, ordered, orderChanged };
}