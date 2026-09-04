/**
 * THROWAWAY production stress-test orchestrator (delete after the test).
 * Drives 5 test tenants against the deployed app: upload → run → poll,
 * with a health canary and duplicate-upload guard checks.
 *
 * Phases:
 *   tsx scripts/stress-prod.local.ts probe
 *   tsx scripts/stress-prod.local.ts start <label> <create|replace|update>
 *   tsx scripts/stress-prod.local.ts guard <label>          # expect 409 while running
 *   tsx scripts/stress-prod.local.ts poll [seconds]
 *   tsx scripts/stress-prod.local.ts cancelall
 *   tsx scripts/stress-prod.local.ts summary
 */
import * as fs from "node:fs";
import { signRdsToken } from "../src/lib/rds-auth.js";

const BASE = process.env.STRESS_BASE || "https://superrmone.vyaasai.com/api";
const FILES_DIR = "/tmp/stress";
const STATE_F = "/tmp/stress-state.json";
const LABELS = ["stresstest-a-0807", "stresstest-b-0807", "stresstest-c-0807", "stresstest-d-0807", "stresstest-e-0807"];

type TState = { uploadId?: string; mode?: string; startedAt?: number; doneAt?: number; status?: string; lastPct?: number; lastStage?: string; phaseTop?: string[] };
type State = { tenants: Record<string, TState>; canaryWorst?: number };
const loadState = (): State => (fs.existsSync(STATE_F) ? JSON.parse(fs.readFileSync(STATE_F, "utf8")) : { tenants: {} });
const saveState = (s: State) => fs.writeFileSync(STATE_F, JSON.stringify(s, null, 2));

const tokenFor = (label: string) =>
  signRdsToken({ sub: `stress-${label}`, tenant: label, username: `loadtest@${label}.example`, role: "admin", accessLevel: "admin" });

async function api(label: string, path: string, init?: RequestInit): Promise<{ status: number; json: any }> {
  const r = await fetch(`${BASE}${path}`, {
    ...init,
    headers: { Authorization: `Bearer ${tokenFor(label)}`, ...(init?.headers || {}) },
  });
  let json: any = null;
  try { json = await r.json(); } catch { /* non-JSON */ }
  return { status: r.status, json };
}

async function canary(): Promise<string> {
  const t0 = Date.now();
  let hs = 0;
  try { hs = (await fetch(BASE.replace(/\/api$/, "") + "/health", { signal: AbortSignal.timeout(10_000) })).status; } catch { hs = -1; }
  const hMs = Date.now() - t0;
  const t1 = Date.now();
  let ts = 0;
  try {
    ts = (await fetch(`${BASE}/rmone/token`, { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}", signal: AbortSignal.timeout(10_000) })).status;
  } catch { ts = -1; }
  const tMs = Date.now() - t1;
  const warn = hMs > 1500 || tMs > 2500 ? "  ⚠ SLOW" : "";
  return `canary: /health ${hs} ${hMs}ms | token ${ts} ${tMs}ms${warn}`;
}

async function upload(label: string, mode: string): Promise<void> {
  const s = loadState();
  const buf = fs.readFileSync(`${FILES_DIR}/${label}.xlsx`);
  const fd = new FormData();
  fd.append("file", new Blob([buf], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" }), `${label}.xlsx`);
  const t0 = Date.now();
  const up = await api(label, "/onboarding/upload", { method: "POST", body: fd });
  if (up.status !== 200 || !up.json?.uploadId) {
    console.log(`${label}: UPLOAD FAILED status=${up.status} body=${JSON.stringify(up.json).slice(0, 300)}`);
    process.exitCode = 1;
    return;
  }
  const uploadId = up.json.uploadId as string;
  const run = await api(label, "/onboarding/run", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ uploadId, importMode: mode }),
  });
  if (run.status >= 300) {
    console.log(`${label}: RUN FAILED status=${run.status} body=${JSON.stringify(run.json).slice(0, 300)}`);
    process.exitCode = 1;
    return;
  }
  s.tenants[label] = { uploadId, mode, startedAt: t0, status: "running" };
  saveState(s);
  console.log(`${label}: started (${mode}) uploadId=${uploadId} upload+run took ${((Date.now() - t0) / 1000).toFixed(0)}s`);
}

async function guard(label: string): Promise<void> {
  const buf = fs.readFileSync(`${FILES_DIR}/${label}.xlsx`);
  const fd = new FormData();
  fd.append("file", new Blob([buf]), `${label}-dup.xlsx`);
  const up = await api(label, "/onboarding/upload", { method: "POST", body: fd });
  const code = up.json?.code || up.json?.error || "";
  console.log(`${label}: duplicate upload while running → ${up.status} ${code} ${up.status === 409 ? "✔ correctly blocked" : "✘ EXPECTED 409"}`);
}

async function pollOnce(s: State): Promise<boolean> {
  let allDone = true;
  for (const label of LABELS) {
    const t = s.tenants[label];
    if (!t?.uploadId || t.doneAt) continue;
    const st = await api(label, `/onboarding/status/${t.uploadId}`);
    const j = st.json || {};
    const status = j.status || `http${st.status}`;
    const pct = j.progress?.pct ?? j.pct ?? "";
    const stage = j.progress?.stage || j.stage || j.progress?.label || "";
    t.status = status; t.lastPct = pct; t.lastStage = stage;
    const mins = t.startedAt ? ((Date.now() - t.startedAt) / 60000).toFixed(1) : "?";
    console.log(`  ${label}: ${status} ${pct !== "" ? pct + "%" : ""} ${String(stage).slice(0, 60)} (${mins}m)`);
    if (["success", "failed", "cancelled", "error"].includes(String(status))) {
      t.doneAt = Date.now();
      const pt: Array<{ label: string; dMs: number }> = j.result?.phaseTimings || j.phaseTimings || [];
      t.phaseTop = [...pt].sort((a, b) => b.dMs - a.dMs).slice(0, 5).map((p) => `${p.label}=${(p.dMs / 1000).toFixed(0)}s`);
      console.log(`  ${label}: TERMINAL ${status} after ${((t.doneAt - (t.startedAt || t.doneAt)) / 60000).toFixed(1)}m; slowest: ${t.phaseTop.join(", ") || "n/a"}`);
    } else allDone = false;
  }
  saveState(s);
  return allDone;
}

(async () => {
  const [phase, a1, a2] = process.argv.slice(2);
  if (phase === "probe") {
    for (const label of LABELS) {
      const r = await api(label, `/onboarding/active`);
      console.log(`${label}: /active → ${r.status} ${JSON.stringify(r.json).slice(0, 120)}`);
    }
    console.log(await canary());
  } else if (phase === "start") {
    await upload(a1, a2 || "create");
  } else if (phase === "guard") {
    await guard(a1);
  } else if (phase === "poll") {
    const budget = (Number(a1) || 240) * 1000;
    const t0 = Date.now();
    const s = loadState();
    for (;;) {
      console.log(`── ${new Date().toISOString().slice(11, 19)}Z  ${await canary()}`);
      const done = await pollOnce(s);
      if (done) { console.log("ALL TERMINAL"); break; }
      if (Date.now() - t0 > budget) { console.log("(poll budget reached — re-invoke)"); break; }
      await new Promise((r) => setTimeout(r, 12_000));
    }
  } else if (phase === "cancelall") {
    const s = loadState();
    for (const label of LABELS) {
      const t = s.tenants[label];
      if (!t?.uploadId || t.doneAt) continue;
      const r = await api(label, `/onboarding/cancel/${t.uploadId}`, { method: "POST" });
      console.log(`${label}: cancel → ${r.status}`);
    }
  } else if (phase === "summary") {
    const s = loadState();
    for (const label of LABELS) {
      const t = s.tenants[label];
      if (!t) continue;
      const mins = t.doneAt && t.startedAt ? ((t.doneAt - t.startedAt) / 60000).toFixed(1) : "—";
      console.log(`${label}: ${t.mode} ${t.status} ${mins}m slowest[${(t.phaseTop || []).join(", ")}]`);
    }
  } else {
    console.log("phases: probe | start <label> <mode> | guard <label> | poll [sec] | cancelall | summary");
  }
})();
