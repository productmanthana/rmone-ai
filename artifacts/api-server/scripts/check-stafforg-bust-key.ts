/**
 * Staff-org cache bust key guard (CI gate, #291).
 * Run: npx tsx scripts/check-stafforg-bust-key.ts
 *
 * Catches the regression where the end-of-import staff-org cache bust is keyed
 * on the raw tenant LABEL instead of the resolved GUID — a silent no-op that
 * would leave the staff grid and org-audience permissions stale for 5 minutes
 * after every import.
 *
 * Guards three invariants:
 *  1. resolveTenantId (pipeline.ts) and tenantLabelToTid (rds-provider.ts) are
 *     lockstep: same UUID namespace → same GUID for every label, so the cache
 *     writer and the bust caller always agree on the key.
 *  2. A friendly label produces a GUID, never itself, as the resolved key.
 *     Equivalently: label !== resolveTenantId(label), so busting by raw label
 *     is always a no-op.
 *  3. Source-code scan: the invalidateStaffOrgCache call and the IPC "staffOrg"
 *     bustCache message in pipeline.ts both pass `tenantId` (the already-resolved
 *     GUID variable) — not `job.tenantId` (the raw label). This catches a
 *     refactor accidentally reverting to the label form.
 *
 * Exit code 0 = all good; 1 = at least one assertion failed.
 */

import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { resolveTenantId } from "../src/lib/pipeline.js";
import { tenantLabelToTid, invalidateStaffOrgCache } from "../src/lib/rds-provider.js";

const here = dirname(fileURLToPath(import.meta.url));

let failures = 0;
const fail = (msg: string) => { failures++; console.error("FAIL  " + msg); };
const ok   = (msg: string) => console.log("ok    " + msg);

// ── (1) Lockstep: both resolvers derive the same GUID from the same label ────
//
// pipeline.ts uses resolveTenantId to derive `tenantId` from `job.tenantId`
// before calling invalidateStaffOrgCache(tenantId).  rds-provider.ts uses
// tenantLabelToTid (an independent copy of the same logic) to key the cache.
// If the two ever diverge they will use different keys and the bust will miss.

const LABELS = [
  "acme-corp",
  "Demo Tenant",
  "liro poc",
  "SOME COMPANY WITH SPACES",
  "tenant_with_underscore",
];

const GUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

for (const label of LABELS) {
  const fromPipeline   = resolveTenantId(label);
  const fromRdsProvider = tenantLabelToTid(label);

  if (fromPipeline !== fromRdsProvider) {
    fail(
      `lockstep diverged for label "${label}": ` +
      `resolveTenantId → ${fromPipeline}, tenantLabelToTid → ${fromRdsProvider}`,
    );
  } else {
    ok(`lockstep: "${label}" → ${fromPipeline}`);
  }

  // ── (2) Label → GUID (not label): busting by raw label would miss ──────────
  if (!GUID_RE.test(fromPipeline)) {
    fail(
      `resolveTenantId("${label}") returned a non-GUID value "${fromPipeline}" — ` +
      `cache is presumably keyed on a GUID form, so this key would be a no-op`,
    );
  }

  if (fromPipeline === label) {
    fail(
      `resolveTenantId("${label}") returned the label verbatim — ` +
      `label === resolved key, so the lock-step check cannot catch a raw-label bust`,
    );
  } else {
    ok(`label !== GUID for "${label}" — raw-label bust would be a no-op (correct)`);
  }
}

// ── GUID passthrough: a real GUID is returned verbatim by both ────────────────
const TEST_GUID = "a1b2c3d4-e5f6-7890-abcd-ef1234567890";
{
  const fromPipeline    = resolveTenantId(TEST_GUID);
  const fromRdsProvider = tenantLabelToTid(TEST_GUID);
  if (fromPipeline !== TEST_GUID) {
    fail(`resolveTenantId(guid) should return the guid verbatim, got ${fromPipeline}`);
  } else {
    ok("GUID passthrough: resolveTenantId returns GUID verbatim");
  }
  if (fromRdsProvider !== TEST_GUID) {
    fail(`tenantLabelToTid(guid) should return the guid verbatim, got ${fromRdsProvider}`);
  } else {
    ok("GUID passthrough: tenantLabelToTid returns GUID verbatim");
  }
}

// ── invalidateStaffOrgCache smoke test: call with a GUID is not an error ──────
// (The cache is a private Map; we cannot seed it without a live DB. We at least
// confirm the export is callable and does not throw when given a GUID key.)
try {
  invalidateStaffOrgCache(resolveTenantId("smoke-test-tenant"));
  ok("invalidateStaffOrgCache(resolvedGuid) does not throw");
} catch (e) {
  fail(`invalidateStaffOrgCache threw unexpectedly: ${e}`);
}
try {
  invalidateStaffOrgCache(); // clear-all form, also used by the IPC relay
  ok("invalidateStaffOrgCache() (no-arg clear-all) does not throw");
} catch (e) {
  fail(`invalidateStaffOrgCache() threw unexpectedly: ${e}`);
}

// ── (3) Source-code scan: pipeline.ts bust lines use resolved `tenantId` ─────
//
// This is the primary regression guard. If someone refactors the bust back to
// `job.tenantId` the static check catches it before any runtime test would.
//
// Exact invariants verified:
//   a. invalidateStaffOrgCache is called with the resolved `tenantId` variable,
//      not with `job.tenantId`.
//   b. The IPC message carries `tid: tenantId` (resolved GUID), not
//      `tid: job.tenantId` (raw label).

const pipelineSrc = readFileSync(
  join(here, "../src/lib/pipeline.ts"),
  "utf-8",
);

// Find all invalidateStaffOrgCache call sites.
const invalidateCalls = [...pipelineSrc.matchAll(/invalidateStaffOrgCache\s*\(([^)]*)\)/g)];
if (invalidateCalls.length === 0) {
  fail("No invalidateStaffOrgCache calls found in pipeline.ts — was the import removed?");
} else {
  for (const m of invalidateCalls) {
    const arg = m[1].trim();
    if (arg === "") {
      // clear-all — only acceptable if intentional (e.g. a separate admin-wipe path)
      // do not fail, but note it
      ok(`invalidateStaffOrgCache() clear-all call found — acceptable for wipe paths`);
      continue;
    }
    if (/job\.tenantId/.test(arg)) {
      fail(
        `invalidateStaffOrgCache(${arg}) passes job.tenantId (raw label) — ` +
        `must use the resolved tenantId variable instead`,
      );
    } else if (/\btenantId\b/.test(arg)) {
      ok(`invalidateStaffOrgCache(${arg}) correctly uses resolved tenantId`);
    } else {
      fail(
        `invalidateStaffOrgCache(${arg}) uses an unexpected argument — ` +
        `expected the resolved tenantId variable`,
      );
    }
  }
}

// Find the IPC bustCache staffOrg message.
const ipcStaffOrgMessages = [
  ...pipelineSrc.matchAll(
    /process\.send\s*\(\s*\{[^}]*fn\s*:\s*["']staffOrg["'][^}]*\}\s*\)/g,
  ),
];
if (ipcStaffOrgMessages.length === 0) {
  fail(
    `No IPC bustCache { fn: "staffOrg" } message found in pipeline.ts — ` +
    `was the IPC relay removed?`,
  );
} else {
  for (const m of ipcStaffOrgMessages) {
    const snippet = m[0];
    if (/tid\s*:\s*job\.tenantId/.test(snippet)) {
      fail(
        `IPC staffOrg message sends tid: job.tenantId (raw label) — ` +
        `must use the resolved tenantId variable: ${snippet.slice(0, 120)}`,
      );
    } else if (/tid\s*:\s*tenantId\b/.test(snippet)) {
      ok(`IPC staffOrg message sends tid: tenantId (resolved GUID)`);
    } else {
      fail(
        `IPC staffOrg message has an unrecognised tid field — ` +
        `expected tid: tenantId: ${snippet.slice(0, 120)}`,
      );
    }
  }
}

// ── Summary ───────────────────────────────────────────────────────────────────
if (failures > 0) {
  console.error(`\n${failures} check(s) failed.`);
  process.exit(1);
} else {
  console.log("\nAll staff-org cache bust key checks passed.");
}
