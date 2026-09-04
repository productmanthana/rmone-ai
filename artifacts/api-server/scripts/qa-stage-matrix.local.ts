// End-to-end matrix for the effective-stage permission fix (Quick Actions
// blanket-lock bug): stored legacy "Active" + stage rule must no longer lock
// records whose VISIBLE phase is something else, while rules anchored on the
// visible phase still enforce, and per-capability locks stay per-card.
// Usage: npx tsx scripts/qa-stage-matrix.local.ts [tenantLabel]
import { getPool } from "../src/lib/db.js";
import { v5 as uuidv5 } from "uuid";
import { signRdsToken } from "../src/lib/rds-auth.js";

const TENANT_NAMESPACE_ORG = "5d8f1e6a-2c3b-4d7e-9a1f-0b2c3d4e5f6a";
const label = process.argv[2] ?? "test20";
const tid = uuidv5(label.toLowerCase(), TENANT_NAMESPACE_ORG);
const BASE = `http://127.0.0.1:${process.env.API_PORT || "8080"}/api/rmone`;
const NOTE_FIELD = process.env.NOTE_FIELD || "Comment";

const day = (v: unknown): string => {
  if (v == null) return "";
  const d = v instanceof Date ? v : new Date(String(v));
  if (isNaN(d.getTime())) return "";
  const s = d.toISOString().slice(0, 10);
  return s > "2000-12-31" ? s : "";
};
const today = new Date().toISOString().slice(0, 10);
const pool = await getPool();

async function colExists(col: string): Promise<boolean> {
  const r = await pool.request().query(`SELECT COL_LENGTH('core2.dbo.PMMTasks','${col}') AS l`);
  return Boolean(r.recordset?.[0]?.l);
}
const hasManual = Boolean(
  (await pool.request().query(`SELECT COL_LENGTH('core2.dbo.PMM','StatusManualDate') AS l`)).recordset?.[0]?.l,
);

// ── Real actors (tokens must carry the true user id in sub — the server
//    derives groups/level overrides from it) ─────────────────────────────
const users = await pool.request().query(`
  SELECT id, username, access_level FROM rmoneapp.dbo.rmone_users
  WHERE LOWER(tenant_id) IN ('${label.toLowerCase()}', '${tid}')
    AND (username LIKE 'priya.sharma%' OR username LIKE 'arjun.menon%')`);
let priyaId = "", arjunId = "";
for (const u of (users.recordset ?? []) as Record<string, unknown>[]) {
  const un = String(u.username);
  if (un.startsWith("priya")) priyaId = String(u.id);
  if (un.startsWith("arjun")) arjunId = String(u.id);
}
console.log(`actors: priya=${priyaId} arjun=${arjunId}`);
if (!priyaId || !arjunId) { console.error("actors missing — abort"); process.exit(1); }

interface Ph { name: string; sd: string; ed: string }
async function phasesOf(ticket: string): Promise<Ph[]> {
  const q = (ord: string) => `
    SELECT t.Title AS name, MIN(${ord}) AS ord, MIN(t.ID) AS tie,
           MIN(t.StartDate) AS sd, MAX(t.DueDate) AS ed
    FROM core2.dbo.PMMTasks t WITH (NOLOCK)
    WHERE t.TenantID = '${tid}' AND t.TicketId = '${ticket}'
      AND (t.Deleted = 0 OR t.Deleted IS NULL)
      AND LTRIM(RTRIM(COALESCE(t.Title,''))) <> ''
    GROUP BY t.Title ORDER BY ord ASC, tie ASC`;
  let rs;
  try { rs = await pool.request().query(q("t.ItemOrder")); }
  catch { rs = await pool.request().query(q("t.ID")); }
  return (rs.recordset ?? []).map((x: Record<string, unknown>) => ({
    name: String(x.name ?? "").trim(), sd: day(x.sd), ed: day(x.ed),
  }));
}
function derivedOf(phases: Ph[]): string | null {
  if (phases.length === 0) return null;
  const sorted = [...phases].sort((a, b) => {
    const ka = a.sd || "9999-99-99"; const kb = b.sd || "9999-99-99";
    return ka < kb ? -1 : ka > kb ? 1 : 0;
  });
  const active = sorted.find((p) => p.sd && p.ed && p.sd <= today && today <= p.ed);
  if (active) return active.name;
  const up = sorted.find((p) => p.sd && p.sd > today);
  if (up) return up.name;
  return sorted[sorted.length - 1].name; // last row — dated or not (web parity)
}
function effectiveOf(stored: string, manualDay: string, phases: Ph[]): string {
  if (/complet|closed|cancel|lost|declin/i.test(stored)) return stored;
  if (phases.length === 0) return stored;
  let lastStarted = "";
  for (const p of phases) if (p.sd && p.sd <= today && p.sd > lastStarted) lastStarted = p.sd;
  if (manualDay && (!lastStarted || manualDay >= lastStarted)) return stored;
  return derivedOf(phases) ?? stored;
}

// ── Part A: find (or fabricate) the mismatch fixture ─────────────────────
const manualSel = hasManual ? "StatusManualDate" : "NULL AS StatusManualDate";
const act = await pool.request().query(`
  SELECT TOP 12 TicketId, Title, Status, ${manualSel} FROM core2.dbo.PMM
  WHERE TenantID = '${tid}' AND (Deleted = 0 OR Deleted IS NULL)
    AND LTRIM(RTRIM(COALESCE(Status,''))) = 'Active'
  ORDER BY TicketId DESC`);
let mismatch = ""; let mismatchPhase = ""; let bare = "";
console.log("── stored-Active PMM records ──");
for (const row of (act.recordset ?? []) as Record<string, unknown>[]) {
  const t = String(row.TicketId).trim();
  const ph = await phasesOf(t);
  const md = day(row.StatusManualDate);
  const eff = effectiveOf("Active", md, ph);
  console.log(`${t}  "${String(row.Title).slice(0, 30)}"  manual=${md || "-"}  phases=${ph.length}  EFFECTIVE=${eff}`);
  if (eff !== "Active" && !mismatch) { mismatch = t; mismatchPhase = eff; }
  if (ph.length === 0 && !md && !bare && /^(SP|P-|p-)/i.test(String(row.Title))) bare = t;
}

if (!mismatch && bare) {
  // Fabricate the user's reported scenario on a throwaway sample record:
  // stored "Active" + an all-past dated schedule ending on "Project Complete".
  console.log(`fabricating dated schedule on sample record ${bare} …`);
  const idIdent = Boolean((await pool.request().query(`
    SELECT c.is_identity AS i FROM core2.sys.columns c
    JOIN core2.sys.objects o ON o.object_id = c.object_id
    WHERE o.name = 'PMMTasks' AND c.name = 'ID'`)).recordset?.[0]?.i);
  const has = async (c: string) => await colExists(c);
  const phases: Array<[string, number, string, string]> = [
    ["Pre-Design", 1, "2026-01-05", "2026-03-01"],
    ["Construction Admin", 2, "2026-03-02", "2026-06-30"],
    ["Project Complete", 3, "2026-07-01", "2026-08-01"],
  ];
  let basePmm = 0, baseId = 0;
  const hasPmmId = await has("PMMIdLookup");
  if (hasPmmId) {
    basePmm = Number((await pool.request().query(
      `SELECT ISNULL(MAX([PMMIdLookup]),0) AS v FROM core2.dbo.PMMTasks WITH (UPDLOCK, HOLDLOCK)`)).recordset?.[0]?.v ?? 0);
  }
  if (!idIdent && await has("ID")) {
    baseId = Number((await pool.request().query(
      `SELECT ISNULL(MAX([ID]),0) AS v FROM core2.dbo.PMMTasks WITH (UPDLOCK, HOLDLOCK)`)).recordset?.[0]?.v ?? 0);
  }
  const optional: Record<string, boolean> = {
    Deleted: await has("Deleted"), Created: await has("Created"), Modified: await has("Modified"),
    SprintLookup: await has("SprintLookup"), UserSkillMultiLookup: await has("UserSkillMultiLookup"),
    PercentComplete: await has("PercentComplete"), Status: await has("Status"),
    StageStep: await has("StageStep"), ItemOrder: await has("ItemOrder"),
  };
  let n = 0;
  for (const [title, step, sd, ed] of phases) {
    n += 1;
    const cols: string[] = ["[TenantID]", "[TicketId]", "[Title]", "[StartDate]", "[DueDate]"];
    const vals: string[] = ["@tid", "@t", "@n", "@sd", "@ed"];
    const req = pool.request()
      .input("tid", tid).input("t", bare).input("n", title)
      .input("sd", new Date(`${sd}T00:00:00Z`)).input("ed", new Date(`${ed}T00:00:00Z`));
    if (optional.StageStep) { cols.push("[StageStep]"); vals.push("@st"); req.input("st", step); }
    if (optional.ItemOrder) { cols.push("[ItemOrder]"); vals.push("@io"); req.input("io", step); }
    if (optional.Status) { cols.push("[Status]"); vals.push("'Not Started'"); }
    if (optional.PercentComplete) { cols.push("[PercentComplete]"); vals.push("0"); }
    if (optional.Deleted) { cols.push("[Deleted]"); vals.push("0"); }
    if (optional.SprintLookup) { cols.push("[SprintLookup]"); vals.push("0"); }
    if (optional.UserSkillMultiLookup) { cols.push("[UserSkillMultiLookup]"); vals.push("0"); }
    if (optional.Created) { cols.push("[Created]"); vals.push("GETUTCDATE()"); }
    if (optional.Modified) { cols.push("[Modified]"); vals.push("GETUTCDATE()"); }
    if (hasPmmId) { cols.push("[PMMIdLookup]"); vals.push(String(basePmm + n)); }
    if (!idIdent && await has("ID")) { cols.push("[ID]"); vals.push(String(baseId + n)); }
    await req.query(`INSERT INTO core2.dbo.PMMTasks (${cols.join(", ")}) VALUES (${vals.join(", ")})`);
  }
  console.log(`inserted ${n} dated phase rows on ${bare}`);
  mismatch = bare; mismatchPhase = "Project Complete";
}
console.log(`picked: MISMATCH=${mismatch || "(none!)"} (visible phase "${mismatchPhase}")`);
if (!mismatch) { console.error("no mismatch fixture — abort"); process.exit(1); }

// A ruled-stage OPM record: rules exist for "Pending Assignment" / "Proposal Development".
const opps = await pool.request().query(`
  SELECT TOP 60 TicketId, CRMOpportunityStatusChoice AS st FROM core2.dbo.Opportunity
  WHERE TenantID = '${tid}' AND (Deleted = 0 OR Deleted IS NULL) ORDER BY TicketId DESC`);
let ruledOpp = ""; let ruledStage = "";
for (const row of (opps.recordset ?? []) as Record<string, unknown>[]) {
  const t = String(row.TicketId).trim();
  const ph = await phasesOf(t);
  const eff = effectiveOf(String(row.st ?? "").trim(), "", ph);
  if ((eff === "Pending Assignment" || eff === "Proposal Development") && ph.length > 0) {
    ruledOpp = t; ruledStage = eff; break;
  }
}
console.log(`picked: RULED_OPM=${ruledOpp || "(none)"} stage="${ruledStage}"`);

// ── Part B: HTTP matrix ──────────────────────────────────────────────────
const mk = (sub: string, username: string, acl: "manager" | "user") =>
  signRdsToken({ sub, tenant: label, username, role: acl, accessLevel: acl });
const P = { Authorization: `Bearer ${mk(priyaId, "priya.sharma@rmone.com", "manager")}`, "x-rmone-tenant": label, "Content-Type": "application/json" };
const A = { Authorization: `Bearer ${mk(arjunId, "arjun.menon@rmone.com", "user")}`, "x-rmone-tenant": label, "Content-Type": "application/json" };

async function call(who: string, tag: string, method: string, path: string, headers: Record<string, string>, body?: unknown) {
  const r = await fetch(`${BASE}${path}`, {
    method, headers, body: body === undefined ? undefined : JSON.stringify(body),
    signal: AbortSignal.timeout(60_000),
  });
  const text = await r.text();
  let snip = text.slice(0, 300);
  try { snip = JSON.stringify(JSON.parse(text)).slice(0, 300); } catch { /* keep raw */ }
  console.log(`[${who}] ${tag}  http=${r.status}  ${snip}`);
  return r.status;
}

console.log("\n── matrix as Manager priya ──");
await call("mgr", "my-capabilities", "GET", "/my-capabilities", P);
await call("mgr", `record-permissions ${mismatch} (stored Active, visible "${mismatchPhase}")`, "GET", `/record-permissions/${mismatch}`, P);
if (ruledOpp) await call("mgr", `record-permissions ${ruledOpp} (ruled "${ruledStage}")`, "GET", `/record-permissions/${ruledOpp}`, P);
await call("mgr", `notes write ${mismatch}`, "POST", "/update-fields", P,
  { RecordId: mismatch, Fields: [{ FieldName: NOTE_FIELD, Value: `[qa] effective-stage matrix ${today}` }] });
await call("mgr", "remove-team-member (staff-gated)", "POST", "/remove-team-member", P,
  { ProjectID: mismatch, ResourceUser: "00000000-qa-0000" });
await call("mgr", `status write ${mismatch} → "${mismatchPhase}"`, "POST", "/update-fields", P,
  { RecordId: mismatch, Fields: [{ FieldName: "CRMProjectStatusChoice", Value: mismatchPhase }] });
await call("mgr", `record-permissions ${mismatch} after status write`, "GET", `/record-permissions/${mismatch}`, P);

console.log("\n── matrix as User arjun ──");
await call("usr", `record-permissions ${mismatch}`, "GET", `/record-permissions/${mismatch}`, A);
await call("usr", `notes write ${mismatch}`, "POST", "/update-fields", A,
  { RecordId: mismatch, Fields: [{ FieldName: NOTE_FIELD, Value: "[qa] should be blocked" }] });
await call("usr", "remove-team-member (staff-gated)", "POST", "/remove-team-member", A,
  { ProjectID: mismatch, ResourceUser: "00000000-qa-0000" });

process.exit(0);
