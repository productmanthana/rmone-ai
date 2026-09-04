/* verify-reports-periods.local.ts — sanity-check the Reports period math
 * against LIVE data for a tenant (default test21).
 *
 * Recomputes, straight from the API rows (same rows the web builders get):
 *   - created-in-period counts per module (week / month / YTD, Mon-start, IST)
 *   - OPM decided (AwardedorLossDate) in YTD + undated decided count
 *   - close-out date coverage: total, future, past-due (active only)
 * Compare these with the Reports pages to confirm the UI numbers are honest.
 *
 * Run:  cd artifacts/api-server && npx tsx scripts/verify-reports-periods.local.ts [tenant]
 */
process.env.TZ = "Asia/Calcutta"; // match the client's browser timezone

import { signRdsToken } from "../src/lib/rds-auth.js";

const BASE = "http://localhost:8080";
const TENANT = process.argv[2] || "test21";

async function fetchModule(token: string, mod: string): Promise<any[]> {
  const res = await fetch(`${BASE}/api/rmone/records/${mod}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) throw new Error(`${mod}: HTTP ${res.status}`);
  const j = await res.json();
  return Array.isArray(j?.data) ? j.data : [];
}

const addDays = (d: Date, n: number) => new Date(d.getFullYear(), d.getMonth(), d.getDate() + n);
function ranges(now = new Date()) {
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const dow = (today.getDay() + 6) % 7;
  const wk = addDays(today, -dow);
  return {
    week: [wk, addDays(wk, 7)] as const,
    month: [new Date(today.getFullYear(), today.getMonth(), 1), new Date(today.getFullYear(), today.getMonth() + 1, 1)] as const,
    ytd: [new Date(today.getFullYear(), 0, 1), addDays(today, 1)] as const,
  };
}
function within(iso: unknown, [s, e]: readonly [Date, Date]): boolean {
  if (!iso) return false;
  const t = new Date(String(iso)).getTime();
  return !isNaN(t) && t >= s.getTime() && t < e.getTime();
}

async function main() {
  const token = signRdsToken({ username: "vyaasaiagent", tenant: TENANT });
  const [pmm, opm, lem] = await Promise.all([
    fetchModule(token, "PMM"), fetchModule(token, "OPM"), fetchModule(token, "LEM"),
  ]);
  const r = ranges();
  console.log(`tenant=${TENANT}  now=${new Date().toString()}`);
  console.log(`week: ${r.week[0].toDateString()} → ${addDays(r.week[1], -1).toDateString()}`);

  for (const [name, rows] of [["PMM", pmm], ["OPM", opm], ["LEM", lem]] as const) {
    const created = (row: any) => row?.Created;
    console.log(`\n${name}: total=${rows.length}`);
    console.log(`  created  week=${rows.filter(x => within(created(x), r.week)).length}` +
      `  month=${rows.filter(x => within(created(x), r.month)).length}` +
      `  ytd=${rows.filter(x => within(created(x), r.ytd)).length}` +
      `  noCreated=${rows.filter(x => !created(x)).length}`);
  }

  /* OPM decisions */
  const decidedDated = opm.filter(o => o?.AwardedorLossDate);
  console.log(`\nOPM AwardedorLossDate: dated=${decidedDated.length}` +
    `  ytd=${decidedDated.filter(o => within(o.AwardedorLossDate, r.ytd)).length}` +
    `  week=${decidedDated.filter(o => within(o.AwardedorLossDate, r.week)).length}`);

  /* close-out coverage (status not interpreted here — raw coverage only) */
  const co = pmm.filter(p => p?.CloseoutDate);
  const now = Date.now();
  console.log(`\nPMM CloseoutDate: with=${co.length} of ${pmm.length}` +
    `  future=${co.filter(p => new Date(String(p.CloseoutDate)).getTime() > now).length}` +
    `  pastOrToday=${co.filter(p => new Date(String(p.CloseoutDate)).getTime() <= now).length}`);
  for (const p of co) {
    console.log(`    ${p.TicketId ?? p.ID}: closeout=${String(p.CloseoutDate).slice(0, 10)} status=${p.Status ?? "—"}`);
  }
}

main().catch(e => { console.error("FAIL:", e?.message || e); process.exit(1); });
