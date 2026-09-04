/**
 * Company-wide DISPLAY defaults — which detail fields, list columns and list
 * view mode every user of a tenant inherits until they personalize.
 *
 * Stored per tenant in the settings-row table (rmone_onboarding_default_settings)
 * under its own scope prefix ("display:<tenant>") so it can never collide with
 * the OnboardingDefaults merge layers. Unlike OnboardingDefaults there is no
 * global layer: an empty/missing blob simply means "keep the app's built-in
 * behavior", which is exactly what tenants had before this feature.
 *
 * The web app mirrors these types in rmone-web/src/lib/displayDefaults.ts —
 * keep the two in sync when adding fields.
 */

export const DISPLAY_MODULES = ["PMM", "OPM", "LEM", "COM", "CON"] as const;
export type DisplayModule = (typeof DISPLAY_MODULES)[number];

export const DISPLAY_VIEWS = ["projects", "opportunities", "leads", "companies"] as const;
export type DisplayView = (typeof DISPLAY_VIEWS)[number];

// Per-module record-detail defaults, mirroring the three personalization
// lists the web's Customize Fields panels manage:
//   pinned       — optional raw fields shown as extra cells by default
//   hidden       — default-shown fields hidden by default
//   budgetPinned — optional fields pinned onto the Budget & Costs card
export interface ModuleDetailDefaults {
  pinned: string[];
  hidden: string[];
  budgetPinned: string[];
}

export interface DisplayDefaults {
  detail: Partial<Record<DisplayModule, ModuleDetailDefaults>>;
  // Visible column keys per list view. Empty/missing list = no company
  // restriction saved — the web then shows its catalog's default view (all
  // entries except ones flagged defaultHidden). Identity/action columns are
  // always kept by the web regardless of this list, so a bad save can never
  // blank a grid.
  columns: Partial<Record<DisplayView, string[]>>;
  // Admin-ADDED extra list columns per view: raw record field names (from the
  // web's EXTRA_FIELD_CATALOG) shown as additional Data Grid columns for
  // everyone. Separate from `columns` (which only restricts the built-ins) so
  // an empty `columns` list keeps meaning "all built-in columns".
  extraColumns: Partial<Record<DisplayView, string[]>>;
  // Default cards-vs-grid mode for the record lists. "" = no company default
  // (the app's built-in "cards" applies).
  viewMode: "" | "cards" | "grid";
}

export const EMPTY_DISPLAY_DEFAULTS: DisplayDefaults = {
  detail: {},
  columns: {},
  extraColumns: {},
  viewMode: "",
};

// Field/column keys come from client-side catalogs (raw record field names and
// grid column ids). Cap sizes so a malformed or malicious body can never bloat
// the settings row; unknown modules/views are dropped entirely.
const MAX_KEYS_PER_LIST = 300;
const MAX_KEY_LENGTH = 120;

// Identity fields the web never offers as addable columns/cells: the locked
// name column and the record header already show them, so a stored entry
// could only ever render a duplicate. Mirrors SUPPRESSED_FIELD_KEYS in
// rmone-web/src/lib/recordFieldCatalog.ts — keep the two in lockstep.
// Dropping them on write means legacy saved docs self-heal on the next save
// and direct API writes can't resurrect a duplicate Title column. No grid
// catalog column id collides (those are lowercase: "id", "name", "client", …).
const SUPPRESSED_IDENTITY_KEYS = new Set<string>([
  "Ticket", "TicketId", "TicketID",
  "Title", "ProjectTitle",
]);

function sanitizeKeyList(input: unknown): string[] {
  if (!Array.isArray(input)) return [];
  const out: string[] = [];
  const seen = new Set<string>();
  for (const v of input) {
    if (typeof v !== "string") continue;
    const s = v.trim();
    if (!s || s.length > MAX_KEY_LENGTH || seen.has(s) || SUPPRESSED_IDENTITY_KEYS.has(s)) continue;
    seen.add(s);
    out.push(s);
    if (out.length >= MAX_KEYS_PER_LIST) break;
  }
  return out;
}

/** Keep only known keys with the right shape — junk can never reach storage or the UI. */
export function sanitizeDisplayDefaults(input: unknown): DisplayDefaults {
  const out: DisplayDefaults = { detail: {}, columns: {}, extraColumns: {}, viewMode: "" };
  if (!input || typeof input !== "object") return out;
  const o = input as Record<string, unknown>;

  const detail = o.detail;
  if (detail && typeof detail === "object") {
    for (const mod of DISPLAY_MODULES) {
      const d = (detail as Record<string, unknown>)[mod];
      if (!d || typeof d !== "object") continue;
      const dd = d as Record<string, unknown>;
      const entry: ModuleDetailDefaults = {
        pinned: sanitizeKeyList(dd.pinned),
        hidden: sanitizeKeyList(dd.hidden),
        budgetPinned: sanitizeKeyList(dd.budgetPinned),
      };
      // Only store modules that actually configure something.
      if (entry.pinned.length || entry.hidden.length || entry.budgetPinned.length) {
        out.detail[mod] = entry;
      }
    }
  }

  const columns = o.columns;
  if (columns && typeof columns === "object") {
    for (const view of DISPLAY_VIEWS) {
      const list = sanitizeKeyList((columns as Record<string, unknown>)[view]);
      if (list.length) out.columns[view] = list;
    }
  }

  // Extra (admin-added) DB-field columns — field-name validity is enforced by
  // the web's catalog on read (coerce); here we only cap size/shape.
  const extra = o.extraColumns;
  if (extra && typeof extra === "object") {
    for (const view of DISPLAY_VIEWS) {
      const list = sanitizeKeyList((extra as Record<string, unknown>)[view]);
      if (list.length) out.extraColumns[view] = list;
    }
  }

  if (o.viewMode === "cards" || o.viewMode === "grid") out.viewMode = o.viewMode;

  return out;
}
