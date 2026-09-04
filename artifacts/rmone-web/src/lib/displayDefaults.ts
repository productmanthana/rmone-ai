/**
 * Company-wide DISPLAY defaults — the admin-set starting point for what every
 * user at a tenant sees: default record-detail fields, list-grid columns and
 * the cards-vs-grid list mode.
 *
 * Resolution order (per user, per browser):
 *   1. The user's OWN personalization, once they've actually customized
 *      something (tracked via a tenant-scoped ":custom" marker) — always wins.
 *   2. The company defaults an admin saved (fetched from the server).
 *   3. The app's built-in behavior (empty defaults = exactly the old app).
 *
 * Singleton pattern mirrors lib/businessRules.ts: module-level current value +
 * version counter + useSyncExternalStore hook. Consumers re-render when a
 * fetch lands or an admin saves. Values refresh on mount of consuming pages
 * (throttled to once a minute), so other users pick changes up through normal
 * navigation — no hard refresh needed.
 *
 * The server mirrors these types in api-server/src/lib/display-defaults.ts —
 * keep the two in sync when adding fields.
 */

import { useSyncExternalStore } from "react";
import { authHeaders, getStoredUser, tenantScopedKey } from "./api";
import { SUPPRESSED_FIELD_KEYS } from "./recordFieldCatalog";

const API = "/api/onboarding";

export const DISPLAY_MODULES = ["PMM", "OPM", "LEM", "COM", "CON"] as const;
export type DisplayModule = (typeof DISPLAY_MODULES)[number];

export const DISPLAY_VIEWS = ["projects", "opportunities", "leads", "companies"] as const;
export type DisplayView = (typeof DISPLAY_VIEWS)[number];

export interface ModuleDetailDefaults {
  pinned: string[];       // optional raw fields shown as extra detail cells
  hidden: string[];       // default-shown fields hidden by default
  budgetPinned: string[];  // optional fields pinned onto Budget & Costs
}

export interface DisplayDefaults {
  detail: Partial<Record<DisplayModule, ModuleDetailDefaults>>;
  /** Visible column keys per list view; empty/missing = the catalog's
   *  default view (every entry except defaultHidden ones). */
  columns: Partial<Record<DisplayView, string[]>>;
  /** Admin-ADDED extra Data Grid columns per view: raw record field names
   *  from EXTRA_FIELD_CATALOG. Separate from `columns` so an empty visible
   *  list keeps meaning "all built-in columns". */
  extraColumns: Partial<Record<DisplayView, string[]>>;
  /** Default cards-vs-grid list mode; "" = no company default. */
  viewMode: "" | "cards" | "grid";
}

export const EMPTY_DISPLAY_DEFAULTS: DisplayDefaults = { detail: {}, columns: {}, extraColumns: {}, viewMode: "" };

export const EMPTY_MODULE_DETAIL: ModuleDetailDefaults = { pinned: [], hidden: [], budgetPinned: [] };

/* ── Column catalog ──────────────────────────────────────────────────────────
   Keys MUST stay in sync with the columns arrays built in pages/projects.tsx
   (each site carries a matching reminder comment). Locked columns are the
   identity cells a grid can't function without — they are always kept no
   matter what an admin saves, so a bad save can never blank a grid. The
   "menu" (row actions) column is likewise always kept and never listed.
   defaultHidden entries stay in the picker but are OFF until an admin turns
   them on — the grid's default view shows only the non-hidden columns. */
export interface ColumnCatalogEntry { key: string; label: string; locked?: boolean; defaultHidden?: boolean }

export const GRID_COLUMN_CATALOG: Record<DisplayView, ColumnCatalogEntry[]> = {
  projects: [
    { key: "id", label: "ID", locked: true },
    { key: "name", label: "Project name", locked: true },
    { key: "ai", label: "AI insight", locked: true },
    { key: "client", label: "Client" },
    { key: "status", label: "Status" },
    { key: "phase", label: "Phase" },
    { key: "value", label: "Contract value" },
    { key: "team", label: "Team" },
    { key: "start", label: "Start" },
    { key: "end", label: "End" },
  ],
  opportunities: [
    { key: "id", label: "ID", locked: true },
    { key: "name", label: "Opportunity name", locked: true },
    { key: "ai", label: "AI insight", locked: true },
    { key: "client", label: "Client" },
    { key: "clientContact", label: "Client contact" },
    { key: "stage", label: "Stage" },
    { key: "value", label: "Est. value" },
    { key: "probability", label: "Probability" },
    { key: "weightedValue", label: "Weighted value" },
    { key: "bidDate", label: "Bid date" },
    { key: "daysLeft", label: "Days left" },
    { key: "team", label: "Team" },
  ],
  leads: [
    { key: "id", label: "ID", locked: true },
    { key: "name", label: "Lead name", locked: true },
    { key: "ai", label: "AI insight", locked: true },
    { key: "client", label: "Client" },
    { key: "clientContact", label: "Client contact" },
    { key: "status", label: "Status" },
    { key: "value", label: "Est. value" },
    { key: "sector", label: "Sector" },
    { key: "bu", label: "Business unit" },
    { key: "due", label: "Due" },
  ],
  companies: [
    { key: "client", label: "Company", locked: true },
    { key: "ai", label: "AI insight", locked: true },
    { key: "companyId", label: "Company ID" },
    { key: "leads", label: "Leads" },
    { key: "opps", label: "Opportunities" },
    { key: "pipeline", label: "Pipeline value" },
    { key: "projects", label: "Active projects" },
    { key: "closed", label: "Closed" },
    { key: "totalValue", label: "Total value" },
    // Full New-Company form fields (Aug 2026) — available in the picker but
    // hidden by default so the grid stays readable (user request, Aug 2026).
    { key: "shortName", label: "Abbreviated name", defaultHidden: true },
    { key: "relType", label: "Relationship type", defaultHidden: true },
    { key: "bizType", label: "Business type", defaultHidden: true },
    { key: "secBizType", label: "Secondary business type", defaultHidden: true },
    { key: "phone", label: "Phone", defaultHidden: true },
    { key: "fax", label: "Fax", defaultHidden: true },
    { key: "email", label: "Email", defaultHidden: true },
    { key: "addr", label: "Address", defaultHidden: true },
    { key: "cityState", label: "City / State", defaultHidden: true },
    { key: "zip", label: "Zip", defaultHidden: true },
    { key: "assignedTo", label: "Assigned to", defaultHidden: true },
    { key: "description", label: "Description", defaultHidden: true },
  ],
};

const LOCKED_KEYS: Record<DisplayView, Set<string>> = Object.fromEntries(
  DISPLAY_VIEWS.map((v) => [v, new Set(GRID_COLUMN_CATALOG[v].filter((c) => c.locked).map((c) => c.key))]),
) as Record<DisplayView, Set<string>>;

const DEFAULT_HIDDEN_KEYS: Record<DisplayView, Set<string>> = Object.fromEntries(
  DISPLAY_VIEWS.map((v) => [v, new Set(GRID_COLUMN_CATALOG[v].filter((c) => c.defaultHidden).map((c) => c.key))]),
) as Record<DisplayView, Set<string>>;

/* ── Extra-column field catalog ──────────────────────────────────────────────
   Database fields an admin can ADD as list columns beyond the built-ins.
   Keys are the raw record field names the list API already returns (the
   server's RECORD_FIELDS allowlist ∩ live schema) — a field a tenant's table
   lacks simply renders "—". `kind` picks the cell formatter/alignment in
   pages/projects.tsx. Fields whose value needs the app's fallback chains
   (City, Division, …) get their value from the MAPPED row via the per-grid
   override in projects.tsx; the key still names the canonical DB column.
   Companies is a derived roll-up view — no raw fields to offer. */
export type ExtraFieldKind = "text" | "money" | "date" | "number";
export interface ExtraFieldDef { key: string; label: string; kind: ExtraFieldKind }

const XF_SHARED: ExtraFieldDef[] = [
  { key: "City", label: "City", kind: "text" },
  { key: "Office", label: "Office", kind: "text" },
  { key: "State", label: "State", kind: "text" },
  { key: "StreetAddress1", label: "Street address", kind: "text" },
  { key: "Division", label: "Division", kind: "text" },
  { key: "Department", label: "Department", kind: "text" },
  { key: "ERPJobID", label: "Job / ERP ID", kind: "text" },
  { key: "WorkflowTypeName", label: "Workflow type", kind: "text" },
  { key: "RequestCategory", label: "Request category", kind: "text" },
  { key: "OwnersRepresentative", label: "Owner's rep", kind: "text" },
  { key: "Description", label: "Description", kind: "text" },
];

export const EXTRA_FIELD_CATALOG: Record<DisplayView, ExtraFieldDef[]> = {
  projects: [
    ...XF_SHARED,
    { key: "OwnerName", label: "Client contact", kind: "text" },
    { key: "SectorChoice", label: "Sector", kind: "text" },
    { key: "CRMBusinessUnitChoice", label: "Business unit", kind: "text" },
    { key: "PctComplete", label: "% complete", kind: "number" },
    { key: "LaborContractAmount", label: "Labor contract", kind: "money" },
    { key: "TotalCost", label: "Total cost", kind: "money" },
    { key: "EstProjectSpend", label: "Est. spend", kind: "money" },
    { key: "ApprovedRFEAmount", label: "Approved RFE", kind: "money" },
    { key: "ContractLimit", label: "Contract limit", kind: "money" },
    { key: "ContractType", label: "Contract type", kind: "text" },
    { key: "RiskScore", label: "Risk score", kind: "number" },
    { key: "ProjectScore", label: "Project score", kind: "number" },
    { key: "ProjectRank", label: "Project rank", kind: "number" },
    { key: "GrossMargin", label: "Gross margin", kind: "number" },
    { key: "NextActivity", label: "Next activity", kind: "text" },
    { key: "NextMilestone", label: "Next milestone", kind: "text" },
    { key: "ActualStartDate", label: "Actual start", kind: "date" },
    { key: "ActualCompletionDate", label: "Actual end", kind: "date" },
    { key: "PreconStartDate", label: "Precon start", kind: "date" },
    { key: "PreconEndDate", label: "Precon end", kind: "date" },
    { key: "ConstStartDate", label: "Construction start", kind: "date" },
    { key: "CloseoutStartDate", label: "Closeout start", kind: "date" },
    { key: "DesiredCompletionDate", label: "Desired completion", kind: "date" },
  ],
  opportunities: [
    ...XF_SHARED,
    { key: "SectorChoice", label: "Sector", kind: "text" },
    { key: "CRMBusinessUnitChoice", label: "Business unit", kind: "text" },
    { key: "ContractValue", label: "Contract value", kind: "money" },
    { key: "LaborContractAmount", label: "Labor contract", kind: "money" },
    { key: "StageStep", label: "Stage step", kind: "text" },
    { key: "InterviewDate", label: "Interview date", kind: "date" },
    { key: "AwardedorLossDate", label: "Awarded / loss date", kind: "date" },
    { key: "ProposalPhaseDueDate", label: "Proposal due", kind: "date" },
    { key: "CloseoutDate", label: "Closeout date", kind: "date" },
    { key: "CloseDate", label: "Close date", kind: "date" },
    { key: "ActualStartDate", label: "Actual start", kind: "date" },
    { key: "ActualCompletionDate", label: "Actual end", kind: "date" },
  ],
  leads: [
    ...XF_SHARED,
    { key: "ContractValue", label: "Contract value", kind: "money" },
    { key: "TargetStartDate", label: "Target start", kind: "date" },
    { key: "TargetCompletionDate", label: "Target end", kind: "date" },
    { key: "Created", label: "Created", kind: "date" },
    { key: "CloseDate", label: "Close date", kind: "date" },
  ],
  companies: [],
};

/* ── Singleton state ───────────────────────────────────────────────────── */

let current: DisplayDefaults = EMPTY_DISPLAY_DEFAULTS;
let version = 0;
let loadedAt = 0;                 // 0 = never loaded this sign-in
let inFlight: Promise<void> | null = null;
let loadSeq = 0;                  // invalidates in-flight fetches on auth change
const listeners = new Set<() => void>();

const STALE_MS = 60_000; // consuming pages re-check at most once a minute

function bump() {
  version++;
  for (const l of Array.from(listeners)) {
    try { l(); } catch { /* ignore */ }
  }
}

function subscribe(cb: () => void): () => void {
  listeners.add(cb);
  return () => listeners.delete(cb);
}

/** Reactive version counter — re-renders the component when defaults change. */
export function useDisplayDefaultsVersion(): number {
  return useSyncExternalStore(subscribe, () => version, () => version);
}

/**
 * Reorder two currently-known detail fields without rebuilding the persisted
 * list. Unknown/legacy keys remain exactly where they were and keep their
 * relative order.
 */
export function reorderPinnedDetailKeys(
  pinned: readonly string[],
  fromKey: string,
  toKey: string,
): string[] {
  const next = [...pinned];
  const from = next.indexOf(fromKey);
  const to = next.indexOf(toKey);
  if (from < 0 || to < 0 || from === to) return next;
  [next[from], next[to]] = [next[to], next[from]];
  return next;
}

/**
 * Build the visible record preview in the same order users inherit: locked
 * fields first, followed by configurable fields in persisted pinned order.
 */
export function orderedDetailPreviewKeys(
  alwaysShown: readonly string[],
  pinned: readonly string[],
  visibleKeys: ReadonlySet<string>,
): string[] {
  const seen = new Set<string>();
  return [...alwaysShown, ...pinned].filter((key) => {
    if (!visibleKeys.has(key) || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

export function orderVisibleGridColumns<T extends { key: string }>(
  columns: readonly T[],
  allowed: readonly string[],
  lockedKeys: ReadonlySet<string>,
): T[] {
  const rank = new Map(allowed.map((key, index) => [key, index]));
  const originalRank = new Map(columns.map((column, index) => [column.key, index]));
  return [...columns].sort((a, b) => {
    if (a.key === "menu") return 1;
    if (b.key === "menu") return -1;
    const aKey = a.key.startsWith("xf:") ? a.key.slice(3) : a.key;
    const bKey = b.key.startsWith("xf:") ? b.key.slice(3) : b.key;
    const aLegacyLocked = lockedKeys.has(a.key) && !rank.has(aKey);
    const bLegacyLocked = lockedKeys.has(b.key) && !rank.has(bKey);
    if (aLegacyLocked !== bLegacyLocked) return aLegacyLocked ? -1 : 1;
    if (aLegacyLocked && bLegacyLocked) {
      return (originalRank.get(a.key) ?? 0) - (originalRank.get(b.key) ?? 0);
    }
    const ar = rank.get(aKey);
    const br = rank.get(bKey);
    if (ar != null && br != null) return ar - br;
    if (ar != null) return -1;
    if (br != null) return 1;
    return (originalRank.get(a.key) ?? 0) - (originalRank.get(b.key) ?? 0);
  });
}

export function getDisplayDefaults(): DisplayDefaults {
  return current;
}

/** True once this session's own-tenant defaults are usable as an instant-render seed. */
export function displayDefaultsLoaded(): boolean {
  return loadedAt > 0 || current !== EMPTY_DISPLAY_DEFAULTS;
}

// Light client-side shape guard: the server sanitizes on write AND read, so
// this only defends against unexpected/error payloads.
function coerce(input: unknown): DisplayDefaults {
  const o = (input && typeof input === "object" ? input : {}) as Record<string, unknown>;
  const arr = (v: unknown): string[] => (Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : []);
  const out: DisplayDefaults = { detail: {}, columns: {}, extraColumns: {}, viewMode: "" };
  const det = (o.detail && typeof o.detail === "object" ? o.detail : {}) as Record<string, unknown>;
  for (const m of DISPLAY_MODULES) {
    const d = det[m];
    if (!d || typeof d !== "object") continue;
    const dd = d as Record<string, unknown>;
    const entry = { pinned: arr(dd.pinned), hidden: arr(dd.hidden), budgetPinned: arr(dd.budgetPinned) };
    if (entry.pinned.length || entry.hidden.length || entry.budgetPinned.length) out.detail[m] = entry;
  }
  const cols = (o.columns && typeof o.columns === "object" ? o.columns : {}) as Record<string, unknown>;
  for (const v of DISPLAY_VIEWS) {
    const list = arr(cols[v]);
    if (list.length) out.columns[v] = list;
  }
  // Extra columns: only catalog-known field names survive (a field retired
  // from the catalog silently drops instead of rendering an unlabeled column).
  const extras = (o.extraColumns && typeof o.extraColumns === "object" ? o.extraColumns : {}) as Record<string, unknown>;
  for (const v of DISPLAY_VIEWS) {
    const known = new Set(EXTRA_FIELD_CATALOG[v].map((f) => f.key));
    const list = arr(extras[v]).filter((k) => known.has(k));
    if (list.length) out.extraColumns[v] = list;
  }
  if (o.viewMode === "cards" || o.viewMode === "grid") out.viewMode = o.viewMode;
  return out;
}

function applyFetched(d: DisplayDefaults) {
  // Only notify subscribers when something actually changed — the periodic
  // staleness refetches would otherwise re-render every consumer for nothing.
  if (JSON.stringify(d) !== JSON.stringify(current)) {
    current = d;
    bump();
  }
}

/**
 * Fetch the signed-in user's company display defaults. Throttled: repeat calls
 * within a minute (e.g. every page navigation) are no-ops unless `force`.
 * Never throws — on failure the last-known (or empty) defaults stay in place,
 * which renders exactly like the app before this feature existed.
 */
export function loadDisplayDefaults(opts?: { force?: boolean }): Promise<void> {
  const user = getStoredUser();
  if (!user) {
    // Signed out — nothing to fetch; make sure nothing stale lingers.
    if (current !== EMPTY_DISPLAY_DEFAULTS) { current = EMPTY_DISPLAY_DEFAULTS; bump(); }
    loadedAt = 0;
    return Promise.resolve();
  }
  if (!opts?.force) {
    if (inFlight) return inFlight;
    if (loadedAt && Date.now() - loadedAt < STALE_MS) return Promise.resolve();
  }
  const seq = ++loadSeq;
  // Definite-assignment assertion: the async body can't reach its `finally`
  // before the first `await`, by which point `p` is assigned.
  let p!: Promise<void>;
  p = (async () => {
    try {
      const res = await fetch(`${API}/display-defaults`, { headers: authHeaders() });
      if (seq !== loadSeq) return; // auth changed mid-flight — drop the result
      if (!res.ok) return;         // keep last-known defaults on any failure
      const body = (await res.json()) as { defaults?: unknown };
      if (seq !== loadSeq) return;
      loadedAt = Date.now();
      applyFetched(coerce(body?.defaults));
    } catch {
      /* offline/transient — keep last-known defaults */
    } finally {
      if (inFlight === p) inFlight = null;
    }
  })();
  inFlight = p;
  return p;
}

/**
 * Persist company defaults (admin only — the server rejects everyone else).
 * `tenantId` is only for superadmins editing another company; in that case the
 * local singleton (the superadmin's own tenant) is left untouched.
 * Throws on failure so callers can toast the real reason (e.g. 403).
 */
export async function saveDisplayDefaults(
  defaults: DisplayDefaults,
  tenantId?: string,
  /** When set, the server merges ONLY this section's keys onto the stored doc
   *  (one-round-trip auto-save); omit for whole-doc writes. */
  section?: "viewMode" | "fields",
): Promise<DisplayDefaults> {
  const body: Record<string, unknown> = { defaults };
  if (tenantId) body.tenantId = tenantId;
  if (section) body.section = section;
  const res = await fetch(`${API}/display-defaults`, {
    method: "PUT",
    headers: { ...authHeaders(), "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const e = await res.json().catch(() => ({} as any));
    throw new Error((e as any).error ?? `HTTP ${res.status}`);
  }
  const saved = coerce(((await res.json().catch(() => ({}))) as { defaults?: unknown })?.defaults);
  const own = getStoredUser()?.tenant;
  if (!tenantId || (own && tenantId.trim().toLowerCase() === own.trim().toLowerCase())) {
    loadedAt = Date.now();
    applyFetched(saved);
  }
  return saved;
}

/** Read another company's defaults (superadmin Settings scope) without touching the singleton. */
export async function fetchDisplayDefaultsFor(tenantId?: string): Promise<DisplayDefaults> {
  const qs = tenantId ? `?tenantId=${encodeURIComponent(tenantId)}` : "";
  const res = await fetch(`${API}/display-defaults${qs}`, { headers: authHeaders() });
  if (!res.ok) {
    const e = await res.json().catch(() => ({} as any));
    throw new Error((e as any).error ?? `HTTP ${res.status}`);
  }
  return coerce(((await res.json()) as { defaults?: unknown })?.defaults);
}

/* ── Record-page field catalog (Settings inline editor) ─────────────────────
   Every raw field the record detail page CAN surface for a module — served by
   the API from the live core2 schema (shared across tenants). Session-cached
   per module: the schema doesn't change while an admin edits settings. */
export type CatalogModule = "PMM" | "OPM" | "LEM";
const catalogCache = new Map<CatalogModule, string[]>();
export async function fetchDetailFieldCatalog(module: CatalogModule): Promise<string[]> {
  const hit = catalogCache.get(module);
  if (hit) return hit;
  const res = await fetch(`${API}/detail-field-catalog?module=${module}`, { headers: authHeaders() });
  if (!res.ok) {
    const e = await res.json().catch(() => ({} as any));
    throw new Error((e as any).error ?? `HTTP ${res.status}`);
  }
  const body = (await res.json()) as { fields?: unknown };
  const fields = Array.isArray(body.fields) ? body.fields.filter((f): f is string => typeof f === "string") : [];
  catalogCache.set(module, fields);
  return fields;
}

// Different sign-in (or tenant switch) → these defaults no longer apply.
// Reset immediately and refetch for the new session.
if (typeof window !== "undefined") {
  window.addEventListener("rmone:authChanged", () => {
    loadSeq++;          // poison any in-flight fetch from the old session
    inFlight = null;
    loadedAt = 0;
    catalogCache.clear(); // schema catalog is tenant-independent, but keep session hygiene strict
    if (current !== EMPTY_DISPLAY_DEFAULTS) { current = EMPTY_DISPLAY_DEFAULTS; bump(); }
    void loadDisplayDefaults();
  });
}

/* ── Resolution helpers ────────────────────────────────────────────────── */

/**
 * Filter a built grid-columns array down to the admin's visible set.
 * Empty/missing admin list = show everything (no company restriction).
 * Identity columns and the row-actions "menu" column are always kept.
 */
export function applyGridColumnDefaults<T extends { key: string }>(view: DisplayView, cols: T[]): T[] {
  const allowed = current.columns[view];
  if (!allowed || !allowed.length) {
    // No admin-saved list → the catalog's DEFAULT set: everything except
    // defaultHidden entries (secondary fields an admin can opt into via
    // Settings → Display Defaults). Locked/menu/xf: columns always stay.
    const hidden = DEFAULT_HIDDEN_KEYS[view];
    if (!hidden.size) return cols;
    const lockedD = LOCKED_KEYS[view];
    return cols.filter((c) => c.key === "menu" || c.key.startsWith("xf:") || lockedD.has(c.key) || !hidden.has(c.key));
  }
  const keep = new Set(allowed);
  const locked = LOCKED_KEYS[view];
  // "xf:" columns exist only because an admin ADDED them — always kept.
  const visible = cols.filter((c) => c.key === "menu" || c.key.startsWith("xf:") || locked.has(c.key) || keep.has(c.key));
  // Honour the exact Settings order immediately. Locked identity fields that
  // are not present in an older saved document retain their original leading
  // position; sticky action columns stay at the far right.
  return orderVisibleGridColumns(visible, allowed, locked);
}

/**
 * Catalog defs for the admin-added extra columns of a view, in saved order.
 * Empty when none are configured. Reads may see docs saved before this
 * feature (no extraColumns key) — treat as none.
 */
export function adminExtraFieldDefs(view: DisplayView): ExtraFieldDef[] {
  const saved = current.extraColumns?.[view];
  if (!saved || !saved.length) return [];
  const byKey = new Map(EXTRA_FIELD_CATALOG[view].map((f) => [f.key, f]));
  return saved.map((k) => byKey.get(k)).filter((f): f is ExtraFieldDef => !!f);
}

/**
 * Non-catalog column defs for a view: keys in columns[view] that are NOT in
 * GRID_COLUMN_CATALOG. These are detail-only fields an admin toggled onto the
 * list grid via Settings → Display Defaults. Returned in the order they appear
 * in the saved list (after catalog columns). EXTRA_FIELD_CATALOG supplies
 * kind/label when available; unknown fields fall back to { kind: "text" }.
 */
export function adminNonCatalogColumnDefs(view: DisplayView): ExtraFieldDef[] {
  const allowed = current.columns[view];
  if (!allowed || !allowed.length) return [];
  const catalogKeys = new Set(GRID_COLUMN_CATALOG[view].map((c) => c.key));
  const extraByKey = new Map(EXTRA_FIELD_CATALOG[view].map((f) => [f.key, f]));
  const result: ExtraFieldDef[] = [];
  for (const key of allowed) {
    if (catalogKeys.has(key)) continue;
    // Older saved docs may still carry identity keys (Title, TicketId, …)
    // that the Fields picker no longer offers — the locked identity columns
    // already show those values, so a stale saved entry must not resurrect
    // a duplicate column.
    if (SUPPRESSED_FIELD_KEYS.has(key)) continue;
    result.push(extraByKey.get(key) ?? { key, label: key, kind: "text" });
  }
  return result;
}
/** The admin's cards-vs-grid default, or null when none is set. */
export function companyDefaultViewMode(): "cards" | "grid" | null {
  return current.viewMode === "cards" || current.viewMode === "grid" ? current.viewMode : null;
}

/* ── List-column hiding carries into record detail pages ────────────────────
   User mandate: hiding a column in Display Defaults hides that data
   EVERYWHERE, including inside the record page — not just the list grid.
   Each mappable column key lists the record-detail field names its detail
   cell(s) gate on (must match the layoutFieldHidden(...) call sites in
   project-detail.tsx). Columns with no single detail counterpart (team, ai,
   phase, daysLeft, weightedValue, due — sections or derived values) are
   deliberately unmapped. */
const CLIENT_FIELDS = ["CompanyName", "CRMCompanyLookupName", "CRMCompanyLookup"];
const STATUS_FIELDS = ["Status", "CRMProjectStatusChoice", "CRMOpportunityStatusChoice", "Stage", "StageChoice"];
const COLUMN_DETAIL_FIELDS: Partial<Record<DisplayView, Record<string, string[]>>> = {
  projects: {
    client: CLIENT_FIELDS,
    status: STATUS_FIELDS,
    value: ["ContractValue"],
    start: ["TargetStartDate", "ActualStartDate"],
    end: ["TargetCompletionDate", "ActualCompletionDate"],
  },
  opportunities: {
    client: CLIENT_FIELDS,
    clientContact: ["OwnerName"],
    stage: STATUS_FIELDS,
    value: ["ApproxContractValue"],
    probability: ["SuccessChance", "ChanceofSuccessChoice", "ChanceOfSuccessChoice"],
  },
  leads: {
    client: CLIENT_FIELDS,
    // Lead contact lives in the Contact* columns (LEM detail cell gates on
    // these) — OwnerName is the OPPORTUNITY contact column, not the lead's.
    clientContact: ["ContactName", "ContactLookup", "CRMContactLookup", "Contact"],
    status: STATUS_FIELDS,
    value: ["ApproxContractValue", "ContractValue"],
    sector: ["SectorChoice", "Sector"],
    bu: ["CRMBusinessUnitChoice", "BusinessUnitName"],
  },
};

const MODULE_TO_VIEW: Partial<Record<DisplayModule, DisplayView>> = {
  PMM: "projects", OPM: "opportunities", LEM: "leads",
};

/**
 * Record-detail field names that must be hidden because the admin unticked
 * their list column for this module's view. Empty when no column restriction
 * is saved. Consumed by the record detail page's fieldHidden gate.
 */
export function adminColumnHiddenFields(module: string): string[] {
  const view = MODULE_TO_VIEW[module as DisplayModule];
  if (!view) return [];
  const allowed = current.columns[view];
  // No stored list = default catalog view. Only projects/opps/leads have
  // COLUMN_DETAIL_FIELDS mappings and none of their entries are defaultHidden,
  // so the default view hides nothing here.
  if (!allowed || !allowed.length) return [];
  const keep = new Set(allowed);
  const map = COLUMN_DETAIL_FIELDS[view] ?? {};
  const out: string[] = [];
  for (const [colKey, fields] of Object.entries(map)) {
    if (!keep.has(colKey)) out.push(...fields);
  }
  return out;
}

/** Admin detail-field defaults for a record module (empty lists when unset). */
export function adminDetailDefaults(module: string): ModuleDetailDefaults {
  return current.detail[module as DisplayModule] ?? EMPTY_MODULE_DETAIL;
}

/* ── "Has this user personalized?" markers ─────────────────────────────────
   Personalization lives in the SAME localStorage keys it always has (e.g.
   "projectDetail.customFields.PMM"), so nothing existing users saved is
   touched. What's new is a tenant-scoped ":custom" marker recording that the
   user really edited that list on this browser. No marker → the list follows
   the company default. Legacy migration: a pre-existing NON-EMPTY saved list
   counts as customized (we can't know otherwise, and preserving what the user
   currently sees is the safe call); a stored empty list — which the old code
   wrote on every visit — does NOT, so those users correctly inherit the new
   company defaults. */

function markerKey(storageKey: string): string {
  return tenantScopedKey(`${storageKey}:custom`);
}

export function hasUserCustomized(storageKey: string): boolean {
  try {
    if (localStorage.getItem(markerKey(storageKey)) === "1") return true;
    const raw = localStorage.getItem(storageKey);
    if (!raw) return false;
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed) && parsed.length > 0) {
      localStorage.setItem(markerKey(storageKey), "1"); // migrate once
      return true;
    }
    return false;
  } catch {
    return false;
  }
}

export function markUserCustomized(storageKey: string): void {
  try { localStorage.setItem(markerKey(storageKey), "1"); } catch { /* ignore */ }
}

/** Forget the user's personalization so the company default applies again. */
export function clearUserCustomization(storageKey: string): void {
  try {
    localStorage.removeItem(markerKey(storageKey));
    localStorage.removeItem(storageKey);
  } catch { /* ignore */ }
}
