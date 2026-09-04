import { lookupUserForLogin, signRdsToken } from "../src/lib/rds-auth.js";
import { getUsersRds } from "../src/lib/rds-provider.js";
import { resolveTenantId } from "../src/lib/pipeline.js";
const targetTenant = "test20";
const targetUsers = await getUsersRds(resolveTenantId(targetTenant));
const target = targetUsers.find((u: any) => String(u.email ?? u.username ?? "").trim().toLowerCase() === "vyaasaiagent@gmail.com");
if (!target) throw new Error("Target user not found in test20");
const root = await lookupUserForLogin("rmone", "drsampathkumarpatil@gmail.com");
if (!root) throw new Error("RM ONE superadmin account not found");
const token = signRdsToken({ sub: root.id, tenant: "rmone", username: root.userName, role: root.role, accessLevel: root.accessLevel });
const response = await fetch("http://127.0.0.1:8080/api/onboarding/members/role", {
  method: "POST",
  headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json", "x-rmone-tenant": "rmone" },
  body: JSON.stringify({ tenantId: targetTenant, userGuid: target.id, role: "Admin" }),
});
console.log("role-update", response.status, await response.text());
if (!response.ok) process.exit(1);
const verify = await lookupUserForLogin(targetTenant, "vyaasaiagent@gmail.com");
console.log("stored-role", JSON.stringify({ userName: verify?.userName, accessLevel: verify?.accessLevel, enabled: verify?.enabled }));
process.exit(0);
