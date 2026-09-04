/**
 * Regression tests: simplified-grid same-file company + record identity keys.
 *
 * Bug class under test: expandClientsSheet synthesizes the "Client Companies"
 * sheet from record rows, but dropped the record's CompanyId — so the strict
 * identity-key gate (which builds its fileCompanyIds set from CRMCompany rows
 * only) falsely blocked a simplified upload that introduces a NEW company and
 * records referencing it by ID in the same file. The insert path adopts a
 * file-supplied CompanyId, so preserving it through expansion is all that's
 * needed for the forward-reference to be legal.
 */
import assert from "node:assert/strict";
import { expandClientsSheet, resolveTable, type SheetData } from "../pipeline.js";

let passed = 0;
function t(name: string, fn: () => void) {
  fn();
  passed++;
  console.log(`ok - ${name}`);
}

const sheet = (rows: Record<string, unknown>[]): SheetData => ({
  sheetName: "Projects",
  columns: [...new Set(rows.flatMap(r => Object.keys(r)))],
  rows: rows as any,
});

const companiesOf = (out: SheetData[]) => out.find(s => s.sheetName === "Client Companies");

t("synthesized Client Companies sheet routes to CRMCompany (fileCompanyIds source)", () => {
  assert.equal(resolveTable("Client Companies"), "CRMCompany");
});

t("record row's CompanyId lands on the synthesized company row", () => {
  const out = expandClientsSheet(sheet([
    { Title: "New HQ Tower", TicketId: "PMM-000123", Company: "Acme Builders", CompanyId: "COM-000042" },
  ]));
  const cos = companiesOf(out);
  assert.ok(cos, "Client Companies sheet emitted");
  assert.equal(cos!.rows.length, 1);
  assert.equal(String(cos!.rows[0].Title), "Acme Builders");
  assert.equal(String(cos!.rows[0].CompanyId), "COM-000042");
});

t("later row backfills a CompanyId the first-seen row lacked", () => {
  const out = expandClientsSheet(sheet([
    { Title: "Job A", TicketId: "PMM-000001", Company: "Acme Builders" },
    { Title: "Job B", TicketId: "PMM-000002", Company: "Acme Builders", CompanyId: "COM-000042" },
  ]));
  const cos = companiesOf(out)!;
  assert.equal(cos.rows.length, 1, "one company row for both records");
  assert.equal(String(cos.rows[0].CompanyId), "COM-000042");
});

t("first-seen CompanyId wins; conflicting later ID never overwrites", () => {
  const out = expandClientsSheet(sheet([
    { Title: "Job A", TicketId: "PMM-000001", Company: "Acme Builders", CompanyId: "COM-000042" },
    { Title: "Job B", TicketId: "PMM-000002", Company: "Acme Builders", CompanyId: "COM-000099" },
  ]));
  const cos = companiesOf(out)!;
  assert.equal(String(cos.rows[0].CompanyId), "COM-000042");
});

t("spaced 'Company ID' header variant is preserved too", () => {
  const out = expandClientsSheet(sheet([
    { Title: "Job A", TicketId: "PMM-000001", Company: "Beta LLC", "Company ID": "COM-000007" },
  ]));
  const cos = companiesOf(out)!;
  assert.equal(String(cos.rows[0].CompanyId), "COM-000007");
});

t("company without any ID still emits a row (auto-mint path, no fake ID)", () => {
  const out = expandClientsSheet(sheet([
    { Title: "Job A", TicketId: "PMM-000001", Company: "Gamma Inc" },
  ]));
  const cos = companiesOf(out)!;
  assert.equal(cos.rows[0].CompanyId ?? null, null);
});

console.log(`\n${passed} passed`);
