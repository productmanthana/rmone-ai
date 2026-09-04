// Dev probe: GET /api/alerts/feed and print each row + attached records
// table (verifying the "Over-allocated staff" trend row carries the same
// per-person table as the AI escalation card). Local use only.
import { signRdsToken } from "../src/lib/rds-auth.js";

const TENANT = process.env.T || "testrmone";
const PORT = process.env.PORT || "8080";
const token = signRdsToken({
  sub: "alerts-probe",
  tenant: TENANT,
  username: "__alerts_probe__",
  role: "",
  accessLevel: "user",
});
const H = {
  Authorization: `Bearer ${token}`,
  "x-rmone-tenant": TENANT,
  Accept: "application/json",
  Connection: "close" as const,
};

const r = await fetch(`http://127.0.0.1:${PORT}/api/alerts/feed`, {
  headers: H,
  signal: AbortSignal.timeout(120_000),
});
console.log("status", r.status);
const j = (await r.json()) as {
  rows?: Array<{
    source: string;
    title: string;
    sub?: string;
    records?: {
      subtitle?: string;
      columns: Array<{ key: string }>;
      rows: Array<Record<string, string>>;
    };
  }>;
};
for (const row of j.rows ?? []) {
  const rec = row.records
    ? `records=${row.records.rows.length} [${row.records.columns.map((c) => c.key).join(",")}]`
    : "no-records";
  console.log(`${row.source} | ${row.title} | ${row.sub ?? ""} | ${rec}`);
  if (row.source === "forecast-shift" && row.records) {
    console.log("  subtitle:", row.records.subtitle);
    for (const rr of row.records.rows.slice(0, 3)) console.log("  row:", JSON.stringify(rr));
  }
}
