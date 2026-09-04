// ── Add Team Member roster prewarm ───────────────────────────────────────────
// The ONE writer for the in-memory roster seed that useAssignMemberCascade
// reads (AddTeamMemberModal + the inline add row). Every surface that can open
// the add-member flow should call warmAddMemberRoster(projectId) ahead of time
// so the modal opens instantly from the seed instead of gating on six network
// calls behind a "Loading roles & roster…" spinner.
//
// Keys are tenant-scoped BY CONSTRUCTION: a user can switch tenants within one
// SPA session, and an un-scoped key would flash tenant A's staff roster to
// tenant B. The cascade hook reads these keys via addMemberRosterKeys() too,
// so writer and reader can never drift apart.
import {
  getDivisions, getProjectDivisionRoles, getUserList, getJobTitles,
  getBusinessUnits, getDepartments, getStoredUser, type JobTitleRow,
} from "@/lib/api";
import { memSeed } from "@/lib/memSeed";

export const ADD_MEMBER_ROSTER_TTL = 30 * 60_000;

export function addMemberRosterKeys(projectId: string) {
  const tenant = (getStoredUser()?.tenant ?? "x").toLowerCase();
  return {
    rosterKey: `rmone:v1:add-member-roster:${tenant}`,
    projRolesKey: `rmone:v1:add-member-projroles:${tenant}:${projectId}`,
  };
}

function isFresh(raw: string | null): boolean {
  if (!raw) return false;
  try {
    const { ts } = JSON.parse(raw) as { ts: number };
    return Date.now() - ts < ADD_MEMBER_ROSTER_TTL;
  } catch { return false; }
}

/** Prefetch the cascade's lists and write the memSeed seeds. Skips lists whose
 *  seed is still fresh; failure-empty results are NEVER cached (a transient
 *  outage must not pin an empty roster for 30 minutes). Best-effort: never
 *  throws — the cascade always loads its own data as a fallback. */
export async function warmAddMemberRoster(projectId: string): Promise<void> {
  const { rosterKey, projRolesKey } = addMemberRosterKeys(projectId);
  const rosterFresh = isFresh(memSeed.getItem(rosterKey));
  const projFresh = isFresh(memSeed.getItem(projRolesKey));
  if (rosterFresh && projFresh) return;
  try {
    if (rosterFresh) {
      // Only this project's roles list is missing — ONE call, not six.
      const projRolesRaw = await getProjectDivisionRoles(projectId);
      memSeed.setItem(projRolesKey, JSON.stringify({
        data: Array.isArray(projRolesRaw) ? projRolesRaw : [],
        ts: Date.now(),
      }));
      return;
    }
    let allOk = true;
    const safe = <T,>(p: Promise<T>, fb: T) => p.catch(() => { allOk = false; return fb; });
    const [divsRaw, projRolesRaw, usersRaw, jobTitles, buRaw, deptsRaw] = await Promise.all([
      safe(getDivisions(), [] as unknown[]),
      safe(getProjectDivisionRoles(projectId) as Promise<unknown>, [] as unknown),
      safe(getUserList(), [] as Record<string, unknown>[]),
      safe(getJobTitles(), [] as JobTitleRow[]),
      safe(getBusinessUnits(), [] as unknown[]),
      safe(getDepartments(), [] as unknown[]),
    ]);
    // Hollow-cache rule: seeds are only written when EVERY fetch succeeded.
    // A partial write (e.g. user-list 500 → []) would render the modal with
    // an empty people list and NO spinner for the full TTL.
    if (!allOk) return;
    memSeed.setItem(rosterKey, JSON.stringify({
      data: [
        Array.isArray(divsRaw) ? divsRaw : [],
        Array.isArray(usersRaw) ? usersRaw : [],
        Array.isArray(jobTitles) ? jobTitles : [],
        Array.isArray(buRaw) ? buRaw : [],
        Array.isArray(deptsRaw) ? deptsRaw : [],
      ],
      ts: Date.now(),
    }));
    memSeed.setItem(projRolesKey, JSON.stringify({
      data: Array.isArray(projRolesRaw) ? projRolesRaw : [],
      ts: Date.now(),
    }));
  } catch { /* best-effort prewarm — the cascade loads its own data */ }
}
