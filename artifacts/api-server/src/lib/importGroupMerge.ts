/**
 * Pure logic for the staff-import "Groups" column merge (extracted from
 * pipeline.ts applyImportedUserGroups so it can be regression-tested the same
 * way the web-side record-import merge is — see
 * rmone-web/src/lib/importGroupMerge.ts for the mirrored contract).
 *
 * Contract highlights (a regression here would silently clobber tenant group
 * membership on every staff import):
 *  - The merge is ADD-only: nobody is ever removed from a group, and existing
 *    member IDs are never dropped or reordered.
 *  - Existing groups are matched by name case-insensitively (trimmed,
 *    whitespace-collapsed); membership dedupe is case-insensitive against the
 *    existing memberIds.
 *  - Unknown group names become NEW groups (capped), never renames.
 */

export interface ServerGroupLike {
  id: string;
  name: string;
  memberIds: string[];
  color: string;
  defaultAccessLevel?: string;
}

export const MAX_GROUPS = 100;
export const MAX_GROUP_MEMBERS = 1000;

/**
 * Mint a stable slug-style group id from a name, avoiding every id in
 * `takenIds` (which it mutates by adding the minted id).
 */
export function mintGroupId(name: string, takenIds: Set<string>): string {
  let base = name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 24).replace(/-+$/g, "");
  if (!/^[a-z0-9]/.test(base)) base = `g${base}`.slice(0, 24);
  let id = base;
  let n = 2;
  while (takenIds.has(id)) { const suf = `-${n++}`; id = base.slice(0, 24 - suf.length) + suf; }
  takenIds.add(id);
  return id;
}

export interface MergeAssignsResult<G extends ServerGroupLike> {
  /** New array; untouched groups are the SAME objects, changed ones are copies. */
  groups: G[];
  /** Memberships appended (existing members never counted, never removed). */
  added: number;
  /** New groups created for unknown names. */
  created: number;
  /** Human-readable notes for skipped work (caps). */
  warnings: string[];
}

/**
 * ADD-only merge of staff-import group assignments into the tenant's group
 * doc. `assigns` maps user GUID → "Group A; Group B" (separators , or ;).
 *
 * Guarantees:
 *  - never mutates `groups` or any group object within it;
 *  - never removes or reorders an existing member ID (preserved verbatim,
 *    order and casing);
 *  - dedupes additions case-insensitively against existing members;
 *  - unknown names create new groups (empty color — sanitizer assigns
 *    palette colors) up to MAX_GROUPS; members cap at MAX_GROUP_MEMBERS.
 */
export function mergeImportedGroupAssigns<G extends ServerGroupLike>(
  groups: G[],
  assigns: Map<string, string> | Iterable<[string, string]>,
): MergeAssignsResult<G | ServerGroupLike> {
  const out: (G | ServerGroupLike)[] = [...groups];
  const byName = new Map<string, number>(); // name (lc) → index in out
  out.forEach((g, i) => byName.set(g.name.trim().toLowerCase(), i));
  const takenIds = new Set(out.map(g => g.id));
  const copied = new Set<number>(); // indexes already copied (safe to push)
  const warnings: string[] = [];
  let added = 0;
  let created = 0;

  for (const [guidRaw, namesRaw] of assigns) {
    const guid = String(guidRaw ?? "").trim().toLowerCase();
    if (!guid) continue;
    for (const part of String(namesRaw ?? "").split(/[;,]/)) {
      const name = part.trim().replace(/\s+/g, " ").slice(0, 80);
      if (!name) continue;
      const key = name.toLowerCase();
      let idx = byName.get(key);
      if (idx === undefined) {
        if (out.length >= MAX_GROUPS) {
          warnings.push(`user groups: ${MAX_GROUPS}-group cap reached — skipping new group "${name}"`);
          continue;
        }
        idx = out.length;
        out.push({ id: mintGroupId(name, takenIds), name, memberIds: [], color: "" });
        byName.set(key, idx);
        copied.add(idx);
        created++;
      }
      const g = out[idx];
      if (g.memberIds.some(m => m.toLowerCase() === guid)) continue;
      if (g.memberIds.length >= MAX_GROUP_MEMBERS) {
        warnings.push(`user groups: "${g.name}" is at the ${MAX_GROUP_MEMBERS}-member cap — skipping ${guid}`);
        continue;
      }
      if (!copied.has(idx)) {
        // Copy-on-write: never mutate a caller-owned group object, and keep
        // existing memberIds verbatim (order + casing).
        out[idx] = { ...g, memberIds: [...g.memberIds] };
        copied.add(idx);
      }
      out[idx].memberIds.push(guid);
      added++;
    }
  }
  return { groups: out, added, created, warnings };
}
