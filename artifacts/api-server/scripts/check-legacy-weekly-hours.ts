/**
 * Read-only cross-tenant audit for legacy weekly-hours conflicts.
 *
 * Prints aggregate counts only: no tenant IDs, person IDs, project IDs, or row
 * values. The underlying integrity scan is SELECT-only and never repairs or
 * deletes data.
 */
import { runAllocationIntegrityScan } from "../src/lib/allocation-integrity-scan.js";

const result = await runAllocationIntegrityScan();
const returnedSignatureCounts: Record<string, number> = {};
for (const row of result.findings) {
  returnedSignatureCounts[row.signature] =
    (returnedSignatureCounts[row.signature] ?? 0) + 1;
}

console.log(JSON.stringify({
  ok: result.ok,
  totalFindings: result.totalFindings,
  affectedTenantCount: Object.keys(result.byTenant).length,
  returnedRows: result.findings.length,
  truncated: result.truncated,
  returnedSignatureCounts,
  error: result.error ?? null,
}, null, 2));

process.exit(result.ok ? 0 : 1);