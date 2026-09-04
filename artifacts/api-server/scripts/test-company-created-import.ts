/**
 * Live E2E: companies import honors "Creation Date" (INSERT-only, blank = today).
 * Uploads a 2-row Companies sheet on testa (one dated, one blank), verifies
 * core2.dbo.CRMCompany.Created, then soft-deletes the test rows.
 * Run: pnpm --filter @workspace/api-server exec tsx scripts/test-company-created-import.ts
 */
import * as XLSX from "xlsx";
import sql from "mssql";
import { signRdsToken } from "../src/lib/rds-auth.js";
import { getPool } from "../src/lib/db.js";
import { deleteOnboardingJobsBatch } from "@workspace/db";

const API = "http://localhost:8080/api/onboarding";
const TENANT = "testa";
const TID = "15bfa454-55a1-5c8a-b0b5-a4faab0e6ccb";
const ts = Date.now();
const CO_DATED = `CPTest Dated Co ${ts}`;
const CO_BLANK = `CPTest Blank Co ${ts}`;
const CO_CREATED = "2023-06-01";

const tok = signRdsToken({ sub: "cptest", tenant: TENANT, username: "cptest@example.com", role: "admin", accessLevel: "admin" });
const auth = { Authorization: `Bearer ${tok}` };
let failures = 0;
const check = (label: string, ok: boolean, detail?: string) => {
  console.log(`${ok ? "PASS" : "FAIL"}  ${label}${detail ? ` — ${detail}` : ""}`);
  if (!ok) failures++;
};

const aoa = [
  ["Title", "Creation Date"],
  [CO_DATED, CO_CREATED],
  [CO_BLANK, ""], // blank → Created = import day
];
const wb = XLSX.utils.book_new();
XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(aoa), "Companies");
const buf: Buffer = XLSX.write(wb, { type: "buffer", bookType: "xlsx" });

let uploadId = "";
const pool = await getPool();
try {
  const fd = new FormData();
  fd.append("file", new Blob([buf], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" }), "company_created_test.xlsx");
  const up = await fetch(`${API}/upload`, { method: "POST", headers: auth, body: fd });
  const upBody: any = await up.json().catch(() => ({}));
  uploadId = upBody?.uploadId ?? "";
  check("upload accepted", up.status === 200 && !!uploadId, `HTTP ${up.status} uploadId=${uploadId} err=${upBody?.error ?? ""}`);
  if (!uploadId) throw new Error("no uploadId");

  const run = await fetch(`${API}/run`, { method: "POST", headers: { ...auth, "Content-Type": "application/json" }, body: JSON.stringify({ uploadId, importMode: "update" }) });
  check("run accepted", run.status === 200, `HTTP ${run.status}`);

  let status = "", lastBody: any = null;
  for (let i = 0; i < 75; i++) {
    await new Promise(r => setTimeout(r, 2000));
    const st = await fetch(`${API}/status/${uploadId}`, { headers: auth });
    lastBody = await st.json().catch(() => ({}));
    status = lastBody?.status ?? "";
    if (["success", "failed", "error", "cancelled"].includes(status)) break;
  }
  check("import finished with success", status === "success", `status=${status} err=${String(lastBody?.error ?? "").slice(0, 200)}`);

  const q = await pool.request()
    .input("tid", sql.NVarChar, TID)
    .input("t1", sql.NVarChar, CO_DATED)
    .input("t2", sql.NVarChar, CO_BLANK)
    .query("SELECT ID, Title, Created FROM core2.dbo.CRMCompany WHERE TenantID=@tid AND (Title IN (@t1,@t2) OR (Title LIKE 'CPTest%Co%' AND Deleted=0))");
  const rows = q.recordset as Array<{ ID: number; Title: string; Created: Date | null }>;
  const dated = rows.find(r => r.Title === CO_DATED);
  const blank = rows.find(r => r.Title === CO_BLANK);
  check("dated company created", !!dated, CO_DATED);
  if (dated) {
    const diffDays = dated.Created ? Math.abs(+new Date(dated.Created) - +new Date(`${CO_CREATED}T00:00:00Z`)) / 86400000 : 99;
    check("dated company Created = file value", diffDays <= 1, `stored=${dated.Created?.toISOString?.() ?? dated.Created}`);
  }
  check("blank company created", !!blank, CO_BLANK);
  if (blank) {
    const diffDays = blank.Created ? Math.abs(Date.now() - +new Date(blank.Created)) / 86400000 : 99;
    check("blank company Created = today", diffDays <= 1, `stored=${blank.Created?.toISOString?.() ?? blank.Created}`);
  }

  // Cleanup: soft-delete test companies.
  for (const r of rows) {
    await pool.request().input("tid", sql.NVarChar, TID).input("id", sql.BigInt, r.ID)
      .query("UPDATE core2.dbo.CRMCompany SET Deleted=1 WHERE TenantID=@tid AND ID=@id");
  }
  console.log(`INFO  cleaned up ${rows.length} test companies`);
} finally {
  if (uploadId) await deleteOnboardingJobsBatch([uploadId]).catch(() => {});
}
console.log(failures ? `\n${failures} FAILURE(S)` : "\nALL PASS");
process.exit(failures ? 1 : 0);
