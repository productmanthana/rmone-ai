import { getStagePermsForTenant, getUserGroupsForTenant } from "./src/lib/access-control.js";
const tenant = "test20";
const perms = await getStagePermsForTenant(tenant);
const groups = await getUserGroupsForTenant(tenant);
const byId = new Map(groups.groups.map(g => [g.id, g]));
console.log(JSON.stringify({
  ruleCount: perms.rules.length,
  rules: perms.rules.map(r => ({
    module: r.module, stage: r.stage, othersMode: r.othersMode,
    actionGroups: r.actionGroupIds.map(g => ({ id: g, name: byId.get(g)?.name ?? g, members: byId.get(g)?.memberIds?.length ?? "?" })),
    actionUsers: r.actionUserIds,
    editorGroups: r.editorGroupIds.map(g => byId.get(g)?.name ?? g),
    editorUsers: r.editorUserIds,
  })),
  groupRoster: groups.groups.filter(g => perms.rules.some(r => r.actionGroupIds.includes(g.id) || r.editorGroupIds.includes(g.id))).map(g => ({ name: g.name, memberIds: g.memberIds })),
}, null, 2));
process.exit(0);
