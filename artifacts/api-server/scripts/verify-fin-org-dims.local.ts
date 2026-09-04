/**
 * Verify /api/analytics/financial now serves byBusinessUnit / byDepartment
 * groupings alongside byDivision, and that the three dimensions reconcile
 * to the same planned-hours total (no row multiplication from the joins).
 * Run: pnpm exec tsx scripts/verify-fin-org-dims.local.ts
 */
import { signRdsToken } from "../src/lib/rds-auth.js";

const BASE = "http://localhost:8080";
const TENANT = process.env.VERIFY_TENANT || "test21";
const TOKEN = signRdsToken({ sub: "verify-fin-org", tenant: TENANT, username: `vyaasaiagent@${TENANT}.rmone`, role: "Admin", accessLevel: "admin" });

(async () => {
  const res = await fetch(`${BASE}/api/analytics/financial?fresh=1`, { headers: { Authorization: `Bearer ${TOKEN}` } });
  console.log(`HTTP ${res.status}`);
  const body: any = await res.json();
  if (!body.available) { console.log("unavailable:", body.reason); return; }
  for (const key of ["all", "t12m"] as const) {
    const b = body.bases?.[key];
    if (!b) { console.log(`${key}: MISSING BASIS`); continue; }
    const sum = (rows: any[] | undefined, f: string) => (rows ?? []).reduce((a, r) => a + (Number(r[f]) || 0), 0);
    console.log(`\n=== basis ${key}: plannedHours=${b.plannedHours} ===`);
    for (const [name, rows, labelKey] of [
      ["byDivision", b.byDivision, "division"],
      ["byBusinessUnit", b.byBusinessUnit, "bu"],
      ["byDepartment", b.byDepartment, "department"],
    ] as const) {
      if (!rows) { console.log(`  ${name}: ABSENT`); continue; }
      const top = rows.slice(0, 3).map((r: any) => `${r[labelKey]}=${r.plannedHours}h/$${r.billDollars}`).join(", ");
      console.log(`  ${name}: ${rows.length} groups, sum plannedHours=${sum(rows, "plannedHours").toFixed(1)} — ${top}`);
    }
  }
})().catch(e => { console.error(e); process.exit(1); });
