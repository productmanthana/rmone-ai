/**
 * Live check for the schedule→status auto-advance hook: hits /task-data for
 * scheduled PMM records on test tenants, then the [sched-autoadvance] log
 * lines in the workflow log show the decision per record (advance or skip
 * reason). Read-only apart from the feature's own intended status writes.
 *
 * Run: pnpm --filter @workspace/api-server exec tsx scripts/schedadv-verify.local.ts
 */
import { signRdsToken } from "../src/lib/rds-auth.js";
import { resolveAutoAdvanceTarget } from "../src/lib/rds-provider.js";

// ── Pure resolver tests (no DB): outcome phases are BARRIERS, not just ──────
// ── ineligible landing targets — never advance a record across one. ─────────
const T = "2026-08-09";
const term = (t: string) => /awarded|project complete/i.test(t);
const P = (rows: [string, string][]) => rows.map(([title, startDay]) => ({ title, startDay }));
const mid = P([["Design", "2026-08-01"], ["Awarded", "2026-08-05"], ["Delivery", "2026-08-07"]]);
const synth: [string, { idx: number; reason?: string }, number, string?][] = [
  // record at Design (idx 0): Delivery started, but Awarded stands between → park
  ["OPM barrier blocks crossing", resolveAutoAdvanceTarget(mid, T, 0, term), -1, "terminal-boundary (Awarded)"],
  // unknown/blank status (-1): caps at the phase BEFORE the outcome
  ["barrier caps to pre-outcome", resolveAutoAdvanceTarget(mid, T, -1, term), 0, undefined],
  // human already crossed (at Delivery): resolver targets Delivery (caller → already-current)
  ["past barrier untouched", resolveAutoAdvanceTarget(mid, T, 2, term), 2, undefined],
  // pre-pass mode (effCurIdx = length, barrier off) still walks back off a terminal tail
  ["walkback off outcome tail", resolveAutoAdvanceTarget(P([["A", "2026-08-01"], ["Awarded", "2026-08-05"]]), T, 2, term), 0, undefined],
  // PMM shape: mid-list "Project Complete" blocks Punch List catch-up
  ["PMM mid terminal blocks", resolveAutoAdvanceTarget(P([["Precon", "2026-07-01"], ["Project Complete", "2026-07-20"], ["Punch List", "2026-08-01"]]), T, 0, term), -1, "terminal-boundary (Project Complete)"],
  ["future schedule skips", resolveAutoAdvanceTarget(P([["A", "2026-09-01"]]), T, 1, term), -1, "schedule-not-started"],
  ["all-terminal skips", resolveAutoAdvanceTarget(P([["Awarded", "2026-08-01"]]), T, 1, term), -1, "target-outcome"],
];
let synthFail = 0;
for (const [name, got, wantIdx, wantReason] of synth) {
  const ok = got.idx === wantIdx && (wantIdx >= 0 || got.reason === wantReason);
  if (!ok) synthFail++;
  console.log(`[synth] ${ok ? "PASS" : "FAIL"} ${name} → idx=${got.idx} reason=${got.reason ?? ""}`);
}
if (synthFail > 0) { console.error(`[synth] ${synthFail} FAILURE(S) — fix before trusting live checks`); process.exit(1); }

const cases: [string, string][] = [
  ["test21", "OPM-26-000082"],   // user's record: "Pending Assignment", DD ended Aug 7 → expect catch-up advance to "Design Development"
  ["test21", "OPM-26-000051"],   // Pending Assignment phase starts TODAY (Aug 9) → expect already-current or advance to it
  ["Liro", "OPM-25-000014"],     // 8 phases since Apr 2025 → whatever today's window says
  ["Liro_Poc", "PMM-26-000537"], // regression: advanced earlier → expect silent "already-current"
  ["Liro_Poc", "PMM-26-000692"], // regression: was phase-gap; now cur==last-started → silent "already-current"
  ["testrmone", "PMM-26-111"],   // schedule starts tomorrow → expect silence (pre-check)
];

for (const [tenant, ticket] of cases) {
  const tok = signRdsToken({
    sub: "schedadvtest",
    tenant,
    username: "samtender12@gmail.com",
    role: "admin",
    accessLevel: "admin",
  });
  const r = await fetch(`http://localhost:8080/api/rmone/task-data?ticketID=${encodeURIComponent(ticket)}`, {
    headers: { Authorization: `Bearer ${tok}` },
  });
  const body: unknown = await r.json().catch(() => null);
  const rows = Array.isArray(body) ? body
    : Array.isArray((body as { Data?: unknown[] })?.Data) ? (body as { Data: unknown[] }).Data : null;
  console.log(`${tenant}/${ticket}: HTTP ${r.status} rows=${rows ? rows.length : "?"}`);
}

// Give the fire-and-forget advance a moment to run + log before exiting.
await new Promise((res) => setTimeout(res, 6000));
console.log("done — now grep the api-server workflow log for [sched-autoadvance]");
process.exit(0);
