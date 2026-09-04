/**
 * Audience exception-rule parity check (CI gate, task #178).
 * Run: npx tsx scripts/check-audience-rules.ts
 *
 * The per-audience settings exceptions ("Visible sections", "Editing weeks
 * that have already ended", "Assumed project length") are parsed in TWO
 * places that must never drift:
 *   - server: src/lib/onboarding-defaults.ts (parseDisplayRules /
 *     parsePastEditRules / parseDurationRules, firstMatchingRule)
 *   - web:    ../rmone-web/src/lib/audienceRules.ts (mirror parsers)
 *
 * This script asserts:
 *   1. PARITY — both sides accept/reject the exact same rule shapes and
 *      produce byte-identical parsed output for a battery of valid,
 *      malformed, and edge-case inputs.
 *   2. FIRST-MATCH ORDERING — with mixed user-group ids, org sentinels
 *      (org:bu/div/dept:<id>) and role sentinels (role:<guid>), the first
 *      row (in saved order) whose ids intersect the viewer's memberships
 *      wins, case-insensitively, on BOTH sides.
 *   3. FALLBACK SAFETY — a viewer matching no exception gets the base
 *      ("Everyone") value (null match), and unknown membership (null set)
 *      never grants an exception.
 *
 * Exit code 0 = all good; 1 = at least one assertion failed.
 */
import * as srv from "../src/lib/onboarding-defaults.js";
import * as web from "../../rmone-web/src/lib/audienceRules.js";

let failures = 0;
const fail = (msg: string) => { failures++; console.error("FAIL  " + msg); };
const ok = (msg: string) => console.log("ok    " + msg);
const eqJson = (label: string, got: unknown, want: unknown) => {
  const g = JSON.stringify(got), w = JSON.stringify(want);
  if (g !== w) fail(`${label}: got ${g}, want ${w}`);
};

// ── 1. Parser parity: identical output for identical input ────────────────
type Parser = (raw: string | null | undefined) => unknown[];
const pairs: Array<[string, Parser, Parser]> = [
  ["parseDisplayRules", srv.parseDisplayRules, web.parseDisplayRules as Parser],
  ["parsePastEditRules", srv.parsePastEditRules, web.parsePastEditRules as Parser],
  ["parseDurationRules", srv.parseDurationRules, web.parseDurationRules as Parser],
];

const j = (v: unknown) => JSON.stringify(v);
const commonInputs: Array<string | null | undefined> = [
  undefined, null, "", "not json", "{}", "[]", "123", "\"str\"", "[null]", "[42]",
  j([{ }]),                                        // no ids → dropped
  j([{ ids: [] , value: "full" }]),                // empty ids → dropped
  j([{ ids: ["G1"], value: "full" }]),
  j([{ ids: [" G1 ", "ORG:BU:7"], value: "no-schedule" }]),        // trim + lowercase
  j([{ ids: ["g1"], value: "bogus-mode" }]),       // invalid value → dropped
  j([{ ids: ["g1"], value: "schedule-no-grid" }, { ids: ["org:div:9"], value: "no-schedule-no-grid" }]),
  j([{ ids: [123, "g1", null], value: "full" }]),  // non-string ids filtered
  j([{ ids: ["g1"], allow: true, limitWeeks: 4 }]),
  j([{ ids: ["g1"], allow: true, limitWeeks: null }]),
  j([{ ids: ["g1"], allow: true }]),               // limitWeeks undefined → null
  j([{ ids: ["g1"], allow: false, limitWeeks: 4 }]),   // allow=false → limit forced null
  j([{ ids: ["g1"], allow: "yes", limitWeeks: 4 }]),   // non-bool allow → dropped
  j([{ ids: ["g1"], allow: true, limitWeeks: "4" }]),  // string limit → dropped
  j([{ ids: ["g1"], allow: true, limitWeeks: 9999 }]), // clamp to 520
  j([{ ids: ["g1"], allow: true, limitWeeks: 0.4 }]),  // round/clamp to 1
  j([{ ids: ["g1"], months: 6 }]),
  j([{ ids: ["g1"], months: 0 }]),                 // clamp to 1
  j([{ ids: ["g1"], months: 999 }]),               // clamp to 120
  j([{ ids: ["g1"], months: "6" }]),               // string → dropped
  j([{ ids: ["g1"], months: NaN }]),
  j([{ ids: ["g1"] }]),                            // value-less rows
  j(Array.from({ length: 25 }, (_, i) => ({ ids: [`g${i}`], value: "full", allow: true, months: 1 }))), // >20 rows capped
  j([{ ids: Array.from({ length: 60 }, (_, i) => `g${i}`), value: "full", allow: true, months: 1 }]),    // >50 ids capped
  j([{ ids: ["x".repeat(120)], value: "full", allow: true, months: 1 }]),                                 // id length cap
];

for (const [name, sp, wp] of pairs) {
  for (const input of commonInputs) {
    const s = sp(input), w = wp(input);
    if (JSON.stringify(s) !== JSON.stringify(w)) {
      fail(`${name} parity drift for input ${JSON.stringify(input)}: server=${JSON.stringify(s)} web=${JSON.stringify(w)}`);
    }
  }
  ok(`${name}: server and web agree on ${commonInputs.length} inputs`);
}

// Spot-check the parsed shapes themselves (not just parity — a shared bug
// would slip past a pure diff). Every valid value type per the contract:
eqJson("display: valid row shape",
  srv.parseDisplayRules(j([{ ids: [" G1 ", "ORG:BU:7"], value: "no-schedule" }])),
  [{ ids: ["g1", "org:bu:7"], value: "no-schedule" }]);
eqJson("display: invalid mode rejected", srv.parseDisplayRules(j([{ ids: ["g1"], value: "bogus" }])), []);
eqJson("past-edit: allow=false forces null limit",
  srv.parsePastEditRules(j([{ ids: ["g1"], allow: false, limitWeeks: 4 }])),
  [{ ids: ["g1"], allow: false, limitWeeks: null }]);
eqJson("past-edit: limit clamped to 520",
  srv.parsePastEditRules(j([{ ids: ["g1"], allow: true, limitWeeks: 9999 }])),
  [{ ids: ["g1"], allow: true, limitWeeks: 520 }]);
eqJson("past-edit: string limit rejects row",
  srv.parsePastEditRules(j([{ ids: ["g1"], allow: true, limitWeeks: "4" }])), []);
eqJson("duration: months clamped 1..120",
  srv.parseDurationRules(j([{ ids: ["g1"], months: 0 }, { ids: ["g2"], months: 999 }])),
  [{ ids: ["g1"], months: 1 }, { ids: ["g2"], months: 120 }]);
eqJson("duration: non-numeric months rejects row",
  srv.parseDurationRules(j([{ ids: ["g1"], months: "6" }])), []);
eqJson("rows capped at 20", srv.parseDisplayRules(
  j(Array.from({ length: 25 }, (_, i) => ({ ids: [`g${i}`], value: "full" })))).length, 20);
eqJson("ids capped at 50", (srv.parseDisplayRules(
  j([{ ids: Array.from({ length: 60 }, (_, i) => `g${i}`), value: "full" }]))[0] as srv.DisplayRule).ids.length, 50);

// ── 2. First-match ordering with mixed groups + org sentinels ─────────────
const rules = srv.parseDisplayRules(j([
  { ids: ["G-Alpha", "ORG:BU:10"], value: "no-schedule" },
  { ids: ["org:div:22", "g-beta"], value: "schedule-no-grid" },
  { ids: ["ORG:DEPT:31"], value: "no-schedule-no-grid" },
  { ids: ["ROLE:R-77", "g-gamma"], value: "full" },
]));
const webRules = web.parseDisplayRules(j([
  { ids: ["G-Alpha", "ORG:BU:10"], value: "no-schedule" },
  { ids: ["org:div:22", "g-beta"], value: "schedule-no-grid" },
  { ids: ["ORG:DEPT:31"], value: "no-schedule-no-grid" },
  { ids: ["ROLE:R-77", "g-gamma"], value: "full" },
]));

// Membership sets are lowercased by callers (rmone-proxy.ts / businessRules.ts).
const lc = (ids: string[]) => new Set(ids.map((s) => s.trim().toLowerCase()));
type Case = [string, string[], string | null];
const orderingCases: Case[] = [
  // Case-different group id still matches row 1.
  ["group id case-insensitive", ["g-alpha"], "no-schedule"],
  ["group id upper input", ["G-ALPHA"], "no-schedule"],
  // Org sentinel matches (case differences both in rule and membership).
  ["org bu sentinel", ["ORG:BU:10"], "no-schedule"],
  ["org div sentinel", ["org:div:22"], "schedule-no-grid"],
  ["org dept sentinel", ["Org:Dept:31"], "no-schedule-no-grid"],
  // User in BOTH row 2 and row 3 audiences → row 2 wins (saved order).
  ["first match wins (rows 2+3)", ["org:dept:31", "g-beta"], "schedule-no-grid"],
  // User in row 1 and row 3 → row 1 wins.
  ["first match wins (rows 1+3)", ["org:dept:31", "org:bu:10"], "no-schedule"],
  // No membership intersects → base value (null).
  ["no match → base value", ["g-other", "org:bu:99"], null],
  ["empty memberships → base value", [], null],
  // Role sentinels ride the same id lists — same matching, same ordering.
  ["role sentinel", ["role:r-77"], "full"],
  ["role sentinel case variants", ["Role:R-77"], "full"],
  ["earlier org row beats later role row", ["role:r-77", "org:dept:31"], "no-schedule-no-grid"],
  ["plain group id inside the role row", ["g-gamma"], "full"],
  ["unknown role → base value", ["role:r-99"], null],
];
for (const [label, mine, want] of orderingCases) {
  const sHit = srv.firstMatchingRule(rules, lc(mine));
  const wHit = web.firstMatchingRule(webRules, lc(mine));
  eqJson(`server: ${label}`, sHit ? (sHit as srv.DisplayRule).value : null, want);
  eqJson(`web:    ${label}`, wHit ? (wHit as web.DisplayRule).value : null, want);
}
ok("first-match ordering verified on both sides (groups + org + role sentinels, case variants)");

// ── 3. Unknown membership never grants an exception ────────────────────────
if (srv.firstMatchingRule(rules, null) !== null) fail("server: null memberships must return null (base value)");
if (web.firstMatchingRule(webRules, null) !== null) fail("web: null memberships must return null (base value)");
ok("unknown membership (null) falls back to the Everyone value on both sides");

// sanitizeDefaults round-trip: stored blob is exactly the strict re-serialize,
// and a malformed blob can never be persisted.
const dirty = j([{ ids: ["G1"], value: "full" }, { ids: ["g2"], value: "nope" }, "junk"]);
const sanitized = srv.sanitizeDefaults({ projDisplayRules: dirty, oppDisplayRules: "not json", projPastEditRules: j([{ ids: ["g1"], allow: true, limitWeeks: 3 }]), projDurationRules: j([{ ids: ["ORG:BU:5", "ROLE:R-9"], months: 7 }]) });
eqJson("sanitize: display rules strict re-serialize", sanitized.projDisplayRules, j([{ ids: ["g1"], value: "full" }]));
eqJson("sanitize: malformed blob → \"\"", sanitized.oppDisplayRules, "");
eqJson("sanitize: past-edit re-serialize", sanitized.projPastEditRules, j([{ ids: ["g1"], allow: true, limitWeeks: 3 }]));
eqJson("sanitize: duration lowercases org + role sentinels", sanitized.projDurationRules, j([{ ids: ["org:bu:5", "role:r-9"], months: 7 }]));
// What sanitize stores, the web parser must read back identically.
eqJson("round-trip: web reads what server stores",
  web.parseDisplayRules(sanitized.projDisplayRules), [{ ids: ["g1"], value: "full" }]);
ok("sanitizeDefaults round-trip verified (server store → web read)");

if (failures) {
  console.error(`\n${failures} assertion(s) failed`);
  process.exit(1);
}
console.log("\nAll audience-rule parity checks passed.");
