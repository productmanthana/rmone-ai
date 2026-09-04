// Schedule-window rule — the server-side resolution that decides whether
// member start/end dates must stay inside the record's phase-schedule window.
//
// SECURITY INVARIANT under test: request input can only TIGHTEN enforcement.
// The server derives its own answer from trusted tenant settings + the
// record's module; a client `true` may switch enforcement on (per-record
// display-mode overrides live client-side, invisible here), but a client
// `false` must NEVER disable the gate — otherwise any authenticated caller
// could POST `ScheduleWindowEnabled: false` and save out-of-window dates.
//
// MODULE RESOLUTION under test: custom (non-OPM/LEM-prefixed) opportunity
// and lead TicketIds resolve through a tenant-scoped cache. The read-path
// ensure swallows load failures and rate-limits forced cache-miss refreshes
// (fine for display routing) — a validation gate trusting it would silently
// default an uncached opp/lead to PMM and apply the wrong tenant mode. The
// PRODUCTION-ADAPTER section below drives the real rds-provider functions
// against a fake mssql driver to pin the trusted save-path semantics: load
// failures and throttled misses fail CLOSED, never default to PMM.
import {
  addResponder, countQueries, startWatchdog, type FakeQuery,
} from "./helpers/fakeRdsDb.js"; // MUST be first: patches the mssql driver
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  enforcedForRecordSave,
  isScheduleFollowingMode,
  resolveScheduleWindowEnforced,
} from "../schedule-window-rule.js";

startWatchdog("scheduleWindowRule");

// ── Mode classification ─────────────────────────────────────────────────────
assert.equal(isScheduleFollowingMode("full"), true);
assert.equal(isScheduleFollowingMode("schedule-no-grid"), true);
assert.equal(isScheduleFollowingMode("no-schedule"), false);
assert.equal(isScheduleFollowingMode("no-schedule-no-grid"), false);
assert.equal(isScheduleFollowingMode("no-schedule-no-hours"), false);
assert.equal(isScheduleFollowingMode(""), false);
assert.equal(isScheduleFollowingMode(null), false);
assert.equal(isScheduleFollowingMode(undefined), false);

// ── A client `false` can NEVER loosen (the rejected-review bypass) ──────────
for (const enforcingMode of ["full", "schedule-no-grid"]) {
  for (const module of ["PMM", "COM", "", null, undefined]) {
    assert.equal(
      resolveScheduleWindowEnforced(false, module, {
        projectDisplayMode: enforcingMode,
        oppDisplayMode: "no-schedule",
      }),
      true,
      `client false must not disable the gate on a "${enforcingMode}" project tenant (module=${String(module)})`,
    );
  }
  for (const module of ["OPM", "LEM"]) {
    assert.equal(
      resolveScheduleWindowEnforced(false, module, {
        projectDisplayMode: "no-schedule",
        oppDisplayMode: enforcingMode,
      }),
      true,
      `client false must not disable the gate on a "${enforcingMode}" opp tenant (module=${module})`,
    );
  }
}
// `false` and absent are equivalent — both defer to the server-derived rule.
for (const clientResolved of [false, undefined]) {
  assert.equal(
    resolveScheduleWindowEnforced(clientResolved, "PMM", {
      projectDisplayMode: "no-schedule",
      oppDisplayMode: "full",
    }),
    false,
    `genuinely free tenants stay free (clientResolved=${String(clientResolved)})`,
  );
}

// ── A client `true` TIGHTENS (record overridden INTO a schedule view) ───────
for (const module of ["PMM", "OPM", "LEM", "COM", null, undefined]) {
  assert.equal(
    resolveScheduleWindowEnforced(true, module, {
      projectDisplayMode: "no-schedule",
      oppDisplayMode: "no-schedule",
    }),
    true,
    `a record overridden INTO a schedule view enforces even on a no-schedule tenant (module=${String(module)})`,
  );
}

// ── Module-aware server-derived fallback ────────────────────────────────────
for (const module of ["PMM", "COM", "", null, undefined]) {
  assert.equal(
    resolveScheduleWindowEnforced(undefined, module, {
      projectDisplayMode: "full",
      oppDisplayMode: "no-schedule",
    }),
    true,
    `project rule enforces on a "full" project tenant regardless of the opp mode (module=${String(module)})`,
  );
  assert.equal(
    resolveScheduleWindowEnforced(undefined, module, {
      projectDisplayMode: "schedule-no-grid",
      oppDisplayMode: "no-schedule",
    }),
    true,
    `schedule-no-grid is a schedule-FOLLOWING mode — the old "full"-only client fallback missed it (module=${String(module)})`,
  );
  assert.equal(
    resolveScheduleWindowEnforced(undefined, module, {
      projectDisplayMode: "no-schedule",
      oppDisplayMode: "full",
    }),
    false,
    `no-schedule project tenants stay free even when opps follow a schedule (module=${String(module)})`,
  );
}
for (const module of ["OPM", "LEM"]) {
  assert.equal(
    resolveScheduleWindowEnforced(undefined, module, {
      projectDisplayMode: "no-schedule",
      oppDisplayMode: "full",
    }),
    true,
    `${module} follows the opp display mode, not the project mode`,
  );
  assert.equal(
    resolveScheduleWindowEnforced(undefined, module, {
      projectDisplayMode: "full",
      oppDisplayMode: "no-schedule-no-grid",
    }),
    false,
    `${module} stays free on no-schedule opp tenants even when projects enforce`,
  );
}

// ── Composition failure policy (injected fakes) ─────────────────────────────
assert.equal(
  await enforcedForRecordSave({
    clientResolved: undefined,
    ensureCustomTickets: async () => { throw new Error("cache read down"); },
    resolveModule: () => "OPM",
    loadRules: async () => ({ projectDisplayMode: "full", oppDisplayMode: "no-schedule" }),
  }),
  true,
  "custom-ticket ensure failure must fail CLOSED",
);
assert.equal(
  await enforcedForRecordSave({
    clientResolved: false,
    ensureCustomTickets: async () => {},
    resolveModule: () => "PMM",
    loadRules: async () => { throw new Error("settings store down"); },
  }),
  true,
  "settings-read failure must fail CLOSED even when the client said false",
);
{
  let lookups = 0;
  assert.equal(
    await enforcedForRecordSave({
      clientResolved: true,
      ensureCustomTickets: async () => { lookups += 1; },
      resolveModule: () => "OPM",
      loadRules: async () => { lookups += 1; return {}; },
    }),
    true,
    "client true tightens unconditionally",
  );
  assert.equal(lookups, 0, "client true must not trigger lookups");
}

// ── PRODUCTION ADAPTERS: real rds-provider against the fake mssql driver ────
// The fourth review found the previous fake-based ordering tests vacuous
// against two real behaviors: (1) the read-path ensure CATCHES load failures
// internally, so the composition's fail-closed catch never fired; (2) its
// global 5s force-throttle skips the refresh for a SECOND unknown custom id,
// which then resolves as PMM. These tests drive the exported provider
// functions themselves through both windows.
const rds = await import("../rds-provider.js");
const TID = "tenant-guid-840";
let customRows: Record<string, unknown>[] = [];
let failLoads = false;
const isCustomLoad = (q: FakeQuery) =>
  q.text.includes("core2.dbo.Opportunity") && q.text.includes("UNION ALL");
addResponder((q) => {
  if (!isCustomLoad(q)) return undefined;
  if (failLoads) throw new Error("simulated custom-ticket load failure");
  return { recordset: customRows };
});
const loadCount = () => countQueries(isCustomLoad);

// Baseline: cold cache loads (empty), unknown non-prefixed ids default PMM.
await rds.ensureCustomOppTickets(TID);
assert.equal(loadCount(), 1, "cold read-path ensure runs the load");
assert.equal(rds.resolveTicketMod("CUST-A", TID), "PMM", "empty cache defaults to PMM");

// First unknown id consumes the read path's forced-refresh budget.
customRows = [{ TenantID: TID, TicketId: "cust-a", Mod: "OPM" }];
await rds.ensureCustomOppTickets(TID, "CUST-A");
assert.equal(loadCount(), 2, "first unknown custom id forces a refresh");
assert.equal(rds.resolveTicketMod("CUST-A", TID), "OPM", "forced refresh learned the custom opp id");

// Second unknown id INSIDE the 5s throttle: the read path skips the refresh
// and the resolver mis-answers PMM — the exact production window the review
// called out. (This pins the read-path behavior the gate must not trust.)
customRows = [
  { TenantID: TID, TicketId: "cust-a", Mod: "OPM" },
  { TenantID: TID, TicketId: "cust-b", Mod: "LEM" },
];
await rds.ensureCustomOppTickets(TID, "CUST-B");
assert.equal(loadCount(), 2, "read-path ensure throttles the second forced refresh");
assert.equal(rds.resolveTicketMod("CUST-B", TID), "PMM", "throttled read path leaves the second id mis-routed to PMM");

// The trusted SAVE-path ensure ignores that throttle: the same id gets a real
// load and resolves to its true module.
assert.equal(await rds.ensureCustomTicketsTrusted(TID, "CUST-B"), true, "trusted ensure bypasses the force-throttle");
assert.equal(loadCount(), 3, "trusted ensure ran its own load despite the throttle");
assert.equal(rds.resolveTicketMod("CUST-B", TID), "LEM", "trusted ensure learned the custom lead id");

// Full gate composition wired EXACTLY like scheduleWindowEnforced in the
// provider, under divergent tenant modes.
const gateFor = (id: string, rules: Record<string, string>, clientResolved?: boolean) =>
  enforcedForRecordSave({
    clientResolved,
    ensureCustomTickets: async () => {
      if (!(await rds.ensureCustomTicketsTrusted(TID, id))) {
        throw new Error("custom-ticket resolution unavailable");
      }
    },
    resolveModule: () => rds.resolveTicketMod(id, TID),
    loadRules: async () => rules,
  });
assert.equal(
  await gateFor("CUST-B", { projectDisplayMode: "full", oppDisplayMode: "no-schedule" }),
  false,
  "custom LEAD id on a free opp tenant stays free even while projects enforce (PMM mis-route would wrongly reject)",
);
assert.equal(
  await gateFor("CUST-B", { projectDisplayMode: "no-schedule", oppDisplayMode: "schedule-no-grid" }),
  true,
  "custom LEAD id on an enforcing opp tenant enforces (PMM mis-route would open the bypass)",
);
assert.equal(
  await gateFor("CUST-A", { projectDisplayMode: "no-schedule", oppDisplayMode: "schedule-no-grid" }, false),
  true,
  "client false cannot loosen a custom OPP record on an enforcing opp tenant",
);

// Load FAILURE: the read path would swallow it; the trusted ensure reports it
// and the gate fails CLOSED — even on a tenant whose modes are all free, and
// even when the client said false.
failLoads = true;
assert.equal(await rds.ensureCustomTicketsTrusted(TID, "CUST-C"), false, "failed load = untrustworthy resolution");
assert.equal(loadCount(), 4, "the failed lookup really attempted a load");
assert.equal(
  await gateFor("CUST-C", { projectDisplayMode: "no-schedule", oppDisplayMode: "no-schedule" }),
  true,
  "gate fails CLOSED when the custom-ticket load fails",
);
assert.equal(
  await gateFor("CUST-C", { projectDisplayMode: "no-schedule", oppDisplayMode: "no-schedule" }, false),
  true,
  "client false cannot reopen a fail-closed resolution",
);
failLoads = false;

// True negative: a genuinely custom PROJECT id (absent after a successful
// fresh load) keeps the project rule — fail-closed must not over-enforce.
assert.equal(await rds.ensureCustomTicketsTrusted(TID, "CUST-D"), true, "successful own load + absence = trustworthy PMM");
assert.equal(rds.resolveTicketMod("CUST-D", TID), "PMM");
assert.equal(
  await gateFor("CUST-D", { projectDisplayMode: "no-schedule", oppDisplayMode: "full" }),
  false,
  "trustworthy custom PROJECT id follows the free project rule",
);
// Standard prefixes never need the cache at all.
assert.equal(await rds.ensureCustomTicketsTrusted(TID, "PMM-26-001"), true);
assert.equal(await rds.ensureCustomTicketsTrusted(TID, "OPM-26-001"), true);

// ── Wiring: the tighten-only invariant holds at every hop ───────────────────
const ruleSource = readFileSync(
  new URL("../schedule-window-rule.js", import.meta.url).pathname.replace(/\.js$/, ".ts"),
  "utf8",
);
assert.ok(
  ruleSource.includes("serverResolved || clientResolved === true"),
  "the shared rule must be structurally unable to loosen: server answer OR an explicit client true",
);
assert.ok(
  ruleSource.includes("if (deps.clientResolved === true) return true;"),
  "only an explicit client TRUE may short-circuit the composition",
);
assert.ok(
  ruleSource.indexOf("await deps.ensureCustomTickets();") <
    ruleSource.indexOf("deps.resolveModule()"),
  "the composition must ensure the custom-ticket cache BEFORE resolving the module",
);
assert.ok(
  /catch\s*\{\s*\n?\s*return true;/.test(ruleSource),
  "lookup failures must fail CLOSED (enforce), never silently open the window",
);

const providerSource = readFileSync(
  new URL("../rds-provider.ts", import.meta.url),
  "utf8",
);
const gateAt = providerSource.indexOf("async function scheduleWindowEnforced");
assert.ok(gateAt >= 0, "rds-provider must keep the scheduleWindowEnforced gate");
const gateBody = providerSource.slice(gateAt, providerSource.indexOf("\n}", gateAt));
assert.ok(
  gateBody.includes("enforcedForRecordSave({"),
  "the gate must delegate to the shared composition — no provider-local fork of the trust model",
);
assert.ok(
  gateBody.includes("ensureCustomTicketsTrusted(tid, recordId)"),
  "the gate must use the TRUSTED save-path ensure, not the failure-swallowing read-path ensure",
);
assert.ok(
  gateBody.includes("resolveTicketMod(recordId, tid)"),
  "the gate must wire the real module resolver",
);
assert.ok(
  gateBody.includes("getBusinessRulesForTenant(tenantLabel)"),
  "the gate must read tenant rules from the trusted settings store",
);
assert.ok(
  !gateBody.includes("return clientResolved"),
  "the gate must never trust a client boolean as-is — a request false would disable server validation",
);

// assignResourceRds — the single write path behind BOTH /assign-resource and
// /change-team-resource — must consult the gate BEFORE opening a transaction.
const assignAt = providerSource.indexOf("export async function assignResourceRds");
assert.ok(assignAt >= 0, "assignResourceRds must exist");
const assignGateAt = providerSource.indexOf(
  "scheduleWindowEnforced(tenantLabel, projectId, tid, opts?.scheduleWindowEnabled)",
  assignAt,
);
const assignTxBeginAt = providerSource.indexOf(".begin()", assignAt);
assert.ok(
  assignGateAt > assignAt,
  "assignResourceRds must thread the client flag (opts.scheduleWindowEnabled) into the gate",
);
assert.ok(
  assignTxBeginAt === -1 || assignGateAt < assignTxBeginAt,
  "the schedule-window gate must reject before the write transaction begins",
);

const routesSource = readFileSync(
  new URL("../../routes/rmone-proxy.ts", import.meta.url),
  "utf8",
);
const flagReads = routesSource.split("ScheduleWindowEnabled?: boolean").length - 1;
assert.ok(
  flagReads >= 2,
  `/assign-resource and /change-team-resource must both accept the ScheduleWindowEnabled flag (found ${flagReads})`,
);
const flagThreads = routesSource.split(
  'scheduleWindowEnabled: typeof payload.ScheduleWindowEnabled === "boolean" ? payload.ScheduleWindowEnabled : undefined',
).length - 1 + routesSource.split(
  'scheduleWindowEnabled: typeof body.ScheduleWindowEnabled === "boolean" ? body.ScheduleWindowEnabled : undefined',
).length - 1;
assert.equal(
  flagThreads,
  2,
  "both routes must thread the flag verbatim into assignResourceRds opts — the tighten-only gate is the ONLY consumer, so no route can honor a loosening false",
);

console.log("scheduleWindowRule.test.ts passed");
process.exit(0);
