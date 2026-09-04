/**
 * Usage Analytics deferred-evidence UI regression gate.
 *
 * The summary payload intentionally excludes event-level rows. This check
 * protects the user-visible contract: a cold card cannot export an empty
 * evidence table, and an opened drawer says it is loading rather than
 * claiming there are zero rows.
 */
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const read = (relative: string) => readFileSync(join(here, relative), "utf8");
const usagePage = read("../src/pages/analytics-usage.tsx");
const shell = read("../src/components/analytics/MissionWorld.tsx");
const drawer = read("../src/components/analytics/DataDrawer.tsx");
const route = read("../../api-server/src/routes/usage-analytics.ts");

let failures = 0;
function check(label: string, ok: boolean) {
  if (ok) console.log(`  OK   ${label}`);
  else {
    failures++;
    console.error(`  FAIL ${label}`);
  }
}

console.log("check-usage-deferred-details: cold-summary UI guards");
check(
  "usage drawer fetch exposes explicit loading state",
  /const \[drawerLoading, setDrawerLoading\] = useState\(false\)/.test(usagePage) &&
    /<DataDrawer card=\{drawer\} loading=\{drawerLoading\}/.test(usagePage),
);
check(
  "old date-window responses cannot replace the active summary or drawer",
  /const activeSelectionRef = useRef\(requestSelectionKey\)/.test(usagePage) &&
    /activeSelectionRef\.current !== selectionAtStart/.test(usagePage) &&
    /activeSelectionRef\.current !== key/.test(usagePage),
);
check(
  "Refresh invalidates both summary and detail server cache variants",
  /const cacheKeyBase =/.test(route) &&
    /bustUsageAnalyticsEverywhere\(`\$\{cacheKeyBase\}\|summary`\)/.test(route) &&
    /bustUsageAnalyticsEverywhere\(`\$\{cacheKeyBase\}\|details`\)/.test(route),
);
check(
  "pre-refresh evidence cannot replace or block the new generation",
  /const analyticsGenerationRef = useRef\(0\)/.test(usagePage) &&
    /const detailKey = `\$\{key\}\|\$\{generation\}`/.test(usagePage) &&
    /analyticsGenerationRef\.current !== generation/.test(usagePage) &&
    /mergeUsageEvidence\(currentPayload, detailPayload\)/.test(usagePage),
);
check(
  "drawer detail waits for its refreshed summary generation",
  /const \[settledSummaryGeneration, setSettledSummaryGeneration\] = useState<number \| null>\(null\)/.test(usagePage) &&
    /setSettledSummaryGeneration\(generationAtStart\)/.test(usagePage) &&
    /if \(settledSummaryGeneration !== generation\)/.test(usagePage),
);
check(
  "drawer shows loading evidence instead of a zero-row message",
  /\{loading \? \(/.test(drawer) &&
    /Loading the evidence behind this number/.test(drawer) &&
    /disabled=\{loading \|\| busy !== null \|\| filtered\.length === 0\}/.test(drawer),
);
check(
  "cold usage cards with empty evidence withhold PDF and Excel",
  /const evidencePending = card\?\.id === "usage" && card\.rows\.length === 0/.test(shell) &&
    /Evidence loads when opened/.test(shell) &&
    /card && evidencePending \? \(/.test(shell),
);
check(
  "outcome cards apply the same evidence-export gate",
  /const evidencePending = card\?\.id === "usage" && card\.rows\.length === 0/.test(usagePage) &&
    /if \(exportBusy \|\| !card \|\| evidencePending\) return/.test(usagePage) &&
    /Open detail to load evidence/.test(usagePage),
);

if (failures > 0) {
  console.error(`\ncheck-usage-deferred-details: ${failures} failure(s)`);
  process.exit(1);
}
console.log("\ncheck-usage-deferred-details: all assertions passed");