import { v5 as uuidv5 } from "uuid";
import { getPool } from "../lib/db.js";
import { getActiveUsersByTenant } from "@workspace/db";
import { getManagersListRds, getManagerStaffRds } from "../lib/rds-provider.js";

const TENANT_NAMESPACE = "5d8f1e6a-2c3b-4d7e-9a1f-0b2c3d4e5f6a";
const label = process.argv[2] || "test21";
const tid = uuidv5(label.toLowerCase(), TENANT_NAMESPACE);

const KP_COLS = [
  "ProjectLeadUser","ProjectManagerUser","SeniorProjectManagerUser",
  "BusinessLeadUser","OwnerUser","LeadEstimatorUser","ProgramManagerUser",
  "EstimatorUser","SeniorEstimatorUser","SeniorMEPManagerUser",
  "LeadSuperintendentUser","SuperintendentUser","SeniorSuperintendentUser",
  "SponsorsUser","StakeHoldersUser","PointOfContact",
  "PresidentUser","ExecutiveVicePresidentUser","SeniorVicePresidentUser",
  "VicePresidentUser","ProjectExecutiveUser","PrincipalUser","AssociateVicePresidentUser",
];

async function main() {
  console.log(`tenant ${label} tid=${tid}`);
  const users = await getActiveUsersByTenant(tid);
  console.log(`active users: ${users.length}`);
  const withMgr = users.filter(u => (u as any).managerUserId);
  console.log(`users with managerUserId set: ${withMgr.length}`);
  const mgrIds = new Set(withMgr.map(u => String((u as any).managerUserId).toLowerCase()));
  console.log(`distinct managerUserIds: ${[...mgrIds].join(", ")}`);
  for (const mid of mgrIds) {
    const m = users.find(u => u.id.toLowerCase() === mid);
    console.log(`  manager ${mid} -> ${m ? m.name : "NOT AN ACTIVE USER"}`);
  }

  const pool = await getPool();
  // which KP columns exist on PMM
  const colsRes = await pool.request().query(
    `SELECT c.name FROM core2.sys.columns c JOIN core2.sys.tables t ON t.object_id=c.object_id WHERE t.name='PMM'`);
  const pmmCols = new Set((colsRes.recordset ?? []).map((r: any) => String(r.name)));
  const existing = KP_COLS.filter(c => pmmCols.has(c));
  console.log(`\nKP cols existing on PMM: ${existing.join(", ") || "(none)"}`);

  if (existing.length) {
    const sel = existing.map(f => `ISNULL(LTRIM(RTRIM([${f}])),'') AS [${f}]`).join(",");
    const r = await pool.request().input("t", tid).query(
      `SELECT TOP 500 ${sel} FROM core2.dbo.PMM WHERE TenantID=@t AND (Deleted IS NULL OR Deleted=0)`);
    const rows = r.recordset ?? [];
    console.log(`PMM rows sampled: ${rows.length}`);
    const tokCount = new Map<string, number>();
    const colNonEmpty = new Map<string, number>();
    for (const row of rows) {
      for (const f of existing) {
        const v = String(row[f] ?? "").trim();
        if (!v) continue;
        colNonEmpty.set(f, (colNonEmpty.get(f) ?? 0) + 1);
        for (const tok of v.split(/[,;]+/).map(s => s.replace(/^#/, "").trim().toLowerCase()).filter(Boolean)) {
          tokCount.set(tok, (tokCount.get(tok) ?? 0) + 1);
        }
      }
    }
    console.log(`non-empty per col:`, Object.fromEntries(colNonEmpty));
    const userIdSet = new Set(users.map(u => u.id.toLowerCase()));
    const nameToId = new Map(users.map(u => [String(u.name ?? "").trim().toLowerCase(), u.id]));
    let idMatch = 0, nameMatch = 0, noMatch = 0;
    const noMatchSamples: string[] = [];
    for (const tok of tokCount.keys()) {
      if (userIdSet.has(tok)) idMatch++;
      else if (nameToId.has(tok)) nameMatch++;
      else { noMatch++; if (noMatchSamples.length < 12) noMatchSamples.push(tok); }
    }
    console.log(`distinct tokens: ${tokCount.size} | match user GUID: ${idMatch} | match user NAME: ${nameMatch} | no match: ${noMatch}`);
    console.log(`sample tokens:`, [...tokCount.keys()].slice(0, 12));
    if (noMatchSamples.length) console.log(`no-match samples:`, noMatchSamples);
  }

  const list = await getManagersListRds(tid);
  console.log(`\ngetManagersListRds -> ${list.length}:`, list.map(m => m.name).join(" | "));
  for (const m of list.slice(0, 5)) {
    const d = await getManagerStaffRds(tid, m.id);
    console.log(`  ${m.name}: direct=${d.direct.length} projectTeam=${d.projectTeam.length} managedProjects=${d.managedProjects.map(p => p.ticketId + "(" + p.leadRole + ")").join(",") || "-"} err=${d.projectTeamError}`);
  }
  process.exit(0);
}
main().catch(e => { console.error("FAIL", e); process.exit(1); });
