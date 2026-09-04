/**
 * Regression tests (task #383): update-mode companies uploads must carry a
 * Company ID on every populated row, enforced as a STRICT issue — the review
 * grid's Continue gate filters on `strict: true`, so "Include" can never
 * override it; the row must be fixed or skipped.
 *
 * Covers:
 *  A) strictKeys + existing data: blank co_companyId → missingId issue with strict:true
 *  B) row WITH a Company ID → no issue
 *  C) create/first-time (clientMayHaveExistingRecords=false) → no requirement,
 *     even under strictKeys (IDs are minted server-side, e.g. COM-26-000123)
 *  D) non-strict surfaces (strictKeys=false) → no requirement
 *  E) other cards ("projects") are untouched by REQUIRED_ID_BY_CARD_STRICT
 */

import assert from "node:assert/strict";
import { scanAllIssues, REQUIRED_ID_BY_CARD_STRICT, type TabDef, type Row } from "../importValidation.js";

const companiesTab: TabDef = {
  id: "main", label: "Companies", sheetName: "Companies",
  cols: [
    { key: "co_name", label: "Company Name", w: 200 },
    { key: "co_companyId", label: "Company ID", w: 130 },
    { key: "co_reltype", label: "Relationship Type", w: 150 },
  ],
};

const rows = (rs: Row[]) => [{ tab: companiesTab, rows: rs }];

// A) blank Company ID under strictKeys + existing data → strict missingId
{
  const issues = scanAllIssues("companies", rows([{ co_name: "Acme Corp" }]), true, { strictKeys: true });
  const hit = issues.filter(i => i.kind === "missingId" && i.colKey === "co_companyId");
  assert.equal(hit.length, 1, "expected exactly one missing Company ID issue");
  assert.equal(hit[0].strict, true, "Companies missing-ID must be strict (Include cannot override)");
  assert.match(hit[0].reason, /matched by ID only/i);
}

// B) row with a Company ID → clean
{
  const issues = scanAllIssues("companies", rows([{ co_name: "Acme Corp", co_companyId: "COM-26-000123" }]), true, { strictKeys: true });
  assert.equal(issues.filter(i => i.colKey === "co_companyId").length, 0);
}

// C) fresh tenant (create mode): no requirement even under strictKeys
{
  const issues = scanAllIssues("companies", rows([{ co_name: "Acme Corp" }]), false, { strictKeys: true });
  assert.equal(issues.filter(i => i.colKey === "co_companyId").length, 0, "first-time uploads stay ID-optional");
}

// D) non-strict surfaces: no requirement
{
  const issues = scanAllIssues("companies", rows([{ co_name: "Acme Corp" }]), true, {});
  assert.equal(issues.filter(i => i.colKey === "co_companyId").length, 0);
}

// E) map only covers companies
assert.deepEqual(Object.keys(REQUIRED_ID_BY_CARD_STRICT), ["companies"]);

console.log("companiesStrictId.test.ts: all assertions passed");
