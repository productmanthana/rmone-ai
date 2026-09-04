/**
 * Usage Analytics window/drill parity regression harness (CI gate).
 * Run: pnpm --filter @workspace/api-server run check:usage-window
 *
 * The /usage-analytics payload reads rolled rows plus today's un-rolled raw
 * rows. The raw rows are needed for timestamp-level drawer details, but must
 * only be merged into the drawers when the selected, Monday-snapped window
 * includes today. This harness protects that boundary without a live DB.
 *
 * It combines source-text guards with an in-memory model of the route's
 * windowing and page/login/transaction builders. The fixtures cover:
 *   - a completely historical window (today's raw rows must be absent);
 *   - a window whose snapped end week contains today (raw rows are present);
 *   - a future-start window (no rows or aggregates);
 *   - empty/non-empty parity between each drawer and its tile aggregate.
 *
 * Exit code 0 = all assertions passed; 1 = extraction drift or a fixture
 * failure.
 */

import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const routeSrc = readFileSync(join(here, "../src/routes/usage-analytics.ts"), "utf8");

let failures = 0;

function check(name: string, actual: unknown, expected: unknown): void {
  const a = JSON.stringify(actual ?? null);
  const e = JSON.stringify(expected ?? null);
  if (a === e) {
    console.log(`  OK   ${name}`);
    return;
  }
  failures++;
  console.error(`  FAIL ${name}\n       expected ${e}\n       got      ${a}`);
}

function checkTrue(name: string, value: unknown): void {
  check(name, value, true);
}

// ── Section A: source-text guards ────────────────────────────────────────────
console.log("check-usage-window: A. route source guards");

const rawTodayGate = routeSrc.match(
  /const windowEndIncl = \(\(\) => \{[\s\S]*?const rawTodayRows = todayInWindow \? \(\(rawQ\.recordset \?\? \[\]\) as RawEventRow\[\]\) : \[\];/,
);
checkTrue("A1 route gates raw today rows behind todayInWindow", rawTodayGate !== null);
checkTrue(
  "A1 todayInWindow checks the snapped start against today",
  /const todayInWindow =\s*\n\s*\(!paramStart \|\| effectiveStart <= todayUtc\)/.test(routeSrc),
);
checkTrue(
  "A1 todayInWindow checks the snapped inclusive end against today",
  /const todayInWindow =[\s\S]{0,220}\(!paramEnd \|\| windowEndIncl >= todayUtc\)/.test(routeSrc),
);
checkTrue(
  "A1 snapped inclusive end is six days after effectiveEnd",
  /const e = new Date\(`\$\{effectiveEnd\}T00:00:00Z`\);[\s\S]{0,180}e\.setUTCDate\(e\.getUTCDate\(\) \+ 6\)/.test(routeSrc),
);

for (const [kind, builder] of [
  ["page", "pageVisitRows"],
  ["login", "loginDetailRows"],
  ["tx", "txDetailRows"],
] as const) {
  checkTrue(
    `A2 ${kind} drawer reads gated tRawRows`,
    new RegExp(`${builder}: \\(\\(\\) => \\{[\\s\\S]{0,700}tRawRows\\.filter\\(\\(r\\) => r\\.kind === "${kind}"`).test(routeSrc),
  );
  checkTrue(
    `A2 ${kind} drawer retains only historical tRows`,
    new RegExp(`${builder}: \\(\\(\\) => \\{[\\s\\S]{0,1600}\\.filter\\(\\(r\\) => r\\.day < todayUtc\\)`).test(routeSrc),
  );
}

checkTrue(
  "A3 page tile aggregate is derived from window-filtered tRows",
  /pageVisitTotal: tRows\.filter\(\(r\) => r\.kind === "page" && !r\.is_system\)\.length/.test(routeSrc),
);
checkTrue(
  "A3 login tile aggregate is derived from window-filtered tRows",
  /loginDetailTotal: tRows\.filter\(\(r\) => r\.kind === "login" && !r\.is_system\)\.length/.test(routeSrc),
);
checkTrue(
  "A3 transaction tile aggregate is derived from window-filtered tRows",
  /txDetailTotal: tRows\.filter\(\(r\) => r\.kind === "tx" && !r\.is_system\)\.length/.test(routeSrc),
);
checkTrue(
  "A4 summary and drawer detail use separate cache entries",
  /const cacheKeyBase = `\$\{superadmin \? "all" : rds\.tenant\}\|\$\{paramStart \?\? ""\}\|\$\{paramEnd \?\? ""\}`/.test(routeSrc) &&
    /const cacheKey = `\$\{cacheKeyBase\}\|\$\{includeDetails \? "details" : "summary"\}`/.test(routeSrc) &&
    /bustUsageAnalyticsEverywhere\(`\$\{cacheKeyBase\}\|summary`\)/.test(routeSrc) &&
    /bustUsageAnalyticsEverywhere\(`\$\{cacheKeyBase\}\|details`\)/.test(routeSrc),
);
checkTrue(
  "A4 raw today-event query is deferred until details=1",
  /const rawP: Promise<\{ recordset\?: unknown\[\] \}> = includeDetails\s*\?/.test(routeSrc),
);
checkTrue(
  "A4 summary omits capped detail arrays",
  /\.\.\.\(includeDetails \? \{[\s\S]{0,500}pageVisitRows:/.test(routeSrc),
);
checkTrue(
  "A5 raw event windows use seekable start/end predicates",
  /WHERE at >= @todayStart AND at < @tomorrowStart/.test(routeSrc) &&
    /dateHiEvt = "AND at < DATEADD\(DAY, 1, @we\)"/.test(routeSrc),
);
checkTrue(
  "A5 tenant summary lookup compares the indexed tenant ID directly",
  /userFilter = "AND tenant_id = @tid"/.test(routeSrc),
);

// ── Section B: in-memory route model ─────────────────────────────────────────
console.log("\ncheck-usage-window: B. selected-window fixtures");

type Kind = "page" | "login" | "tx";
type WindowParams = { start: string | null; end: string | null };
type RawFixtureRow = { kind: Kind; at: string; cnt: number; is_system: boolean };
type AggregateRow = { kind: Kind; day: string; cnt: number; is_system: boolean };
type DrillRow = { kind: Kind; day: string; at?: string; cnt: number };
type Result = {
  todayInWindow: boolean;
  tiles: Record<Kind, number>;
  drills: Record<Kind, DrillRow[]>;
};

function weekStartUtc(date: Date): string {
  const day = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
  const dow = (day.getUTCDay() + 6) % 7; // Mon=0 … Sun=6
  day.setUTCDate(day.getUTCDate() - dow);
  return day.toISOString().slice(0, 10);
}

function addUtcDays(isoDate: string, days: number): string {
  const date = new Date(`${isoDate}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

function routeWindow(params: WindowParams, todayUtc: string): {
  effectiveStart: string;
  effectiveEnd: string;
  windowEndIncl: string;
  todayInWindow: boolean;
} {
  const todayWk = weekStartUtc(new Date(`${todayUtc}T12:00:00Z`));
  // The fixtures always pass an explicit start or end. These fallbacks match
  // runUsageQuery when collectingSince is unavailable.
  const effectiveStart = params.start
    ? weekStartUtc(new Date(`${params.start}T12:00:00Z`))
    : todayWk;
  const effectiveEnd = params.end
    ? weekStartUtc(new Date(`${params.end}T12:00:00Z`))
    : todayWk;
  const windowEndIncl = addUtcDays(effectiveEnd, 6);
  const todayInWindow =
    (!params.start || effectiveStart <= todayUtc) &&
    (!params.end || windowEndIncl >= todayUtc);
  return { effectiveStart, effectiveEnd, windowEndIncl, todayInWindow };
}

/**
 * Mirrors the route's relevant sequence:
 *   1. SQL returns the date-filtered aggregate rows (tRows).
 *   2. rawTodayRows is emptied unless the selected window includes today.
 *   3. each drawer unions today's raw detail with historical tRows.
 * Tile values intentionally sum cnt while drawer values count rows; this test
 * checks the required empty/non-empty contract rather than equating them.
 */
function buildPayload(params: WindowParams, rawRows: RawFixtureRow[], todayUtc: string): Result {
  const { effectiveStart, windowEndIncl, todayInWindow } = routeWindow(params, todayUtc);
  const tRows: AggregateRow[] = rawRows
    .filter((row) => {
      const day = row.at.slice(0, 10);
      return day >= effectiveStart && day <= windowEndIncl;
    })
    .map((row) => ({
      kind: row.kind,
      day: row.at.slice(0, 10),
      cnt: row.cnt,
      is_system: row.is_system,
    }));
  const rawTodayRows = todayInWindow
    ? rawRows.filter((row) => row.at.slice(0, 10) === todayUtc)
    : [];

  const kinds: Kind[] = ["page", "login", "tx"];
  const tiles = Object.fromEntries(
    kinds.map((kind) => [
      kind,
      tRows
        .filter((row) => row.kind === kind && !row.is_system)
        .reduce((sum, row) => sum + row.cnt, 0),
    ]),
  ) as Record<Kind, number>;
  const drills = Object.fromEntries(
    kinds.map((kind) => {
      const tRaw: DrillRow[] = rawTodayRows
        .filter((row) => row.kind === kind && !row.is_system)
        .map((row) => ({
          kind: row.kind,
          day: row.at.slice(0, 10),
          at: row.at,
          cnt: row.cnt,
        }));
      const tHist: DrillRow[] = tRows
        .filter((row) => row.kind === kind && !row.is_system && row.day < todayUtc)
        .map((row) => ({ kind: row.kind, day: row.day, cnt: row.cnt }));
      return [kind, [...tRaw, ...tHist]];
    }),
  ) as Record<Kind, DrillRow[]>;

  return { todayInWindow, tiles, drills };
}

const todayUtc = new Date().toISOString().slice(0, 10);
const todayWeek = weekStartUtc(new Date(`${todayUtc}T12:00:00Z`));
const rawTodayRows: RawFixtureRow[] = [
  { kind: "page", at: `${todayUtc}T09:15:00.000Z`, cnt: 3, is_system: false },
  { kind: "login", at: `${todayUtc}T09:16:00.000Z`, cnt: 2, is_system: false },
  { kind: "tx", at: `${todayUtc}T09:17:00.000Z`, cnt: 4, is_system: false },
];

const scenarios: Array<{ name: string; params: WindowParams; expectedRows: number }> = [
  {
    name: "entirely past",
    params: { start: addUtcDays(todayWeek, -21), end: addUtcDays(todayWeek, -15) },
    expectedRows: 0,
  },
  {
    // Any end date in the current Monday–Sunday week snaps to an end week
    // whose inclusive end contains today.
    name: "snapped end week contains today",
    params: { start: addUtcDays(todayWeek, -7), end: todayUtc },
    expectedRows: 1,
  },
  {
    name: "future start",
    params: { start: addUtcDays(todayWeek, 7), end: addUtcDays(todayWeek, 13) },
    expectedRows: 0,
  },
];

for (const scenario of scenarios) {
  const result = buildPayload(scenario.params, rawTodayRows, todayUtc);
  check(
    `B1 ${scenario.name}: todayInWindow`,
    result.todayInWindow,
    scenario.expectedRows > 0,
  );
  for (const kind of ["page", "login", "tx"] as const) {
    check(
      `B2 ${scenario.name}: ${kind} drill row count`,
      result.drills[kind].length,
      scenario.expectedRows,
    );
    check(
      `B3 ${scenario.name}: ${kind} tile aggregate`,
      result.tiles[kind],
      scenario.expectedRows > 0 ? (kind === "page" ? 3 : kind === "login" ? 2 : 4) : 0,
    );
  }
}

// The key invariant is deliberately checked as a boolean for every kind and
// window: a capped/list-shaped drawer and its numeric tile must agree about
// whether there is any activity, even though their units differ.
for (const scenario of scenarios) {
  const result = buildPayload(scenario.params, rawTodayRows, todayUtc);
  for (const kind of ["page", "login", "tx"] as const) {
    checkTrue(
      `B4 ${scenario.name}: ${kind} drawer/tile empty parity`,
      (result.drills[kind].length > 0) === (result.tiles[kind] > 0),
    );
  }
}

if (failures > 0) {
  console.error(`\ncheck-usage-window: ${failures} failure(s)`);
  process.exit(1);
}
console.log("\ncheck-usage-window: all assertions passed");