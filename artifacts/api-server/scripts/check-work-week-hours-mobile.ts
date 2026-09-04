/**
 * Mobile work-week-hours flow check (CI gate, task #467).
 * Run: pnpm --filter @workspace/api-server run check:hours-win
 *      (included at the end of that chain)
 *
 * Confirms three things:
 *
 *  1. SERVER settings endpoint logic: mergeDefaults propagates a client
 *     override of workWeekHours=55 into effective.workWeekHours=55, i.e. the
 *     GET /api/onboarding/settings?tenantId=… response body that
 *     getWorkWeekHours() reads will carry 55 for that tenant, not the builtin 40.
 *
 *  2. MOBILE parsing logic: the actual parser extracted from
 *     artifacts/rmone-mobile/lib/api.ts getMobileBusinessRules() — the num()
 *     helper that getWorkWeekHours() now delegates to (same pattern as
 *     check-hours-win.ts) — handles every shape the server can return:
 *       • numeric value → returned verbatim
 *       • string-encoded number → coerced
 *       • missing / null / NaN / non-positive → fallback 40
 *     Extraction drift = test failure, so a change to the real function that
 *     breaks the contract is caught rather than hidden by an inline copy.
 *
 *  3. MOBILE display sites: a line-scoped text scan of resources.tsx confirms
 *     that each of the three specific render locations references the
 *     `workWeekHours` state variable (not a hardcoded 40). Each assertion is
 *     pinned to the expected line region so a match at a different site cannot
 *     satisfy a different site's assertion.
 *
 * Exit code 0 = all good; 1 = at least one assertion failed.
 */

import { readFileSync, writeFileSync, mkdtempSync } from "node:fs";
import { join, dirname } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath, pathToFileURL } from "node:url";
import {
  BUILTIN_ONBOARDING_DEFAULTS,
  mergeDefaults,
} from "../src/lib/onboarding-defaults.js";
import type { OnboardingDefaults } from "../src/lib/onboarding-defaults.js";

const here = dirname(fileURLToPath(import.meta.url));

let failures = 0;
function check(name: string, actual: unknown, expected: unknown): void {
  const a = JSON.stringify(actual ?? null);
  const e = JSON.stringify(expected ?? null);
  if (a === e) { console.log(`  OK   ${name}`); return; }
  failures++;
  console.error(`  FAIL ${name}\n       expected ${e}\n       got      ${a}`);
}
function checkTrue(name: string, cond: boolean, hint = ""): void {
  if (cond) { console.log(`  OK   ${name}`); return; }
  failures++;
  console.error(`  FAIL ${name}${hint ? `\n       ${hint}` : ""}`);
}

// ── 1. Server-side: mergeDefaults propagates workWeekHours ──────────────────
console.log("check-work-week-hours-mobile: server settings logic");

check("builtin workWeekHours is 40",
  BUILTIN_ONBOARDING_DEFAULTS.workWeekHours, 40);

const clientOverride: Partial<OnboardingDefaults> = { workWeekHours: 55 };
check("client override 55 → effective 55 (no global layer)",
  mergeDefaults(clientOverride).workWeekHours, 55);

const globalOverride: Partial<OnboardingDefaults> = { workWeekHours: 35 };
check("client override 55 wins over global 35",
  mergeDefaults(globalOverride, clientOverride).workWeekHours, 55);

check("null client layer → global 35 passes through",
  mergeDefaults(globalOverride, null).workWeekHours, 35);

check("no overrides → builtin 40",
  mergeDefaults().workWeekHours, 40);

check("non-workWeekHours field unchanged after override",
  mergeDefaults(clientOverride).forecastWeeks,
  BUILTIN_ONBOARDING_DEFAULTS.forecastWeeks);

// ── 2. Mobile: extract REAL parser from getMobileBusinessRules() in lib/api.ts ──
// getWorkWeekHours() now delegates to getMobileBusinessRules(), whose num()
// helper is the real parser. Following the same extraction pattern as
// check-hours-win.ts: read the actual source, slice out the parser body, write
// a testable temp module, import it. This way a change to the real function
// that breaks the contract is caught rather than hidden by an inline copy.
console.log("\ncheck-work-week-hours-mobile: mobile business-rules parser (extracted from real source)");

const apiPath = join(here, "../../rmone-mobile/lib/api.ts");
const apiSrc = readFileSync(apiPath, "utf8");

// getWorkWeekHours() must still delegate to getMobileBusinessRules().
checkTrue(
  "getWorkWeekHours() delegates to getMobileBusinessRules().workWeekHours",
  /return \(await getMobileBusinessRules\(\)\)\.workWeekHours;/.test(apiSrc),
);

// Anchor on stable markers that uniquely identify the parser inside
// getMobileBusinessRules(): the eff derivation through the num() helper's
// guard line. Extraction drift (markers missing) → test failure.
const startMarker = /const eff = data\?\.effective \?\? \{\};/;
const endMarker   = /return Number\.isFinite\(n\) && n > 0 \? n : fallback;/;

const startIdx = apiSrc.search(startMarker);
if (startIdx < 0) {
  failures++;
  console.error("  FAIL extraction drift: start marker (const eff = data?.effective ?? {}) not found in getMobileBusinessRules() — was the parser rewritten?");
  process.exit(1);
}
const rest    = apiSrc.slice(startIdx);
const endIdx  = rest.search(endMarker);
if (endIdx < 0) {
  failures++;
  console.error("  FAIL extraction drift: end marker (Number.isFinite(n) && n > 0 ? n : fallback) not found in getMobileBusinessRules() — was the parser rewritten?");
  process.exit(1);
}
const endMatch    = rest.slice(endIdx).match(endMarker)!;
// Include the arrow function's closing `};` that immediately follows the guard.
const afterGuard  = rest.slice(endIdx + endMatch[0].length);
const closeMatch  = afterGuard.match(/^\s*\n\s*\};/);
if (!closeMatch) {
  failures++;
  console.error("  FAIL extraction drift: num() helper does not close with `};` right after the guard — was the parser rewritten?");
  process.exit(1);
}
const parserSlice = rest.slice(0, endIdx + endMatch[0].length) + closeMatch[0];

// Sanity: the slice must contain all the logic lines.
checkTrue(
  "extracted slice contains eff derivation from data?.effective",
  /const eff = data\?\.effective \?\? \{\}/.test(parserSlice),
);
checkTrue(
  "extracted slice contains n derivation with numeric/string/NaN branches",
  /typeof v === "number".*typeof v === "string".*Number\(v\).*NaN/.test(parserSlice),
);
checkTrue(
  "extracted slice contains the finite+positive guard returning the fallback",
  /Number\.isFinite\(n\) && n > 0 \? n : fallback/.test(parserSlice),
);
// The real call site must ask num() for workWeekHours with the 40 fallback.
checkTrue(
  "getMobileBusinessRules() reads workWeekHours via num(\"workWeekHours\", 40)",
  /num\("workWeekHours",\s*40\)/.test(apiSrc),
);

// Build a runnable temp module wrapping the extracted parser.
const tmp     = mkdtempSync(join(tmpdir(), "wwh-mobile-"));
const modPath = join(tmp, "parser.ts");
writeFileSync(modPath, `
export function parseWWH(data: { effective?: { workWeekHours?: unknown } } | null): number {
  ${parserSlice}
  return num("workWeekHours", 40);
}
`);
const { parseWWH } = await import(pathToFileURL(modPath).href) as {
  parseWWH: (data: { effective?: { workWeekHours?: unknown } } | null) => number;
};

// Run fixtures against the REAL parser logic.
check("numeric 55 → 55",           parseWWH({ effective: { workWeekHours: 55 } }), 55);
check("string '55' → 55",          parseWWH({ effective: { workWeekHours: "55" } }), 55);
check("numeric 37.5 → 37.5",       parseWWH({ effective: { workWeekHours: 37.5 } }), 37.5);
check("missing key → 40 fallback", parseWWH({ effective: {} }), 40);
check("null data → 40 fallback",   parseWWH(null), 40);
check("zero → 40 fallback",        parseWWH({ effective: { workWeekHours: 0 } }), 40);
check("negative → 40 fallback",    parseWWH({ effective: { workWeekHours: -8 } }), 40);
check("string 'none' → 40 fallback", parseWWH({ effective: { workWeekHours: "none" } }), 40);
check("string 'NaN' → 40 fallback",  parseWWH({ effective: { workWeekHours: "NaN" } }), 40);

// Confirmed flow: 100% at 55h/wk = 55h, 60% at 55h/wk = 33h (not the 24h from 40h).
check("100% of 55h week = 55h",
  Math.round((100 / 100) * parseWWH({ effective: { workWeekHours: 55 } })), 55);
check("60% of 55h week = 33h (not 24h from 40h default)",
  Math.round((60 / 100) * parseWWH({ effective: { workWeekHours: 55 } })), 33);

// ── 3. Mobile display sites: line-scoped assertions in resources.tsx ─────────
// Each assertion is pinned to the expected line region (±30 lines) so a match
// at a different site cannot satisfy a different site's assertion.
console.log("\ncheck-work-week-hours-mobile: resources.tsx display-site audit (line-scoped)");

const resourcesPath = join(here, "../../rmone-mobile/app/(tabs)/resources.tsx");
const resSrc   = readFileSync(resourcesPath, "utf8");
const resLines = resSrc.split("\n");

// Return 1-based line numbers for lines matching re, within [minLine, maxLine].
function findInRange(re: RegExp, minLine: number, maxLine: number): number[] {
  const found: number[] = [];
  for (let i = minLine - 1; i < Math.min(maxLine, resLines.length); i++) {
    if (re.test(resLines[i])) found.push(i + 1);
  }
  return found;
}

// Site 1 (AI analysis prompt, line ~285): inside openAnalysis(), the
// projectsLine builder that computes h/wk per project for the LLM prompt.
// Scoped to lines 250–320 — well before the cell-modal region.
// The distinguishing context: the result feeds `hrs` which appears in a
// template literal with `~${hrs}h/wk at ${a.pct}%` on the NEXT line.
{
  const site1 = findInRange(
    /\(a\.pct\s*\/\s*100\)\s*\*\s*workWeekHours/,
    250, 320,
  );
  checkTrue(
    "site 1 (AI prompt h/wk calc, ~line 285) — workWeekHours used in range 250–320",
    site1.length > 0,
    `pattern not found between lines 250–320; found at: ${
      resLines.reduce<number[]>((acc, l, i) => (
        /\(a\.pct\s*\/\s*100\)\s*\*\s*workWeekHours/.test(l) ? [...acc, i + 1] : acc
      ), []).join(", ") || "nowhere"
    }`,
  );
  if (site1.length > 0) console.log(`    found at line(s): ${site1.join(", ")}`);

  // Confirm the surrounding context: the hrs variable feeds a ~${hrs}h/wk string.
  const hrsUsage = findInRange(/~\$\{hrs\}h\/wk/, 250, 320);
  checkTrue(
    "site 1 context: hrs variable used in '~${hrs}h/wk' prompt string in same range",
    hrsUsage.length > 0,
    `~\${hrs}h/wk not found in range 250–320`,
  );
}

// Site 2 (cell-modal projHours label, line ~2585): inside the cell-modal
// renderer, the `const projHours = …` line that drives the "~Nh/wk" label.
// Scoped to lines 2555–2615.
{
  const site2 = findInRange(
    /const\s+projHours\s*=\s*Math\.round\(\s*\(a\.pct\s*\/\s*100\)\s*\*\s*workWeekHours\s*\)/,
    2580, 2650,
  );
  checkTrue(
    "site 2 (cell modal projHours, ~line 2615) — workWeekHours used in range 2580–2650",
    site2.length > 0,
    `const projHours = Math.round((a.pct / 100) * workWeekHours) not found in range 2580–2650`,
  );
  if (site2.length > 0) console.log(`    found at line(s): ${site2.join(", ")}`);
}

// Site 3 (cell-modal totalHours label, line ~2621): the `const totalHours = …`
// line that drives the "Nh total" label. Scoped to lines 2585–2655.
{
  const site3 = findInRange(
    /const\s+totalHours\s*=\s*totalWeeks\s*\?.*\(a\.pct\s*\/\s*100\)\s*\*\s*workWeekHours/,
    2585, 2655,
  );
  checkTrue(
    "site 3 (cell modal totalHours, ~line 2621) — workWeekHours used in range 2585–2655",
    site3.length > 0,
    `const totalHours = totalWeeks ? Math.round((a.pct / 100) * workWeekHours * …) not found in range 2585–2655`,
  );
  if (site3.length > 0) console.log(`    found at line(s): ${site3.join(", ")}`);
}

// Confirm workWeekHours is fetched on mount — now via getMobileBusinessRules()
// (getWorkWeekHours delegates to it) with setWorkWeekHours(br.workWeekHours).
{
  const mountFetch = findInRange(/getMobileBusinessRules\(\)\.then\(br\s*=>/, 1, 500);
  const setter     = findInRange(/setWorkWeekHours\(br\.workWeekHours\)/, 1, 500);
  checkTrue(
    "workWeekHours fetched on mount via getMobileBusinessRules().then(br =>…) in range 1–500",
    mountFetch.length > 0 && setter.length > 0,
    `mount fetch found at: ${mountFetch.join(", ") || "nowhere"}; setter found at: ${setter.join(", ") || "nowhere"}`,
  );
  if (mountFetch.length > 0) console.log(`    found at line(s): ${mountFetch.join(", ")}`);
}

// Confirm the state is initialised to 40 (the pre-fetch fallback sentinel).
{
  const initState = findInRange(/useState\(40\)/, 1, 500);
  checkTrue(
    "workWeekHours state initialised to 40 (fallback sentinel) in range 1–500",
    initState.length > 0,
  );
  if (initState.length > 0) console.log(`    found at line(s): ${initState.join(", ")}`);
}

// ── Result ───────────────────────────────────────────────────────────────────
if (failures) {
  console.error(`\ncheck-work-week-hours-mobile: ${failures} failure(s)`);
  process.exit(1);
}
console.log("\ncheck-work-week-hours-mobile: all assertions passed");
