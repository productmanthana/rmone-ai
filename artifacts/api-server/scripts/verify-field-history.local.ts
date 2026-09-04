/**
 * One-shot live verification of the contract-value history ledger (#724).
 * Inserts disposable-tenant rows via recordFieldChanges (real core2 DB),
 * reads them back via fetchFieldHistory AND the running dev server's
 * /api/rmone/record-field-history route (port 8080), then deletes them.
 * Root-account token (no roster row needed — resolveLiveAcl exempts roots).
 */
import { signRdsToken } from "../src/lib/rds-auth.js";
import { getPool, sql } from "../src/lib/db.js";
import { recordFieldChanges, fetchFieldHistory } from "../src/lib/fieldHistory.js";

const RUN_TAG = Date.now().toString(36);
const TENANT_LABEL = `Field Hist Check ${RUN_TAG}`;
const TICKET = "PMM-99724001";
const TOKEN = signRdsToken({
  sub: "field-history-check",
  tenant: TENANT_LABEL,
  username: "sanjeev@rmone.com", // root allowlist → live-ACL exempt, admin caps
  role: "admin",
  accessLevel: "admin",
});
const TID = (JSON.parse(Buffer.from(TOKEN.split(".")[1]!, "base64url").toString()) as { tid: string }).tid;
const BASE = "http://127.0.0.1:8080";

const failures: string[] = [];
function check(name: string, ok: boolean, detail?: string) {
  if (ok) console.log(`  ✓ ${name}`);
  else { failures.push(name); console.error(`  ✗ ${name}${detail ? ` — ${detail}` : ""}`); }
}

try {
  // 1. Append: 3 real changes + 1 echo (must be skipped)
  await recordFieldChanges([
    { tenantId: TID, module: "PMM", ticketId: TICKET, fieldName: "ContractValue", oldValue: null, newValue: "1500000", changedBy: "alice@check.local", changedById: "guid-a", source: "import" },
    { tenantId: TID, module: "PMM", ticketId: TICKET, fieldName: "ContractValue", oldValue: "1500000", newValue: "150000", changedBy: "bob@check.local", changedById: "guid-b", source: "user" },
    { tenantId: TID, module: "PMM", ticketId: TICKET, fieldName: "LaborContractAmount", oldValue: "80000", newValue: "95000.5", changedBy: "bob@check.local", changedById: "guid-b", source: "user" },
    { tenantId: TID, module: "PMM", ticketId: TICKET, fieldName: "ContractValue", oldValue: "150000", newValue: "$150,000.00", changedBy: "eve@check.local", changedById: "guid-e", source: "user" }, // echo
  ]);

  // 2. Direct fetch
  const direct = await fetchFieldHistory(TID, TICKET);
  check("3 rows stored (echo skipped)", direct.rows.length === 3, `got ${direct.rows.length}`);
  check("newest-first order", direct.rows[0]?.fieldName === "LaborContractAmount" || direct.rows[0]?.changedBy === "bob@check.local",
    JSON.stringify(direct.rows.map(r => r.fieldName)));
  const cv = direct.rows.find(r => r.fieldName === "ContractValue" && r.changedBy === "bob@check.local");
  check("old → new + who preserved", !!cv && cv.oldValue === "1500000" && cv.newValue === "150000" && cv.changedById === "guid-b" && cv.source === "user", JSON.stringify(cv));
  check("import row tagged", direct.rows.some(r => r.source === "import" && r.oldValue === null && r.newValue === "1500000"));
  check("not truncated at default limit", direct.truncated === false);
  const capped = await fetchFieldHistory(TID, TICKET, { limit: 2 });
  check("limit caps + flags truncated", capped.rows.length === 2 && capped.truncated === true);

  // 3. Route: 200 with rows for an authorized (root/admin) token
  const r200 = await fetch(`${BASE}/api/rmone/record-field-history?record=${TICKET}`, { headers: { Authorization: `Bearer ${TOKEN}` } });
  const body = await r200.json().catch(() => null) as { rows?: unknown[]; truncated?: boolean } | null;
  check("route 200 for financial-capable admin", r200.status === 200, `status ${r200.status} body ${JSON.stringify(body).slice(0, 200)}`);
  check("route returns the 3 rows", Array.isArray(body?.rows) && body!.rows!.length === 3, JSON.stringify(body).slice(0, 200));

  // 4. Route: 400 without record param, 401 without token
  const r400 = await fetch(`${BASE}/api/rmone/record-field-history`, { headers: { Authorization: `Bearer ${TOKEN}` } });
  check("route 400 without record param", r400.status === 400, `status ${r400.status}`);
  const r401 = await fetch(`${BASE}/api/rmone/record-field-history?record=${TICKET}`);
  check("route 401 unauthenticated", r401.status === 401, `status ${r401.status}`);
} finally {
  // 5. Cleanup — remove every disposable row whether checks passed or not
  try {
    const pool = await getPool();
    const del = await pool.request().input("tid", sql.VarChar, TID)
      .query("DELETE FROM core2.dbo.RMOneFieldHistory WHERE TenantID = @tid");
    console.log(`  cleanup: deleted ${del.rowsAffected?.[0] ?? 0} disposable rows (tenant ${TENANT_LABEL})`);
  } catch (e) {
    console.error(`  cleanup FAILED for tid ${TID}: ${String(e).slice(0, 200)}`);
  }
}

if (failures.length > 0) { console.error(`\n${failures.length} live check(s) FAILED`); process.exit(1); }
console.log("\nField-history live verification passed.");
process.exit(0);
