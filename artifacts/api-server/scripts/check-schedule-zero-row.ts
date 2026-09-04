/**
 * Schedule "nothing imported" message check (task: keep import failure
 * messages truthful for edge-case schedule files).
 *
 * The zero-row diagnosis in insertScheduleBatch picks between five messages
 * (no data rows / no ID column in strict mode / ID column all blank / IDs but
 * no phase names / no titles). A regression here re-creates the Aug 2026
 * Alston AI incident: the user was told "no Project Titles found" when the
 * real problem was the ID column.
 *
 * Exercises the EXACT extracted functions the live pipeline uses
 * (scanScheduleSheets + pickScheduleZeroRowMessage) — no DB, no server.
 * "Zero writes" is asserted structurally: each case must produce
 * byProject.size === 0, the exact precondition of insertScheduleBatch's
 * early return BEFORE any SQL.
 *
 * Runs as part of the `import-matching` check workflow:
 *   pnpm --filter @workspace/api-server run check:import-matching
 */
import {
  scanScheduleSheets,
  pickScheduleZeroRowMessage,
  type SheetData,
} from "../src/lib/pipeline.js";

const failures: string[] = [];
function check(name: string, ok: boolean, detail?: string) {
  if (ok) console.log(`  ✓ ${name}`);
  else {
    console.error(`  ✗ ${name}${detail ? ` — ${detail}` : ""}`);
    failures.push(name);
  }
}

function sheet(columns: string[], rows: Array<Record<string, string>>): SheetData {
  return { sheetName: "Schedule", columns, rows };
}

interface Case {
  label: string;
  strict: boolean;
  sheets: SheetData[];
  /** Exact message the user must see. */
  expect: string;
}

const ID_COLS = ["Project ID", "Phase Name", "Start Date", "End Date"];

const cases: Case[] = [
  {
    label: "header-only sheet (strict)",
    strict: true,
    sheets: [sheet(ID_COLS, [])],
    expect:
      "The Schedule sheet has no data rows — only headers were found. Add your schedule rows under the header row and upload again.",
  },
  {
    // Rows full of titles + phases, but no column classifies as an ID column.
    // THE Alston AI incident shape: the old message blamed missing Project
    // Titles when the file was full of them.
    label: "strict mode, no recognized ID column",
    strict: true,
    sheets: [
      sheet(["Project Title", "Phase Name", "Start Date"], [
        { "Project Title": "Harbor Bridge Retrofit", "Phase Name": "Design", "Start Date": "2026-01-05" },
        { "Project Title": "Harbor Bridge Retrofit", "Phase Name": "Construction", "Start Date": "2026-03-02" },
      ]),
    ],
    expect:
      `The Schedule sheet has no recognized Project/Opportunity ID column — this import matches rows by ID only, and none of the sheet's columns (Project Title, Phase Name, Start Date) is an ID column. Add a "Project / Opp ID" column with IDs like PMM-26-000123 and upload again.`,
  },
  {
    label: "strict mode, ID column present but blank on every row",
    strict: true,
    sheets: [
      sheet(ID_COLS, [
        { "Project ID": "", "Phase Name": "Design", "Start Date": "2026-01-05", "End Date": "2026-02-27" },
        { "Project ID": "  ", "Phase Name": "Construction", "Start Date": "2026-03-02", "End Date": "2026-06-26" },
      ]),
    ],
    expect:
      `Schedule rows were found, but the "Project ID" column is empty on every row. This import matches rows by Project/Opportunity ID (like PMM-26-000123) — fill in the IDs and upload again.`,
  },
  {
    label: "strict mode, IDs present but no Phase Name/Order anywhere",
    strict: true,
    sheets: [
      sheet(["Project ID", "Start Date", "End Date"], [
        { "Project ID": "PMM-26-000123", "Start Date": "2026-01-05", "End Date": "2026-02-27" },
      ]),
    ],
    expect:
      "Schedule rows were matched to projects, but no row has a Phase Name (or Phase Order) value — each schedule row needs a phase. Fill in the Phase Name column and upload again.",
  },
  {
    // Non-strict: titles CAN link, so a title-only file (no phase column)
    // must blame the missing phases — never the titles that are clearly there.
    label: "non-strict, title-only file (titles but no phases)",
    strict: false,
    sheets: [
      sheet(["Project Title", "Start Date"], [
        { "Project Title": "Harbor Bridge Retrofit", "Start Date": "2026-01-05" },
      ]),
    ],
    expect:
      "Schedule rows were matched to projects, but no row has a Phase Name (or Phase Order) value — each schedule row needs a phase. Fill in the Phase Name column and upload again.",
  },
  {
    // Non-strict fallback: data rows with phases but NO title/ID reference at
    // all — the only case where "no Project Title" is the truthful message.
    label: "non-strict, phases but no project reference (no-titles fallback)",
    strict: false,
    sheets: [
      sheet(["Phase Name", "Start Date"], [
        { "Phase Name": "Design", "Start Date": "2026-01-05" },
      ]),
    ],
    expect: "No schedule rows with a Project Title were found in the Schedule sheet.",
  },
];

console.log("Schedule zero-row diagnosis check:");
for (const c of cases) {
  const scan = scanScheduleSheets(c.sheets, c.strict);
  // Zero writes: the message path only fires when NO usable rows were
  // collected — insertScheduleBatch returns before any SQL in that case.
  check(`${c.label}: zero usable rows (no writes possible)`, scan.byProject.size === 0,
    `byProject.size=${scan.byProject.size}`);
  const msg = pickScheduleZeroRowMessage(c.strict, scan.signals, c.sheets.flatMap(s => s.columns));
  check(`${c.label}: exact message`, msg === c.expect, `got: ${msg}`);
}

// Sanity: a GOOD strict file must scan to usable rows (the diagnosis must not
// fire at all) — guards against the scan itself regressing to drop-everything.
{
  const good = scanScheduleSheets(
    [sheet(ID_COLS, [
      { "Project ID": "PMM-26-000123", "Phase Name": "Design", "Start Date": "2026-01-05", "End Date": "2026-02-27" },
    ])],
    true,
  );
  check("valid strict file: rows collected (diagnosis does not fire)", good.byProject.size === 1,
    `byProject.size=${good.byProject.size}`);
}

if (failures.length) {
  console.error(`\n${failures.length} check(s) FAILED`);
  process.exit(1);
}
console.log("\nAll schedule zero-row message checks passed.");
