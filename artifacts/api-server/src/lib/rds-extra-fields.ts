// ─────────────────────────────────────────────────────────────────────────────
// Extra-column → screen-field mapping engine
//
// During onboarding, columns the client asked to "keep in our database" that do
// not map onto a standard RM ONE field are stored verbatim in Postgres
// (onboardingExtraFields), grouped by (tenantKey, entityType, naturalKey,
// fieldName). This engine slots SPECIFIC extra columns into SPECIFIC existing
// screen fields so they render in the same layout/theme with no frontend change.
//
// The actual per-customer mapping list (which extra column belongs in which
// field) is supplied by the user. Until it is, the mapping tables below are
// EMPTY and this engine is a strict no-op — it never reads Postgres and never
// touches a record. When the list arrives, add entries to GLOBAL_MAPPINGS (all
// tenants) or TENANT_MAPPINGS[normTenant(label)] (one tenant); no other code
// needs to change.
//
// naturalKey conventions (must match onboarding capture in routes/onboarding.ts):
//   person       → UserName / login email, lowercased
//   project      → project Title, lowercased
//   opportunity  → opportunity Title, lowercased
//   company      → company name, lowercased
// ─────────────────────────────────────────────────────────────────────────────
import { getOnboardingExtraFields } from "@workspace/db";

// Keep this in lockstep with normTenant() in routes/onboarding.ts so the
// tenantKey we query matches the one onboarding wrote.
function normTenant(t: string): string {
  return t.trim().replace(/\s+/g, "_").toLowerCase();
}

export interface FieldMapping {
  /** person | project | opportunity | company | assignment | contact */
  entityType: string;
  /** the onboarding extra-column name, exactly as captured */
  fieldName: string;
  /** the frontend field the value should appear in */
  targetField: string;
}

// ── mapping config (populate when the customer's mapping list is provided) ────
// Applies to every tenant.
const GLOBAL_MAPPINGS: FieldMapping[] = [
  // Financial fallbacks for Opportunity records: when core2.Opportunity is
  // missing LaborContractAmount or ForecastedProjectCost columns, the import
  // pipeline saves their values to onboardingExtraFields and these mappings
  // re-inject them into rawFields so Budget & Costs can display them regardless
  // of the tenant's specific RM ONE schema version.
  { entityType: "opportunity", fieldName: "LaborContractAmount",   targetField: "LaborContractAmount"   },
  { entityType: "opportunity", fieldName: "ForecastedProjectCost", targetField: "ForecastedProjectCost" },
];
// Applies to a single tenant; key = normTenant(tenantLabel).
const TENANT_MAPPINGS: Record<string, FieldMapping[]> = {};

/** Effective mappings for a tenant + entity type (global first, then tenant). */
export function getFieldMappings(tenantLabel: string, entityType: string): FieldMapping[] {
  const key = normTenant(tenantLabel);
  return [...GLOBAL_MAPPINGS, ...(TENANT_MAPPINGS[key] ?? [])]
    .filter((m) => m.entityType === entityType);
}

// naturalKey → (fieldName → value) for one tenant + entity type.
type ExtraValueMap = Map<string, Map<string, string | null>>;

// ── Per-tenant raw-row cache ─────────────────────────────────────────────────
// getRecordDetail calls applyExtraFieldMappings AND attachExtraFields back to
// back — each used to fire its own full app-DB query (~0.5-2s each on the
// high-latency link) for data that changes only when onboarding writes extra
// fields. Cache the RAW row set per tenant (it already contains every entity
// type; loadExtraValues filters in JS) with a short TTL plus in-flight dedup so
// concurrent detail reads share one query. Onboarding busts this cache after
// saveExtraFields via bustExtraFieldsCache, so post-import reads never serve a
// pre-write snapshot for the full TTL.
type ExtraRows = Awaited<ReturnType<typeof getOnboardingExtraFields>>;
const EXTRA_ROWS_TTL_MS = 60_000;
const extraRowsCache = new Map<string, { rows: ExtraRows; exp: number }>();
const extraRowsInFlight = new Map<string, Promise<ExtraRows>>();

export function bustExtraFieldsCache(tenantLabel?: string): void {
  if (tenantLabel) {
    const key = normTenant(tenantLabel);
    extraRowsCache.delete(key);
    extraRowsInFlight.delete(key);
  } else {
    extraRowsCache.clear();
    extraRowsInFlight.clear();
  }
}

async function loadExtraRows(tenantKey: string): Promise<ExtraRows> {
  const hit = extraRowsCache.get(tenantKey);
  if (hit && hit.exp > Date.now()) return hit.rows;
  let inflight = extraRowsInFlight.get(tenantKey);
  if (!inflight) {
    inflight = getOnboardingExtraFields(tenantKey)
      .then((rows) => {
        extraRowsCache.set(tenantKey, { rows, exp: Date.now() + EXTRA_ROWS_TTL_MS });
        extraRowsInFlight.delete(tenantKey);
        return rows;
      })
      .catch((e) => {
        // Failure is never cached — the next call retries. Serve a stale
        // snapshot if one exists rather than failing the detail read.
        extraRowsInFlight.delete(tenantKey);
        if (hit) return hit.rows;
        throw e;
      });
    extraRowsInFlight.set(tenantKey, inflight);
  }
  return inflight;
}

/** Fire-and-forget warm of the per-tenant extra-fields row cache. Callers on
 *  a cold path (e.g. getRecordDetail) kick this BEFORE their main query chain
 *  so the app-DB round trip overlaps it instead of trailing it — the later
 *  applyExtraFieldMappings/attachExtraFields calls then join the in-flight
 *  promise instead of paying the latency serially. */
export function prefetchExtraFields(tenantLabel?: string): void {
  if (!tenantLabel) return;
  void loadExtraRows(normTenant(tenantLabel)).catch(() => { /* best-effort */ });
}

async function loadExtraValues(tenantLabel: string, entityType: string): Promise<ExtraValueMap> {
  const rows = await loadExtraRows(normTenant(tenantLabel));
  const map: ExtraValueMap = new Map();
  for (const r of rows) {
    if (r.entityType !== entityType) continue;
    const nk = (r.naturalKey ?? "").toLowerCase();
    if (!nk) continue;
    let inner = map.get(nk);
    if (!inner) { inner = new Map(); map.set(nk, inner); }
    inner.set(r.fieldName, r.value);
  }
  return map;
}

/**
 * Merge mapped extra-column values into a list of provider records, matching on
 * naturalKey. Mutates and returns `records`. A strict no-op when there is no
 * tenant label, no configured mapping for the entity type, or no stored values —
 * so it is safe to call from every provider unconditionally.
 *
 * Existing non-empty field values are NOT overwritten and empty extra values are
 * never written, so a mapping can only ADD data the screen was otherwise missing.
 */
export async function applyExtraFieldMappings<T extends Record<string, unknown>>(
  tenantLabel: string | undefined,
  entityType: string,
  records: T[],
  getNaturalKey: (rec: T) => string | null | undefined,
): Promise<T[]> {
  if (!tenantLabel || records.length === 0) return records;
  const mappings = getFieldMappings(tenantLabel, entityType);
  if (mappings.length === 0) return records;
  const values = await loadExtraValues(tenantLabel, entityType);
  if (values.size === 0) return records;

  for (const rec of records) {
    const raw = getNaturalKey(rec);
    const nk = raw == null ? "" : String(raw).trim().toLowerCase();
    if (!nk) continue;
    const inner = values.get(nk);
    if (!inner) continue;
    for (const m of mappings) {
      if (!inner.has(m.fieldName)) continue;
      const v = inner.get(m.fieldName);
      if (v == null || v === "") continue;
      const cur = rec[m.targetField];
      if (cur == null || cur === "") (rec as Record<string, unknown>)[m.targetField] = v;
    }
  }
  return records;
}

// ─────────────────────────────────────────────────────────────────────────────
// Automatic extra-field attach (no mapping list needed)
//
// Unlike applyExtraFieldMappings (which slots SPECIFIC columns into SPECIFIC
// existing screen fields), this attaches EVERY captured extra column for a record
// as a list under `rec[fieldKey]` (default "ExtraFields") so the detail screen can
// render them automatically beneath the record — showing only fields that have a
// value. Empty / placeholder values ("", "null", "false", all-zero dates) are
// skipped. A strict no-op when there is no tenant label or no stored values, so
// it is safe to call from every provider unconditionally.
// ─────────────────────────────────────────────────────────────────────────────
export interface ExtraField {
  /** the onboarding extra-column name, exactly as captured */
  label: string;
  /** the stored value (trimmed, guaranteed non-empty) */
  value: string;
}

function isMeaningful(v: string | null | undefined): v is string {
  if (v == null) return false;
  const s = String(v).trim();
  if (!s) return false;
  const lc = s.toLowerCase();
  if (lc === "null" || lc === "false") return false;
  if (s.startsWith("0001-")) return false; // SQL "empty" datetime
  return true;
}

export async function attachExtraFields<T extends Record<string, unknown>>(
  tenantLabel: string | undefined,
  entityType: string,
  records: T[],
  getNaturalKey: (rec: T) => string | null | undefined,
  fieldKey = "ExtraFields",
): Promise<T[]> {
  if (!tenantLabel || records.length === 0) return records;
  const values = await loadExtraValues(tenantLabel, entityType);
  if (values.size === 0) return records;

  for (const rec of records) {
    const raw = getNaturalKey(rec);
    const nk = raw == null ? "" : String(raw).trim().toLowerCase();
    if (!nk) continue;
    const inner = values.get(nk);
    if (!inner) continue;
    const extras: ExtraField[] = [];
    for (const [fieldName, v] of inner) {
      if (!isMeaningful(v)) continue;
      extras.push({ label: fieldName, value: String(v).trim() });
    }
    if (extras.length > 0) (rec as Record<string, unknown>)[fieldKey] = extras;
  }
  return records;
}
