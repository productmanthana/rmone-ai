// Dev probe: print every allocation row for a named resource so we can
// see whether a person has two rows on the SAME project and whether the
// rows overlap (stacked duplicate) or sit back-to-back (period split).
import { signRdsToken } from "../src/lib/rds-auth.js";

const TENANT = process.env.T || "testrmone";
const NAME = (process.env.N || "Laura").toLowerCase();
const PORT = process.env.PORT || "8080";
const token = signRdsToken({
  sub: "rows-probe",
  tenant: TENANT,
  username: "__rows_probe__",
  role: "",
  accessLevel: "user",
});
const H = {
  Authorization: `Bearer ${token}`,
  "x-rmone-tenant": TENANT,
  Accept: "application/json",
  Connection: "close" as const,
};

const r = await fetch(`http://127.0.0.1:${PORT}/api/rmone/resource-allocations`, {
  headers: H,
  signal: AbortSignal.timeout(120_000),
});
console.log("status", r.status);
const j = (await r.json()) as { resources?: Array<Record<string, unknown>> };
const hits = (j.resources ?? []).filter((res) =>
  String(res.name ?? "").toLowerCase().includes(NAME),
);
for (const res of hits) {
  console.log(`\n=== ${res.name} (id=${res.id ?? res.guid ?? "?"}) currentPct=${res.currentPct}`);
  const rows = (res.allAllocations ?? res.activeAllocations ?? []) as Array<Record<string, unknown>>;
  // Group by project so duplicates jump out.
  const byProject = new Map<string, Array<Record<string, unknown>>>();
  for (const a of rows) {
    const k = String(a.projectId ?? "?");
    if (!byProject.has(k)) byProject.set(k, []);
    byProject.get(k)!.push(a);
  }
  for (const [pid, list] of byProject) {
    console.log(`  ${pid} — ${list.length} row(s)${list.length > 1 ? "  <-- MULTIPLE" : ""}`);
    for (const a of list) console.log("    ", JSON.stringify(a));
  }
}
if (hits.length === 0) console.log("no resource matched", NAME);
