/**
 * Per-stage "Applies to" audiences — the web coerce mirror must round-trip
 * what the server sanitizer stores (lockstep contract in lib/stageRules.ts).
 * Dropping or mangling the key here would silently erase every stage
 * audience on the admin's next workflow save.
 */
import { coerceRules } from "../stageRules";

let failures = 0;
function check(name: string, ok: boolean, detail?: string) {
  if (ok) {
    console.log(`  ✓  ${name}`);
  } else {
    failures++;
    console.error(`  ✗  ${name}${detail ? ` — ${detail}` : ""}`);
  }
}

console.log("\nA) round-trips a scoped stage, lowercasing stage keys and ids");
const doc = coerceRules({
  fieldLocks: [],
  stageSkips: [],
  stageAudiences: {
    OPM: { "Contract Negotiations": { applyMode: "GROUPS", groupIds: ["G-1", "user:U2", "org:bu:X"] } },
  },
});
const entry = doc.stageAudiences?.OPM?.["contract negotiations"];
check("entry survives under lowercased stage key", !!entry, JSON.stringify(doc.stageAudiences));
check("mode lowercased to \"groups\"", entry?.applyMode === "groups", JSON.stringify(entry));
check("ids lowercased, sentinels intact",
  JSON.stringify(entry?.groupIds) === JSON.stringify(["g-1", "user:u2", "org:bu:x"]),
  JSON.stringify(entry?.groupIds));

console.log("\nB) drops everyone / empty-id / unknown-mode entries (everyone = absence)");
const doc2 = coerceRules({
  fieldLocks: [],
  stageSkips: [],
  stageAudiences: {
    PMM: {
      a: { applyMode: "everyone", groupIds: ["g"] },
      b: { applyMode: "groups", groupIds: [] },
      c: { applyMode: "banana", groupIds: ["g"] },
      d: { applyMode: "except", groupIds: ["G"] },
    },
  },
});
check("only the valid entry remains",
  JSON.stringify(Object.keys(doc2.stageAudiences?.PMM ?? {})) === JSON.stringify(["d"]),
  JSON.stringify(doc2.stageAudiences));
check("except-mode entry round-trips",
  JSON.stringify(doc2.stageAudiences?.PMM?.d) === JSON.stringify({ applyMode: "except", groupIds: ["g"] }),
  JSON.stringify(doc2.stageAudiences?.PMM?.d));

console.log("\nC) omits the key entirely when nothing is scoped — untouched docs keep their shape");
check("no stageAudiences input → undefined",
  coerceRules({ fieldLocks: [], stageSkips: [] }).stageAudiences === undefined);
check("empty module map → undefined",
  coerceRules({ fieldLocks: [], stageSkips: [], stageAudiences: { OPM: {} } }).stageAudiences === undefined);

console.log("");
if (failures > 0) {
  console.error(`stageAudiences tests: ${failures} FAILED`);
  process.exit(1);
}
console.log("stageAudiences tests: PASS");
