/**
 * Verify which date/owner fields the /records endpoints actually return
 * for tenant test21 — foundation check for the Reports pages.
 * Run: pnpm exec tsx scripts/verify-report-fields.local.ts
 */
import { signRdsToken } from "../src/lib/rds-auth.js";

const BASE = "http://localhost:8080";
const TENANT = "test21";
const TOKEN = signRdsToken({ sub: "verify-reports", tenant: TENANT, username: "vyaasaiagent@test21.rmone", role: "Admin", accessLevel: "admin" });
const H = { Authorization: `Bearer ${TOKEN}` };

const FIELDS = [
  "Created", "CreationDate", "AwardedorLossDate", "CloseDate", "BidDueDate",
  "CloseoutStartDate", "CloseoutDate", "ClosedDate",
  "ActualStartDate", "ActualCompletionDate", "TargetStartDate", "TargetCompletionDate",
  "OwnerName", "OwnerUser", "OwnerUserName", "ProjectManagerUser", "ProjectManagerUserName",
  "ProjectLeadUser", "BusinessLeadUser",
  "Status", "Closed", "LeadStatus", "CRMProjectStatusChoice", "CRMOpportunityStatusChoice",
  "CRMOpportunityStageChoice", "StageStep", "CompanyName", "CRMCompanyLookupName",
  "DivisionName", "BusinessUnitName", "TicketId", "Title",
];

async function probe(module: string) {
  const res = await fetch(`${BASE}/api/rmone/records/${module}?fresh=1`, { headers: H });
  if (!res.ok) { console.error(`${module}: HTTP ${res.status}`); return; }
  const body: any = await res.json();
  const rows: any[] = body?.data ?? body ?? [];
  console.log(`\n=== ${module}: ${rows.length} rows ===`);
  if (!rows.length) return;
  for (const f of FIELDS) {
    const present = rows.filter(r => r[f] !== undefined);
    const nonNull = rows.filter(r => r[f] !== undefined && r[f] !== null && String(r[f]).trim() !== "");
    if (present.length === 0) { console.log(`  ${f}: ABSENT`); continue; }
    const sample = nonNull[0]?.[f];
    console.log(`  ${f}: present, ${nonNull.length}/${rows.length} non-null, sample=${JSON.stringify(sample)?.slice(0, 40)}`);
  }
}

(async () => {
  for (const m of ["PMM", "OPM", "LEM"]) await probe(m);
})().catch(e => { console.error(e); process.exit(1); });
