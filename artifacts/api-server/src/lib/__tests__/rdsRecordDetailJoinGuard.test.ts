/**
 * check:cache-guards — record-detail JOIN tenant-guard regression test.
 *
 * getRecordDetail()'s fetchRow builds LEFT JOINs to CRMCompany /
 * CompanyDivisions / Department (aliases rdco/rdcd/rddep) so display names
 * ride along on the record SELECT. Those tables are shared across tenants, so
 * a JOIN is only legal with a TenantID guard on the joined table:
 *   - live table lacks TenantID  → the JOIN must be OMITTED entirely and the
 *     in-row text fallbacks (CRMCompanyLookup text, Division column) apply;
 *   - live table has TenantID    → every JOIN must carry
 *     "AND <alias>.TenantID = @tid".
 * A regression here would silently surface another tenant's titles.
 *
 * Node harness pattern (tsx + watchdog + explicit process.exit) — chained into
 * check:synonyms (workflow "synonym-map"); see check:cache-guards.
 */
import assert from "node:assert/strict";
import { addResponder, flush, setTableColumns, startWatchdog } from "./helpers/fakeRdsDb.js";

startWatchdog("rdsRecordDetailJoinGuard");

// Loaded AFTER the fake driver is in place — a static import would hoist.
const rds = await import("../rds-provider.js");

// ── Fixtures ─────────────────────────────────────────────────────────────────
setTableColumns("PMM", [
  "TicketId", "Title", "Status", "TenantID", "Deleted",
  "CRMCompanyLookup", "DivisionLookup", "DepartmentLookup", "Division",
]);
setTableColumns("Opportunity", []); // table "absent" → ensure-columns loops skip it
setTableColumns("Lead", []);

const rowsById = new Map<string, Record<string, unknown>>();
const recordSelects: { id: string; tid: unknown; text: string }[] = [];
addResponder((q) => {
  if (!q.text.includes("FROM core2.dbo.[PMM] t")) return undefined;
  const id = String(q.params.id ?? "");
  recordSelects.push({ id, tid: q.params.tid, text: q.text });
  const row = rowsById.get(id);
  return { recordset: row ? [{ ...row }] : [] };
});

type Detail = { Status: boolean; Data: Record<string, unknown> } | null;

let passed = 0;
let failed = 0;
async function scenario(name: string, fn: () => Promise<void>): Promise<void> {
  try { await fn(); passed++; console.log(`  ok   ${name}`); }
  catch (e) { failed++; console.error(`  FAIL ${name}\n     ${(e as Error).stack ?? String(e)}`); }
}

await scenario("lookup tables WITHOUT TenantID: JOINs omitted, in-row text fallbacks used", async () => {
  const TID = "tenant-joinguard-naked";
  setTableColumns("CRMCompany", ["ID", "Title"]);                    // no TenantID
  setTableColumns("CompanyDivisions", ["ID", "Title", "ShortName"]); // no TenantID
  setTableColumns("Department", ["ID", "Title", "ShortName"]);       // no TenantID
  rowsById.set("PMM-C1", {
    TicketId: "PMM-C1", Title: "Join Guard Alpha", Status: "Active",
    CRMCompanyLookup: "Acme Builders LLC", DivisionLookup: "77",
    DepartmentLookup: "99", Division: "Ops East Text",
  });

  const res = (await rds.getRecordDetail("PMM-C1", TID, undefined, "PMM")) as Detail;
  assert.ok(res && res.Status, "record must be served");

  const sel = recordSelects.filter((s) => s.id === "PMM-C1");
  assert.equal(sel.length, 1, "exactly one record SELECT expected");
  for (const frag of ["LEFT JOIN", "rdco", "rdcd", "rddep"]) {
    assert.ok(!sel[0].text.includes(frag),
      `record SELECT must not contain "${frag}" when lookup tables lack TenantID`);
  }

  const d = res.Data;
  assert.equal(d.CRMCompanyLookupName, "Acme Builders LLC", "company name falls back to in-row lookup text");
  assert.equal(d.DivisionName, "Ops East Text", "division name falls back to the in-row Division column");
  assert.equal(d.CompanyName, undefined, "no joined company title without the JOIN");
  assert.equal(d.DepartmentName, undefined, "no department name without the JOIN");
});

await scenario("lookup tables WITH TenantID: every JOIN carries the @tid tenant guard", async () => {
  const TID = "tenant-joinguard-guarded";
  // Swap the lookup-table schemas. bustColCache is the mandated invalidation
  // path (gen-guarded) — plain colCache expiry would serve the OLD columns
  // stale-while-revalidate and poison this scenario.
  rds.bustColCache("CRMCompany");
  rds.bustColCache("CompanyDivisions");
  rds.bustColCache("Department");
  setTableColumns("CRMCompany", ["ID", "Title", "TenantID"]);
  setTableColumns("CompanyDivisions", ["ID", "Title", "ShortName", "TenantID"]);
  setTableColumns("Department", ["ID", "Title", "ShortName", "TenantID"]);
  rowsById.set("PMM-C2", {
    TicketId: "PMM-C2", Title: "Join Guard Beta", Status: "Active",
    CRMCompanyLookup: "123", DivisionLookup: "77", DepartmentLookup: "99",
    // Values the guarded JOINs would have fetched (aliases from extraCols):
    __CoTitle: "Joined Co Title", __DivTitle: "Ops East Full", __DivShort: "OE",
    __DepTitle: "Estimating", __DepShort: null,
  });

  const res = (await rds.getRecordDetail("PMM-C2", TID, undefined, "PMM")) as Detail;
  assert.ok(res && res.Status, "record must be served");

  const sel = recordSelects.filter((s) => s.id === "PMM-C2");
  assert.equal(sel.length, 1, "exactly one record SELECT expected");
  assert.equal(sel[0].tid, TID, "record SELECT must bind the tenant id");
  const text = sel[0].text;
  const joins: Array<[string, string]> = [
    ["LEFT JOIN core2.dbo.CRMCompany rdco ON rdco.ID = TRY_CAST(t.[CRMCompanyLookup] AS BIGINT)", "AND rdco.TenantID = @tid"],
    ["LEFT JOIN core2.dbo.CompanyDivisions rdcd ON rdcd.ID = TRY_CAST(t.[DivisionLookup] AS BIGINT)", "AND rdcd.TenantID = @tid"],
    ["LEFT JOIN core2.dbo.Department rddep ON rddep.ID = TRY_CAST(t.[DepartmentLookup] AS BIGINT)", "AND rddep.TenantID = @tid"],
  ];
  for (const [joinFrag, guardFrag] of joins) {
    assert.ok(text.includes(joinFrag), `record SELECT must contain "${joinFrag}"`);
    assert.ok(text.includes(joinFrag + " " + guardFrag),
      `the ${guardFrag.includes("rdco") ? "company" : guardFrag.includes("rdcd") ? "division" : "department"} JOIN must carry its tenant guard inline: "${guardFrag}"`);
  }

  const d = res.Data;
  assert.equal(d.CompanyName, "Joined Co Title", "joined company title published as CompanyName");
  assert.equal(d.CRMCompanyLookupName, "Joined Co Title", "client display field mirrors the joined title");
  assert.equal(d.DivisionName, "OE", "short division name from the guarded JOIN wins");
  assert.equal(d.DepartmentName, "Estimating", "department title from the guarded JOIN (ShortName NULL falls back to Title)");
  for (const transport of ["__CoTitle", "__DivTitle", "__DivShort", "__DepTitle", "__DepShort"]) {
    assert.ok(!(transport in d), `transport field ${transport} must be stripped from the payload`);
  }
});

await flush(); // let the background custom-opp ticket probe settle before exit
console.log(`\nrdsRecordDetailJoinGuard: ${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
