/**
 * Verify: named schedule sets (Settings → Schedules) sync into Manage
 * Lifecycles templates (Config_ModuleLifeCycles) for BOTH modules.
 * Run: pnpm exec tsx scripts/verify-schedule-set-sync.local.ts
 */
import { signRdsToken } from "../src/lib/rds-auth.js";

const BASE = "http://localhost:8080";
const TENANT = "test21";
const TOKEN = signRdsToken({ sub: "verify-set-sync", tenant: TENANT, username: "verifytest@test21.rmone", role: "Admin", accessLevel: "admin" });
const H = { Authorization: `Bearer ${TOKEN}`, "Content-Type": "application/json" };

let pass = 0, failures = 0;
const ok = (label: string) => { console.log(`  PASS ${label}`); pass++; };
const fail = (label: string, detail?: unknown) => { console.error(`  FAIL ${label}`, detail ?? ""); failures++; };

async function getSettings(): Promise<any> {
  const res = await fetch(`${BASE}/api/onboarding/settings?tenantId=${TENANT}`, { headers: H });
  if (!res.ok) throw new Error(`GET /settings -> ${res.status}: ${await res.text()}`);
  return res.json();
}
async function putSettings(settings: Record<string, unknown>): Promise<{ status: number; body: any }> {
  const res = await fetch(`${BASE}/api/onboarding/settings`, {
    method: "PUT", headers: H, body: JSON.stringify({ tenantId: TENANT, settings }),
  });
  return { status: res.status, body: await res.json().catch(() => ({})) };
}
async function getLifecycles(module: "PMM" | "OPM"): Promise<any[]> {
  const res = await fetch(`${BASE}/api/rmone/lifecycles?module=${module}&fresh=1`, { headers: H });
  if (!res.ok) throw new Error(`GET /lifecycles?module=${module} -> ${res.status}: ${await res.text()}`);
  const b = await res.json();
  return Array.isArray(b) ? b : (b?.Data ?? b?.data ?? []);
}
const stageNames = (lc: any): string[] => {
  const arr = lc?.Stages ?? lc?.stages ?? [];
  return (Array.isArray(arr) ? arr : [])
    .slice()
    .sort((a: any, b: any) => (Number(a?.StageStep ?? a?.ItemOrder ?? 0) - Number(b?.StageStep ?? b?.ItemOrder ?? 0)))
    .map((s: any) => String(s?.Name ?? s?.StageTitle ?? s?.Title ?? "").trim()).filter(Boolean);
};

async function main() {
  const before = await getSettings();
  const eff = before.effective as Record<string, unknown>;
  const prevProj = String(eff.projectPhaseSets ?? "");
  const prevOpp = String(eff.oppStageSets ?? "");

  const projSets = JSON.stringify([{ id: "syncchk-p1", name: "Sync Check Proj", phases: ["Alpha Phase", "Beta Phase", "Gamma Phase"], groupIds: [], applyMode: "everyone" }]);
  const oppSets = JSON.stringify([{ id: "syncchk-o1", name: "Sync Check Opp", phases: ["Qualify", "Proposal", "Won"], groupIds: [], applyMode: "everyone" }]);

  // ── 1. Save sets → templates created ──
  console.log("\n1. Save named sets (proj + opp)");
  const r1 = await putSettings({ ...eff, projectPhaseSets: projSets, oppStageSets: oppSets });
  if (r1.status !== 200) { fail("PUT -> non-200", { status: r1.status, err: r1.body?.error }); return; }
  console.log("   setLifecycleSync =", JSON.stringify(r1.body.setLifecycleSync), "err =", r1.body.setLifecycleSyncError);
  if (r1.body.setLifecycleSync && r1.body.setLifecycleSync.failed === 0) ok("sync ran, no failures");
  else fail("sync missing or had failures", r1.body.setLifecycleSync);

  const pmm1 = await getLifecycles("PMM");
  const proj1 = pmm1.find((l: any) => String(l?.Name ?? "").trim() === "Sync Check Proj");
  if (proj1) ok(`PMM template "Sync Check Proj" exists, stages=[${stageNames(proj1).join(", ")}]`);
  else { fail("PMM template missing", pmm1.map((l: any) => l?.Name)); }
  if (proj1 && JSON.stringify(stageNames(proj1)) === JSON.stringify(["Alpha Phase", "Beta Phase", "Gamma Phase"])) ok("PMM stages match the set");
  else if (proj1) fail("PMM stages mismatch", stageNames(proj1));

  const opm1 = await getLifecycles("OPM");
  const opp1 = opm1.find((l: any) => String(l?.Name ?? "").trim() === "Sync Check Opp");
  if (opp1) ok(`OPM template "Sync Check Opp" exists, stages=[${stageNames(opp1).join(", ")}]`);
  else fail("OPM template missing", opm1.map((l: any) => l?.Name));
  if (opp1 && JSON.stringify(stageNames(opp1)) === JSON.stringify(["Qualify", "Proposal"])) ok("OPM outcome stage (Won) filtered out");
  else if (opp1) fail("OPM stages unexpected (Won should be filtered)", stageNames(opp1));

  // ── 2. Re-save identical → no-op ──
  console.log("\n2. Re-save identical sets (heal path, expect all-zero sync)");
  const eff2 = (await getSettings()).effective as Record<string, unknown>;
  const r2 = await putSettings({ ...eff2 });
  const s2 = r2.body.setLifecycleSync;
  console.log("   setLifecycleSync =", JSON.stringify(s2));
  if (s2 && s2.created === 0 && s2.updated === 0 && s2.renamed === 0 && s2.failed === 0) ok("identical re-save is a no-op");
  else fail("expected all-zero sync on identical re-save", s2);

  // ── 3. Change a set's phases → template updated in place ──
  console.log("\n3. Change proj set phases (Gamma -> Delta), expect updated=1");
  const projSetsV2 = JSON.stringify([{ id: "syncchk-p1", name: "Sync Check Proj", phases: ["Alpha Phase", "Beta Phase", "Delta Phase"], groupIds: [], applyMode: "everyone" }]);
  const r3 = await putSettings({ ...eff2, projectPhaseSets: projSetsV2 });
  const s3 = r3.body.setLifecycleSync;
  console.log("   setLifecycleSync =", JSON.stringify(s3));
  if (s3 && s3.updated === 1 && s3.failed === 0) ok("in-place stage rewrite reported");
  else fail("expected updated=1", s3);
  const pmm3 = await getLifecycles("PMM");
  const proj3 = pmm3.find((l: any) => String(l?.Name ?? "").trim() === "Sync Check Proj");
  if (proj3 && JSON.stringify(stageNames(proj3)) === JSON.stringify(["Alpha Phase", "Beta Phase", "Delta Phase"])) ok("template stages rewritten");
  else fail("template stages not rewritten", proj3 ? stageNames(proj3) : "missing");

  // ── 4. Restore previous settings (templates intentionally stay) ──
  console.log("\n4. Restore prior settings");
  const effNow = (await getSettings()).effective as Record<string, unknown>;
  const r4 = await putSettings({ ...effNow, projectPhaseSets: prevProj, oppStageSets: prevOpp });
  if (r4.status === 200) ok("settings restored");
  else fail("restore failed", r4.status);

  console.log(`\nDone: ${pass} passed, ${failures} failed`);
  if (failures > 0) process.exitCode = 1;
}
main().catch((e) => { console.error("FATAL", e); process.exitCode = 1; });
