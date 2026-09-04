import { signRdsToken } from "../src/lib/rds-auth.js";
const BASE = `http://127.0.0.1:${process.env.PORT || "8080"}/api/rmone`;
const TENANT = "Liro";
const token = signRdsToken({ sub: "speed-probe", tenant: TENANT, username: "__speed_probe__", role: "", accessLevel: "user" });
const H = { Authorization: `Bearer ${token}`, "x-rmone-tenant": TENANT, Accept: "application/json" };
const targets = [
  { id: "OPM-25-000019", note: "523 alloc rows" },
  { id: "PMM-26-000506", note: "507 alloc rows" },
  { id: "OPM-25-000007", note: "375 alloc rows" },
  { id: "PMM-25-000369", note: "6 alloc rows (control)" },
];
async function timed(label: string, url: string): Promise<number> {
  const t0 = Date.now();
  const r = await fetch(url, { headers: H, signal: AbortSignal.timeout(120_000) });
  const body = await r.text();
  const ms = Date.now() - t0;
  let extra = "";
  try {
    const j = JSON.parse(body);
    const d = j?.Data ?? j;
    if (Array.isArray(d)) extra = `rows=${d.length}`;
    else if (d && typeof d === "object") extra = `keys=${Object.keys(d).length}`;
  } catch { extra = "non-json"; }
  console.log(`  ${label.padEnd(14)} ${String(ms).padStart(6)}ms  http=${r.status}  ${(body.length / 1024).toFixed(0)}KB  ${extra}`);
  return ms;
}
async function main() {
  for (const t of targets) {
    console.log(`── ${t.id}  (${t.note})`);
    await timed("detail COLD", `${BASE}/project/${t.id}?fresh=1&prefetch=1`);
    await timed("detail warm", `${BASE}/project/${t.id}?prefetch=1`);
    await timed("team COLD", `${BASE}/project-team?projectID=${t.id}&fresh=1`);
    await timed("team warm", `${BASE}/project-team?projectID=${t.id}`);
    await timed("task COLD?", `${BASE}/task-data?ticketID=${t.id}`);
    await timed("task warm", `${BASE}/task-data?ticketID=${t.id}`);
    await new Promise(r => setTimeout(r, 1500));
  }
  process.exit(0);
}
main().catch(e => { console.error("FATAL", String(e?.message || e).slice(0, 300)); process.exit(1); });
