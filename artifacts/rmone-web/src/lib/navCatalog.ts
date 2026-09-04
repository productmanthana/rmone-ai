/**
 * The web sidebar's menu catalog (#88) — the ONE list both the Shell and the
 * Settings → Navigation page build from, so an item can never appear in one
 * and be missing from the other. Icons stay in Shell.tsx (they're a rendering
 * concern); this module owns the stable ids, routes, labels and flags.
 *
 * Ids are persisted in each tenant's navigation-visibility config
 * (api-server lib/access-control.ts, scope "navvis:<tenant>") — NEVER rename
 * an id once shipped or existing configs silently stop applying to that item.
 */

export interface NavDef {
  /** Stable id persisted in tenant nav-visibility configs. */
  id: string;
  path: string;
  label: string;
  /** Optional muted sublabel rendered after the label, e.g. "People (Resources)". */
  sub?: string;
  /** Only rendered for admins; the nav config can neither reveal nor hide it for them. */
  adminOnly?: boolean;
  /** Gated on the `canImport` capability (controlled via Access Levels settings). */
  importGated?: boolean;
  /** Hidden from read-only accounts (canEdit === false). */
  editorOnly?: boolean;
  /** Home — the safe redirect target for hidden pages; can never be hidden. */
  neverHide?: boolean;
  /** When set, the item is only shown for tenants whose label is in this list.
   * An empty list deliberately disables the item for all regular tenants. */
  allowedTenants?: string[];
  /**
   * For /projects entries only: EVERY ?view= value this menu item covers
   * (after the legacy "Opps"→"Opportunities" normalization). Defaults to the
   * single view in `path`. "Leads & Opportunities" is ONE menu item whose page
   * has two tabs, and switching tabs rewrites the URL to ?view=Opportunities —
   * so hiding it must block (and visiting it must highlight) BOTH views, not
   * just the one the sidebar links to.
   */
  matchViews?: string[];
  /**
   * Additional pathnames this menu item covers beyond `path`. Used when ONE
   * menu item fronts a page with tabs that navigate to distinct routes
   * (e.g. "Actuals vs Forecast" → /actuals-forecast, /forecast-report and
   * /executive-forecast). Hiding the item must block — and visiting any of
   * them must highlight — EVERY listed path, not just the one the nav links to.
   */
  matchPaths?: string[];
  /**
   * Sidebar grouping (#813): render this item as an indented sub-item of the
   * given catalog id, always directly beneath it (a saved custom order can
   * never split the pair — the Shell regroups after ordering). Display-only:
   * the child keeps its own route, role flags and hide rules. When the parent
   * is not visible to the viewer, the child renders as a normal top-level
   * item so it never silently disappears.
   */
  groupUnder?: string;
  /** Product-disabled navigation item; keep its route available to internal links. */
  navigationHidden?: boolean;
  /** Default surface before an admin chooses a placement. */
  defaultSurface?: NavSurface;
}

export type NavSurface = "vertical" | "horizontal";

/** Tenant labels allowed to use the limited forecast surfaces. */
export const LIMITED_MANAGER_FORECAST_TENANTS = ["test20", "test21"] as const;

/** Compare tenant-label allowlists consistently, ignoring casing/spacing. */
export function tenantMatchesAllowlist(
  tenant: string | null | undefined,
  allowedTenants?: readonly string[],
): boolean {
  if (allowedTenants === undefined) return true;
  const normalized = (tenant ?? "").trim().toLowerCase();
  return allowedTenants.some((allowed) => allowed.trim().toLowerCase() === normalized);
}

// Order and labels follow the client's navigation feedback (#813): every
// module lives in the LEFT sidebar (Reports and Analytics Center included),
// the top bar is reserved for feature shortcuts (Quick Actions + future
// client-specific shortcuts), Actuals vs Forecast is grouped under Analytics
// Center, with admin-only Usage Analytics kept near the bottom because it is
// intended for a small number of organization users.
// Several items are views of the same /projects page selected via the
// ?view query param (CRM → Companies, Leads & Opportunities →
// Opportunities/Leads tabs, Archive → closed records), so active-state
// matching compares the query string too, not just the pathname — see
// navDefMatches below.
export const NAV_DEFS: NavDef[] = [
  { id: "home",      path: "/",                                    label: "Home", neverHide: true },
  { id: "ai",        path: "/chat",                                label: "AI" },
  { id: "quickActions", path: "/quick-actions",                    label: "Quick Actions", defaultSurface: "horizontal" },
  // Manager is a standard tenant-wide workspace surface. Keep it separate
  // from the limited Actuals vs Forecast preview below.
  { id: "manager",   path: "/manager",                             label: "Manager", defaultSurface: "horizontal" },
  { id: "people",    path: "/resources",                           label: "People", sub: "Resources" },
  { id: "crm",       path: "/projects?view=Companies",             label: "CRM", sub: "Contacts & Companies" },
  { id: "leads",     path: "/projects?view=Leads",                 label: "Leads & Opportunities", matchViews: ["Leads", "Opportunities"] },
  { id: "projects",  path: "/projects",                            label: "Projects", sub: "Pipeline & Active" },
  { id: "forecast",  path: "/forecast",                            label: "Forecast" },
  // Covers more than pipeline — label renamed from "Pipeline Reports" (#813).
  // The id is persisted in tenant nav configs and NEVER changes.
  { id: "reports",   path: "/reports",                             label: "Reports" },
  { id: "analytics", path: "/analytics",                           label: "Analytics", editorOnly: true, allowedTenants: [] },
  { id: "analyticsCenter", path: "/analytics-center",              label: "Analytics Center" },
  { id: "actualsForecast", path: "/actuals-forecast",              label: "Actuals vs Forecast", sub: "Graphs & Reports", editorOnly: true,
    allowedTenants: [...LIMITED_MANAGER_FORECAST_TENANTS],
    matchPaths: ["/forecast-report", "/executive-forecast"],
    groupUnder: "analyticsCenter", navigationHidden: true },
  { id: "archive",   path: "/projects?view=Projects&filter=Closed", label: "Archive", sub: "Closed Records" },
  { id: "alerts",    path: "/alerts",                              label: "Alerts" },
  { id: "import",    path: "/import",                              label: "Import", importGated: true },
  { id: "settings",  path: "/configuration",                       label: "Settings", sub: "Admin", adminOnly: true },
  // Admin/C-suite/IT-only usage telemetry — intentionally above System at
  // the bottom of the sidebar because it is used by very few people.
  { id: "usageAnalytics", path: "/usage-analytics",                label: "Usage Analytics" },
  { id: "system",    path: "/system-health",                       label: "System", adminOnly: true },
];

const NAV_ID_BY_LOWER = new Map(NAV_DEFS.map((def) => [def.id.toLowerCase(), def.id]));

/** API storage is case-normalized; convert payload ids back to the catalog's
 * stable spelling before any Settings/Shell lookup. Unknown ids stay lowercase
 * so forward-compatible documents still round-trip safely. */
export function canonicalNavId(value: unknown): string {
  const lower = String(value ?? "").trim().toLowerCase();
  return NAV_ID_BY_LOWER.get(lower) ?? lower;
}

/**
 * True when the nav entry points at the given location, including the
 * /projects?view=… variants that share one pathname. For /projects entries
 * the view (and Closed filter) must match exactly so only ONE of the four
 * /projects-based rows matches at a time. Non-/projects entries also match
 * their sub-routes (e.g. hiding People blocks /resources AND /resources/…).
 */
export function navDefMatches(
  def: { path: string; matchViews?: string[]; matchPaths?: string[] },
  location: string,
  search: string,
): boolean {
  const [defPath, defQuery = ""] = def.path.split("?");
  if (defPath === "/projects") {
    if (location !== "/projects") return false;
    const cur = new URLSearchParams(search);
    const want = new URLSearchParams(defQuery);
    const rawView = cur.get("view");
    const curView = rawView === "Opps" ? "Opportunities" : (rawView ?? "Projects");
    const wantViews = def.matchViews ?? [want.get("view") ?? "Projects"];
    const curFilter = cur.get("filter") ?? "";
    const wantFilter = want.get("filter") ?? "";
    return wantViews.includes(curView) && curFilter === wantFilter;
  }
  /* Tab-strip siblings: a def that fronts several routes (matchPaths) owns
   * those pathnames too — for both active-highlight and admin hiding. */
  if (def.matchPaths?.some((p) => location === p || location.startsWith(p + "/"))) {
    return true;
  }
  /* Sub-route matching requires the "/" boundary so sibling paths that share
   * a prefix stay independent (e.g. /analytics vs /analytics-center). */
  return location === defPath || (defPath !== "/" && location.startsWith(defPath + "/"));
}
