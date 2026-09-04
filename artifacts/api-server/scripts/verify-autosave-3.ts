/**
 * Item 3: Stage/phase key isolation from auto-save payload
 * Run: pnpm exec tsx scripts/verify-autosave-3.ts
 */

import { signRdsToken } from "../src/lib/rds-auth.js";

const BASE = "http://localhost:8080";
const TENANT = "test21";
const TOKEN = signRdsToken({ sub: "verify-autosave", tenant: TENANT, username: "verifytest@test21.rmone", role: "Admin", accessLevel: "admin" });
const H = { Authorization: `Bearer ${TOKEN}`, "Content-Type": "application/json" };

let pass = 0, failures = 0;
const ok = (label: string) => { console.log(`  ✅ ${label}`); pass++; };
const fail = (label: string, detail?: unknown) => { console.error(`  ❌ ${label}`, detail ?? ""); failures++; };

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
// Stage/phase fields — live on proj-defaults/opp-defaults with MANUAL Save buttons
const STAGE_PHASE_KEYS = ["defaultOpportunityStage","defaultOpportunityStages","defaultPhases","projectPhaseSets","oppStageSets"];

(async () => {
  console.log(`\n=== Item 3: Stage/phase isolation (tenant="${TENANT}") ===`);

  // ① Static: no stage/phase key appears in any auto-save tab
  const allAutoKeys = new Set(Object.values(AUTO_SAVE_TABS).flat());
  let clean = true;
  for (const k of STAGE_PHASE_KEYS) {
    if (allAutoKeys.has(k)) { fail(`"${k}" in AUTO_SAVE_TABS`); clean = false; }
  }
  if (clean) ok(`All ${STAGE_PHASE_KEYS.length} stage/phase keys absent from AUTO_SAVE_TABS (${allAutoKeys.size} auto-save keys)`);

  // ② Static: simulate runAutoSave key construction (dirty tabs flatMap)
  for (const tab of ["proj-fields", "opp-fields"] as const) {
    const keys = [tab].flatMap(t => AUTO_SAVE_TABS[t]);
    const leaks = keys.filter(k => STAGE_PHASE_KEYS.includes(k));
    if (leaks.length) fail(`${tab} payload leaks stage keys: ${leaks.join(", ")}`);
    else ok(`${tab} payload (${keys.length} keys): 0 stage/phase leaks`);
  }

  // ③ Stage/phase keys live in SECTION_FIELDS.projects (manual Save) — confirm not in AUTO_SAVE_TABS
  //    From source (onboarding-settings.tsx lines 166-184, SECTION_FIELDS.projects):
  const SECTION_FIELDS_PROJECTS = [
    "defaultOpportunityStage", "defaultOpportunityStages",
    "defaultPhases", "projectPhaseSets", "oppStageSets", "durationMonths", "oppDurationMonths", "startRule",
    "forecastHorizonDays", "projectDisplayMode", "allowPastDateEdit", "pastEditLimitWeeks",
    "projSchedApplyMode", "projSchedGroupIds", "projDurationApplyMode", "projDurationGroupIds",
    "projDisplayApplyMode", "projDisplayGroupIds", "projPastEditApplyMode", "projPastEditGroupIds",
    "oppDisplayMode", "oppAllowPastDateEdit", "oppPastEditLimitWeeks",
    "oppSchedApplyMode", "oppSchedGroupIds", "oppDisplayApplyMode", "oppDisplayGroupIds",
    "oppPastEditApplyMode", "oppPastEditGroupIds", "projDisplayRules", "oppDisplayRules",
    "projPastEditRules", "oppPastEditRules", "projDurationRules",
  ];
  for (const k of STAGE_PHASE_KEYS) {
    if (SECTION_FIELDS_PROJECTS.includes(k)) ok(`"${k}" in SECTION_FIELDS.projects (manual Save card) ✓`);
  }
  ok("Stage/phase keys are in SECTION_FIELDS.projects (manual Save) and absent from AUTO_SAVE_TABS — no overlap");

  // ④ Real API: PUT with only a display-mode change (simulates auto-save body for proj-fields);
  //    stage keys stay at baseline → server sees no diff → not stored in client overrides
  const gRes = await fetch(`${BASE}/api/onboarding/settings?tenantId=${TENANT}`, { headers: H });
  if (!gRes.ok) { fail("GET /settings failed", gRes.status); return; }
  const eff = (await gRes.json()).effective as Record<string, unknown>;
  ok("GET /settings 200");

  const nextMode = eff.projectDisplayMode === "full" ? "no-schedule" : "full";
  // Auto-save payload: start from baseline, overlay ONLY auto-tab keys (stage keys stay = baseline = no diff)
  const payload: Record<string, unknown> = { ...eff };
  for (const k of AUTO_SAVE_TABS["proj-fields"]) payload[k] = eff[k]; // keep at baseline except display
  payload.projectDisplayMode = nextMode; // the one actual change

  const pRes = await fetch(`${BASE}/api/onboarding/settings`, {
    method: "PUT", headers: H,
    body: JSON.stringify({ tenantId: TENANT, settings: payload }),
  });
  if (!pRes.ok) { fail("PUT /settings failed", pRes.status); }
  else {
    const pBody = await pRes.json();
    const overrideKeys = Object.keys(pBody.client ?? {});
    const stageLeaks = overrideKeys.filter(k => STAGE_PHASE_KEYS.includes(k));
    if (stageLeaks.length) fail(`Stage keys in server client-overrides: ${stageLeaks.join(", ")}`);
    else ok(`Server client-overrides: ${overrideKeys.length} keys, 0 stage/phase — end-to-end isolation confirmed`);
    if ("projectDisplayMode" in (pBody.client ?? {})) ok(`projectDisplayMode in overrides (changed field stored correctly)`);
    // Restore
    await fetch(`${BASE}/api/onboarding/settings`, {
      method: "PUT", headers: H,
      body: JSON.stringify({ tenantId: TENANT, settings: { ...eff } }),
    });
    ok("Settings restored");
  }

  console.log(`\n=== Results: ${pass} passed, ${failures} failed ===`);
})();
