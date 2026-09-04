/**
 * Admin-wins policy for per-record team-layout overrides (lib/projectViewMode).
 *
 * A user may override the team layout for ONE record ("Schedule View" picker);
 * that choice is stored in tenant-scoped localStorage together with the
 * company display mode it was picked AGAINST (its base). These tests pin:
 *
 *   A) Before the real settings load, saved overrides are honored as-is
 *      (defaults never masquerade as "the admin changed the setting").
 *   B) A pick made BEFORE the settings fetch resolves is stored base-pending
 *      and stamped from the first successful fetch — a pre-existing server
 *      setting that differs from the defaults must NOT delete it.
 *   C) Once settings load — even when they EQUAL the built-in defaults, which
 *      produces no rules value change — the readiness flip still notifies
 *      subscribers, and a pre-migration entry (bare mode string, no base) is
 *      swept from storage; the record follows the company setting again.
 *   D) A fresh pick wins over the company setting and SURVIVES a reload of
 *      identical settings.
 *   E) An admin changing the module's display mode AFTER the pick invalidates
 *      the override (admin wins) — and the sweep removes it from storage.
 *   F) Module isolation: changing the OPPORTUNITY setting never clears a
 *      PROJECT-record override, and vice versa.
 *   G) Picking "Default" (null) clears the override immediately.
 */

import assert from "node:assert/strict";

// ── localStorage shim (must exist before the modules under test load) ───────
const store = new Map<string, string>();
(globalThis as Record<string, unknown>).localStorage = {
  getItem: (k: string) => (store.has(k) ? store.get(k)! : null),
  setItem: (k: string, v: string) => { store.set(k, String(v)); },
  removeItem: (k: string) => { store.delete(k); },
  clear: () => { store.clear(); },
  key: (i: number) => [...store.keys()][i] ?? null,
  get length() { return store.size; },
};

// ── fetch router: serves the onboarding settings the businessRules lib loads ─
let effectiveSettings: Record<string, unknown> = {};
(globalThis as Record<string, unknown>).fetch = async (url: unknown) => {
  const u = String(url);
  if (u.includes("/api/onboarding/settings")) {
    return {
      ok: true,
      json: async () => ({ effective: effectiveSettings }),
    } as Response;
  }
  throw new Error(`unexpected fetch in test: ${u}`);
};

const OVERRIDE_KEY = "rmone:projViewMode:v1"; // no tenant in storage → bare key
const OPP = "OPM-01435";
const PROJ = "PMM-00042";

const rawStore = () => JSON.parse(store.get(OVERRIDE_KEY) ?? "{}") as Record<string, unknown>;

// Seed a LEGACY entry (bare string, saved before bases existed) before import.
store.set(OVERRIDE_KEY, JSON.stringify({ [OPP.toLowerCase()]: "full" }));

const { loadBusinessRules, hasBusinessRulesLoaded, subscribeBusinessRules } =
  await import("../businessRules.js");
const {
  getDisplayModeForRecord, getProjectViewOverride, setProjectViewOverride,
} = await import("../projectViewMode.js");

// ── A) pre-load: legacy override honored, defaults not treated as a change ──
assert.equal(hasBusinessRulesLoaded(), false, "settings not loaded yet");
assert.equal(
  getDisplayModeForRecord(OPP, "OPM"), "full",
  "before settings load, the stored override applies unchanged",
);

// ── B) pre-load pick → base-pending, honored across the first fetch ─────────
setProjectViewOverride(PROJ, "schedule-no-grid", "PMM");
assert.equal(
  getDisplayModeForRecord(PROJ, "PMM"), "schedule-no-grid",
  "a pick made before settings load applies immediately",
);

// ── C) first load EQUALS the defaults → readiness still notifies + sweeps ───
let notified = 0;
const unsub = subscribeBusinessRules(() => { notified += 1; });
effectiveSettings = {}; // server rules identical to the built-in defaults
await loadBusinessRules();
unsub();
assert.equal(hasBusinessRulesLoaded(), true, "settings marked loaded");
assert.equal(notified, 1, "the readiness flip notifies even with unchanged rule values");
assert.equal(
  getDisplayModeForRecord(OPP, "OPM"), "full",
  "a pre-migration override no longer decides — the company setting shows",
);
assert.equal(getProjectViewOverride(OPP, "OPM"), null, "pre-migration entry reads as cleared");
assert.equal(
  OPP.toLowerCase() in rawStore(), false,
  "the sweep removed the pre-migration entry from storage",
);
assert.equal(
  getDisplayModeForRecord(PROJ, "PMM"), "schedule-no-grid",
  "the pre-load pick survives the first fetch (server setting is its base, not a later change)",
);
assert.deepEqual(
  rawStore()[PROJ.toLowerCase()], { m: "schedule-no-grid", mod: "PMM", b: "full" },
  "the sweep stamped the fetched company setting as the pending pick's base",
);

// ── D) fresh pick wins, and survives an identical-settings reload ───────────
effectiveSettings = { oppDisplayMode: "schedule-no-grid" };
await loadBusinessRules();
assert.equal(getDisplayModeForRecord(OPP, "OPM"), "schedule-no-grid", "company setting applies");
setProjectViewOverride(OPP, "full", "OPM");
assert.equal(getDisplayModeForRecord(OPP, "OPM"), "full", "new pick wins immediately");
await loadBusinessRules(); // same settings again (e.g. popup reopens)
assert.equal(
  getDisplayModeForRecord(OPP, "OPM"), "full",
  "an unchanged admin setting never clears a user's pick",
);
assert.deepEqual(
  rawStore()[OPP.toLowerCase()], { m: "full", b: "schedule-no-grid", mod: "OPM" },
  "the pick is persisted together with the base it was picked against",
);

// ── E) admin changes the opp setting afterwards → admin wins ────────────────
effectiveSettings = { oppDisplayMode: "no-schedule-no-grid" };
await loadBusinessRules();
assert.equal(
  getDisplayModeForRecord(OPP, "OPM"), "no-schedule-no-grid",
  "an admin settings change made after the pick overrides it",
);
assert.equal(getProjectViewOverride(OPP, "OPM"), null, "the outranked override reads as cleared");
assert.equal(
  OPP.toLowerCase() in rawStore(), false,
  "the sweep removed the outranked override from storage",
);

// ── F) module isolation ──────────────────────────────────────────────────────
// PROJ still carries its override (project setting is the default "full").
effectiveSettings = { oppDisplayMode: "full" };
await loadBusinessRules();
assert.equal(
  getDisplayModeForRecord(PROJ, "PMM"), "schedule-no-grid",
  "an opp-side settings change never clears a project-record override",
);
effectiveSettings = { oppDisplayMode: "full", projectDisplayMode: "no-schedule" };
await loadBusinessRules();
assert.equal(
  getDisplayModeForRecord(PROJ, "PMM"), "no-schedule",
  "a project-side settings change clears the project-record override",
);

// ── G) "Default" clears immediately ─────────────────────────────────────────
setProjectViewOverride(OPP, "no-schedule", "OPM");
assert.equal(getDisplayModeForRecord(OPP, "OPM"), "no-schedule");
setProjectViewOverride(OPP, null, "OPM");
assert.equal(
  getDisplayModeForRecord(OPP, "OPM"), "full",
  "picking Default returns the record to the company setting",
);

console.log("✓ admin display-mode changes outrank stale per-record layout overrides");
