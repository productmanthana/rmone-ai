/** READ-ONLY: map tids of interest back to tenant labels via known label sources. */
import { getAllOnboardingJobsMeta } from "@workspace/db";
import { resolveTenantId } from "../src/lib/pipeline.js";

const want = new Set([
  "5c03084c-7413-5a56-9fa2-bc401f8a5650",
  "07160b5c-7a8f-5e55-84ce-7499c981cb87",
  "38ca247a-9899-5dad-ad45-b47bfc77f61b",
]);
const labels = new Set<string>();
for (const j of await getAllOnboardingJobsMeta()) {
  const l = String((j as any).tenantId ?? "").trim();
  if (l) labels.add(l);
}
// extra guesses beyond job history
for (const l of [
  "Liro", "Liro_Poc", "Liro POC", "LiroPoc", "LiRoDemo", "LiroDemo", "demormone", "Alston AI",
  "test20", "test21", "test99", "RMOne", "RM ONE", "rmone", "Demo", "demo", "Dynamisch",
]) labels.add(l);

let hits = 0;
for (const l of labels) {
  try {
    const t = resolveTenantId(l);
    if (want.has(t)) { console.log(`${t}  <=  "${l}"`); hits++; }
  } catch { /* ignore */ }
}
console.log(`checked ${labels.size} labels, matched ${hits}/${want.size}`);
process.exit(0);
