/**
 * Access-level import fixture check (CI gate, #156 — guards #155).
 * Run: npx tsx scripts/check-access-levels.ts
 *
 * Confirms a workbook naming a custom access level still lands correctly after
 * future import changes: a small Team Members sheet + Assignments sheet are run
 * through the SAME resolver plumbing the pipeline uses (makeAclResolverFromDoc
 * → idMaps._aclResolve → aclResolveFor), with a stubbed custom-levels doc built
 * by the real sanitizeAccessLevels. Asserts:
 *   - custom name → "custom:<id>" with isSiteAdmin=false
 *   - built-ins still map (admin/manager/user + synonyms)
 *   - a stale "custom:<deleted-id>" and an unknown name each produce exactly
 *     one dedup'd warning and a null access level
 *
 * Exit code 0 = all good; 1 = at least one assertion failed.
 */
import {
  makeAclResolverFromDoc,
  aclResolveFor,
  type SheetData,
} from "../src/lib/pipeline.js";
import { sanitizeAccessLevels, resolveAccessCapsFromDoc, type Caps } from "../src/lib/access-control.js";

let failures = 0;
const fail = (msg: string) => { failures++; console.error("FAIL  " + msg); };
const eq = (label: string, got: unknown, want: unknown) => {
  if (got !== want) fail(`${label}: got ${JSON.stringify(got)}, want ${JSON.stringify(want)}`);
};

// ── Stubbed tenant custom-levels doc (through the real sanitizer) ────────────
// Includes two levels whose names deliberately collide with built-in synonyms
// ("Supervisor" → ACL_MANAGER_SYNONYMS, "Administrator" → ACL_ADMIN_SYNONYMS)
// to verify that custom exact-name wins over every built-in heuristic.
const doc = sanitizeAccessLevels({
  levels: [
    { id: "estim1",      name: "Estimator",     caps: { editData: true } },
    { id: "fin-view",    name: "Finance Viewer", caps: {} },
    { id: "supv1",       name: "Supervisor",     caps: {} },   // collides with manager synonym
    { id: "admin-cust1", name: "Administrator",  caps: {} },   // collides with admin synonym
  ],
});
eq("sanitizer kept all stub levels", doc.levels.length, 4);

// Mirror runPipeline: stash the tenant-aware resolver on idMaps, then have the
// sheet paths pull it back out via aclResolveFor (dedup'd warning collector).
const idMaps: Record<string, Map<string, any>> = {};
(idMaps as any)._aclResolve = makeAclResolverFromDoc(doc);

// ── Team Members sheet path (insertUsersBatch's normAcl) ─────────────────────
const teamSheet: SheetData = {
  sheetName: "Team Members",
  columns: ["Name", "Email", "Access Level"],
  rows: [
    { Name: "Ada Estimator",  Email: "ada@x.com",  AccessLevel: "Estimator" },
    { Name: "Bob Admin",      Email: "bob@x.com",  AccessLevel: "Site Admin" },
    { Name: "Cat Manager",    Email: "cat@x.com",  AccessLevel: "Team Lead" },
    { Name: "Dan User",       Email: "dan@x.com",  AccessLevel: "Read Only" },
    { Name: "Eve Plain",      Email: "eve@x.com",  AccessLevel: "user" },
    { Name: "Fay Stale",      Email: "fay@x.com",  AccessLevel: "custom:deleted99" },
    { Name: "Gus Unknown",    Email: "gus@x.com",  AccessLevel: "Wizard" },
    { Name: "Hal Unknown2",   Email: "hal@x.com",  AccessLevel: "wizard" }, // same value, differing case → no extra warning
    { Name: "Ida Blank",      Email: "ida@x.com",  AccessLevel: "" },
    { Name: "Joe Reexport",   Email: "joe@x.com",  AccessLevel: "custom:fin-view" }, // still-existing marker survives re-export
    { Name: "Kay FinViewer",  Email: "kay@x.com",  AccessLevel: "Finance Viewer" }, // plain display name must NOT be downgraded to "user"
    { Name: "Lee Supv",       Email: "lee@x.com",  AccessLevel: "Supervisor" },     // collides with manager synonym → must stay custom
    { Name: "Mia AdminCust",  Email: "mia@x.com",  AccessLevel: "Administrator" },  // collides with admin synonym → must stay custom
  ],
};

const { resolve: aclResolve, warnUnrecognized: aclWarn } = aclResolveFor(idMaps);
// Exactly what insertUsersBatch does per row:
const normAcl = (raw?: string | null): string | null => {
  const r = aclResolve(raw);
  if (r.unrecognized) aclWarn(r.unrecognized, `Team Members sheet "${teamSheet.sheetName}"`);
  return r.acl;
};

const teamAcls = teamSheet.rows.map((row) => normAcl(String(row.AccessLevel ?? "")));
const isSiteAdmin = teamAcls.map((acl) => acl === "admin"); // pipeline writes isSiteAdmin: acl === "admin"

eq("custom name → custom:<id>",          teamAcls[0], "custom:estim1");
eq("custom level is NOT site admin",     isSiteAdmin[0], false);
eq("admin synonym maps",                 teamAcls[1], "admin");
eq("admin synonym IS site admin",        isSiteAdmin[1], true);
eq("manager synonym maps",               teamAcls[2], "manager");
eq("user synonym maps",                  teamAcls[3], "user");
eq("plain built-in maps",                teamAcls[4], "user");
eq("stale custom marker → null",         teamAcls[5], null);
eq("unknown name → null",                teamAcls[6], null);
eq("unknown name (case dup) → null",     teamAcls[7], null);
eq("blank → null",                       teamAcls[8], null);
eq("live custom marker accepted",        teamAcls[9], "custom:fin-view");
eq("custom level named with 'view' NOT downgraded to user",    teamAcls[10], "custom:fin-view");
eq("custom level named 'Supervisor' NOT downgraded to manager", teamAcls[11], "custom:supv1");
eq("custom level named 'Administrator' NOT downgraded to admin", teamAcls[12], "custom:admin-cust1");

// ── Assignments sheet path (RA row UserRole/AccessLevel) ─────────────────────
const assignSheet: SheetData = {
  sheetName: "Assignments",
  columns: ["Resource", "Project", "UserRole"],
  rows: [
    { Resource: "ada@x.com", Project: "P-1", UserRole: "estimator" },        // custom, case-insensitive
    { Resource: "bob@x.com", Project: "P-1", UserRole: "super admin" },
    { Resource: "fay@x.com", Project: "P-2", UserRole: "custom:deleted99" }, // stale again → still no NEW warning
    { Resource: "gus@x.com", Project: "P-2", UserRole: "Wizard" },           // unknown again → still no NEW warning
  ],
};

const raAcls = assignSheet.rows.map((row) => {
  // Exactly what the RA path does per row:
  const { resolve: _raAcl, warnUnrecognized: _raAclWarn } = aclResolveFor(idMaps);
  const r = _raAcl(String(row.UserRole ?? row.AccessLevel ?? ""));
  if (r.unrecognized) _raAclWarn(r.unrecognized, "Assignments sheet");
  return r.acl;
});

eq("RA custom name (lowercase) maps",    raAcls[0], "custom:estim1");
eq("RA admin synonym maps",              raAcls[1], "admin");
eq("RA stale custom marker → null",      raAcls[2], null);
eq("RA unknown name → null",             raAcls[3], null);

// ── Warning collection: exactly one dedup'd warning per distinct bad value ───
const warnings: string[] = (idMaps as any)._aclWarnings ?? [];
eq("exactly 2 warnings collected (stale + unknown, dedup'd across sheets)", warnings.length, 2);
const staleWarns   = warnings.filter((w) => w.includes('"custom:deleted99"'));
const unknownWarns = warnings.filter((w) => w.toLowerCase().includes('"wizard"'));
eq("exactly one warning for the stale custom marker", staleWarns.length, 1);
eq("exactly one warning for the unknown name",        unknownWarns.length, 1);
for (const w of warnings) {
  if (!/Settings → Access Levels/.test(w)) fail(`warning missing remediation hint: ${w}`);
}

// ── Capability matrix regression coverage ────────────────────────────────────
// Pure resolution checks: no DB/cache needed, so these are deterministic CI
// coverage for the same matrix used by route and provider permission gates.
const matrixDoc = sanitizeAccessLevels({
  levels: [
    { id: "data", caps: { editData: true } , name: "Data only" },
    { id: "stage", caps: { advanceStages: true }, name: "Stage only" },
    { id: "finance", caps: { editFinancials: true }, name: "Finance only" },
    { id: "staff", caps: { manageStaff: true }, name: "Staff only" },
    { id: "settings", caps: { manageSettings: true }, name: "Settings only" },
    { id: "imp-nodata", caps: { importPage: true }, name: "Import without data" },
    { id: "full", caps: { editData: true, advanceStages: true, editFinancials: true, manageStaff: true, manageSettings: true, importPage: true }, name: "Full" },
  ],
  builtinOverrides: {
    manager: { editData: false, manageSettings: true },
    user: { editFinancials: true },
  },
});
const defaultDoc = sanitizeAccessLevels({});
const capsFor = (acl: string, source = defaultDoc): Caps | null => resolveAccessCapsFromDoc(acl, source).caps;
const sameCaps = (label: string, got: Caps | null, want: Partial<Caps>) => {
  if (!got) return fail(`${label}: no resolved caps`);
  for (const [key, value] of Object.entries(want)) eq(`${label}.${key}`, got[key as keyof Caps], value);
};
const canStatusWrite = (caps: Caps | null) => !!caps?.editData && !!caps?.advanceStages;
const canImport = (caps: Caps | null) => !!caps?.importPage && !!caps?.editData;

sameCaps("Admin defaults all caps", capsFor("admin"), {
  editData: true, advanceStages: true, editFinancials: true, manageStaff: true, manageSettings: true, importPage: true,
});
sameCaps("Manager defaults", capsFor("manager"), {
  editData: true, advanceStages: true, editFinancials: true, manageStaff: true, manageSettings: false, importPage: false,
});
sameCaps("User defaults all false", capsFor("user"), {
  editData: false, advanceStages: false, editFinancials: false, manageStaff: false, manageSettings: false, importPage: false,
});
sameCaps("explicit Manager override authoritative", capsFor("manager", matrixDoc), { editData: false, manageSettings: true });
sameCaps("explicit User override authoritative", capsFor("user", matrixDoc), { editFinancials: true, editData: false });
sameCaps("data-only", capsFor("custom:data", matrixDoc), { editData: true, advanceStages: false });
eq("data-only cannot advance stage", canStatusWrite(capsFor("custom:data", matrixDoc)), false);
sameCaps("stage-without-data", capsFor("custom:stage", matrixDoc), { editData: false, advanceStages: true });
eq("stage-without-data denied stage write", canStatusWrite(capsFor("custom:stage", matrixDoc)), false);
sameCaps("financial-only", capsFor("custom:finance", matrixDoc), { editFinancials: true, editData: false });
sameCaps("staff-only", capsFor("custom:staff", matrixDoc), { manageStaff: true, editData: false });
sameCaps("settings-only", capsFor("custom:settings", matrixDoc), { manageSettings: true, editData: false });
sameCaps("import-without-data", capsFor("custom:imp-nodata", matrixDoc), { importPage: true, editData: false });
eq("import-without-data denied import", canImport(capsFor("custom:imp-nodata", matrixDoc)), false);
sameCaps("full custom level", capsFor("custom:full", matrixDoc), {
  editData: true, advanceStages: true, editFinancials: true, manageStaff: true, manageSettings: true, importPage: true,
});

if (failures) {
  console.error(`\ncheck-access-levels: ${failures} failure(s)`);
  process.exit(1);
}
console.log("check-access-levels: all assertions passed");
