/**
 * Read-only scan of persisted Actuals-vs-Forecast snapshot identities.
 *
 * Run against the app database with:
 *   pnpm --filter @workspace/api-server run check:forecast-integrity
 *   pnpm --filter @workspace/api-server run check:forecast-integrity -- --json
 *   pnpm --filter @workspace/api-server run check:forecast-integrity -- --tenant=<GUID>
 *
 * Every tenant is read in its own query. The script never issues INSERT,
 * UPDATE, DELETE, MERGE, or repair statements. Exit code 1 means findings
 * were reported; it does not mean the scan attempted a repair.
 */
import { closeMssqlPool } from "@workspace/db";
import {
  scanAfSnapshotIntegrity,
  type AfSnapshotIntegrityFinding,
} from "../src/lib/actuals-forecast-integrity.js";

const jsonOutput = process.argv.includes("--json");
const tenantArg = process.argv.find((arg) => arg.startsWith("--tenant="));
const tenantFilter = tenantArg?.slice("--tenant=".length).trim() || null;
const epsilonArg = process.argv.find((arg) => arg.startsWith("--epsilon="));
const epsilon = epsilonArg ? Number(epsilonArg.slice("--epsilon=".length)) : undefined;

function printTextReport(
  tenantsScanned: number,
  rowsScanned: number,
  epsilon: number,
  findings: AfSnapshotIntegrityFinding[],
): void {
  console.log(`Actuals-vs-Forecast snapshot integrity scan`);
  console.log(`epsilon=${epsilon} tenants=${tenantsScanned} rows=${rowsScanned} findings=${findings.length}`);
  if (!findings.length) {
    console.log("No integrity violations found.");
    return;
  }

  for (const finding of findings) {
    for (const metric of finding.metrics) {
      const reasons = metric.violations.join(",");
      console.log(
        [
          `tenant=${finding.tenantId}`,
          `ticket=${finding.ticketId}`,
          `week=${finding.weekMonday}`,
          `metric=${metric.metric}`,
          `violations=${reasons}`,
          `totalDelta=${metric.totalDelta ?? "n/a"}`,
          `varianceDelta=${metric.varianceDelta ?? "n/a"}`,
          `remaining=${metric.remaining ?? "n/a"}`,
        ].join("\t"),
      );
    }
  }
}

async function main(): Promise<void> {
  const scan = await scanAfSnapshotIntegrity(tenantFilter ?? undefined, epsilon);

  if (jsonOutput) {
    console.log(JSON.stringify(scan, null, 2));
  } else {
    printTextReport(scan.tenantsScanned, scan.rowsScanned, scan.epsilon, scan.findings);
  }
  if (scan.findingCount) process.exitCode = 1;
}

main()
  .catch((error: unknown) => {
    console.error(`Snapshot integrity scan failed: ${error instanceof Error ? error.message : String(error)}`);
    process.exitCode = 2;
  })
  .finally(() => closeMssqlPool().catch(() => {}));