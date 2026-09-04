/**
 * Strict-keys schedule gate check (task: confirm strict-mode uploads point at
 * the EXACT schedule row that lacks a Project ID).
 *
 * check-schedule-zero-row.ts covers the FIRST message source for schedule
 * files (insertScheduleBatch's zero-row diagnosis). This covers the SECOND:
 * the update-mode strict-keys pre-gate (validateStrictKeys, PMMTasks branch),
 * which blocks the whole upload with per-row errors before a single write.
 * A regression here misleads customers exactly like the Aug 2026 Alston AI
 * incident: the message must name the real problem row and the real cause.
 *
 * Exercises the EXACT extracted function the live gate calls
 * (validateStrictScheduleSheet) — no DB, no server. The strict_keys/zero-write
 * contract is structural: runPipeline's update-mode gate turns ANY returned
 * violation into failureReason "strict_keys" and returns BEFORE any write, so
 * each case asserts the violations themselves (count, exact row, column,
 * exact message).
 *
 * Runs as part of the `import-matching` check workflow:
 *   pnpm --filter @workspace/api-server run check:import-matching
 */
import {
  validateStrictScheduleSheet,
  type SheetData,
  type StrictKeyViolation,
} from "../src/lib/pipeline.js";

const failures: string[] = [];
function check(name: string, ok: boolean, detail?: string) {
  if (ok) console.log(`  ✓ ${name}`);
  else {
    console.error(`  ✗ ${name}${detail ? ` — ${detail}` : ""}`);
    failures.push(name);
  }
}

/** rowNums mirrors parseExcel: header is Excel row 1, data starts at row 2. */
function sheet(columns: string[], rows: Array<Record<string, string>>): SheetData {
  return {
    sheetName: "Schedule",
    columns,
    rows,
    rowNums: rows.map((_, i) => i + 2),
  };
}

// Only these IDs exist "in RM ONE or in this file".
const KNOWN = new Set(["pmm-26-000123", "prj-26-0001"]);
const projectRefKnown = (tok: string) => KNOWN.has(tok.toLowerCase());

interface Expected { rowIndex: number; column: string; message: string }
interface Case { label: string; sheets: SheetData; expect: Expected[] }

const cases: Case[] = [
  {
    // Title-only rows: no ID column anywhere — every content row must be
    // blamed individually, and the message must say titles are never matched.
    label: "title-only schedule rows",
    sheets: sheet(["Project Title", "Phase Name", "Start Date"], [
      { "Project Title": "Harbor Bridge Retrofit", "Phase Name": "Design", "Start Date": "2026-01-05" },
      { "Project Title": "Harbor Bridge Retrofit", "Phase Name": "Construction", "Start Date": "2026-03-02" },
    ]),
    expect: [
      {
        rowIndex: 2, column: "Project ID",
        message: `Schedule rows under "Harbor Bridge Retrofit" reference the project by title only — titles are never matched. Add a Project ID column with the project's or opportunity's ID.`,
      },
      {
        rowIndex: 3, column: "Project ID",
        message: `Schedule rows under "Harbor Bridge Retrofit" reference the project by title only — titles are never matched. Add a Project ID column with the project's or opportunity's ID.`,
      },
    ],
  },
  {
    // Unknown Project ID: the ID fills down, so BOTH content rows under it
    // are flagged with the verbatim unknown ID.
    label: "unknown Project ID (fill-down under the bad ID)",
    sheets: sheet(["Project ID", "Phase Name", "Start Date"], [
      { "Project ID": "PMM-26-999999", "Phase Name": "Design", "Start Date": "2026-01-05" },
      { "Project ID": "", "Phase Name": "Construction", "Start Date": "2026-03-02" },
      { "Project ID": "PMM-26-000123", "Phase Name": "Closeout", "Start Date": "2026-07-06" },
    ]),
    expect: [
      {
        rowIndex: 2, column: "Project ID",
        message: `Project ID "PMM-26-999999" on this schedule row doesn't match any project or opportunity in RM ONE or in this file — fix the ID or import that record first.`,
      },
      {
        rowIndex: 3, column: "Project ID",
        message: `Project ID "PMM-26-999999" on this schedule row doesn't match any project or opportunity in RM ONE or in this file — fix the ID or import that record first.`,
      },
      // Row 4 (known ID) must NOT appear.
    ],
  },
  {
    // Fill-down groups under a TITLE header row (grouped export shape):
    // a title-only header row resets the ID context, so every content row in
    // that group points at the group's title — while the ID'd group before it
    // stays clean. Also proves a title header row with NO content is not
    // itself flagged (the CONTENT rows are the exact rows to fix).
    label: "fill-down group under a title header row",
    sheets: sheet(["Project ID", "Project Title", "Phase Name", "Start Date"], [
      { "Project ID": "PMM-26-000123", "Project Title": "", "Phase Name": "Design", "Start Date": "2026-01-05" },
      { "Project ID": "", "Project Title": "", "Phase Name": "Construction", "Start Date": "2026-03-02" },
      { "Project ID": "", "Project Title": "Downtown Tower Pursuit", "Phase Name": "", "Start Date": "" },
      { "Project ID": "", "Project Title": "", "Phase Name": "Pursuit", "Start Date": "2026-04-06" },
      { "Project ID": "", "Project Title": "", "Phase Name": "Award", "Start Date": "2026-06-01" },
    ]),
    expect: [
      {
        rowIndex: 5, column: "Project ID",
        message: `Schedule rows under "Downtown Tower Pursuit" reference the project by title only — titles are never matched. Add a Project ID column with the project's or opportunity's ID.`,
      },
      {
        rowIndex: 6, column: "Project ID",
        message: `Schedule rows under "Downtown Tower Pursuit" reference the project by title only — titles are never matched. Add a Project ID column with the project's or opportunity's ID.`,
      },
    ],
  },
  {
    // Canonical grid header alias "Project / Opp ID" (mapScheduleHeader
    // "projectoppid"): the gate must recognize every alias the schedule
    // writer does, or valid uploads get rejected. Unknown ID under the alias
    // header must still be flagged.
    label: `alias header "Project / Opp ID": unknown ID flagged`,
    sheets: sheet(["Project / Opp ID", "Phase Name", "Start Date"], [
      { "Project / Opp ID": "PMM-26-999999", "Phase Name": "Design", "Start Date": "2026-01-05" },
    ]),
    expect: [
      {
        rowIndex: 2, column: "Project ID",
        message: `Project ID "PMM-26-999999" on this schedule row doesn't match any project or opportunity in RM ONE or in this file — fix the ID or import that record first.`,
      },
    ],
  },
  {
    // No ID and no title context at all — the generic per-row message.
    label: "content row with neither ID nor title context",
    sheets: sheet(["Phase Name", "Start Date"], [
      { "Phase Name": "Design", "Start Date": "2026-01-05" },
    ]),
    expect: [
      {
        rowIndex: 2, column: "Project ID",
        message: `Schedule row has no Project ID — none of this sheet's columns is a recognized Project/Opportunity ID column. Add a "Project / Opp ID" column so every phase row links to a project or opportunity by ID.`,
      },
    ],
  },
];

console.log("Strict-keys schedule gate check:");
for (const c of cases) {
  const got: StrictKeyViolation[] = validateStrictScheduleSheet(c.sheets, projectRefKnown);
  // Any violation blocks the upload with failureReason "strict_keys" and zero
  // writes (runPipeline returns from the gate before any SQL) — so the
  // violation list IS the block. Assert it precisely.
  check(`${c.label}: exactly ${c.expect.length} row(s) flagged`, got.length === c.expect.length,
    `got ${got.length}: ${JSON.stringify(got).slice(0, 400)}`);
  c.expect.forEach((e, i) => {
    const v = got[i];
    check(`${c.label}: violation ${i + 1} points at Excel row ${e.rowIndex}`,
      v?.rowIndex === e.rowIndex && v?.column === e.column,
      `got rowIndex=${v?.rowIndex} column=${v?.column}`);
    check(`${c.label}: violation ${i + 1} exact message`, v?.message === e.message, `got: ${v?.message}`);
  });
}

// Sanity: a fully-ID'd schedule sheet with known IDs produces NO violations —
// the gate must not block good uploads (zero violations = no strict_keys
// failure, writes proceed).
{
  const good = validateStrictScheduleSheet(
    sheet(["Project ID", "Phase Name", "Start Date"], [
      { "Project ID": "PMM-26-000123", "Phase Name": "Design", "Start Date": "2026-01-05" },
      { "Project ID": "", "Phase Name": "Construction", "Start Date": "2026-03-02" }, // fill-down under known ID
      { "Project ID": "PRJ-26-0001", "Phase Name": "Kickoff", "Start Date": "2026-02-02" },
    ]),
    projectRefKnown,
  );
  check("valid ID'd sheet (incl. fill-down): no violations", good.length === 0,
    JSON.stringify(good).slice(0, 300));

  // Same, but under the canonical grid alias "Project / Opp ID" — the gate
  // must accept every ID-header alias the schedule writer accepts.
  const goodAlias = validateStrictScheduleSheet(
    sheet(["Project / Opp ID", "Phase Name", "Start Date"], [
      { "Project / Opp ID": "PMM-26-000123", "Phase Name": "Design", "Start Date": "2026-01-05" },
      { "Project / Opp ID": "", "Phase Name": "Construction", "Start Date": "2026-03-02" },
    ]),
    projectRefKnown,
  );
  check(`valid sheet under alias header "Project / Opp ID": no violations`, goodAlias.length === 0,
    JSON.stringify(goodAlias).slice(0, 300));
}

if (failures.length) {
  console.error(`\n${failures.length} check(s) FAILED`);
  process.exit(1);
}
console.log("\nAll strict-schedule gate checks passed.");
