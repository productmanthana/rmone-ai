/**
 * One-off: seed the saved default schedule onto "Alston AI" opportunities that
 * have NO lifecycle at all — exactly what the settings-save adoption now does
 * (the user's save predates the fix, so re-fire it for them). Verifies via
 * getTaskDataRds, the same provider the Schedule tab reads.
 */
import { resolveTenantId } from "../src/lib/pipeline.js";
import { loadEffectiveDefaults } from "../src/lib/onboarding-settings-store.js";
import { isOutcomeStageName } from "../src/lib/stage-rules.js";
import { adoptDefaultLifecycleForBareOppsRds, getTaskDataRds } from "../src/lib/rds-provider.js";

const APPLY = process.argv.includes("--apply");
const label = process.argv.find((a) => a.startsWith("--label="))?.slice(8) ?? "Alston AI";

const tid = resolveTenantId(label);
const eff = await loadEffectiveDefaults(label);
const raw = String(eff.defaultOpportunityStages ?? "").split(",").map((s) => s.trim()).filter(Boolean);
const list = raw.filter((s) => !isOutcomeStageName(s));
console.log(`tenant "${label}" tid=${tid}`);
console.log(`saved default: [${raw.join(" | ")}]`);
console.log(`schedulable:   [${list.join(" | ")}]`);
if (list.length === 0) { console.log("EMPTY schedulable list — refusing"); process.exit(1); }
if (!APPLY) { console.log("DRY RUN — pass --apply to write"); process.exit(0); }

const r = await adoptDefaultLifecycleForBareOppsRds(tid, list);
console.log(`adopted=${r.adopted} failed=${r.failed} lifecycleId=${r.lifecycleId} tickets=[${r.tickets.join(", ")}]`);
for (const t of r.tickets) {
  const rows = (await getTaskDataRds(tid, t)) as { Title: string }[];
  console.log(`  ${t}: ${rows.length} stages [${rows.map((x) => x.Title).join(" | ")}]`);
}
process.exit(0);
