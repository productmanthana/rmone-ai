/**
 * LIST-view slimming for GET /records/:module payloads (RDS tenants).
 *
 * The records list endpoint used to ship every column of every row — on big
 * tenants that is multi-MB JSON (test20 OPM ≈ 15 MB raw) that the browser
 * re-parses on every grid visit and cache refresh. List consumers (web /
 * mobile grids, pickers, dashboards, reports) only render populated fields,
 * so the list view applies three VALUE-PRESERVING rules. The record DETAIL
 * endpoint (getRecordDetail) keeps returning full rows, and internal
 * consumers (chat, decision support, onboarding template exports) stay on
 * the default full view.
 *
 *  1. EMPTY values (null / undefined / "") are omitted. Every audited list
 *     consumer treats "absent" and "empty" identically — cells render "—"
 *     and alias fallback chains fall through either way. `false` and `0` are
 *     NEVER omitted: tri-state reads exist (web projectDates.ts stops its
 *     status-heuristic fallback on `Closed === false`, and 0 survives `??`
 *     chains that "" does not).
 *  2. ALIAS TWINS are omitted when byte-identical to the canonical field that
 *     every consumer fallback chain also checks (e.g. getRecords backfills
 *     CRMCompanyLookupName FROM CompanyName, then shipped both). A twin that
 *     DIFFERS from its canonical is kept — it carries real information then.
 *     Only add a pair here after auditing that NO web/mobile consumer reads
 *     the twin without its canonical in the same fallback chain.
 *  3. LONG FREE-TEXT fields are truncated to LIST_TEXT_CAP chars — lists only
 *     show previews / hover tooltips; editing and full text live on the
 *     detail page. Only fields in the explicit allowlist are ever truncated:
 *     CustomLeadsJson (JSON.parsed by the web grid) and person `*User`
 *     columns (comma lists of GUIDs/names) must never be cut mid-value.
 *
 * NEVER feed slimmed rows into a write path or an editor prefill that saves
 * back (truncated text would overwrite full text). If a new list consumer
 * needs to distinguish "" from absent, or reads a twin field standalone,
 * remove the offending rule/pair here instead of special-casing the client.
 * Mobile persists list rows to disk — any change to these rules is a payload
 * shape change: bump MODULE_CACHE_PREFIX in artifacts/rmone-mobile/lib/api.ts.
 */

export type RecordsView = "full" | "list";

/** Truncation cap for the long-text allowlist below — roughly two grid-cell
 *  tooltip lines; the web/mobile note previews clamp far shorter. */
export const LIST_TEXT_CAP = 280;

/** Long free-text columns truncated in list view (rule 3). */
export const LIST_TRUNCATED_TEXT_FIELDS: ReadonlySet<string> = new Set([
  "Description",
  "Note",
  "Comment",
  "ProjectSummaryNote",
  "AnalysisDetails",
  "WorkDescription",
  "ServicesDescription",
  "ClientAskDescription",
  "ContractNotes",
  "EstProjectSpendComment",
  "ProjectCostNote",
  "NextActivity",
  "NextMilestone",
]);

/** [twin, canonical] pairs for rule 2 — twin omitted only when its value is
 *  strictly equal to the canonical's. Audit trail (Aug 2026): all web+mobile
 *  reads of the twins sit in fallback chains that check the canonical too
 *  (web projects/quickActions/dashboardData/home/sameJob/reportData/forecast/
 *  create pages, mobile home/forecast intelligence). */
export const LIST_ALIAS_TWINS: ReadonlyArray<readonly [string, string]> = [
  ["CompanyName", "CRMCompanyLookupName"],
  ["ShortName", "Title"],
  ["BusinessUnitName", "CRMBusinessUnitChoice"],
];

const TWIN_CANONICAL: ReadonlyMap<string, string> = new Map(LIST_ALIAS_TWINS);

/** Slim one record for the list view. Returns a NEW object; the input row is
 *  not mutated (getRecords may hand the same rows to other post-processing). */
export function slimListRecord(rec: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const k of Object.keys(rec)) {
    const v = rec[k];
    if (v === null || v === undefined || v === "") continue; // rule 1 — empties
    const canonical = TWIN_CANONICAL.get(k);
    if (canonical !== undefined && v === rec[canonical]) continue; // rule 2 — identical twin
    if (typeof v === "string" && v.length > LIST_TEXT_CAP && LIST_TRUNCATED_TEXT_FIELDS.has(k)) {
      out[k] = v.slice(0, LIST_TEXT_CAP); // rule 3 — long text preview
      continue;
    }
    out[k] = v;
  }
  return out;
}

/** Slim a whole list payload (see slimListRecord). */
export function slimListRecords(rows: Array<Record<string, unknown>>): Array<Record<string, unknown>> {
  return rows.map(slimListRecord);
}
