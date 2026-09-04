// Dev probe: for a named person, list every project they're allocated to
// (weekly-row summary), then pull each project's Team entries to show how
// many ASSIGNMENT records (rwiId) the person has per project and whether
// those records overlap. Local use only.
import { signRdsToken } from "../src/lib/rds-auth.js";

const TENANT = process.env.T || "testrmone";
const NAME = (process.env.N || "Laura Jensen").toLowerCase();
const PORT = process.env.PORT || "8080";
const token = signRdsToken({
  sub: "team-probe",
  tenant: TENANT,
  username: "__team_probe__",
  role: "",
  accessLevel: "user",
});
const H = {
  Authorization: `Bearer ${token}`,
  "x-rmone-tenant": TENANT,
  Accept: "application/json",
  Connection: "close" as const,
};
const BASE = `http://127.0.0.1:${PORT}/api/rmone`;

const ra = await fetch(`${BASE}/resource-allocations`, { headers: H, signal: AbortSignal.timeout(120_000) });
const raJ = (await ra.json()) as { resources?: Array<Record<string, unknown>> };
const me = (raJ.resources ?? []).find((r) => String(r.name ?? "").toLowerCase() === NAME);
if (!me) { console.log("resource not found:", NAME); process.exit(0); }
const rows = (me.allAllocations ?? []) as Array<Record<string, unknown>>;
const byProject = new Map<string, { n: number; hours: number; min: string; max: string; name: string }>();
for (const a of rows) {
  const k = String(a.projectId ?? "?");
  const cur = byProject.get(k) ?? { n: 0, hours: 0, min: "9999", max: "0000", name: String(a.projectName ?? "") };
  cur.n++;
  cur.hours += Number(a.hours ?? 0);
  const s = String(a.startDate ?? ""); const e = String(a.endDate ?? "");
  if (s && s < cur.min) cur.min = s;
  if (e && e > cur.max) cur.max = e;
  byProject.set(k, cur);
}
console.log(`\n${me.name} — weekly-row summary per project:`);
for (const [pid, v] of byProject)
  console.log(`  ${pid} (${v.name}): ${v.n} weekly rows, ${v.hours}h, ${v.min} → ${v.max}`);

for (const pid of byProject.keys()) {
  const r = await fetch(`${BASE}/project-team?projectID=${encodeURIComponent(pid)}`, {
    headers: H, signal: AbortSignal.timeout(120_000),
  });
  const j = (await r.json()) as { team?: Array<Record<string, unknown>> };
  const mine = (j.team ?? []).filter((m) => String(m.name ?? "").toLowerCase() === NAME);
  console.log(`\n=== ${pid}: team=${(j.team ?? []).length} entries, ${mine.length} for ${me.name}${mine.length > 1 ? "  <-- TWO ASSIGNMENT RECORDS" : ""}`);
  for (const m of mine)
    console.log(`   rwiId=${m.rwiId} span=${m.startDate} → ${m.endDate} pctAllocation=${m.pctAllocation}`);
}
