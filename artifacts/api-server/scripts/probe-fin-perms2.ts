/* Probe 2: does a PUT /access-levels with editFinancials:false persist and
 * enforce? Uses the admin account, then re-probes a manager user. */
import { getOnboardingSettings, getUsersByTenant } from "@workspace/db";
import { v5 as uuidv5 } from "uuid";
import { signRdsToken } from "../src/lib/rds-auth";

const NS = "5d8f1e6a-2c3b-4d7e-9a1f-0b2c3d4e5f6a";
const TENANT = "test20";
const API = process.env.BASE ?? "http://localhost:8080/api";
const RECORD = "PMM-25-000007";

async function call(token: string, method: string, url: string, body?: unknown) {
  const r = await fetch(url, {
    method,
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  let txt = await r.text();
  if (txt.length > 500) txt = txt.slice(0, 500) + "…";
  return `${r.status} ${txt}`;
}

async function main() {
  const before = await getOnboardingSettings("accesslevels:" + TENANT);
  console.log("BEFORE row meta:", JSON.stringify({ updatedAt: (before as any)?.updatedAt ?? (before as any)?.updated_at, createdAt: (before as any)?.createdAt ?? (before as any)?.created_at }));
  console.log("BEFORE overrides:", JSON.stringify((before?.settings as any)?.builtinOverrides ?? null));

  const admToken = signRdsToken({
    sub: "b4f70845-5010-45ab-96d0-84c407219e14",
    tenant: TENANT,
    username: "vyaasaiagent@gmail.com",
    role: "Admin",
    accessLevel: "admin" as any,
  });

  // Exactly what the web page would send after unchecking "Edit financials".
  const putBody = {
    levels: [],
    builtinOverrides: {
      manager: { editData: true, advanceStages: true, editFinancials: false, manageStaff: true, manageSettings: false, importPage: false },
    },
  };
  console.log("\nPUT /onboarding/access-levels:", await call(admToken, "PUT", `${API}/onboarding/access-levels`, putBody));

  const after = await getOnboardingSettings("accesslevels:" + TENANT);
  console.log("AFTER overrides:", JSON.stringify((after?.settings as any)?.builtinOverrides ?? null));

  // Re-probe as manager (priya) — expect editFinancials:false + 403s now.
  const tid = uuidv5(TENANT, NS);
  const users = await getUsersByTenant(tid);
  const mgr = (users as any[]).find((u) => String(u.accessLevel ?? "").toLowerCase() === "manager" && u.enabled && !u.deleted);
  if (!mgr) { console.log("no manager found"); return; }
  const tok = signRdsToken({ sub: mgr.id, tenant: TENANT, username: mgr.username, role: mgr.role ?? "", accessLevel: "manager" as any });
  console.log(`\n=== MANAGER re-probe as ${mgr.username} ===`);
  console.log("my-capabilities:", await call(tok, "GET", `${API}/rmone/my-capabilities`));
  console.log("record-permissions:", await call(tok, "GET", `${API}/rmone/record-permissions/${RECORD}`));
  console.log("update-fields(ContractValue):", await call(tok, "POST", `${API}/rmone/update-fields`, {
    RecordId: RECORD, Fields: [{ FieldName: "ContractValue", FieldValue: "123456" }],
  }));
  console.log("role-billing-rate:", await call(tok, "POST", `${API}/rmone/role-billing-rate`, {
    roleId: "00000000-0000-0000-0000-000000000001", billingRate: 111,
  }));
  console.log("rate-card/apply(rows:[]):", await call(tok, "POST", `${API}/rmone/rate-card/apply`, { rows: [] }));
  console.log("allocation-flag(nc+CostRate, bogus ids):", await call(tok, "POST", `${API}/rmone/allocation-flag`, {
    ProjectID: "PMM-00-999999", ResourceGuid: "00000000-0000-0000-0000-000000000002", Flag: "nc", Value: true, CostRate: 99,
  }));
}

main().then(() => process.exit(0)).catch((e) => { console.error("PROBE FAILED:", e); process.exit(1); });
