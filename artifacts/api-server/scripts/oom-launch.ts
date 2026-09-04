/**
 * Fire-and-forget import launcher.
 * Uploads a file, calls /run, writes state to /tmp/oom-state.json, exits.
 * Usage: tsx scripts/oom-launch.ts <filePath> <tenant> [forcedTabType] [importMode]
 */
import fs   from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { signRdsToken } from "../src/lib/rds-auth.js";

const [,, filePath, tenant, forcedTabType, importMode = "add"] = process.argv;
if (!filePath || !tenant) {
  console.error("Usage: tsx oom-launch.ts <filePath> <tenant> [forcedTabType] [importMode]");
  process.exit(1);
}

const BASE  = "http://localhost:8080";
const TOKEN = signRdsToken({
  sub: "oom-launch", tenant: "rmone",
  username: "sanjeev@rmone.com", role: "admin", accessLevel: "admin",
});
const AUTH = `Bearer ${TOKEN}`;

async function main() {
  // Upload
  const form = new FormData();
  form.append("tenantId", tenant);
  if (forcedTabType) form.append("forcedTabType", forcedTabType);
  const bytes    = fs.readFileSync(filePath);
  const fileName = path.basename(filePath);
  form.append("file", new Blob([bytes], {
    type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  }), fileName);

  console.log(`Uploading ${fileName} (${Math.round(bytes.length / 1024)} KB) → tenant=${tenant}`);
  const upResp = await fetch(`${BASE}/api/onboarding/upload`, {
    method: "POST", headers: { Authorization: AUTH }, body: form,
  });
  const upJson: any = await upResp.json();
  if (upResp.status !== 200) {
    console.error("Upload failed:", upResp.status, JSON.stringify(upJson).slice(0, 300));
    process.exit(2);
  }
  const { uploadId, sheets } = upJson;
  for (const s of (sheets ?? [])) console.log(`  sheet="${s.sheetName}" totalRows=${s.totalRows}`);

  // Run
  const runResp = await fetch(`${BASE}/api/onboarding/run`, {
    method: "POST",
    headers: { Authorization: AUTH, "Content-Type": "application/json" },
    body: JSON.stringify({ uploadId, tenantId: tenant, importMode }),
  });
  const runJson: any = await runResp.json();
  if (runResp.status !== 200) {
    console.error("Run failed:", runResp.status, JSON.stringify(runJson).slice(0, 300));
    process.exit(3);
  }

  // Save state for polling
  const state = { uploadId, tenant, filePath, startedAt: new Date().toISOString() };
  fs.writeFileSync("/tmp/oom-state.json", JSON.stringify(state, null, 2));
  console.log(`\n✅ Import launched! uploadId=${uploadId}`);
  console.log(`   State saved to /tmp/oom-state.json — poll with oom-poll.ts`);
}

main().catch(e => { console.error("FATAL:", e); process.exit(1); });
