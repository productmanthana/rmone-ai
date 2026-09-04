/**
 * Live E2E: staff import honors "Creation Date" (INSERT-only) + "Phone Number".
 * Runs a real 2-row update-mode import on testa, verifies rmone_users, cleans up.
 * Run: pnpm --filter @workspace/api-server exec tsx scripts/test-created-phone-import.ts
 */
import * as XLSX from "xlsx";
import { signRdsToken } from "../src/lib/rds-auth.js";
import { getPool } from "../src/lib/db.js";
import { getUsersByTenant, getUserByTenantAndUsername, updateUser, deleteOnboardingJobsBatch } from "@workspace/db";

const API = "http://localhost:8080/api/onboarding";
const TENANT = "testa";
const TID = "15bfa454-55a1-5c8a-b0b5-a4faab0e6ccb";
const ts = Date.now();
const NEW_EMAIL = `created.phone.test.${ts}@example.com`;
const NEW_PHONE = "+1 999-555-0101";
const NEW_CREATED = "2024-03-15";
const UPD_PHONE = "+1 999-555-0177";

const tok = signRdsToken({ sub: "cptest", tenant: TENANT, username: "cptest@example.com", role: "admin", accessLevel: "admin" });
const auth = { Authorization: `Bearer ${tok}` };
let failures = 0;
const check = (label: string, ok: boolean, detail?: string) => {
  console.log(`${ok ? "PASS" : "FAIL"}  ${label}${detail ? ` — ${detail}` : ""}`);
  if (!ok) failures++;
};

// 0. CRMCompany schema probe (companies module: does a created column exist?)
try {
  const pool = await getPool();
  const r = await pool.request().query(`
    SELECT c.name FROM core2.sys.columns c
    JOIN core2.sys.tables t ON t.object_id = c.object_id
    WHERE t.name = 'CRMCompany' AND (c.name LIKE '%reat%' OR c.name LIKE '%hone%') ORDER BY c.name`);
  console.log("INFO  CRMCompany created/phone-ish cols:", r.recordset.map((x: any) => x.name).join(", ") || "(none)");
} catch (e: any) { console.log("INFO  CRMCompany probe failed:", e?.message); }

// 1. Pick an existing enabled user for the update-path test.
const users = (await getUsersByTenant(TID)).filter(u => u.enabled && !u.deleted && u.username?.includes("@") && !u.isSiteAdmin);
if (!users.length) { console.error("no existing testa user found"); process.exit(1); }
const ex = users[0];
const exPhoneBefore = ex.phoneNumber ?? null;
const exCreatedBefore = ex.createdAt ? new Date(ex.createdAt).toISOString() : null;
console.log(`INFO  existing user: ${ex.username} phoneBefore=${exPhoneBefore} createdBefore=${exCreatedBefore}`);

// 2. Build the staff workbook (ISO date strings, never bare serials).
const aoa = [
  ["Full Name", "Login Email", "Phone Number", "Creation Date"],
  ["Created Phone Test", NEW_EMAIL, NEW_PHONE, NEW_CREATED],
  [ex.name ?? "Existing User", ex.username, UPD_PHONE, "2020-01-01"], // created must NOT change
];
const wb = XLSX.utils.book_new();
XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(aoa), "Team");
const buf: Buffer = XLSX.write(wb, { type: "buffer", bookType: "xlsx" });

let uploadId = "";
try {
  // 3. Upload + run (update mode) + poll.
  const fd = new FormData();
  fd.append("file", new Blob([buf], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" }), "created_phone_test.xlsx");
  const up = await fetch(`${API}/upload`, { method: "POST", headers: auth, body: fd });
  const upBody: any = await up.json().catch(() => ({}));
  uploadId = upBody?.uploadId ?? "";
  check("upload accepted", up.status === 200 && !!uploadId, `HTTP ${up.status} uploadId=${uploadId} err=${upBody?.error ?? ""}`);
  if (!uploadId) throw new Error("no uploadId");

  const run = await fetch(`${API}/run`, { method: "POST", headers: { ...auth, "Content-Type": "application/json" }, body: JSON.stringify({ uploadId, importMode: "update" }) });
  const runBody: any = await run.json().catch(() => ({}));
  check("run accepted", run.status === 200, `HTTP ${run.status} ${JSON.stringify(runBody).slice(0, 140)}`);

  let status = "", lastBody: any = null;
  for (let i = 0; i < 75; i++) {
    await new Promise(r => setTimeout(r, 2000));
    const st = await fetch(`${API}/status/${uploadId}`, { headers: auth });
    lastBody = await st.json().catch(() => ({}));
    status = lastBody?.status ?? "";
    if (["success", "failed", "error", "cancelled"].includes(status)) break;
  }
  check("import finished with success", status === "success", `status=${status} err=${String(lastBody?.error ?? "").slice(0, 200)}`);

  // 4. Verify DB.
  const nu = await getUserByTenantAndUsername(TID, NEW_EMAIL);
  check("new user created", !!nu, NEW_EMAIL);
  if (nu) {
    const cIso = nu.createdAt ? new Date(nu.createdAt).toISOString() : "null";
    const diffDays = nu.createdAt ? Math.abs(+new Date(nu.createdAt) - +new Date(`${NEW_CREATED}T00:00:00Z`)) / 86400000 : 99;
    check("new user created_at = file Creation Date", diffDays <= 1, `stored=${cIso} expected≈${NEW_CREATED}`);
    check("new user phone saved", (nu.phoneNumber ?? "") === NEW_PHONE, `stored=${nu.phoneNumber}`);
  }
  const ex2 = await getUserByTenantAndUsername(TID, ex.username!);
  const exCreatedAfter = ex2?.createdAt ? new Date(ex2.createdAt).toISOString() : null;
  check("existing user created_at UNCHANGED", exCreatedAfter === exCreatedBefore, `before=${exCreatedBefore} after=${exCreatedAfter}`);
  check("existing user phone updated", (ex2?.phoneNumber ?? "") === UPD_PHONE, `stored=${ex2?.phoneNumber}`);

  // 5. Cleanup: soft-delete test user, restore existing phone, drop job row.
  if (nu) await updateUser(TID, nu.id, { deleted: true, enabled: false });
  if (ex2 && (ex2.phoneNumber ?? null) !== exPhoneBefore) await updateUser(TID, ex2.id, { phoneNumber: exPhoneBefore });
} finally {
  if (uploadId) await deleteOnboardingJobsBatch([uploadId]).catch(() => {});
}
console.log(failures ? `\n${failures} FAILURE(S)` : "\nALL PASS");
process.exit(failures ? 1 : 0);
