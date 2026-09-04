/**
 * Pure logic for the projects/opportunities import "Groups" column
 * (extracted from InlineDataGrid so it can be regression-tested the same way
 * the gate latches are — see importGateLatches.ts).
 *
 * Contract highlights (a regression here would silently clobber tenant group
 * membership on every import):
 *  - mergeGroupMembers is ADD-only: nobody is ever removed from a group, and
 *    existing member IDs are never dropped or reordered.
 *  - Person-name matching is strict: an ambiguous name (two different people
 *    sharing it) is NEVER guessed — the token drops.
 *  - Only a cell's FIRST token may name a NEW group; later unknown tokens drop.
 */

export interface GroupLike {
  id: string;
  name: string;
  memberIds: string[];
  color?: string;
  defaultAccessLevel?: string;
}

export interface UnknownGroupCandidate { name: string; count: number }

/** Normalized person-name key ("  Mitch  Spencer " → "mitch spencer"). */
export const normPersonName = (s: string): string => s.replace(/\s+/g, " ").trim().toLowerCase();

/**
 * Person-name → user GUID map. Two DIFFERENT people sharing a normalized
 * name map to `null` (ambiguous — never guess); the same GUID appearing
 * twice stays resolvable.
 */
export function buildUserNameMap(userRows: Record<string, unknown>[] | null | undefined): Map<string, string | null> {
  const userByName = new Map<string, string | null>();
  for (const u of userRows ?? []) {
    const guid = String(u.Id ?? u.id ?? "").trim().toLowerCase();
    const label = normPersonName(String(u.Name ?? u.name ?? u.UserName ?? u.username ?? ""));
    if (!guid || !label) continue;
    const prev = userByName.get(label);
    userByName.set(label, prev === undefined || prev === guid ? guid : null);
  }
  return userByName;
}

/**
 * ADD-only member merge: people named next to a group in the file join that
 * group; nobody is ever removed (same contract as the staff-import
 * server-side merge). Existing memberIds are preserved verbatim (order and
 * casing); additions are deduped case-insensitively against them.
 */
export function mergeGroupMembers<G extends GroupLike>(
  groups: G[],
  members: Map<string, Set<string>>,
): { merged: G[]; changed: boolean } {
  let changed = false;
  const merged = groups.map(g => {
    const add = members.get(g.name.trim().toLowerCase());
    if (!add?.size) return g;
    const have = new Set(g.memberIds.map(m => m.toLowerCase()));
    const extra = [...add].filter(m => !have.has(m));
    if (!extra.length) return g;
    changed = true;
    return { ...g, memberIds: [...g.memberIds, ...extra] };
  });
  return { merged, changed };
}

export interface ResolvedRecordGroups {
  /** Unknown FIRST tokens that may become NEW groups (keyed lowercase). */
  unknown: Map<string, UnknownGroupCandidate>;
  /** group name (lowercase) → member GUIDs collected from its cells/rows. */
  members: Map<string, Set<string>>;
}

/**
 * Cell-token → group/person resolution for the record-import Groups column.
 * Cells come in many shapes ("rm1" alone, "PMO; Mitch Spencer",
 * "pmo,director"):
 *  - tokens matching an existing group (canon) are groups;
 *  - tokens matching exactly one staff member are PEOPLE (members of the
 *    cell's groups), never new-group candidates — even in first position;
 *  - ambiguous names (null in userByName) drop — never guess;
 *  - only a cell's FIRST token can name a NEW group;
 *  - everyone in the row's personnel columns joins every group the row names.
 */
export function resolveRecordGroupTokens(
  rows: Record<string, unknown>[],
  key: string,
  canon: Map<string, string>,
  userByName: Map<string, string | null>,
  personnelCols: string[],
): ResolvedRecordGroups {
  const unknown = new Map<string, UnknownGroupCandidate>();
  const members = new Map<string, Set<string>>();
  for (const r of rows) {
    const toks = String(r[key] ?? "").split(/[;,]/).map(s => s.trim()).filter(Boolean);
    const cellGroups: string[] = [];
    const cellPeople: string[] = [];
    toks.forEach((tok, i) => {
      const k = tok.toLowerCase();
      if (canon.has(k)) { cellGroups.push(k); return; }
      const e = unknown.get(k);
      if (e) { cellGroups.push(k); e.count += 1; return; }
      // A token matching an existing staff member is a PERSON, never a
      // new-group candidate — even in first position.
      const guid = userByName.get(normPersonName(tok));
      if (guid) { cellPeople.push(guid); return; }
      if (guid === null) return; // ambiguous name — never guess
      // Only a cell's FIRST token can name a NEW group.
      if (i === 0) { cellGroups.push(k); unknown.set(k, { name: tok, count: 1 }); }
    });
    // Row team → members of every group named on this row. Same strict
    // name matching as cell tokens; unknown or ambiguous names drop.
    if (cellGroups.length) {
      for (const pk of personnelCols) {
        for (const nm of String(r[pk] ?? "").split(/[;,]/)) {
          const guid = userByName.get(normPersonName(nm));
          if (guid) cellPeople.push(guid);
        }
      }
    }
    if (!cellPeople.length) continue;
    for (const g of cellGroups) {
      let set = members.get(g);
      if (!set) { set = new Set(); members.set(g, set); }
      for (const p of cellPeople) set.add(p);
    }
  }
  return { unknown, members };
}

/**
 * Rewrite a Groups cell to the canonical "; "-joined group names it resolved
 * to (dropping person tokens, unknown tokens and duplicates).
 */
export function cleanGroupCellValue(raw: string, canon: Map<string, string>): string {
  const kept: string[] = [];
  for (const tok of raw.split(/[;,]/).map(s => s.trim()).filter(Boolean)) {
    const c = canon.get(tok.toLowerCase());
    if (c && !kept.includes(c)) kept.push(c);
  }
  return kept.join("; ");
}

/**
 * Build the NEW groups to append for confirmed unknown tokens. Never touches
 * `fresh` (existing groups); skips candidates whose name meanwhile exists;
 * mints ids that avoid every taken id; new groups are born with the members
 * collected from their cells.
 */
export function buildNewGroups(
  fresh: GroupLike[],
  prompt: { name: string }[],
  picks: Record<string, string>,
  members: Map<string, Set<string>>,
  seqStart: number,
): GroupLike[] {
  const takenIds = new Set(fresh.map(g => g.id));
  const have = new Set(fresh.map(g => g.name.trim().toLowerCase()));
  let seq = seqStart;
  const additions: GroupLike[] = [];
  for (const g of prompt) {
    if (have.has(g.name.toLowerCase())) continue;
    let id = `grp-${seq++}`;
    while (takenIds.has(id)) id = `grp-${seq++}`;
    takenIds.add(id);
    const lvl = (picks[g.name.toLowerCase()] ?? "").trim();
    additions.push({
      id,
      name: g.name,
      memberIds: [...(members.get(g.name.trim().toLowerCase()) ?? [])],
      ...(lvl ? { defaultAccessLevel: lvl } : {}),
    });
  }
  return additions;
}
