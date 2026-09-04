/**
 * Assumed schedule-date derivation check (CI gate, #167).
 * Run: npx tsx scripts/check-assumed-dates.ts
 *
 * Pins the entity-type branch rules in deriveScheduleDates
 * (src/lib/onboarding-defaults.ts), shared by the import pipeline
 * (pipeline.ts), record creation, and the settings-reconcile
 * (rds-provider.ts). A regression here misdates records everywhere:
 *   - projects:      missing end → start + durationMonths
 *   - opportunities: missing end → start + oppDurationMonths
 *   - leads:         missing end → start + forecastHorizonDays (days)
 *   - both-missing pipeline records open "today"; projects follow startRule
 *   - provided dates always pass through untouched
 *
 * Exit code 0 = all good; 1 = at least one assertion failed.
 */
import {
  BUILTIN_ONBOARDING_DEFAULTS,
  deriveScheduleDates,
  defaultProjectStart,
  type OnboardingDefaults,
} from "../src/lib/onboarding-defaults.js";

let failures = 0;
const fail = (msg: string) => { failures++; console.error("FAIL  " + msg); };
const eq = (label: string, got: unknown, want: unknown) => {
  if (got !== want) fail(`${label}: got ${JSON.stringify(got)}, want ${JSON.stringify(want)}`);
};

// Local date helpers mirroring the module's (local-time, ISO YYYY-MM-DD).
const iso = (d: Date): string => {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
};
const addMonths = (s: string, months: number): string => {
  const [y, m, d] = s.split("-").map(Number);
  return iso(new Date(y, (m - 1) + months, d));
};
const addDays = (s: string, days: number): string => {
  const [y, m, d] = s.split("-").map(Number);
  return iso(new Date(y, m - 1, d + days));
};
const mondayOfCurrentWeek = (): string => {
  const d = new Date();
  const day = d.getDay();
  const diff = (day === 0 ? -6 : 1) - day;
  return iso(new Date(d.getFullYear(), d.getMonth(), d.getDate() + diff));
};

// Deliberately distinct knob values so a branch that reads the WRONG setting
// (e.g. an opp using the project length) can never pass by coincidence.
const D: OnboardingDefaults = {
  ...BUILTIN_ONBOARDING_DEFAULTS,
  durationMonths: 5,
  oppDurationMonths: 7,
  forecastHorizonDays: 33,
  durationMonthsBack: 2,
  startRule: "monday-of-week",
};

const today = iso(new Date());
const monday = mondayOfCurrentWeek();

const proj = (o: { rawStart?: string | null; rawEnd?: string | null }) =>
  deriveScheduleDates(D, o);
const opp = (o: { rawStart?: string | null; rawEnd?: string | null }) =>
  deriveScheduleDates(D, { ...o, isPipeline: true });
const lead = (o: { rawStart?: string | null; rawEnd?: string | null }) =>
  deriveScheduleDates(D, { ...o, isPipeline: true, isLead: true });

// ── Both dates provided → verbatim pass-through for all three types ─────────
for (const [name, fn] of [["project", proj], ["opportunity", opp], ["lead", lead]] as const) {
  const r = fn({ rawStart: "2026-02-03", rawEnd: "2026-09-15" });
  eq(`${name} provided start passes through`, r.start, "2026-02-03");
  eq(`${name} provided end passes through`, r.end, "2026-09-15");
}

// ── Missing END (start provided) — the three-way entity branch ──────────────
{
  const start = "2026-04-10";
  eq("project missing end → start + durationMonths",
     proj({ rawStart: start }).end, addMonths(start, D.durationMonths));
  eq("opportunity missing end → start + oppDurationMonths",
     opp({ rawStart: start }).end, addMonths(start, D.oppDurationMonths));
  eq("lead missing end → start + forecastHorizonDays (days)",
     lead({ rawStart: start }).end, addDays(start, D.forecastHorizonDays));
  // Starts stay verbatim when provided.
  eq("project keeps provided start", proj({ rawStart: start }).start, start);
  eq("opportunity keeps provided start", opp({ rawStart: start }).start, start);
  eq("lead keeps provided start", lead({ rawStart: start }).start, start);
}

// ── Missing START (end provided) — startRule applies to every type ──────────
{
  const end = "2027-01-20";
  eq("project missing start → startRule (monday-of-week)",
     proj({ rawEnd: end }).start, monday);
  eq("opportunity missing start → startRule (monday-of-week)",
     opp({ rawEnd: end }).start, monday);
  eq("lead missing start → startRule (monday-of-week)",
     lead({ rawEnd: end }).start, monday);
  eq("project keeps provided end", proj({ rawEnd: end }).end, end);
  eq("opportunity keeps provided end", opp({ rawEnd: end }).end, end);
  eq("lead keeps provided end", lead({ rawEnd: end }).end, end);
}

// ── Both missing ─────────────────────────────────────────────────────────────
{
  // Projects: startRule start, project-length end.
  const p = proj({});
  eq("project both-missing start = startRule", p.start, monday);
  eq("project both-missing end = start + durationMonths", p.end, addMonths(p.start, D.durationMonths));
  // Pipeline records open "today" (NOT the startRule) and stay open for their window.
  const o = opp({});
  eq("opportunity both-missing opens today", o.start, today);
  eq("opportunity both-missing end = today + oppDurationMonths", o.end, addMonths(today, D.oppDurationMonths));
  const l = lead({});
  eq("lead both-missing opens today", l.start, today);
  eq("lead both-missing end = today + forecastHorizonDays", l.end, addDays(today, D.forecastHorizonDays));
}

// ── startRule = "month-back" honoured on the missing-start path ──────────────
{
  const D2: OnboardingDefaults = { ...D, startRule: "month-back" };
  const wantStart = addMonths(today, -1);
  eq("defaultProjectStart month-back", defaultProjectStart(D2), wantStart);
  eq("project missing start honours month-back",
     deriveScheduleDates(D2, { rawEnd: "2027-03-01" }).start, wantStart);
  eq("opportunity missing start honours month-back",
     deriveScheduleDates(D2, { rawEnd: "2027-03-01", isPipeline: true }).start, wantStart);
  // Both-missing pipeline still opens today regardless of startRule.
  eq("opportunity both-missing ignores startRule (opens today)",
     deriveScheduleDates(D2, { isPipeline: true }).start, today);
}

// ── Blank/whitespace/null raw values are treated as missing ──────────────────
{
  eq("blank end treated as missing (project)",
     proj({ rawStart: "2026-04-10", rawEnd: "  " }).end, addMonths("2026-04-10", D.durationMonths));
  eq("null start treated as missing (lead)",
     lead({ rawStart: null, rawEnd: "2027-01-20" }).start, monday);
}

if (failures) {
  console.error(`\ncheck-assumed-dates: ${failures} assertion(s) FAILED`);
  process.exit(1);
}
console.log("check-assumed-dates: all assertions passed");
