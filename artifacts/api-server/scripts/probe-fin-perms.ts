/* Temporary probe: financial-permission audit for tenant test20.
 * 1) What does the saved Access Levels doc say (Manager override)?
 * 2) Which users exist + their levels?
 * 3) As a manager-level user: /my-capabilities, /record-permissions, and
 *    financial write routes (harmless payloads) — expect 403 where gated.
 */
import { getOnboardingSettings, getUsersByTenant } from "@workspace/db";
import { v5 as uuidv5 } from "uuid";
import { signRdsToken } from "../src/lib/rds-auth";

const NS = "5d8f1e6a-2c3b-4d7e-9a1f-0b2c3d4e5f6a";
const TENANT = "test20";
const BASE = process.env.BASE ?? "http://localhost:8080/api/rmone";
const RECORD = "PMM-25-000007";

async function call(token: string, method: string, path: string, body?: unknown) {
  const r = await fetch(BASE + path, {
    method,
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  let txt = await r.text();
  if (txt.length > 400) txt = txt.slice(0, 400) + "…";
  return `${r.status} ${txt}`;
}

async function main() {
  const doc = await getOnboardingSettings("accesslevels:" + TENANT);
  const s: any = doc?.settings ?? null;
  console.log("=== accesslevels doc ===");
  console.log("builtinOverrides:", JSON.stringify(s?.builtinOverrides ?? null));
  console.log("custom levels:", JSON.stringify((s?.levels ?? []).map((l: any) => ({ id: l.id, name: l.name, caps: l.caps }))));

  const tid = uuidv5(TENANT, NS);
  const users = await getUsersByTenant(tid);
  console.log("\n=== users (" + users.length + ") ===");
  if (users[0]) console.log("row keys:", Object.keys(users[0] as any).join(","));
  for (const u of users as any[]) {
    console.log(`- ${u.username} id=${u.id} acl=${u.accessLevel ?? u.access_level ?? "?"} role=${u.role ?? "?"} enabled=${u.enabled} deleted=${u.deleted}`);
  }

  const mgr = (users as any[]).find(
    (u) => String(u.accessLevel ?? "").toLowerCase() === "manager" && u.enabled && !u.deleted,
  );
  const adm = (users as any[]).find(
    (u) => ["admin", "administrator"].includes(String(u.accessLevel ?? "").toLowerCase()) && u.enabled && !u.deleted,
  );

  for (const [label, u] of [["MANAGER", mgr], ["ADMIN", adm]] as const) {
    if (!u) { console.log(`\n=== ${label}: none found ===`); continue; }
    console.log(`\n=== ${label} probe as ${u.username} ===`);
    const tok = signRdsToken({ sub: u.id, tenant: TENANT, username: u.username, role: u.role ?? "", accessLevel: (u.accessLevel ?? "unset") as any });
    console.log("my-capabilities:", await call(tok, "GET", "/my-capabilities"));
    console.log("record-permissions:", await call(tok, "GET", `/record-permissions/${RECORD}`));
    console.log("update-fields(ContractValue):", await call(tok, "POST", "/update-fields", {
      TicketId: RECORD, Fields: [{ FieldName: "ContractValue", FieldValue: "123456" }],
    }));
    console.log("role-billing-rate(bogus id):", await call(tok, "POST", "/role-billing-rate", {
      roleId: "00000000-0000-0000-0000-000000000001", billingRate: 111,
    }));
    console.log("rate-card/apply(rows:[]):", await call(tok, "POST", "/rate-card/apply", { rows: [] }));
    console.log("allocation-flag(nc+CostRate, bogus ids):", await call(tok, "POST", "/allocation-flag", {
      ProjectID: "PMM-00-999999", ResourceGuid: "00000000-0000-0000-0000-000000000002", Flag: "nc", Value: true, CostRate: 99,
    }));
  }
}

main().then(() => process.exit(0)).catch((e) => { console.error("PROBE FAILED:", e); process.exit(1); });
