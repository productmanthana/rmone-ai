/**
 * Single-shot status poll + VmHWM sampler.
 * Reads /tmp/oom-state.json, fetches /status/:id once, prints a one-liner.
 * Usage: tsx scripts/oom-poll.ts
 */
import fs from "fs";
import { signRdsToken } from "../src/lib/rds-auth.js";

const BASE  = "http://localhost:8080";
const TOKEN = signRdsToken({
  sub: "oom-poll", tenant: "rmone",
  username: "sanjeev@rmone.com", role: "admin", accessLevel: "admin",
});
const AUTH = `Bearer ${TOKEN}`;

function vmHwm(): { pids: number[]; sumMb: number; maxMb: number } {
  const pids: number[] = [];
  let sum = 0, max = 0;
  try {
    for (const d of fs.readdirSync("/proc")) {
      if (!/^\d+$/.test(d)) continue;
      try {
        const cmd = fs.readFileSync(`/proc/${d}/cmdline`).toString().replace(/\0/g, " ");
        if (!cmd.includes("tsx") || !cmd.includes("src/index.ts")) continue;
        pids.push(Number(d));
        const m = fs.readFileSync(`/proc/${d}/status`).toString().match(/VmHWM:\s*(\d+)/);
        const kb = m ? Number(m[1]) : 0;
        sum += kb; if (kb > max) max = kb;
      } catch { /* */ }
    }
  } catch { /* */ }
  return { pids, sumMb: Math.round(sum / 1024), maxMb: Math.round(max / 1024) };
}

function recentSigkills(): string[] {
  try {
    const logs = fs.readdirSync("/tmp/logs")
      .filter(n => n.includes("api-server") && n.endsWith(".log"))
      .sort().reverse().slice(0, 2);
    const lines: string[] = [];
    for (const f of logs) {
      const text = fs.readFileSync(`/tmp/logs/${f}`, "utf8");
      lines.push(...text.split("\n").filter(l =>
        l.includes("[cluster]") && (l.includes("died") || l.includes("SIGKILL"))
      ));
    }
    return lines;
  } catch { return []; }
}

async function main() {
  const state = JSON.parse(fs.readFileSync("/tmp/oom-state.json", "utf8"));
  const { uploadId, tenant } = state;

  const r = await fetch(`${BASE}/api/onboarding/status/${uploadId}`, {
    headers: { Authorization: AUTH },
  });
  const j: any = await r.json();

  const hw = vmHwm();
  const elapsed = Math.round((Date.now() - new Date(state.startedAt).getTime()) / 1000);
  const phase   = j?.progress?.phase ?? "-";
  const pct     = j?.progress?.pct   ?? "-";

  console.log(`[${new Date().toISOString()}] uploadId=${uploadId} tenant=${tenant}`);
  console.log(`  status=${j?.status ?? "?"} inserted=${j?.totalInserted ?? "?"} errors=${j?.totalErrors ?? "?"}`);
  console.log(`  phase="${phase}" pct=${pct}%  elapsed=${elapsed}s`);
  console.log(`  VmHWM sum=${hw.sumMb} MB  max/worker=${hw.maxMb} MB  pids=${hw.pids.join(",")}`);

  const kills = recentSigkills();
  if (kills.length) {
    console.log(`  ⚠ SIGKILL/died lines found:`);
    kills.forEach(l => console.log(`    ${l.trim()}`));
  } else {
    console.log(`  ✅ no SIGKILL/died lines in log`);
  }

  const terminal = ["success", "partial", "failed", "cancelled"].includes(j?.status);
  if (terminal) {
    console.log(`\n  🏁 TERMINAL — status=${j?.status} inserted=${j?.totalInserted} errors=${j?.totalErrors}`);
    if (j?.result?.steps) {
      for (const s of j.result.steps) {
        console.log(`     step=${s.name} inserted=${s.inserted ?? "-"} updated=${s.updated ?? "-"} errors=${s.errors?.length ?? 0}`);
      }
    }
    if (j?.result?.fatalError) console.log(`  fatalError: ${j.result.fatalError}`);
    if (j?.result?.warnings?.length) {
      console.log(`  warnings (${j.result.warnings.length}):`);
      j.result.warnings.slice(0, 5).forEach((w: any) => console.log(`    ${JSON.stringify(w).slice(0, 120)}`));
    }
  }
}

main().catch(e => { console.error("FATAL:", e); process.exit(1); });
