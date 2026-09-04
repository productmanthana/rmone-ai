/**
 * Live test for the one-import-at-a-time-per-tenant guard (409 IMPORT_IN_PROGRESS).
 *
 * Inserts synthetic job rows for the test tenant, hits the real HTTP endpoints
 * on the local dev server, then deletes the rows. The fake "running" row exists
 * for only a few seconds (shared dev+prod jobs table — keep the window short).
 *
 * Run: pnpm --filter @workspace/api-server exec tsx scripts/test-import-guard.ts
 */
import { upsertOnboardingJob, deleteOnboardingJobsBatch } from "@workspace/db";
import { signRdsToken } from "../src/lib/rds-auth.js";

const API    = "http://localhost:8080/api/onboarding";
const TENANT = "testa";
const ts     = Date.now();
const RUN_ID  = `guardtest-run-${ts}`;
const PEND_ID = `guardtest-pend-${ts}`;

const tok = signRdsToken({
  sub: "guardtest",
  tenant: TENANT,
  username: "guardtest@example.com",
  role: "admin",
  accessLevel: "admin",
});
const auth = { Authorization: `Bearer ${tok}` };

let failures = 0;
function check(label: string, ok: boolean, detail?: string) {
  console.log(`${ok ? "PASS" : "FAIL"}  ${label}${detail ? ` — ${detail}` : ""}`);
  if (!ok) failures++;
}

function dummyForm(name: string): FormData {
  const fd = new FormData();
  fd.append("file", new Blob([Buffer.from("dummy")], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" }), name);
  return fd;
}

try {
  // 1. Fake RUNNING import (upsert stamps updated_at = now → fresh heartbeat).
  await upsertOnboardingJob({ uploadId: RUN_ID, tenantId: TENANT, fileName: "guardtest_running.xlsx", status: "running" });
  // 2. Fake PENDING second upload (as if parked at the preflight dialog).
  //    Tiny fileData so /run's job loader accepts the row.
  await upsertOnboardingJob({ uploadId: PEND_ID, tenantId: TENANT, fileName: "guardtest_pending.xlsx", status: "pending", fileData: Buffer.from("dummy").toString("base64") });

  // A. /upload while an import is running → 409 IMPORT_IN_PROGRESS.
  const up = await fetch(`${API}/upload`, { method: "POST", headers: auth, body: dummyForm("guardtest_second.xlsx") });
  const upBody: any = await up.json().catch(() => ({}));
  check("A. /upload blocked while import running", up.status === 409 && upBody?.code === "IMPORT_IN_PROGRESS",
    `HTTP ${up.status} code=${upBody?.code} active=${upBody?.activeUploadId} msg="${String(upBody?.error ?? "").slice(0, 90)}"`);

  // B. /run on the pending job while ANOTHER import runs → 409 pointing at the
  //    running job (own uploadId excluded, the other one blocks).
  const run = await fetch(`${API}/run`, { method: "POST", headers: { ...auth, "Content-Type": "application/json" }, body: JSON.stringify({ uploadId: PEND_ID, importMode: "create" }) });
  const runBody: any = await run.json().catch(() => ({}));
  check("B. /run blocked while another import running", run.status === 409 && runBody?.code === "IMPORT_IN_PROGRESS" && runBody?.activeUploadId === RUN_ID,
    `HTTP ${run.status} code=${runBody?.code} active=${runBody?.activeUploadId}`);

  // C. /active reports the running job for the tenant (popup data source).
  const act = await fetch(`${API}/active`, { headers: auth });
  const actBody: any = await act.json().catch(() => ({}));
  check("C. /active reports running job", act.status === 200 && actBody?.active === true,
    `HTTP ${act.status} active=${actBody?.active} uploadId=${actBody?.uploadId}`);

  // D. Remove the RUNNING row: a fresh PENDING row alone must still block
  //    /upload (a parked preflight upload holds the tenant's one slot).
  await deleteOnboardingJobsBatch([RUN_ID]);
  const up2 = await fetch(`${API}/upload`, { method: "POST", headers: auth, body: dummyForm("guardtest_third.xlsx") });
  const up2Body: any = await up2.json().catch(() => ({}));
  check("D. /upload blocked by fresh pending job", up2.status === 409 && up2Body?.code === "IMPORT_IN_PROGRESS" && up2Body?.activeUploadId === PEND_ID,
    `HTTP ${up2.status} code=${up2Body?.code} active=${up2Body?.activeUploadId}`);
} finally {
  await deleteOnboardingJobsBatch([RUN_ID, PEND_ID]);
  console.log("cleanup: synthetic job rows deleted");
}

console.log(failures === 0 ? "ALL PASS" : `${failures} FAILURE(S)`);
process.exit(failures === 0 ? 0 : 1);
