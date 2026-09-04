import { signRdsToken } from "../src/lib/rds-auth.js";
const BASE = `http://127.0.0.1:${process.env.PORT || "8080"}/api/rmone`;
const TENANT = "Liro";
const token = signRdsToken({ sub: "adopt-probe", tenant: TENANT, username: "__adopt_probe__", role: "", accessLevel: "user" });
const H = { Authorization: `Bearer ${token}`, "x-rmone-tenant": TENANT, Accept: "application/json", Connection: "close" as const };
async function hit(label: string, url: string) {
  const t0 = Date.now();
  const r = await fetch(url, { headers: H, signal: AbortSignal.timeout(120_000) });
  const body = await r.text();
  let extra = "";
  try { const j = JSON.parse(body); const d = j?.Data ?? j;
    extra = Array.isArray(d) ? `rows=${d.length}` : d && typeof d === "object" ? `keys=${Object.keys(d).length}` : "";
  } catch { extra = "non-json"; }
  console.log(`  ${label.padEnd(24)} ${String(Date.now() - t0).padStart(6)}ms http=${r.status} ${extra}`);
}
console.log("── seeds (cold on whichever worker answers):");
await hit("task seed OPM-25-000019", `${BASE}/task-data?ticketID=OPM-25-000019`);
await hit("detail seed PMM-26-000506", `${BASE}/project/PMM-26-000506?prefetch=1`);
await new Promise((r) => setTimeout(r, 1200)); // let IPC fan out
console.log("── round-robin, fresh TCP each (all fast = siblings adopted):");
for (let i = 0; i < 8; i++) await hit(`task rr${i}`, `${BASE}/task-data?ticketID=OPM-25-000019`);
for (let i = 0; i < 8; i++) await hit(`detail rr${i}`, `${BASE}/project/PMM-26-000506?prefetch=1`);
process.exit(0);
