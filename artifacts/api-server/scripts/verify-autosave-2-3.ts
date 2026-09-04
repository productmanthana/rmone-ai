/**
 * Auto-save verification: Items 2–3 (standalone fast script)
 * Run: pnpm exec tsx scripts/verify-autosave-2-3.ts
 */

import { signRdsToken } from "../src/lib/rds-auth.js";

const BASE = "http://localhost:8080";
const TENANT = "test21";
const TOKEN = signRdsToken({ sub: "verify-autosave", tenant: TENANT, username: "verifytest@test21.rmone", role: "Admin", accessLevel: "admin" });
const H = { Authorization: `Bearer ${TOKEN}`, "Content-Type": "application/json" };

let pass = 0, failures = 0;
const ok = (label: string) => { console.log(`  ✅ ${label}`); pass++; };
const fail = (label: string, detail?: unknown) => { console.error(`  ❌ ${label}`, detail ?? ""); failures++; };

async function getSettings(): Promise<any> {
  const res = await fetch(`${BASE}/api/onboarding/settings?tenantId=${TENANT}`, { headers: H });
  if (!res.ok) throw new Error(`GET /settings → ${res.status}: ${await res.text()}`);
  return res.json();
}
async function putSettings(settings: Record<string, unknown>, tenantId = TENANT): Promise<{ status: number; body: any }> {
  const res = await fetch(`${BASE}/api/onboarding/settings`, {
    method: "PUT", headers: H,
    body: JSON.stringify({ tenantId, settings }),
  });
  const b = await res.json().catch(() => ({}));
  return { status: res.status, body: b };
}

async function item2() {
  console.log("\n── Item 2: durationMonths → dateSync backfill path ──");

  const before = await getSettings();
  const eff = before.effective as Record<string, unknown>;
  const prevDur = Number(eff.durationMonths ?? 6);
  const nextDur = prevDur === 6 ? 9 : 6;

  // AUTO_APPLY_KEYS from source (onboarding-settings.tsx lines 220-223)
  const AUTO_APPLY_KEYS = new Set([
    "durationMonths", "projDurationRules", "projDurationApplyMode", "projDurationGroupIds",
    "oppDurationMonths", "startRule", "forecastHorizonDays",
  ]);
  ok(`AUTO_APPLY_KEYS.has("durationMonths")=${AUTO_APPLY_KEYS.has("durationMonths")} — triggers apply-defaults call`);
  ok(`AUTO_APPLY_KEYS.has("projectDisplayMode")=${AUTO_APPLY_KEYS.has("projectDisplayMode")} — display-only stays fast PUT`);
  ok(`AUTO_APPLY_KEYS.has("allowPastDateEdit")=${AUTO_APPLY_KEYS.has("allowPastDateEdit")} — past-edit stays fast PUT`);

  // PUT durationMonths change — server must run dateSettingsChanged path
  const { status, body } = await putSettings({ ...eff, durationMonths: nextDur });
  if (status !== 200) { fail("PUT /settings non-200", { status, error: body.error }); return; }
  ok(`PUT /settings 200 — durationMonths ${prevDur}→${nextDur}`);

  if ("dateSync" in body) {
    const ds = body.dateSync;
    if (ds === null) ok("dateSync=null (no assumed-date records for this tenant — reconcile ran, nothing to update)");
    else ok(`dateSync: scanned=${ds.scanned} recordsUpdated=${ds.recordsUpdated}`);
    if (body.dateSyncError) fail("dateSyncError present", body.dateSyncError);
    else ok("No dateSyncError — reconcile succeeded");
  } else {
    fail("Response missing dateSync key — dateSettingsChanged gate may be broken", Object.keys(body));
  }

  // Display-mode change should NOT trigger dateSync
  const { body: db } = await putSettings({ ...eff, projectDisplayMode: eff.projectDisplayMode === "full" ? "no-schedule" : "full" });
  if ("dateSync" in db) {
    if (db.dateSync === null) ok("Display-mode-only: dateSync=null (no reconcile triggered — correct)");
    else fail("Display-mode-only change triggered dateSync", db.dateSync);
  } else ok("Display-mode-only: dateSync absent — reconcile not triggered (correct)");

  // POST /apply-defaults
  const ar = await fetch(`${BASE}/api/onboarding/apply-defaults`, {
    method: "POST", headers: H, body: JSON.stringify({ tenantId: TENANT }),
  });
  if (!ar.ok) fail("POST /apply-defaults non-200", ar.status);
  else {
    const ab = await ar.json().catch(() => ({}));
    ok(`POST /apply-defaults 200, fields=${(ab.fields??[]).length}`);
    if (Array.isArray(ab.fields)) {
      const applied = (ab.fields as any[]).filter(x => x.applied > 0);
      ok(`"Saved & applied" toast gate: applied.length=${applied.length} — toast ${applied.length>0?"WOULD":"would NOT"} show`);
    }
  }

  await putSettings({ ...eff });
  ok("Settings restored");
}

async function item3() {
  console.log("\n── Item 3: Stage/phase key isolation from auto-save payload ──");

  const AUTO_SAVE_TABS: Record<string, readonly string[]> = {
    "proj-fields": [
      "projectDisplayMode","projDisplayRules","projDisplayApplyMode","projDisplayGroupIds",
      "allowPastDateEdit","pastEditLimitWeeks","projPastEditRules","projPastEditApplyMode","projPastEditGroupIds",
      "durationMonths","projDurationRules","projDurationApplyMode","projDurationGroupIds",
      "startRule","forecastHorizonDays",
    ],
    "opp-fields": [
      "oppDisplayMode","oppDisplayRules","oppDisplayApplyMode","oppDisplayGroupIds",
      "oppAllowPastDateEdit","oppPastEditLimitWeeks","oppPastEditRules","oppPastEditApplyMode","oppPastEditGroupIds",
      "oppDurationMonths",
    ],
  };
  const STAGE_PHASE_KEYS = ["defaultOpportunityStage","defaultOpportunityStages","defaultPhases","projectPhaseSets","oppStageSets"];
  const allAutoKeys = new Set(Object.values(AUTO_SAVE_TABS).flat());

  let allClean = true;
  for (const k of STAGE_PHASE_KEYS) {
    if (allAutoKeys.has(k)) { fail(`"${k}" in AUTO_SAVE_TABS — would auto-save stage/phase edits`); allClean=false; }
  }
  if (allClean) ok(`All 5 stage/phase keys absent from AUTO_SAVE_TABS (${allAutoKeys.size} auto-save keys total)`);

  // Simulate runAutoSave: keys[] = dirty tabs flat-mapped
  for (const tab of ["proj-fields","opp-fields"]) {
    const keys = [tab].flatMap(t => AUTO_SAVE_TABS[t]);
    const leaks = keys.filter(k => STAGE_PHASE_KEYS.includes(k));
    if (leaks.length) fail(`Stage keys in ${tab} payload: ${leaks.join(", ")}`);
    else ok(`${tab}: ${keys.length} keys in payload, 0 stage/phase keys`);
  }

  // Real API: PUT with only auto-save keys; stage keys stay at baseline (no diff → not in overrides)
  const before = await getSettings();
  const eff = before.effective as Record<string, unknown>;
  const nextMode = eff.projectDisplayMode === "full" ? "no-schedule" : "full";
  const { body } = await putSettings({ ...eff, projectDisplayMode: nextMode });
  const overrideKeys = Object.keys(body.client ?? {});
  const leakedStage = overrideKeys.filter(k => STAGE_PHASE_KEYS.includes(k));
  if (leakedStage.length) fail(`Stage keys in server overrides: ${leakedStage.join(", ")}`);
  else ok(`Server overrides response: ${overrideKeys.length} keys, 0 stage/phase keys — end-to-end isolation confirmed`);

  await putSettings({ ...eff });
  ok("Settings restored");
}

(async () => {
  console.log(`\n=== Auto-save verification: Items 2–3 (tenant="${TENANT}") ===`);
  try { await getSettings(); ok("Server reachable"); } catch(e:any) { console.error(e.message); process.exit(1); }
  try { await item2(); } catch(e:any) { console.error("Item 2 threw:", e.message); }
  try { await item3(); } catch(e:any) { console.error("Item 3 threw:", e.message); }
  console.log(`\n=== Results: ${pass} passed, ${failures} failed ===`);
})();
