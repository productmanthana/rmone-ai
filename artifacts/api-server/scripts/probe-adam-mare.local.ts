// Dev probe: full allocation picture for Adam Engstrom + Anello on
// OPM-00051 "Mare Island" — weekly rows vs containers, pct distribution,
// AllocationHour, and what the two surfaces would serve.
import { getPool } from "../src/lib/db.js";

const pool = await getPool();

const opp = await pool.request().query(`
  SELECT TenantID FROM core2.dbo.Opportunity
  WHERE TicketId = 'OPM-00051' AND Title LIKE '%Mare%' AND (Deleted = 0 OR Deleted IS NULL)
`);
const tid = (opp.recordset[0] as { TenantID: string } | undefined)?.TenantID;
console.log("tenant:", tid);
if (!tid) process.exit(1);

// does RA have AllocationHour here?
const cols = await pool.request().query(`
  SELECT name FROM core2.sys.columns WHERE object_id = OBJECT_ID('core2.dbo.ResourceAllocation')
`);
const raCols = (cols.recordset as { name: string }[]).map(c => c.name);
console.log("RA has AllocationHour:", raCols.includes("AllocationHour"));

const ra = await pool.request().query(`
  SELECT ra.ID, ra.ResourceUser,
         CONVERT(varchar(10), ra.AllocationStartDate, 23) AS S,
         CONVERT(varchar(10), ra.AllocationEndDate, 23) AS E,
         ra.PctAllocation AS Pct${raCols.includes("AllocationHour") ? ", ra.AllocationHour AS AH" : ""}
  FROM core2.dbo.ResourceAllocation ra
  WHERE ra.TenantID = '${tid}' AND ra.TicketId = 'OPM-00051'
    AND (ra.Deleted = 0 OR ra.Deleted IS NULL)
  ORDER BY ra.AllocationStartDate
`);
const rows = ra.recordset as { ID: number; ResourceUser: string | null; S: string; E: string; Pct: number | null; AH?: number | null }[];

// summarize per user
const byUser = new Map<string, typeof rows>();
for (const r of rows) {
  const k = String(r.ResourceUser ?? "(demand)").toLowerCase();
  if (!byUser.has(k)) byUser.set(k, []);
  byUser.get(k)!.push(r);
}
for (const [u, rs] of byUser) {
  const pcts = new Map<string, number>();
  for (const r of rs) {
    const key = `pct=${r.Pct}${r.AH != null ? `,AH=${r.AH}` : ""}`;
    pcts.set(key, (pcts.get(key) ?? 0) + 1);
  }
  const days = (r: typeof rs[0]) => (new Date(r.E).getTime() - new Date(r.S).getTime()) / 86400000;
  const broad = rs.filter(r => days(r) > 8);
  console.log(`\nuser ${u}: rows=${rs.length} span=${rs[0].S}..${rs[rs.length - 1].E} broadRows=${broad.length}`);
  console.log("  value distribution:", Array.from(pcts.entries()).map(([k, n]) => `${k} x${n}`).join(" | "));
  for (const b of broad.slice(0, 4)) console.log(`  broad: RA#${b.ID} ${b.S} -> ${b.E} pct=${b.Pct} AH=${b.AH}`);
  // rows overlapping the grid window shown in the screenshot (Aug 31 - Nov 2 2026)
  const win = rs.filter(r => r.S >= "2026-08-24" && r.S <= "2026-11-09");
  for (const w of win.slice(0, 12)) console.log(`  2026win: RA#${w.ID} ${w.S} -> ${w.E} pct=${w.Pct} AH=${w.AH}`);
}
process.exit(0);
