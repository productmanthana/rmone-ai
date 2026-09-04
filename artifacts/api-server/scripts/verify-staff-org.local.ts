/**
 * TEMP verification (staff import dept fix): the Resources-page staff grid is
 * served by getResourceAllocations → resources[].departmentName/divisionName,
 * enriched from the staff org map this fix repaired. Print what the grid
 * would now show for the Alston AI tenant. Expect real departments (Houston,
 * Dallas, Atlanta, Rosemont, New Jersey, Downers Grove, Chicago, Cold
 * Storage) for the 19 linked users; blanks only for the 5 no-org rows.
 *
 * Run: pnpm --filter @workspace/api-server exec tsx scripts/verify-staff-org.local.ts
 */
import { getResourceAllocations } from "../src/lib/rds-provider.js";

const TID = "22897300-acd1-5876-bfba-ae8b794cedd0"; // resolveTenantId("Alston AI")

async function main() {
  const res = (await getResourceAllocations(TID)) as any;
  const rows: Array<Record<string, unknown>> =
    res?.resources ?? res?.Data?.resources ?? (Array.isArray(res) ? res : []);
  console.log("top-level keys:", Object.keys(res ?? {}).join(","));
  console.log(`staff rows: ${rows.length}`);
  if (rows[0]) console.log("row keys:", Object.keys(rows[0]).join(","));
  const deptCount = new Map<string, number>();
  for (const u of rows) {
    const dept = String((u as any).departmentName ?? "").trim() || "(blank)";
    const div  = String((u as any).divisionName ?? "").trim() || "(blank)";
    deptCount.set(dept, (deptCount.get(dept) ?? 0) + 1);
    console.log(`  ${String((u as any).name ?? "?").padEnd(28)} dept=${dept.padEnd(16)} div=${div}`);
  }
  console.log("— dept distribution:", [...deptCount.entries()].map(([k, v]) => `${k}:${v}`).join("  "));
  process.exit(0);
}

main().catch((e) => { console.error("verify failed:", e); process.exit(1); });
