// LIST-view slimming contract for GET /records/:module (RDS tenants) — see
// src/lib/records-list-slim.ts for the rules and their audit trail. Guards
// what the web/mobile grids rely on: empty-omission never drops 0/false
// (tri-state Closed reads), alias twins dedupe ONLY when byte-identical,
// note fields truncate at the cap while JSON / person-list fields never do,
// and identity fields (TicketId / ModuleName) always survive. Runs in the
// check:synonyms chain (synonym-map workflow).
import assert from "node:assert/strict";
import {
  LIST_ALIAS_TWINS,
  LIST_TEXT_CAP,
  LIST_TRUNCATED_TEXT_FIELDS,
  slimListRecord,
  slimListRecords,
} from "../records-list-slim.js";

// ── Rule 1: empty-omission keeps falsy-but-meaningful values ─────────────────
{
  const slim = slimListRecord({
    TicketId: "PMM-26-000520",
    ModuleName: "PMM",
    Title: "Staff for VDC",
    Closed: false,          // tri-state read in web projectDates.ts — MUST survive
    ContractValue: 0,        // 0 survives ?? chains that "" does not — MUST survive
    Description: null,
    Comment: "",
    OwnerName: undefined,
  });
  assert.deepEqual(slim, {
    TicketId: "PMM-26-000520",
    ModuleName: "PMM",
    Title: "Staff for VDC",
    Closed: false,
    ContractValue: 0,
  });
}

// ── Rule 2: alias twins dedupe only when strictly identical ──────────────────
{
  // Identical twin values are omitted (canonical survives).
  const dup = slimListRecord({
    Title: "Harbor Bridge",
    ShortName: "Harbor Bridge",
    CRMCompanyLookupName: "Acme Co",
    CompanyName: "Acme Co",
    CRMBusinessUnitChoice: "Buildings",
    BusinessUnitName: "Buildings",
  });
  assert.deepEqual(dup, {
    Title: "Harbor Bridge",
    CRMCompanyLookupName: "Acme Co",
    CRMBusinessUnitChoice: "Buildings",
  });

  // Differing twins carry real information — both kept.
  const diff = slimListRecord({
    Title: "Harbor Bridge Replacement",
    ShortName: "HBR",
    CRMCompanyLookupName: "Acme Co",
    CompanyName: "Acme Company LLC",
  });
  assert.equal(diff.ShortName, "HBR");
  assert.equal(diff.CompanyName, "Acme Company LLC");

  // Twin present while canonical is absent → twin kept (it is the only value).
  const solo = slimListRecord({ ShortName: "HBR" });
  assert.equal(solo.ShortName, "HBR");

  // Every configured pair keeps [twin, canonical] orientation — the canonical
  // must never be the side that gets dropped.
  for (const [twin, canonical] of LIST_ALIAS_TWINS) {
    const slim = slimListRecord({ [twin]: "Same", [canonical]: "Same" });
    assert.equal(slim[canonical], "Same", `${canonical} must survive its twin ${twin}`);
    assert.ok(!(twin in slim), `${twin} must dedupe against ${canonical}`);
  }
}

// ── Rule 3: long-text truncation is allowlist-only ───────────────────────────
{
  const long = "x".repeat(LIST_TEXT_CAP + 500);
  const slim = slimListRecord({
    Description: long,
    Note: long,
    CustomLeadsJson: long,        // JSON.parsed by the web grid — never cut
    ProjectManagerUser: long,     // person GUID/name comma list — never cut
    SomeUnlistedEssayField: long, // not in the allowlist — ships untouched
    Comment: "short note",
  });
  assert.equal((slim.Description as string).length, LIST_TEXT_CAP);
  assert.equal((slim.Note as string).length, LIST_TEXT_CAP);
  assert.equal(slim.CustomLeadsJson, long);
  assert.equal(slim.ProjectManagerUser, long);
  assert.equal(slim.SomeUnlistedEssayField, long);
  assert.equal(slim.Comment, "short note");
  for (const f of LIST_TRUNCATED_TEXT_FIELDS) {
    assert.ok(!f.endsWith("User"), `person list column ${f} must not be truncatable`);
  }
  assert.ok(!LIST_TRUNCATED_TEXT_FIELDS.has("CustomLeadsJson"), "CustomLeadsJson must never truncate");
}

// ── Non-string values pass through untouched (Dates serialize identically) ──
{
  const created = new Date("2026-08-07T06:29:55.140Z");
  const slim = slimListRecord({ Created: created, NumAllocations: 12, ExtraFields: [{ label: "Region", value: "NE" }] });
  assert.equal(slim.Created, created);
  assert.equal(slim.NumAllocations, 12);
  assert.deepEqual(slim.ExtraFields, [{ label: "Region", value: "NE" }]);
}

// ── slimListRecords maps rows without mutating the inputs ────────────────────
{
  const row = { TicketId: "OPM-1", CompanyName: "Acme", CRMCompanyLookupName: "Acme", Empty: null };
  const out = slimListRecords([row]);
  assert.equal(out.length, 1);
  assert.ok(!("CompanyName" in out[0]!));
  assert.equal(row.CompanyName, "Acme", "input row must not be mutated");
  assert.equal(row.Empty, null, "input row must not be mutated");
}

console.log("recordsListSlim.test.ts passed");
