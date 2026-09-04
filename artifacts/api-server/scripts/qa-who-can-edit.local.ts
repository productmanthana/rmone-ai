// Live probe for the "Who can edit" stage rule (drawer rule 5 → stage-perms
// editor tier). Verifies end to end on a real tenant:
//   1. listed editor can still save a field edit at the restricted stage
//   2. an unlisted user is blocked (403) at that stage
//   3. site admins are NOT exempt (blocked when unlisted)
//   4. record-permissions summary mirrors the verdict (canEditData)
//   5. a record at a DIFFERENT stage stays editable (stage scoping)
//   6. an OPM record is untouched by a PMM rule (module scoping)
//   7. role:/org: sentinel ids work in editorGroupIds (live resolution)
// The tenant's stage-permissions doc is restored afterwards.
// Usage: npx tsx scripts/qa-who-can-edit.local.ts [tenantLabel]
import { getPool } from "../src/lib/db.js";
import { v5 as uuidv5 } from "uuid";
import { signRdsToken } from "../src/lib/rds-auth.js";

const TENANT_NAMESPACE_ORG = "5d8f1e6a-2c3b-4d7e-9a1f-0b2c3d4e5f6a";
const label = process.argv[2] ?? "testrmone";
const tid = uuidv5(label.toLowerCase(), TENANT_NAMESPACE_ORG);
const PORT = process.env.API_PORT || "8080";
const RM = `http://127.0.0.1:${PORT}/api/rmone`;
const ONB = `http://127.0.0.1:${PORT}/api/onboarding`;
const today = new Date().toISOString().slice(0, 10);

let failures = 0;
const check = (name: string, ok: boolean, detail?: unknown) => {
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${ok ? "" : ` — ${JSON.stringify(detail).slice(0, 300)}`}`);
  if (!ok) failures++;
};

const pool = await getPool();

// ── Actors: real enabled users on the tenant ────────────────────────────────
const ur = await pool.request().query(`
  SELECT id, username, access_level, enabled FROM rmoneapp.dbo.rmone_users
  WHERE LOWER(tenant_id) IN ('${label.toLowerCase()}', '${tid}')`);
type U = { id: string; username: string; access_level: string | null; enabled: boolean | number | null };
const all = ((ur.recordset ?? []) as U[]).filter(u => u.enabled === true || u.enabled === 1);
const admin = all.find(u => (u.access_level ?? "").toLowerCase() === "admin");
const editors = all.filter(u => {
  const a = (u.access_level ?? "").toLowerCase();
  return a !== "admin" && a !== "user" && !a.startsWith("custom"); // plain non-admin writers
});
const [uA, uB] = editors;
if (!admin || !uA || !uB) {
  console.error(`need 1 admin + 2 non-admin writers on ${label}; found admin=${admin?.username} writers=${editors.length}`);
  process.exit(1);
}
console.log(`actors: admin=${admin.username} A=${uA.username}(${uA.access_level}) B=${uB.username}(${uB.access_level})`);

const tok = (u: U) => signRdsToken({
  sub: u.id, tenant: label, username: u.username, role: "agent",
  accessLevel: (u.access_level ?? undefined) as never,
});
const hdr = (u: U) => ({ Authorization: `Bearer ${tok(u)}`, "x-rmone-tenant": label, "Content-Type": "application/json" });

async function call(method: string, url: string, headers: Record<string, string>, body?: unknown) {
  const r = await fetch(url, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
  let json: Record<string, unknown> = {};
  try { json = await r.json() as Record<string, unknown>; } catch { /* non-JSON */ }
  return { status: r.status, json };
}

// ── Records: PMM rows that HAVE schedule phases (rules only bite then) ──────
const rr = await pool.request().query(`
  SELECT TOP 40 p.TicketId, p.Status, p.Comment FROM core2.dbo.PMM p WITH (NOLOCK)
  WHERE p.TenantID = '${tid}' AND (p.Deleted = 0 OR p.Deleted IS NULL)
    AND EXISTS (SELECT 1 FROM core2.dbo.PMMTasks t WITH (NOLOCK)
                WHERE t.TenantID = p.TenantID AND t.TicketId = p.TicketId
                  AND (t.Deleted = 0 OR t.Deleted IS NULL)
                  AND LTRIM(RTRIM(COALESCE(t.Title,''))) <> '')
  ORDER BY p.ID DESC`);
const day = (v: unknown): string => {
  if (v == null) return "";
  const d = v instanceof Date ? v : new Date(String(v));
  if (isNaN(d.getTime())) return "";
  const s = d.toISOString().slice(0, 10);
  return s > "2000-12-31" ? s : "";
};
async function effectiveStage(ticket: string, stored: string): Promise<string> {
  if (/complet|closed|cancel|lost|declin/i.test(stored)) return stored;
  const q = (ord: string) => `
    SELECT t.Title AS name, MIN(${ord}) AS ord, MIN(t.ID) AS tie, MIN(t.StartDate) AS sd, MAX(t.DueDate) AS ed
    FROM core2.dbo.PMMTasks t WITH (NOLOCK)
    WHERE t.TenantID = '${tid}' AND t.TicketId = '${ticket}'
      AND (t.Deleted = 0 OR t.Deleted IS NULL) AND LTRIM(RTRIM(COALESCE(t.Title,''))) <> ''
    GROUP BY t.Title ORDER BY ord ASC, tie ASC`;
  let rs;
  try { rs = await pool.request().query(q("t.ItemOrder")); } catch { rs = await pool.request().query(q("t.ID")); }
  const phases = (rs.recordset ?? []).map((x: Record<string, unknown>) => ({
    name: String(x.name ?? "").trim(), sd: day(x.sd), ed: day(x.ed),
  })).filter(p => p.name);
  if (phases.length === 0) return stored;
  const sorted = [...phases].sort((a, b) => ((a.sd || "9999") < (b.sd || "9999") ? -1 : 1));
  const active = sorted.find(p => p.sd && p.ed && p.sd <= today && today <= p.ed);
  return (active ?? sorted.find(p => p.sd && p.sd > today) ?? sorted[sorted.length - 1]).name;
}
type Rec = { ticket: string; stage: string; comment: string };
let recA: Rec | null = null; let recOther: Rec | null = null;
for (const row of (rr.recordset ?? []) as Record<string, unknown>[]) {
  const ticket = String(row.TicketId ?? "").trim();
  const stored = String(row.Status ?? "").trim();
  if (!ticket || /complet|closed|cancel|lost|declin/i.test(stored)) continue;
  const stage = await effectiveStage(ticket, stored);
  if (!stage || /complet|closed|cancel|lost|declin/i.test(stage)) continue;
  const rec = { ticket, stage, comment: String(row.Comment ?? "") };
  if (!recA) recA = rec;
  else if (!recOther && rec.stage.toLowerCase() !== recA.stage.toLowerCase()) { recOther = rec; break; }
}
if (!recA) { console.error("no scheduled, non-terminal PMM record found — abort"); process.exit(1); }
console.log(`record: ${recA.ticket} @ "${recA.stage}"  other: ${recOther ? `${recOther.ticket} @ "${recOther.stage}"` : "(none)"}`);

// One OPM record for the module-scoping summary probe (skip when absent).
let oppTicket = "";
try {
  const or_ = await pool.request().query(`
    SELECT TOP 1 TicketId FROM core2.dbo.Opportunity WITH (NOLOCK)
    WHERE TenantID = '${tid}' AND (Deleted = 0 OR Deleted IS NULL) ORDER BY ID DESC`);
  oppTicket = String((or_.recordset?.[0] as Record<string, unknown> | undefined)?.TicketId ?? "").trim();
} catch { /* no Opportunity table / no rows — skip the module-scope probe */ }

// ── Save doc (with restore) ─────────────────────────────────────────────────
const orig = await call("GET", `${ONB}/stage-permissions`, hdr(admin));
check("GET stage-permissions as admin", orig.status === 200, orig);
if (orig.status !== 200 || !Array.isArray(orig.json.rules)) {
  // Never mutate the tenant doc without a trustworthy original to restore.
  console.error("abort: could not read the original stage-permissions doc — no writes attempted");
  process.exit(1);
}
const origRules = orig.json.rules as Record<string, unknown>[];
const keepRules = origRules.filter(r =>
  !(String(r.module) === "PMM" && String(r.stage ?? "").toLowerCase() === recA!.stage.toLowerCase()));

const editProbe = (who: U, rec: Rec) =>
  call("PUT", `${RM}/project`, hdr(who), {
    RecordId: rec.ticket,
    Fields: [{ FieldName: "Comment", Value: rec.comment }], // same-value write: no data change
  });

try {
  // Rule variant 1: named person (editor tier, othersMode viewOnly)
  const put1 = await call("PUT", `${ONB}/stage-permissions`, hdr(admin), {
    rules: [...keepRules, {
      module: "PMM", stage: recA.stage,
      actionUserIds: [], actionGroupIds: [],
      editorUserIds: [uA.id], editorGroupIds: [], othersMode: "viewOnly",
    }],
  });
  check("PUT who-can-edit rule (person)", put1.status === 200, put1);

  const [a1, b1, adm1] = [await editProbe(uA, recA), await editProbe(uB, recA), await editProbe(admin, recA)];
  check("listed person can edit", a1.status === 200, a1);
  check("unlisted person blocked (403)", b1.status === 403, b1);
  check("admin not exempt (403)", adm1.status === 403, adm1);

  const [sumA, sumB] = [
    await call("GET", `${RM}/record-permissions/${encodeURIComponent(recA.ticket)}`, hdr(uA)),
    await call("GET", `${RM}/record-permissions/${encodeURIComponent(recA.ticket)}`, hdr(uB)),
  ];
  check("summary: editor canEditData", sumA.status === 200 && sumA.json.canEditData === true, sumA);
  check("summary: unlisted canEditData=false", sumB.status === 200 && sumB.json.canEditData === false, sumB);

  if (recOther) {
    const bOther = await editProbe(uB, recOther);
    check("different stage unaffected", bOther.status === 200, bOther);
  }
  if (oppTicket) {
    const sumOpp = await call("GET", `${RM}/record-permissions/${encodeURIComponent(oppTicket)}`, hdr(uB));
    check("OPM record unaffected by PMM rule", sumOpp.status === 200 && sumOpp.json.canEditData === true, sumOpp);
  }

  // Rule variant 2: live sentinel (role:/org:) unique to A
  const [capA, capB] = [
    await call("GET", `${RM}/my-capabilities`, hdr(uA)),
    await call("GET", `${RM}/my-capabilities`, hdr(uB)),
  ];
  const gidsA = (capA.json.groupIds as string[] | undefined) ?? [];
  const gidsB = new Set(((capB.json.groupIds as string[] | undefined) ?? []).map(x => x.toLowerCase()));
  const sentinel = gidsA.find(g => /^(role|org):/i.test(g) && !gidsB.has(g.toLowerCase()));
  if (sentinel) {
    const put2 = await call("PUT", `${ONB}/stage-permissions`, hdr(admin), {
      rules: [...keepRules, {
        module: "PMM", stage: recA.stage,
        actionUserIds: [], actionGroupIds: [],
        editorUserIds: [], editorGroupIds: [sentinel], othersMode: "viewOnly",
      }],
    });
    check(`PUT who-can-edit rule (sentinel ${sentinel})`, put2.status === 200, put2);
    const [a2, b2] = [await editProbe(uA, recA), await editProbe(uB, recA)];
    check("sentinel holder can edit", a2.status === 200, a2);
    check("non-holder blocked (403)", b2.status === 403, b2);
  } else {
    console.log(`SKIP  sentinel variant — no role:/org: id unique to ${uA.username} (A=${gidsA.join(",")})`);
  }
} finally {
  const restore = await call("PUT", `${ONB}/stage-permissions`, hdr(admin), { rules: origRules });
  check("restore original stage-permissions doc", restore.status === 200 && Array.isArray(restore.json.rules) && (restore.json.rules as unknown[]).length === origRules.length, restore);
}

console.log(failures === 0 ? "\nAll who-can-edit probes passed." : `\n${failures} probe(s) FAILED`);
process.exit(failures === 0 ? 0 : 1);
