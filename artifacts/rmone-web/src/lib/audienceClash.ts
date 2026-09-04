/**
 * Audience-overlap detection — shared by the Schedule-phases card
 * (projectPhaseSets / oppStageSets exceptions + the scoped Default list) and
 * the Stage Rules workflow stage sets.
 *
 * Both features answer "which list does this person get?" by first-match-wins
 * over an ordered list of audience-scoped entries. When one person sits in
 * TWO audiences (picked directly, or through a group), the lower-priority
 * entry silently loses — the admin meant one thing and the app quietly does
 * another. This scanner finds every such overlap BEFORE save so the UI can
 * show a conflict popup (remove from one side / save anyway) instead of
 * silently picking a winner.
 *
 * Pure + synchronous: groups expand through the memberIds already loaded for
 * the audience pickers. org:bu/div/dept sentinels have no client-side member
 * list (the server resolves them live), so org units clash only when the
 * SAME unit id appears on both sides. "role:<guid>" sentinels behave the same
 * way — their pseudo-group entries carry empty memberIds and a "Role: …"
 * display name, so a shared role id reports as a "group" clash under that
 * name, which reads correctly in the dialog.
 */
import type { UserGroup } from "./permissions";
import { isUserAudienceId, USER_AUDIENCE_PREFIX, type PersonOption } from "./audienceIds";

/** Lockstep with ORG_AUDIENCE_RE in lib/orgAudience.ts — duplicated so this
 *  module stays import-light (runnable in node tests without the api client). */
const ORG_ID_RE = /^org:(bu|div|dept):/i;

export interface ClashAudience {
  /** Stable id of the entry (exception set id / template id / default-scope id). */
  key: string;
  /** Display name — "test3", "Default list", … */
  label: string;
  applyMode?: "everyone" | "except" | "groups";
  groupIds: string[];
  /** Position in resolution order — LOWER number is checked first and wins. */
  priority: number;
}

export interface AudienceClash {
  /** What is shared: one person, a whole group, or an org unit. */
  subjectKind: "person" | "group" | "org";
  subjectName: string;
  winner: ClashAudience;
  loser: ClashAudience;
  /** The audience id whose removal from that side resolves the clash… */
  winnerViaId: string;
  loserViaId: string;
  /** …and how to describe that coverage: group name, or null = picked directly. */
  winnerViaName: string | null;
  loserViaName: string | null;
}

const low = (s: unknown) => String(s ?? "").trim().toLowerCase();

/**
 * Find every audience overlap between the given entries.
 * Entries must be passed in RESOLUTION ORDER semantics via `priority`
 * (lower priority number = checked first = wins). Only effective
 * "groups"-mode audiences participate: "everyone" overlaps everything by
 * design, and legacy "except" audiences have complement semantics that make
 * "overlap" meaningless.
 */
export function findAudienceClashes(
  entries: ClashAudience[],
  groups: UserGroup[],
  people?: PersonOption[] | null,
): AudienceClash[] {
  const groupById = new Map(groups.map((g) => [low(g.id), g]));
  const personName = (uid: string): string => {
    const p = (people ?? []).find((x) => low(x.value) === uid);
    if (p) return p.label;
    return uid.length > 12 ? `${uid.slice(0, 10)}…` : uid; // roster unavailable
  };

  // Only audiences that actually scope by membership.
  const scoped = entries.filter(
    (e) => e.groupIds.length > 0 && (e.applyMode === "groups" || !e.applyMode),
  );

  // Expand each audience: person id (lowercased, sentinel prefix stripped) →
  // the audience id that covers them. Direct picks beat group coverage inside
  // one entry (more specific for messaging).
  type Cover = { viaId: string; direct: boolean };
  const expanded = scoped.map((e) => {
    const persons = new Map<string, Cover>();
    const rawIds = new Set<string>();
    for (const id of e.groupIds) {
      const idL = low(id);
      if (!idL) continue;
      rawIds.add(idL);
      if (isUserAudienceId(idL)) {
        persons.set(idL.slice(USER_AUDIENCE_PREFIX.length), { viaId: id, direct: true });
      } else {
        const g = groupById.get(idL);
        for (const m of g?.memberIds ?? []) {
          const mL = low(m);
          if (mL && !persons.get(mL)?.direct) persons.set(mL, { viaId: id, direct: false });
        }
      }
    }
    return { e, persons, rawIds };
  });

  const out: AudienceClash[] = [];
  for (let i = 0; i < expanded.length; i++) {
    for (let j = i + 1; j < expanded.length; j++) {
      const A = expanded[i];
      const B = expanded[j];
      const [win, lose] = A.e.priority <= B.e.priority ? [A, B] : [B, A];
      // 1) The SAME audience id on both sides — whole group, org unit, or the
      //    same person picked directly twice.
      const sharedRaw = new Set<string>();
      for (const idL of win.rawIds) {
        if (!lose.rawIds.has(idL)) continue;
        sharedRaw.add(idL);
        const kind: AudienceClash["subjectKind"] =
          isUserAudienceId(idL) ? "person" : ORG_ID_RE.test(idL) ? "org" : "group";
        const name = kind === "person"
          ? personName(idL.slice(USER_AUDIENCE_PREFIX.length))
          : groupById.get(idL)?.name ?? idL;
        out.push({
          subjectKind: kind, subjectName: name,
          winner: win.e, loser: lose.e,
          winnerViaId: idL, loserViaId: idL,
          winnerViaName: null, loserViaName: null,
        });
      }
      // 2) The same PERSON covered through DIFFERENT ids (direct pick vs
      //    group, or two different groups). Coverage through an id already
      //    reported in (1) is skipped — removing that shared id fixes it.
      for (const [uid, cw] of win.persons) {
        const cl = lose.persons.get(uid);
        if (!cl || low(cw.viaId) === low(cl.viaId)) continue;
        if (sharedRaw.has(low(cw.viaId)) || sharedRaw.has(low(cl.viaId))) continue;
        out.push({
          subjectKind: "person", subjectName: personName(uid),
          winner: win.e, loser: lose.e,
          winnerViaId: cw.viaId,
          winnerViaName: cw.direct ? null : groupById.get(low(cw.viaId))?.name ?? cw.viaId,
          loserViaId: cl.viaId,
          loserViaName: cl.direct ? null : groupById.get(low(cl.viaId))?.name ?? cl.viaId,
        });
      }
    }
  }
  // Deduplicate: each person or group is shown at most once regardless of how
  // many schedule-entry pairs they clash between. The first row in `out` for a
  // given subject is already the highest-priority (lowest priority-number)
  // winner, so first-wins is the right collapse strategy.
  const seen = new Set<string>();
  return out.filter((c) => {
    const key = `${c.subjectKind}|${c.subjectName}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}
