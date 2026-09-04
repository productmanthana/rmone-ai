import { signRdsToken } from "/home/runner/workspace/artifacts/api-server/src/lib/rds-auth.js";
const tok = signRdsToken({ sub: "verify", tenant: "test20", username: "samtender12@gmail.com", role: "user", accessLevel: "admin" as any });
const base = "http://localhost:8080/api/rmone";
const h = { Authorization: `Bearer ${tok}` };
const r = await fetch(base + "/allocation-utilization?mode=Weekly", { headers: h });
const j = await r.json();
const rows = Array.isArray(j) ? j : (j.data ?? j.Data ?? []);
console.log("row count:", rows.length);
for (const row of rows) {
  const keys = Object.keys(row);
  const dateCols = keys.filter(k => /\d{1,2}[\/\-]\d{1,2}/.test(k));
  console.log(row.ResourceUser ?? row.Name, "| datecols:", dateCols.length, "| sample:", dateCols.slice(0,3).map(k=>`${k}=${JSON.stringify(row[k])}`).join(" "));
}
console.log("first row keys:", rows[0] ? Object.keys(rows[0]).join(",") : "none");
process.exit(0);
