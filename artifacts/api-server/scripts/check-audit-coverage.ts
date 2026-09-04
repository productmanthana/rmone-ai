import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import {
  auditOutcomeForResponse,
  boundedAuditChanges,
  countAuditEventsByTenant,
  isReadShapedPost,
  parseAuditInteraction,
  READ_SHAPED_POST_PATHS,
  sanitizeAuditValue,
  trustedAuditDiff,
} from "../src/lib/auditTrail.js";

const read = (path: string) => readFileSync(new URL(path, import.meta.url), "utf8");
const app = read("../src/app.ts");
const routeDir = new URL("../src/routes/", import.meta.url);
const routeSources = readdirSync(routeDir)
  .filter((name) => name.endsWith(".ts"))
  .map((name) => ({ name, source: read(`../src/routes/${name}`) }));
const audit = read("../src/lib/auditTrail.ts");
const trustProxy = read("../src/lib/trust-proxy.ts");
const provider = read("../src/lib/rds-provider.ts");

const onboarding = routeSources.find(({ name }) => name === "onboarding.ts")?.source ?? "";
const chat = routeSources.find(({ name }) => name === "chat.ts")?.source ?? "";

const decision = routeSources.find(({ name }) => name === "decision.ts")?.source ?? "";
const dbStore = read("../../../lib/db/src/index.ts");
const webCard = read("../../rmone-web/src/components/AuditTrailCard.tsx");
const quickActions = read("../../rmone-web/src/pages/quick-actions.tsx");
const mobileProject = read("../../rmone-mobile/app/project/[id].tsx");
const mobileApi = read("../../rmone-mobile/lib/api.ts");
const mobileLayout = read("../../rmone-mobile/app/_layout.tsx");
const mobileAlerts = read("../../rmone-mobile/app/(tabs)/alerts.tsx");
const mobileResources = read("../../rmone-mobile/app/(tabs)/resources.tsx");
const mobileChat = read("../../rmone-mobile/app/(tabs)/chat.tsx");
const mobileBriefing = read("../../rmone-mobile/app/daily-briefing.tsx");
const mobileSources = [
  mobileProject,
  mobileAlerts,
  mobileResources,
  mobileChat,
  mobileBriefing,
  mobileLayout,
];

// All API routers are mounted only after the observer. New authenticated write
// routes are therefore audited by construction; recursive/token routes are the
// only explicit exemptions in auditTrailObserver.
assert.ok(app.indexOf('app.use("/api", auditTrailObserver)') >= 0, "global API audit observer is missing");
assert.ok(app.indexOf('app.use("/api", auditTrailObserver)') < app.indexOf('app.use("/api", router)'), "audit observer must run before routes");
assert.ok(app.indexOf('app.use("/api", auditTrailObserver)') < app.indexOf('app.use("/api", rateLimit'), "audit observer must capture rate-limited mutations");
assert.ok(app.indexOf('app.use("/api", auditTrailObserver)') < app.indexOf('app.use(express.json'), "audit observer must capture parser-rejected mutations");
assert.match(app, /applyTrustProxy\(app\)/, "global app must configure trusted proxies before audit and rate-limit middleware");
assert.match(
  trustProxy,
  /if \(!process\.env\["ENV_NAME"\]\)[\s\S]*?app\.set\("trust proxy",\s*1\)/,
  "workspace/hosted traffic must trust exactly the local proxy hop",
);
assert.match(
  trustProxy,
  /app\.set\("trust proxy",\s*trustList\(CLOUDFRONT_ORIGIN_FACING_SNAPSHOT\)\)/,
  "Elastic Beanstalk must use the proxy address allowlist so audit IPs cannot be spoofed through a fixed hop count",
);
assert.match(audit, /res\.once\("finish"/, "audit outcomes must be recorded only after the response result is known");
assert.match(audit, /rmone_audit_outbox/, "failed audit events must enter the durable retry outbox");
assert.match(audit, /path\.endsWith\("\/audit-trail"\).*path\.endsWith\("\/token"\)/s, "recursive and token exemptions must remain explicit");
assert.match(audit, /path\.endsWith\("\/audit-interaction"\)/, "interaction endpoint must use a value-free audit target");
assert.match(audit, /eventKind\?: AuditTrailEventKind/, "audit reads must support interaction/change filtering");

// Read-shaped POSTs (page-load data fetches, telemetry beacons) must never be
// recorded as edits — they produced false "Edited project" rows on page loads.
assert.ok(READ_SHAPED_POST_PATHS.includes("/project-allocations"), "weekly-allocation page-load fetch must stay skip-listed");
assert.ok(READ_SHAPED_POST_PATHS.includes("/usage-beacon"), "telemetry beacon must stay skip-listed");
assert.equal(isReadShapedPost("/api/rmone/project-allocations"), true, "skip must match by suffix regardless of mount prefix");
assert.equal(isReadShapedPost("/api/rmone/update-fields"), false, "real edits must never be skip-listed");
assert.match(audit, /isWrite && isReadShapedPost\(path\)/, "observer must skip read-shaped POSTs");
assert.match(audit, /'\/project-allocations', '\/rmone\/project-allocations', '\/usage-beacon', '\/rmone\/usage-beacon'/, "trail reads must exclude legacy read-shaped POST noise rows for both mounted and unmounted paths");
assert.match(audit, /if \(!isWrite \|\| path\.endsWith\("\/audit-trail"\)/, "observer must not infer audit actions from record-detail GETs");
assert.match(audit, /\[Action\] NOT LIKE 'view\.%'/, "trail reads must hide historical inferred record views");
// The canonical record writer captures before/after row images by locking the
// pre-image (UPDLOCK/HOLDLOCK read), updating, then re-reading the final row
// inside ONE transaction. This intentionally replaced UPDATE OUTPUT capture:
// OUTPUT inserted.* surfaces values BEFORE AFTER-triggers run, so it is not a
// sufficient final persisted snapshot.
assert.match(
  provider,
  /BEGIN TRAN;[\s\S]*?SELECT \$\{auditSelect\} FROM core2\.dbo\.\$\{bracket\(table\)\} WITH \(UPDLOCK, HOLDLOCK\)[\s\S]*?UPDATE core2\.dbo\.\$\{bracket\(table\)\} SET \$\{sets\.join\(", "\)\}[\s\S]*?SELECT \$\{auditSelect\} FROM core2\.dbo\.\$\{bracket\(table\)\}[\s\S]*?COMMIT;/,
  "record edits must capture exact before/after row images via locked pre-image read → UPDATE → post-image re-read in one transaction",
);
assert.match(provider, /divisionmultilookup[\s\S]*Supporting Business Units/, "record-edit audit must resolve division lookup IDs to readable labels");
assert.match(provider, /departmentlookup\|departmentid[\s\S]*JobTitle[\s\S]*Roles/, "record-edit audit must resolve department, title, and role lookup IDs to readable labels");
// The assignment-edit writer must, IN ORDER: lock the parent RWI row first,
// then its allocation rows (deadlock doctrine — saveWeeklyHoursRds takes the
// same parent-then-child order), update, re-read persisted state through the
// same snapshot reader, diff via trustedAuditDiff, and return the rows as
// auditChanges. Scoped to the function so deleting ANY link in the chain (not
// just the before-read) fails this check.
{
  const assignSrc = provider.slice(provider.indexOf("export async function assignResourceRds"));
  assert.ok(assignSrc.length > 1000, "assignResourceRds must exist in the provider");
  assert.match(
    assignSrc,
    /FROM core2\.dbo\.ResourceWorkItems rwi WITH \(UPDLOCK, HOLDLOCK\)[\s\S]*?WHERE rwi\.ID = @rwi AND rwi\.TenantID = @tid\s+AND \(rwi\.Deleted = 0 OR rwi\.Deleted IS NULL\)[\s\S]*?FROM core2\.dbo\.ResourceAllocation ra WITH \(UPDLOCK, HOLDLOCK\)[\s\S]*?readAssignmentAuditState[\s\S]*?UPDATE core2\.dbo\.ResourceWorkItems[\s\S]*?await readAssignmentAuditState\(\)[\s\S]*?trustedAuditDiff\([\s\S]*?auditChanges: collectedAuditChanges/,
    "assignment edits must lock parent RWI before allocation rows, re-read persisted state after the update, and return trusted audit diffs",
  );
  const weeklySrc = provider.slice(provider.indexOf("export async function saveWeeklyHoursRds"));
  assert.ok(weeklySrc.length > 1000, "saveWeeklyHoursRds must exist in the provider");
  assert.match(
    weeklySrc,
    /FROM core2\.dbo\.ResourceWorkItems WITH \(UPDLOCK, HOLDLOCK\)\s+WHERE TenantID = @tid AND \(ID = @rwi OR \(ResourceUser = @p AND WorkItem = @pid\)\)[\s\S]{0,3000}?const auditBeforeReq/,
    "weekly-hours saves must lock the parent RWI identities before taking allocation-row locks (parent-then-child doctrine)",
  );
}
assert.doesNotMatch(
  provider.match(/async function maxMemberEndRds[\s\S]*?\n\}/)?.[0] ?? "",
  /UPDLOCK|HOLDLOCK/,
  "read-only max-member-end query must not take assignment audit update locks",
);
// The durable outbox shares the audit database, so a DB-side incident breaks
// both at once: the in-memory last-resort queue must hold events for retry.
assert.match(audit, /stashAuditEventsInMemory\(events\.map\(normalizedAuditEvent\)\)/, "outbox failures must keep events in the memory retry queue");
assert.match(audit, /memoryPendingEvents\.splice/, "outbox drain must flush the memory retry queue");
assert.match(audit, /rmone_audit_health[\s\S]*?\n\s*END\n\s*`\);/, "audit health table must be ensured eagerly, not only during a failure flush");
const proxy = routeSources.find(({ name }) => name === "rmone-proxy.ts")?.source ?? "";
assert.match(proxy, /router\.post\("\/audit-interaction"/, "authenticated interaction endpoint is missing");
assert.match(proxy, /parseAuditInteraction\(req\.body\)/, "interaction endpoint must validate semantic fields");
assert.doesNotMatch(proxy.match(/router\.post\("\/audit-interaction"[\s\S]*?\n\}\);/)?.[0] ?? "", /recordAuditEvent/, "interaction endpoint must be captured only by the observer");

const mutationRoutes = routeSources.flatMap(({ name, source }) =>
  [...source.matchAll(/\b(?:router|app)\.(post|put|patch|delete)\(\s*["'`]([^"'`]+)/g)]
    .map((match) => ({ file: name, method: match[1], path: match[2] })),
);
assert.ok(mutationRoutes.length > 150, `unexpectedly found only ${mutationRoutes.length} API mutation routes`);
for (const { method, path, file } of mutationRoutes) {
  assert.notEqual(path, "/audit-trail", `${method.toUpperCase()} ${path} would recursively audit the ledger`);
  assert.ok(file !== "index.ts" || path !== "/token", "token mutation must remain in the explicitly exempt observer path");
}

// Privacy regression: key-based and field-diff-shaped secrets are both hidden.
assert.deepEqual(
  sanitizeAuditValue({ password: "hunter2", nested: { Authorization: "Bearer abc", safe: "yes" } }),
  { password: "[redacted]", nested: { Authorization: "[redacted]", safe: "yes" } },
);
assert.deepEqual(
  trustedAuditDiff(
    { Status: "Draft", Unchanged: 1 },
    { Status: "Active", Unchanged: 1 },
    { fields: ["Status", "Unchanged"] },
  ),
  [{ FieldName: "Status", OldValue: "Draft", NewValue: "Active" }],
  "trusted snapshots must omit unchanged values",
);

const bounded = boundedAuditChanges(
  Array.from({ length: 4 }, (_, i) => ({ FieldName: `Row ${i}`, OldValue: i, NewValue: i + 1 })),
  10,
  2,
);
assert.equal(bounded.length, 3);
assert.match(String(bounded[2]?.NewValue), /10 total changes; 8 not shown/, "bounded bulk diffs must disclose complete total and omissions");
assert.match(audit, /res\.locals\["auditOutcome"\]/, "streaming and multi-action routes must be able to report trusted partial/failed outcomes");
assert.doesNotMatch(audit, /changes:\s*fields\s*\?\?\s*safeBody/, "request body values must never be presented as committed audit state");
assert.match(audit, /changes: isWrite \? res\.locals\["auditChanges"\] : undefined/, "write values must come only from a trusted route handoff");
assert.match(provider, /OUTPUT \$\{outputCols\.join\(", "\)\}/, "allocation flag writes must capture SQL deleted/inserted values");
assert.match(provider, /SQL Server's OUTPUT inserted values are[\s\S]*WITH \(UPDLOCK, HOLDLOCK\)[\s\S]*UPDATE core2\.dbo\.\$\{bracket\(table\)\}[\s\S]*SELECT \$\{auditSelect\}/, "record edits must lock the pre-image and read final post-trigger state inside one transaction");
assert.match(provider, /derivedAuditCols[\s\S]*StatusManualDate[\s\S]*AwardedorLossDate/, "record audit snapshots must include system-derived status columns");
assert.match(provider, /skipAuditChanges\.push\(\.\.\.\(up\.auditChanges \?\? \[\]\)\)/, "automatic skip-stage writes must merge their trusted diffs");
assert.match(provider, /auditBeforeReq[\s\S]*WITH \(UPDLOCK, HOLDLOCK\)[\s\S]*auditAfterReq[\s\S]*weeklyAuditChanges/, "weekly-hours audits must use provider-owned transaction snapshots");
assert.match(proxy, /saveWeeklyHoursRds[\s\S]*handoffTrustedAuditChanges\(res, result\)/, "weekly-hours route must hand off provider-produced trusted diffs");
assert.doesNotMatch(proxy, /setTrustedAuditChanges\(res, \[[\s\S]{0,500}hoursBeforeTelemetry/, "telemetry pre-reads must never be repurposed as audit before-state");
assert.match(dbStore, /updateUserWithSnapshots[\s\S]*UPDLOCK, HOLDLOCK[\s\S]*UPDATE dbo\.rmone_users[\s\S]*SELECT TOP 1 \* FROM dbo\.rmone_users/, "staff audit snapshots must lock, update, and read back inside one transaction");
assert.match(provider, /updateStaffAssignmentRds[\s\S]*updateUserWithSnapshots/, "staff assignment writes must use the atomic snapshot primitive");
assert.match(provider, /updateStaffExtraRds[\s\S]*updateUserWithSnapshots/, "staff profile writes must use the atomic snapshot primitive");
assert.match(provider, /boundedAuditChanges\(\[[\s\S]*Allocation save coverage[\s\S]*weeklyAuditChanges/, "weekly allocation bulk audit must disclose complete counts with bounded member detail");
for (const route of ["/schedule", "/allocation-lock", "/allocation-flag", "/delete-record", "/restore-record"]) {
  const block = proxy.match(new RegExp(`router\\.(?:post|put|delete)\\(\\"${route.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\"[\\s\\S]*?\\n\\}\\);`))?.[0] ?? "";
  assert.match(block, /handoffTrustedAuditChanges|setTrustedAuditChanges/, `${route} must hand authoritative changes to the observer`);
}
assert.match(proxy, /createScheduleRds\(rds\.tid, newTicketId[\s\S]*handoffTrustedAuditChanges\(res, schedule\)/, "new-record auto-schedules must merge trusted schedule diffs");
assert.match(proxy, /autoLifecycleFailure[\s\S]*res\.locals\["auditOutcome"\] = "partial"/, "record create plus schedule failure must be audited as partial");
assert.match(onboarding, /upsertSettingsWithAudit\(res/, "settings and access-control documents must use pre/post database snapshots");
assert.match(dbStore, /upsertOnboardingSettingsWithSnapshots[\s\S]*UPDLOCK, HOLDLOCK/, "settings audit snapshots must be captured under one database lock");
assert.match(dbStore, /updateUserOfficesWithSnapshots[\s\S]*UPDLOCK, HOLDLOCK[\s\S]*UPDATE dbo\.rmone_users[\s\S]*SELECT id, office/, "bulk office assignments must lock, update, and read final staff state in one transaction");
assert.match(onboarding, /writeOfficeDoc[\s\S]*upsertOnboardingSettingsWithSnapshots/, "office-list writes must use atomic settings snapshots");
assert.match(onboarding, /updateUserOfficesWithSnapshots[\s\S]*updated: staffSnapshots\.length/, "office assignment response counts must come from transaction snapshots");
assert.match(onboarding, /staffSnapshots\.length[\s\S]*auditOutcome"\] = "partial"/, "office assignment races must report a partial audit outcome");
assert.match(provider, /FROM core2\.dbo\.\$\{bracket\(taskTable\)\} WITH \(UPDLOCK, HOLDLOCK\)/, "schedule before-state must be locked against concurrent replacement");
assert.match(provider, /afterLifecycle[\s\S]*await tx\.commit\(\)/, "schedule after-state must be selected before commit");
assert.match(provider, /persistedStages[\s\S]*await tx\.commit\(\)/, "lifecycle after-state must be selected before commit");
assert.match(provider, /createLifecycleRds[\s\S]*auditStageTid[\s\S]*finalStages[\s\S]*await tx\.commit\(\)/, "created lifecycle phases must come from a persisted transaction readback");
assert.match(provider, /@recordState TABLE \(oldDeleted BIT, newDeleted BIT\)[\s\S]*OUTPUT deleted\.\[Deleted\], inserted\.\[Deleted\]/, "delete and restore state changes must come from SQL OUTPUT");
assert.doesNotMatch(provider, /FieldName: "Schedule restored"/, "restore audit must not claim hard-deleted schedule rows were restored");
assert.match(chat, /const auditChanges = result\.auditChanges \?\? \[\]/, "chat field edits must report provider-verified values");
assert.match(chat, /auditChanges: _auditOnly[\s\S]*JSON\.stringify\(llmToolResult\)/, "audit-only snapshots must be stripped before chat tool results reach the model");
assert.doesNotMatch(chat, /auditChanges\.map\([\s\S]{0,300}OldValue/, "chat confirmations must not render raw audit values into SSE");
assert.match(chat, /res\.locals\["auditOutcome"\].*partial/s, "mixed chat tool outcomes must remain partial rather than successful");
assert.match(chat, /req\.once\("aborted"[\s\S]*"cancelled"/, "aborted chat streams must be audited as cancelled");
assert.match(chat, /catch \(err\) \{\s*res\.locals\["auditOutcome"\] = "failed"/, "chat stream failures must override HTTP 200 outcome inference");
assert.match(decision, /updateRecordFieldsRds[\s\S]*handoffTrustedAuditChanges\(res, up\)/, "decision-support record edits must hand trusted provider diffs to the observer");

// PII: candidate outreach must never persist recipient names/emails in audit rows.
assert.doesNotMatch(decision, /FieldName: `Candidate \$\{/, "engage-candidates must not audit per-candidate identities (third-party PII) — aggregate only");
assert.match(decision, /Candidates engaged/, "engage-candidates must audit the aggregate sent count");

// job-title-cost-rate is a FINANCIAL write: capability gate + VarChar tenant binding.
assert.match(proxy, /job-title-cost-rate[\s\S]{0,900}?blockIfFinancialRestricted/, "job-title-cost-rate must require the financial-edit capability");
assert.match(proxy, /job-title-cost-rate[\s\S]{0,1600}?\.input\("tid", msql\.VarChar, rds\.tid\)/, "job-title-cost-rate tenant param must be VarChar (NVarChar converts the column)");
const secretField = sanitizeAuditValue({ FieldName: "ApiToken", OldValue: "old", NewValue: "new" }) as Record<string, unknown>;
assert.equal(secretField.Value, "[redacted]");
assert.equal("OldValue" in secretField, false);
assert.equal("NewValue" in secretField, false);
const piiField = sanitizeAuditValue({ FieldName: "BankAccountNumber", OldValue: "111", NewValue: "222" }) as Record<string, unknown>;
assert.equal(piiField.Value, "[redacted]");
assert.deepEqual(
  parseAuditInteraction({ interactionType: "view", entityType: "project", entityId: "PMM-123" }),
  { interactionType: "view", entityType: "project", entityId: "PMM-123" },
);
assert.equal(parseAuditInteraction({ interactionType: "search", query: "private search text" }), null);
assert.equal(parseAuditInteraction({ interactionType: "view", entityType: "project", entityId: "unsafe value" }), null);
assert.deepEqual(
  parseAuditInteraction({ interactionType: "action", screen: "chat" }),
  { interactionType: "action", entityType: "dashboard", entityId: "chat" },
);
assert.equal(auditOutcomeForResponse(200, { ok: false }), "failed");
assert.equal(auditOutcomeForResponse(207, { ok: true }), "partial");
assert.equal(auditOutcomeForResponse(403, { error: "denied" }), "denied");
assert.deepEqual(
  [...countAuditEventsByTenant([
    { tenantId: "tenant-a", action: "test", outcome: "failed" },
    { tenantId: "tenant-b", action: "test", outcome: "failed" },
    { tenantId: "tenant-a", action: "test", outcome: "failed" },
  ])],
  [["tenant-a", 2], ["tenant-b", 1]],
  "mixed-tenant batch failures must be attributed independently",
);

assert.match(webCard, /UTC:/, "web audit detail must disclose the precise UTC timestamp");
assert.match(webCard, /Filter audit outcome/, "web audit card must expose filters");
assert.match(quickActions, /subjectId=\{staffGuid\}/, "Quick Actions staff results must expose subject-mode audit history (by and about the person)");
assert.match(webCard, /subjectId/, "web audit card must support subject mode");
assert.match(audit, /subjectClauses\.push\("\(a\.\[EntityType\] IN \('staff', 'resource'\) AND a\.\[EntityID\] = @subjectId\)"\)/, "subject mode must match events AFFECTING the person's staff record, not only their own actions");
assert.match(quickActions, /entityType="company"/, "Quick Actions company results must expose record audit history");
assert.match(mobileProject, /<MobileAuditTrail/, "mobile record detail must expose the shared audit trail");
assert.match(mobileProject, /UTC \{item\.createdAt\}/, "mobile audit rows must disclose UTC");
assert.match(mobileApi, /export const auditOpen/, "mobile audit helper must expose semantic open events");
assert.match(mobileApi, /export const auditClose/, "mobile audit helper must expose semantic close events");
assert.match(mobileApi, /export const auditFilter/, "mobile audit helper must expose semantic filter events");
assert.match(mobileApi, /export const auditSearch/, "mobile audit helper must expose semantic search events");
assert.match(mobileApi, /export const auditExport/, "mobile audit helper must expose semantic export events");
assert.match(mobileApi, /export const auditAction/, "mobile audit helper must expose semantic action events");
assert.match(mobileApi, /catch \{\s*\/\/ Deliberately fire-and-forget/s, "mobile audit events must never block user actions");
assert.match(mobileApi, /const body = "screen" in target/, "mobile audit request bodies must be rebuilt from allowlisted fields");
for (const source of mobileSources) {
  for (const call of source.matchAll(/\baudit(?:View|Open|Close|Filter|Search|Export|Action)\(([^)]]*)\)/g)) {
    assert.doesNotMatch(
      call[1],
      /\.\.\.|\b(?:query|label|value|text|name|email|phone|metadata)\b/i,
      `mobile audit call must remain value-free: ${call[0]}`,
    );
  }
}
assert.match(mobileLayout, /auditView\(screen\)/, "mobile route views must use the shared audit wrapper");
assert.match(mobileAlerts, /const handleRisk[\s\S]{0,220}auditOpen\(/, "mobile alert row opens must be audited");
assert.match(mobileAlerts, /onPress=\{\(\) => \{\s*auditFilter\([\s\S]{0,120}setFilter\(/, "mobile alert filters must be audited at the control");
assert.match(mobileResources, /value=\{search\}[\s\S]{0,180}onSubmitEditing=\{\(\) => auditSearch\(/, "mobile staff search submissions must be audited");
assert.match(mobileResources, /value=\{utilSearch\}[\s\S]{0,180}onSubmitEditing=\{\(\) => auditSearch\(/, "mobile utilization search submissions must be audited");
assert.match(mobileResources, /value=\{contactsSearch\}[\s\S]{0,350}onSubmitEditing=\{\(\) => auditSearch\(/, "mobile contact search submissions must be audited");
assert.match(mobileResources, /value=\{demandSearch\}[\s\S]{0,180}onSubmitEditing=\{\(\) => auditSearch\(/, "mobile demand search submissions must be audited");
assert.match(mobileResources, /auditFilter\(\{ screen: "resources" \}\);\s*setUtilFilters/, "mobile utilization filter changes must be audited");
assert.match(mobileResources, /function openAnalysis[\s\S]{0,160}auditOpen\(/, "mobile utilization analyses must be audited");
assert.match(mobileResources, /function openCellModal[\s\S]{0,160}auditOpen\(/, "mobile utilization cell drill-downs must be audited");
assert.match(mobileResources, /function modalToChat[\s\S]{0,160}auditAction\(/, "mobile resource-to-chat actions must be audited");
assert.match(mobileChat, /const doSend[\s\S]{0,180}auditAction\(/, "mobile chat sends must be audited");
assert.match(mobileChat, /auditAction\(\{ screen: "chat" \}\);\s*processPrompt\(q\.text, "quick-prompt"\)/, "mobile Quick Actions must be audited");
assert.match(mobileBriefing, /const openDetail[\s\S]{0,180}auditOpen\(/, "mobile daily briefing drill-downs must be audited");
assert.match(mobileBriefing, /const handleResolveAi[\s\S]{0,180}auditAction\(/, "mobile daily briefing resolve actions must be audited");
assert.match(mobileProject, /const askAI[\s\S]{0,180}auditAction\(/, "mobile project AI actions must be audited");
assert.match(mobileProject, /onAssigned=\{async \(name, resourceId\) => \{\s*auditAction\(/, "mobile project assignment actions must be audited after success");
assert.match(mobileProject, /onPress=\{\(\) => \{ auditAction\(\{ screen: "project-detail" \}\); onSelect\(/, "mobile lifecycle selection must be audited");
assert.match(mobileProject, /await createSchedule\(\{[\s\S]{0,700}auditAction\(\{ entityType: "project", entityId: ticketId \}\)/, "mobile lifecycle assignment must be audited after success");
assert.match(mobileProject, /Tasks: built,[\s\S]{0,120}\}\);\s*auditAction\(\{ entityType: "project", entityId: ticketId \}\)/, "mobile schedule task saves must be audited after success");
assert.match(mobileProject, /const startEditDates[\s\S]{0,160}auditOpen\(/, "mobile project date editor opens must be audited");
assert.match(mobileProject, /Tasks: currentTasks,[\s\S]{0,120}\}\);\s*auditAction\(\{ entityType: "project", entityId: ticketId \}\)/, "mobile project date saves must be audited after success");

// ---------------------------------------------------------------------------
// Explicit business targets, subject-mode reads, and entity-family expansion
// (write-API-level audit coverage, 2026-08).
// ---------------------------------------------------------------------------
assert.match(audit, /export function setAuditTarget/, "routes must be able to declare their real business target");
assert.match(audit, /const explicit = res\.locals\["auditTarget"\] as AuditTargetOverride \| undefined/, "observer must prefer explicit route-declared targets over request-shape inference");
assert.match(audit, /\[EntityType\] IN \(\$\{typeParams\.join\(", "\)\}\)/, "trail reads must support entity-family IN filters");
assert.match(audit, /opts\.entityTypes\.slice\(0, 8\)/, "entity-family filter must stay bounded");
assert.match(audit, /subjectClauses\.push\("a\.\[ActorID\] = @subjectId"\)/, "subject mode must include the person's own actions");
{
  const families = proxy.match(/const AUDIT_ENTITY_FAMILIES[\s\S]*?\n\};/)?.[0] ?? "";
  assert.ok(families.length > 50, "record popups must request entity families so schedule/allocation edits appear on the record");
  assert.match(families, /project:[^\n]*schedule/, "project family must include schedule events");
  assert.match(families, /project:[^\n]*allocation/, "project family must include allocation events");
  assert.match(families, /staff:[^\n]*resource/, "staff family must include resource enrichment events");
}
assert.match(proxy, /Audit access is limited to your own activity/, "non-admin audit queries must be clamped to the caller's own activity");
assert.match(
  proxy,
  /const ownSubject = requestedSubjectId && requestedSubjectId\.toLowerCase\(\) === rds\.userId\.toLowerCase\(\)/,
  "non-admin subject mode must be limited to the caller's own record",
);
assert.ok(READ_SHAPED_POST_PATHS.includes("/bench-resources"), "bench lookup POST must stay skip-listed");
assert.ok(READ_SHAPED_POST_PATHS.includes("/resource-skills-availability"), "skills availability POST must stay skip-listed");
assert.ok(READ_SHAPED_POST_PATHS.includes("/debug-log"), "client debug-log shipping must stay skip-listed");

// ---------------------------------------------------------------------------
// Route wiring guard: every authenticated mutation route must either hand the
// observer a trusted target/changes (directly or via a *WithAudit /
// *WithSnapshots writer in its handler) or be explicitly classified below.
// A new mutation route fails this check until it is wired or classified —
// silently relying on request-shape inference is not an option.
// ---------------------------------------------------------------------------
const AUDIT_WIRING = /handoffTrustedAuditChanges|setTrustedAuditChanges|AuditTarget|recordAuditEvent|WithAudit|WithSnapshots/;
// READ_ONLY: POST/PUT used as a query or pure compute — writes no tenant data.
// TECHNICAL: infra/diagnostics/dev tooling — no tenant business data changes.
// MINOR_PERSONAL: the caller's own UI/device state (chat sessions, push tokens).
// OBSERVED_OK: business-adjacent action where the observer's generic row is the
//   whole truth — there is no committed field-level state to diff.
// OBSERVER_EXEMPT: skipped by the observer itself (token exchange, read-shaped).
const ROUTE_AUDIT_CLASSIFICATION: Record<string, string> = {
  "actuals-forecast.ts POST /rebuild": "TECHNICAL — rebuilds derived weekly snapshots from existing plan + imported actuals; writes no source-of-truth tenant data",
  "actuals-forecast.ts POST /imports": "OBSERVED_OK — actuals import batch creation; the batch ledger records actor (uploaded_by), filename, counts, and status",
  "actuals-forecast.ts POST /imports/:id/rows": "OBSERVED_OK — staged actuals rows; the batch ledger carries actor + counts, unmatched rows land as in-app exceptions",
  "actuals-forecast.ts POST /imports/:id/commit": "OBSERVED_OK — batch lifecycle close; the batch ledger records final status + accepted/exception counts",
  "actuals-forecast.ts POST /imports/:id/abort": "OBSERVED_OK — batch lifecycle abort; the batch ledger records the aborted status and the removed row count",
  "card-insights.ts POST /card-insights": "READ_ONLY — computes/caches an AI insight; no tenant data written",
  "card-insights.ts DELETE /card-insights/cache/:kind/:id": "TECHNICAL — cache invalidation only",
  "card-insights.ts DELETE /card-insights/cache/:kind": "TECHNICAL — cache invalidation only",
  "chat-sessions.ts POST /sessions": "MINOR_PERSONAL — caller's own chat session bookkeeping",
  "chat-sessions.ts DELETE /sessions/:sessionId": "MINOR_PERSONAL — caller's own chat session bookkeeping",
  "chat.ts POST /notify-team": "OBSERVED_OK — notification fan-out; no committed field state to diff",
  "chat.ts DELETE /inbox/:messageId": "MINOR_PERSONAL — caller's own inbox row",
  "chat.ts POST /push-token": "MINOR_PERSONAL — device push registration (token value never audited)",
  "chat.ts POST /push-test": "TECHNICAL — developer push-delivery test",
  "codebase-graph.ts POST /regenerate": "TECHNICAL — internal tooling graph rebuild",
  "data-cleaning.ts POST /upload": "OBSERVED_OK — pre-import staging; the eventual import audits per record",
  "data-cleaning.ts POST /reclean/:sessionId": "OBSERVED_OK — pre-import staging rerun",
  "data-cleaning.ts POST /reviewed/:sessionId": "OBSERVED_OK — staging review state; import audits per record",
  "data-cleaning.ts POST /chat": "OBSERVED_OK — cleaning-session assistant; no tenant table writes",
  "index.ts POST /admin/db-optimize-hot": "TECHNICAL — root-only index maintenance",
  "index.ts POST /admin/db-optimize": "TECHNICAL — root-only index maintenance",
  "onboarding.ts POST /check-ticket-ids": "READ_ONLY — ID existence probe",
  "onboarding.ts POST /validate-data": "READ_ONLY — validation pass over an uploaded sheet",
  "onboarding.ts POST /preflight": "READ_ONLY — import preflight analysis",
  "onboarding.ts POST /dev/restore-tenant": "TECHNICAL — dev-only restore tool",
  "onboarding.ts POST /reanalyze-sheet": "READ_ONLY — sheet re-analysis",
  "onboarding.ts POST /suggest-field": "READ_ONLY — LLM mapping suggestion",
  "onboarding.ts POST /classify-cross-tab": "READ_ONLY — LLM tab classification",
  "onboarding.ts POST /suggest-fields-batch": "READ_ONLY — LLM mapping suggestions",
  "onboarding.ts POST /client-template": "READ_ONLY — template file generation",
  "onboarding.ts POST /my-access-level/revert": "MINOR_PERSONAL — caller reverts their own preview access level",
  "onboarding.ts POST /upload": "OBSERVED_OK — import job creation; the pipeline emits job + per-record audit rows",
  "onboarding.ts POST /cancel/:id": "OBSERVED_OK — import job lifecycle; observer row + job history carry the truth",
  "onboarding.ts POST /retry-construction/:id": "OBSERVED_OK — import job retry; the pipeline re-emits audit rows",
  "onboarding.ts POST /review/:id/resolve": "OBSERVED_OK — quarantine resolution; resulting writes audited by the pipeline",
  "onboarding.ts POST /setup-schema": "TECHNICAL — schema bootstrap",
  "onboarding.ts POST /dry-run-validate": "READ_ONLY — dry-run validation",
  "onboarding.ts POST /validate": "READ_ONLY — validation pass",
  "onboarding.ts POST /seed-testrmone-users": "TECHNICAL — dev seeding for the test tenant",
  "rmone-proxy.ts POST /debug-log": "OBSERVER_EXEMPT — read-shaped telemetry (skip-listed)",
  "rmone-proxy.ts POST /token": "OBSERVER_EXEMPT — token exchange is explicitly exempt in the observer",
  "rmone-proxy.ts POST /logout": "OBSERVED_OK — sign-out; observer row is the whole truth",
  "rmone-proxy.ts POST /bench-resources": "OBSERVER_EXEMPT — read-shaped query (skip-listed)",
  "rmone-proxy.ts POST /audit-interaction": "OBSERVED_OK — semantic interactions are captured only by the observer by design",
  "rmone-proxy.ts POST /resource-skills-availability": "OBSERVER_EXEMPT — read-shaped query (skip-listed)",
  "rmone-proxy.ts POST /project-allocations": "OBSERVER_EXEMPT — read-shaped page-load fetch (skip-listed)",
  "rmone-proxy.ts POST /assign-person": "READ_ONLY — 501 stub; no assignment write path",
  "rmone-proxy.ts PUT /attachments": "READ_ONLY — 501 stub; no attachment write path",
  "rmone-proxy.ts POST /weekly-resources": "READ_ONLY — returns a fixed empty shape; performs no write",
  "rmone-proxy.ts POST /org/trace": "TECHNICAL — diagnostic provenance trace; memoizes trace metadata only",
  "rmone-proxy.ts POST /update-division-roles": "READ_ONLY — 501 stub; performs no write",
  "rmone-proxy.ts PUT /daily-briefing-cache": "TECHNICAL — durable per-user briefing cache write (derived display data only); no source-of-truth tenant writes",
  "storage.ts POST /storage/uploads/request-url": "TECHNICAL — presigned upload URL issuance",
  "superadmin.ts POST /ai-analysis/refresh": "TECHNICAL — root-only analysis cache refresh",
  "superadmin.ts POST /integrity-scan/run": "TECHNICAL — root-only integrity scan trigger",
  "transcribe.ts POST /": "READ_ONLY — audio transcription compute",
  "usage-analytics.ts POST /usage-beacon": "OBSERVER_EXEMPT — telemetry beacon (skip-listed)",
  "workflow-document.ts POST /workflow-document": "READ_ONLY — document generation from existing data",
};
{
  const unclassified: string[] = [];
  const stale: string[] = [];
  const allKeys = new Set<string>();
  for (const { name, source } of routeSources) {
    const decls = [...source.matchAll(/\b(?:router|app)\.(get|post|put|patch|delete|use)\(\s*["'`]([^"'`]+)["'`]/g)];
    for (let i = 0; i < decls.length; i++) {
      const verb = decls[i]?.[1] ?? "";
      if (verb === "get" || verb === "use") continue;
      const key = `${name} ${verb.toUpperCase()} ${decls[i]?.[2] ?? ""}`;
      allKeys.add(key);
      const block = source.slice(decls[i]?.index ?? 0, decls[i + 1]?.index ?? source.length);
      const wired = AUDIT_WIRING.test(block);
      const classified = key in ROUTE_AUDIT_CLASSIFICATION;
      if (!wired && !classified) unclassified.push(key);
      if (wired && classified) stale.push(key);
    }
  }
  assert.deepEqual(
    unclassified,
    [],
    `mutation routes with neither audit wiring nor an explicit classification:\n  ${unclassified.join("\n  ")}\nHand the observer a trusted target/changes (setAuditTarget / handoffTrustedAuditChanges / setTrustedAuditChanges) or classify the route in ROUTE_AUDIT_CLASSIFICATION with a justification.`,
  );
  assert.deepEqual(stale, [], `stale classifications (route now has audit wiring in its handler — remove the entry):\n  ${stale.join("\n  ")}`);
  const orphaned = Object.keys(ROUTE_AUDIT_CLASSIFICATION).filter((key) => !allKeys.has(key));
  assert.deepEqual(orphaned, [], `classifications for routes that no longer exist — remove them:\n  ${orphaned.join("\n  ")}`);
}

console.log(`audit coverage check passed (${mutationRoutes.length} authenticated RM ONE write routes are observer-covered)`);
