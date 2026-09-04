// ─────────────────────────────────────────────────────────────────────────────
// coalesceWeeklyCellSaves — turns rapid single-cell weekly edits into bulk
// per-project saves.
//
// Every weekly cell save is a heavy round trip: fresh team read → full-map
// POST → verified re-read. When a user zeroes dozens of over-allocated cells
// in quick succession, firing one full save per cell both crawls and risks
// dropped edits. This coalescer keeps ONE save in flight per project ("lane"):
//   • The first edit for a project starts saving immediately (no debounce).
//   • Edits arriving while that save is in flight accumulate into a pending
//     batch, LAST value per week wins.
//   • When the in-flight save settles, the whole pending batch is flushed as
//     ONE atomic weekPatches save through the same shared backend contract
//     (same queueing, 168h validation, past-week locks, verification).
//
// Different projects have independent lanes — their container rows (RWIs) are
// disjoint, and the shared save queue already serializes same-member writes
// where required.
//
// Failure semantics stay honest: if a batch save fails, EVERY edit folded into
// that batch rejects, so each cell rolls back its optimistic value and shows
// the error. Edits are never silently dropped.
// ─────────────────────────────────────────────────────────────────────────────
import type {
  ResourceProjectWeekEdit,
  ResourceProjectWeeksEdit,
} from "@/components/ResourcesTimelineGrid";

interface Settler {
  resolve: () => void;
  reject: (error: unknown) => void;
}

interface PendingBatch {
  /** ISO Monday → hours. Re-editing the same week replaces the older value. */
  weeks: Record<string, number>;
  onAccepted: Array<() => void>;
  settlers: Settler[];
  /** Identity fields (person/project/role) from the latest folded edit. */
  identity: ResourceProjectWeekEdit;
}

interface ProjectLane {
  inFlight: boolean;
  pending: PendingBatch | null;
}

export type WeeklyCellSaver = (edit: ResourceProjectWeekEdit) => Promise<void>;

/**
 * Wrap an atomic multi-week saver into a single-cell saver that coalesces
 * rapid edits per project. The returned promise for each edit settles when
 * the batch that carried it settles.
 */
export function createWeeklyCellSaveCoalescer(
  saveWeeks: (edit: ResourceProjectWeeksEdit) => Promise<void>,
): WeeklyCellSaver {
  const lanes = new Map<string, ProjectLane>();

  // Lanes are keyed by PERSON + project, never project alone. A shared
  // coalescer instance may outlive a person switch (the popup can re-target
  // to another member while a save is still in flight); folding two people's
  // edits into one batch would write one member's weeks under the other's
  // identity. GUID-first, name fallback — same identity precedence as the
  // shared save contract.
  const laneKeyOf = (edit: ResourceProjectWeekEdit): string =>
    `${(edit.personId || edit.personName).toLowerCase()}::${edit.projectId}`;

  const flush = (laneKey: string): void => {
    const lane = lanes.get(laneKey);
    if (!lane || lane.inFlight || !lane.pending) return;
    const batch = lane.pending;
    lane.pending = null;
    lane.inFlight = true;
    // The saver starts SYNCHRONOUSLY (a save must be in flight the moment the
    // first edit lands), but a synchronously-throwing saver is normalized into
    // the rejection path below. Letting it throw out of flush() would skip
    // both the settlers and the finally, stranding the lane with
    // inFlight=true and leaving every queued cell promise pending forever.
    let saveResult: Promise<void>;
    try {
      saveResult = saveWeeks({
        personId: batch.identity.personId,
        personName: batch.identity.personName,
        role: batch.identity.role,
        projectId: batch.identity.projectId,
        projectName: batch.identity.projectName,
        weeks: { ...batch.weeks },
        onAccepted: () => {
          for (const accepted of batch.onAccepted) {
            try {
              accepted();
            } catch {
              // One cell's acceptance hook must never break the others.
            }
          }
        },
      });
    } catch (error) {
      saveResult = Promise.reject(error);
    }
    saveResult
      .then(
        () => {
          for (const settler of batch.settlers) settler.resolve();
        },
        (error: unknown) => {
          for (const settler of batch.settlers) settler.reject(error);
        },
      )
      .finally(() => {
        lane.inFlight = false;
        // Anything that accumulated while this batch was saving goes out as
        // the next single bulk write.
        flush(laneKey);
      });
  };

  return edit =>
    new Promise<void>((resolve, reject) => {
      const laneKey = laneKeyOf(edit);
      let lane = lanes.get(laneKey);
      if (!lane) {
        lane = { inFlight: false, pending: null };
        lanes.set(laneKey, lane);
      }
      if (!lane.pending) {
        lane.pending = { weeks: {}, onAccepted: [], settlers: [], identity: edit };
      }
      lane.pending.identity = edit;
      lane.pending.weeks[edit.week] = edit.hours;
      if (edit.onAccepted) lane.pending.onAccepted.push(edit.onAccepted);
      lane.pending.settlers.push({ resolve, reject });
      flush(laneKey);
    });
}
