/**
 * Schedule ID upload-review preflight check (task #420: catch schedule ID
 * problems during upload review, before the import runs).
 *
 * Asserts the review-time scan and the run-time strict gate reach REAL
 * schedule sheets. Aug 2026 regression class: sheet selection via
 * resolveTable(...) === "PMMTasks" never fires — schedule sheets have no
 * SHEET_TABLE_MAP entry — so both scans were dead code and problems only
 * surfaced after the import ran. Selection MUST be isScheduleTab (name OR
 * content), the same predicate insertScheduleBatch uses.
 *
 * Exercises the EXACT exported functions the live pipeline uses
 * (scheduleIdPreflightIssues + scanScheduleIdViolations + isScheduleTab) —
 * no DB, no server. The strict-run block shares scanScheduleIdViolations, so
 * a violation flagged here is a violation the run would block.
 *
 * Runs as part of the `import-matching` check workflow:
 *   pnpm --filter @workspace/api-server run check:import-matching
 */
import {
  scheduleIdPreflightIssues,
  scanScheduleIdViolations,
  collectFileRecordIds,
  isScheduleTab,
  resolveTable,
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

const known = (tok: string) => ["prj-101", "opp-202"].includes(tok.trim().toLowerCase());

// ── 1. Ordinary "Schedule"-named tab (name-detected) ─────────────────────────
{
  const s: SheetData = {
    sheetName: "Schedule",
    columns: ["Project ID", "Phase Name", "Start Date", "End Date"],
    rows: [
      { "Project ID": "PRJ-101", "Phase Name": "Design", "Start Date": "2026-01-05", "End Date": "2026-02-01" }, // ok
      { "Project ID": "PRJ-999", "Phase Name": "Build",  "Start Date": "2026-02-02", "End Date": "2026-03-01" }, // unknown ID
      { "Project ID": "",        "Phase Name": "Close",  "Start Date": "2026-03-02", "End Date": "2026-04-01" }, // fill-down → PRJ-999 group (still unknown)
    ],
  };
  check("named Schedule tab is a schedule tab", isScheduleTab(s));
  check("resolveTable never identifies schedule sheets (guard against reintroducing the dead selector)",
    resolveTable(s.sheetName) !== "PMMTasks");
  const issues = scheduleIdPreflightIssues([s], known);
  check("named tab: unknown-ID issue reported", issues.some(i => i.kind === "schedule_id" && /doesn't exist/.test(i.message)),
    JSON.stringify(issues.map(i => i.message)));
  check("named tab: strict gate flags the same rows",
    scanScheduleIdViolations(s, known).length > 0);
  check("named tab: clean rows produce no issue for known IDs",
    scheduleIdPreflightIssues([{ ...s, rows: [s.rows[0]] }], known).length === 0);
}

// ── 2. Custom-named tab (content-detected) ───────────────────────────────────
{
  const s: SheetData = {
    sheetName: "Alston Milestones 2026",
    columns: ["Project / Opp ID", "Phase Name", "Phase Order", "Start Date", "End Date", "Percent Complete"],
    rows: [
      { "Project / Opp ID": "", "Phase Name": "Mobilize", "Phase Order": "1", "Start Date": "2026-05-01", "End Date": "2026-05-15", "Percent Complete": "0" },
    ],
  };
  check("content-detected custom tab is a schedule tab", isScheduleTab(s),
    "isScheduleTabByContent should recognize phase/order/date columns");
  const issues = scheduleIdPreflightIssues([s], known);
  check("custom tab: missing-ID issue reported (row has content, no usable ID)",
    issues.some(i => i.kind === "schedule_id" && /no usable Project\/Opportunity ID/.test(i.message)),
    JSON.stringify(issues.map(i => i.message)));
  check("custom tab: issue carries row numbers for grid highlighting",
    issues.every(i => Array.isArray(i.rows) && i.rows.length > 0));
}

// ── 3. Schedule sheet whose NAME resolves to a record table ──────────────────
// A sheet named "Projects" full of phase rows is imported as a schedule
// (insertScheduleBatch selects by isScheduleTab), so the strict gate must
// validate it as one too — its schedule branch runs BEFORE the table-name
// record branches. Preflight and the runtime scanner must flag identical rows.
{
  const s: SheetData = {
    sheetName: "Projects", // resolveTable → PMM
    columns: ["Project ID", "Phase Name", "Phase Order", "Start Date", "End Date"],
    rows: [
      { "Project ID": "PRJ-101", "Phase Name": "Design", "Phase Order": "1", "Start Date": "2026-01-05", "End Date": "2026-02-01" },
      { "Project ID": "PRJ-777", "Phase Name": "Build",  "Phase Order": "2", "Start Date": "2026-02-02", "End Date": "2026-03-01" },
    ],
  };
  check("record-named sheet with schedule content resolves to PMM by name", resolveTable(s.sheetName) === "PMM");
  check("…but is content-detected as a schedule tab", isScheduleTab(s));
  const violations = scanScheduleIdViolations(s, known);
  const issues = scheduleIdPreflightIssues([s], known);
  check("mapped-name schedule: runtime scanner flags the unknown ID",
    violations.length === 1 && /PRJ-777/.test(violations[0].message), JSON.stringify(violations));
  check("mapped-name schedule: preflight reports the SAME rows as the runtime scan",
    JSON.stringify(issues.flatMap(i => i.rows ?? []).sort()) === JSON.stringify(violations.map(v => v.rowIndex).sort()),
    JSON.stringify({ issues: issues.map(i => i.rows), violations: violations.map(v => v.rowIndex) }));
  // Integration guard: this sheet's own IDs must NOT become legal in-file
  // forward references — a schedule sheet creates no records, whatever its
  // name. Both the strict gate and preflight build fileRecordIds via this
  // shared collector.
  const fileIds = collectFileRecordIds([s, {
    sheetName: "Opportunities", // real record sheet — ITS ids DO count
    columns: ["Opportunity ID", "Title"],
    rows: [{ "Opportunity ID": "OPP-500", "Title": "New Pursuit" }],
  }]);
  check("mapped-name schedule: its IDs are excluded from in-file record IDs",
    !fileIds.has("prj-777") && !fileIds.has("prj-101"), JSON.stringify([...fileIds]));
  check("real record sheets still contribute in-file forward-ref IDs",
    fileIds.has("opp-500"), JSON.stringify([...fileIds]));
}

// ── 3b. Grouped format: repeated title + blank ID rows under a prior ID ──────
// The importer's strict fill-down carries the LAST ID forward even across
// rows that repeat the project title with a blank ID cell. The scanner must
// accept exactly what the import accepts — flagging this legal grouped
// format would false-block valid uploads.
{
  const s: SheetData = {
    sheetName: "Schedule",
    columns: ["Project ID", "Project Title", "Phase Name", "Start Date"],
    rows: [
      { "Project ID": "PRJ-101", "Project Title": "Harbor Tower", "Phase Name": "Design",    "Start Date": "2026-01-05" },
      { "Project ID": "",        "Project Title": "Harbor Tower", "Phase Name": "Permitting","Start Date": "2026-02-01" },
      { "Project ID": "",        "Project Title": "Harbor Tower", "Phase Name": "Build",     "Start Date": "2026-03-01" },
    ],
  };
  check("grouped repeated-title rows under a known ID are NOT flagged",
    scanScheduleIdViolations(s, known).length === 0,
    JSON.stringify(scanScheduleIdViolations(s, known)));
  // And with NO prior ID at all, title-only rows still get the title-only message.
  const noId: SheetData = { ...s, rows: s.rows.map(r => ({ ...r, "Project ID": "" })) };
  const v = scanScheduleIdViolations(noId, known);
  check("title-only rows with no prior ID are still flagged with the title-only message",
    v.length === 3 && v.every(x => /title only/.test(x.message)), JSON.stringify(v));
}

// ── 4. Non-schedule sheet is never scanned ───────────────────────────────────
{
  const s: SheetData = {
    sheetName: "Projects",
    columns: ["Project ID", "Project Title", "Status"],
    rows: [{ "Project ID": "PRJ-999", "Project Title": "New Job", "Status": "Open" }],
  };
  check("record sheet is not treated as a schedule sheet",
    scheduleIdPreflightIssues([s], known).length === 0);
}

if (failures.length) {
  console.error(`\n✗ schedule-preflight check FAILED (${failures.length}): ${failures.join("; ")}`);
  process.exit(1);
}
console.log("\n✓ schedule-preflight check passed");
