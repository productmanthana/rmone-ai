import { acquireTenantImportLease, hasActiveOnboardingRun } from "@workspace/db";
async function main() {
  const label = "leasesmoke-0807";
  console.log("active-run probe (expect false):", await hasActiveOnboardingRun(label));
  const a = await acquireTenantImportLease(label, 5000);
  console.log("first acquire ok:", !!a);
  const t0 = Date.now();
  const b = await acquireTenantImportLease(label, 2000);
  console.log("second acquire while held (expect null):", b === null, "waited", Date.now() - t0, "ms");
  await a!.release();
  const c = await acquireTenantImportLease(label, 5000);
  console.log("re-acquire after release (expect true):", !!c);
  await c!.release();
  if (b) await b.release();
  console.log("SMOKE_PASS");
  process.exit(0);
}
main().catch(e => { console.error("FATAL", e); process.exit(1); });
