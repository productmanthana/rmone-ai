/**
 * Multi-timezone sweep for the capacity-strip regression harness (CI gate).
 * Run: pnpm --filter @workspace/api-server run check:capacity-strip
 *
 * Re-runs check-capacity-strip.ts under several IANA time zones that cover:
 *   - UTC          (no DST, offsets always exact multiples of 1h)
 *   - America/Los_Angeles  (US Pacific — same DST calendar as NY but UTC-8/7)
 *   - Australia/Sydney     (Southern-Hemisphere DST — spring-forward in Oct,
 *                           fall-back in Apr; UTC+10/+11)
 *   - America/New_York     (baseline — already tested in check-capacity-strip.ts,
 *                           included here for symmetry so any zone failure report
 *                           always shows the full matrix)
 *
 * Each zone runs in its own child process (tsx spawned with CAPACITY_STRIP_TZ
 * injected) because TZ must be set before the first Date constructor call.
 * Any TZ-dependent failure prints which zone broke and what the fixture said.
 *
 * Exit code 0 = all zones passed; 1 = one or more zones failed.
 */

import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const corePath = join(here, "check-capacity-strip.ts");

const ZONES = [
  "America/New_York",
  "UTC",
  "America/Los_Angeles",
  "Australia/Sydney",
];

let anyFailed = false;

for (const tz of ZONES) {
  console.log(`\n${"─".repeat(60)}`);
  console.log(`TZ = ${tz}`);
  console.log("─".repeat(60));

  const result = spawnSync("tsx", [corePath], {
    env: { ...process.env, CAPACITY_STRIP_TZ: tz },
    stdio: "pipe",
    encoding: "utf8",
  });

  // Echo stdout regardless of outcome so pass lines are visible.
  if (result.stdout) process.stdout.write(result.stdout);

  if (result.status !== 0) {
    anyFailed = true;
    console.error(`\n❌  ZONE FAILED: ${tz}`);
    if (result.stderr) process.stderr.write(result.stderr);
  } else {
    console.log(`✓  ${tz} — all fixtures passed`);
  }
}

console.log(`\n${"═".repeat(60)}`);
if (anyFailed) {
  console.error("check-capacity-strip-tz: one or more zones FAILED (see above)");
  process.exit(1);
}
console.log("check-capacity-strip-tz: all zones passed");
