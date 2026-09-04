/**
 * Integration test: a >20 MB upload with S3 unavailable must be rejected
 * BEFORE any parse work, and a failed history row must be retained.
 *
 * Boots the real onboarding router in-process on an ephemeral port with the
 * AWS S3 env stripped, then uploads a 21 MB DELIBERATELY INVALID .xlsx
 * (constant filler bytes). The assertions prove ordering, not just status:
 *   - the response is the size-gate 400 ("require S3 storage"), NOT the
 *     "Could not parse file" 400 this invalid file would produce if
 *     previewExcel ran first — so a passing run proves parse was never invoked;
 *   - the slim job row exists in DB with status "failed" (audit trail kept).
 * Cleans up via DELETE /history/:id (allowed for failed runs).
 *
 * Run: pnpm --filter @workspace/api-server exec tsx scripts/test-large-upload-gate.ts
 */

// Strip S3 config BEFORE the app graph loads (storage reads env per call, but
// this also guards against any import-time capture).
delete process.env.AWS_S3_BUCKET;
delete process.env.AWS_ACCESS_KEY_ID;
delete process.env.AWS_SECRET_ACCESS_KEY;

import express from "express";

async function main(): Promise<number> {
  const { default: onboardingRouter } = await import("../src/routes/onboarding");
  const { signRdsToken } = await import("../src/lib/rds-auth");
  const { getRecentOnboardingJobsMeta } = await import("@workspace/db");

  const app = express();
  app.use(express.json({ limit: "1mb" }));
  app.use("/api/onboarding", onboardingRouter);
  const srv = app.listen(0, "127.0.0.1");
  await new Promise<void>(resolve => srv.once("listening", () => resolve()));
  const port = (srv.address() as { port: number }).port;

  const tenant = `oomgate-test-${Date.now()}`;
  const token = signRdsToken({
    sub: "oomgate-test",
    tenant,
    username: `oomgate-${Date.now()}@test.local`,
    role: "admin",
  });

  const buf = Buffer.alloc(21 * 1024 * 1024, 0x37); // 21 MB, NOT a valid xlsx
  const fd = new FormData();
  fd.append(
    "file",
    new Blob([buf], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" }),
    "oomgate-21mb.xlsx",
  );

  console.log(`[test] POST /upload — 21 MB invalid xlsx, tenant ${tenant}, S3 env stripped`);
  const t0 = Date.now();
  const r = await fetch(`http://127.0.0.1:${port}/api/onboarding/upload`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}` },
    body: fd,
  });
  const elapsed = Date.now() - t0;
  const body = (await r.json().catch(() => ({}))) as { error?: string };
  console.log(`[test] response ${r.status} in ${elapsed}ms: ${JSON.stringify(body).slice(0, 200)}`);

  const failures: string[] = [];
  if (r.status !== 400) failures.push(`expected HTTP 400, got ${r.status}`);
  const msg = String(body?.error ?? "");
  if (!/require S3 storage/i.test(msg)) failures.push(`expected the size-gate message, got: "${msg.slice(0, 200)}"`);
  if (/could not parse/i.test(msg)) failures.push("previewExcel ran before the gate (got a parse error, not the gate 400)");

  // Failed history row retained (the failed-status persist is chained after
  // the 400 goes out — poll briefly).
  let row: { uploadId: string; status: string } | null = null;
  for (let i = 0; i < 20 && !row; i++) {
    await new Promise(resolve => setTimeout(resolve, 500));
    const rows = await getRecentOnboardingJobsMeta(300).catch(() => []);
    const hit = rows.find(j => j.tenantId === tenant);
    if (hit && hit.status === "failed") row = { uploadId: hit.uploadId, status: hit.status };
  }
  if (!row) {
    failures.push("no failed job row found in DB for the rejected upload (audit trail missing)");
  } else {
    console.log(`[ok] failed history row retained: uploadId=${row.uploadId} status=${row.status}`);
    // Cleanup — failed runs are deletable through the history endpoint.
    const del = await fetch(`http://127.0.0.1:${port}/api/onboarding/history/${row.uploadId}`, {
      method: "DELETE",
      headers: { Authorization: `Bearer ${token}` },
    });
    console.log(`[test] cleanup DELETE /history/${row.uploadId} → ${del.status}`);
  }

  srv.close();
  if (failures.length) {
    console.error("FAILED:\n - " + failures.join("\n - "));
    return 1;
  }
  console.log("PASSED: size gate fires before parse and leaves a failed history row");
  return 0;
}

main().then(
  code => process.exit(code),
  err => { console.error("FAILED (unexpected):", err); process.exit(1); },
);
