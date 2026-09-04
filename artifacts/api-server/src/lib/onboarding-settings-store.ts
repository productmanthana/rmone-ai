// ─────────────────────────────────────────────────────────────────────────────
// Onboarding settings store + assumed-data recorder (shared).
//
// The per-tenant onboarding defaults (org labels, schedule-date rules, …) and the
// "assumed data" audit trail live in OUR Postgres. Both the onboarding routes AND
// the live record-create path need to read those defaults and record assumptions,
// so the access lives here in a dependency-light lib module rather than inside a
// route file (which would create an import cycle: onboarding.ts already imports
// from rmone-proxy.ts).
// ─────────────────────────────────────────────────────────────────────────────
import {
  getOnboardingSettings,
  upsertOnboardingAssumedFieldsBatch,
  insertOnboardingAssumedHistoryBatch,
} from "@workspace/db";
import { sanitizeDefaults, mergeDefaults } from "./onboarding-defaults.js";
import type { OnboardingDefaults } from "./onboarding-defaults.js";

export const GLOBAL_SCOPE = "global";

// Normalize a company display name to its settings/assumed-data scope key.
// MUST match normTenant in routes/onboarding.ts (trivial, stable normalization).
export function normTenantKey(t: string): string {
  return t.trim().replace(/\s+/g, "_").toLowerCase();
}

// Read the partial override blob stored for a scope ("global" or a tenant key).
export async function readSettingsRow(scope: string): Promise<Partial<OnboardingDefaults>> {
  const row = await getOnboardingSettings(scope);
  if (!row) return {};
  return sanitizeDefaults(row.settings);
}

// Resolve the effective defaults for a tenant: built-in ← global ← per-client.
// The two scope reads are independent rows — fetch them in parallel (this sits
// on the hot path of /project-team and record-create, so the serial round-trip
// was pure added latency).
export async function loadEffectiveDefaults(tenantLabel?: string): Promise<OnboardingDefaults> {
  const [global, perClient] = await Promise.all([
    readSettingsRow(GLOBAL_SCOPE),
    tenantLabel ? readSettingsRow(normTenantKey(tenantLabel)) : Promise.resolve({}),
  ]);
  return mergeDefaults(global, perClient);
}

// Record system-defaulted (assumed) schedule dates for a freshly-created record,
// mirroring how the import pipeline tracks assumptions: upsert the current value
// on (tenantKey, entityType, naturalKey, fieldName) and append an audit-history
// row. This keeps the assumptions review accurate AND lets the settings-reconcile
// (reconcileAssumedScheduleDatesRds) re-derive these dates when the rules change.
export async function recordAssumedScheduleDates(opts: {
  tenantLabel: string;
  entityType: "project" | "opportunity" | "lead";
  title: string;
  startDate?: string;   // 'YYYY-MM-DD', set only if the start was auto-filled
  endDate?: string;     // 'YYYY-MM-DD', set only if the finish was auto-filled
  actor: string;
  sheetName?: string;
}): Promise<void> {
  const title = (opts.title ?? "").trim();
  if (!title) return;
  const fields: { field: string; value: string }[] = [];
  if (opts.startDate) fields.push({ field: "Start Date", value: opts.startDate });
  if (opts.endDate) fields.push({ field: "Completion Date", value: opts.endDate });
  if (!fields.length) return;

  const tenantKey = normTenantKey(opts.tenantLabel);
  const naturalKey = title.toLowerCase();
  const sheetName = opts.sheetName ?? "New record";
  const now = new Date();

  await upsertOnboardingAssumedFieldsBatch(fields.map(f => ({
    tenantKey, tenantLabel: opts.tenantLabel, entityType: opts.entityType,
    naturalKey, recordLabel: title, fieldName: f.field,
    value: f.value, confidence: "system_defaulted", sheetName,
  })));
  await insertOnboardingAssumedHistoryBatch(fields.map(f => ({
    tenantKey, tenantLabel: opts.tenantLabel, entityType: opts.entityType,
    naturalKey, recordLabel: title, fieldName: f.field, action: "created",
    oldValue: null, newValue: f.value,
    oldConfidence: null, newConfidence: "system_defaulted",
    sheetName, actor: opts.actor,
  })));
  void now;
}

// Record a system-defaulted (assumed) billing rate filled onto a role, mirroring
// how the import pipeline records the same assumption (entityType "role",
// fieldName "Billing Rate"). Used when a manually-added staff member's role had no
// rate and the "Fill a default rate when missing" setting is on. Keeps the
// assumptions-review consistent whether the role rate was filled at import time or
// when adding a single person.
export async function recordAssumedRoleRate(opts: {
  tenantLabel: string;
  roleName: string;
  rate: number;
  actor: string;
  sheetName?: string;
}): Promise<void> {
  const roleName = (opts.roleName ?? "").trim();
  if (!roleName) return;

  const tenantKey = normTenantKey(opts.tenantLabel);
  const naturalKey = roleName.toLowerCase();
  const sheetName = opts.sheetName ?? "Add staff";
  const value = String(opts.rate);
  const now = new Date();

  await upsertOnboardingAssumedFieldsBatch([{
    tenantKey, tenantLabel: opts.tenantLabel, entityType: "role",
    naturalKey, recordLabel: roleName, fieldName: "Billing Rate",
    value, confidence: "system_defaulted", sheetName,
  }]);
  await insertOnboardingAssumedHistoryBatch([{
    tenantKey, tenantLabel: opts.tenantLabel, entityType: "role",
    naturalKey, recordLabel: roleName, fieldName: "Billing Rate", action: "created",
    oldValue: null, newValue: value,
    oldConfidence: null, newConfidence: "system_defaulted",
    sheetName, actor: opts.actor,
  }]);
  void now;
}
