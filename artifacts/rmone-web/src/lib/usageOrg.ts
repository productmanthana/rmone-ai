/* ─────────────────────────────────────────────────────────────
 * usageOrg — adoption-by-organization grouping for Usage Analytics.
 *
 * Groups the staff roster by ONE selected canonical org dimension
 * (Division / Business Unit / Department — separate fields, never
 * relabeled or cross-filled: business-unit-separate-entity rule) and
 * marks each person active vs never-active from the usage payload's
 * complete active-name list.
 *
 * Returns null when the roster has no genuine data for THAT dimension
 * (fewer than two groups, or nothing beyond "Unassigned") — the page
 * shows an honest note instead of silently regrouping by another
 * dimension. Extracted from analytics-usage.tsx so the honesty check
 * can assert the no-merge / no-fallback behavior directly.
 * ──────────────────────────────────────────────────────────── */
import type { CardModel } from "@/lib/analyticsCenter";
import { orgDimLabel, type OrgDim, type SectionId } from "@/lib/analyticsCenter";

export type UsageOrgStaff = {
  name: string;
  id?: string | null;
  role?: string | null;
  division?: string | null;
  businessUnit?: string | null;
  department?: string | null;
  utilization?: number | null;
  activeProjects?: number | null;
  totalProjects?: number | null;
};

export type UsageOrgRow = {
  group: string;
  total: number;
  never: number;
  active: number;
  adoptionPct: number | null;
};

export type UsageOrgResult = {
  dim: OrgDim;
  rows: UsageOrgRow[];
  /** Drill/table card — also the PDF/Excel export model (columns follow the dim). */
  card: CardModel;
};

const normalizeIdentityPart = (value: unknown): string =>
  String(value ?? "").trim().toLowerCase().replace(/\s+/g, " ");

/**
 * Usage Analytics is a roster view, so duplicate legacy account rows must not
 * inflate headcount or adoption. Prefer the stable user id; when migrations
 * produced different ids for the same displayed account, use the exact
 * display-name + role + org signature as a conservative legacy fallback.
 */
export function dedupeUsageOrgStaff<T extends UsageOrgStaff>(staff: T[]): T[] {
  const unique: T[] = [];
  const byStableId = new Map<string, number>();
  const byDisplayIdentity = new Map<string, number>();

  const rowScore = (row: T): number =>
    Number(row.totalProjects ?? 0) * 1_000
    + Number(row.activeProjects ?? 0) * 100
    + Number(row.utilization ?? 0);

  for (const row of staff) {
    const stableId = normalizeIdentityPart(row.id);
    const displayName = normalizeIdentityPart(row.name);
    const displayIdentity = displayName
      ? [
          displayName,
          normalizeIdentityPart(row.role),
          normalizeIdentityPart(row.division),
          normalizeIdentityPart(row.businessUnit),
          normalizeIdentityPart(row.department),
        ].join("|")
      : "";
    const existingIndex = stableId
      ? (byStableId.get(stableId) ?? (displayIdentity ? byDisplayIdentity.get(displayIdentity) : undefined))
      : (displayIdentity ? byDisplayIdentity.get(displayIdentity) : undefined);

    if (existingIndex == null) {
      const index = unique.push(row) - 1;
      if (stableId) byStableId.set(stableId, index);
      if (displayIdentity) byDisplayIdentity.set(displayIdentity, index);
      continue;
    }

    if (rowScore(row) > rowScore(unique[existingIndex])) {
      unique[existingIndex] = row;
    }
    if (stableId) byStableId.set(stableId, existingIndex);
    if (displayIdentity) byDisplayIdentity.set(displayIdentity, existingIndex);
  }

  return unique;
}

/**
 * @param staff      roster rows carrying the canonical org fields
 * @param activeNames lower-cased trimmed names of staff ACTIVE in the window.
 *                   Positive-set approach: active = in set, never = not in set.
 *                   This avoids the ROW_CAP truncation problem of the old
 *                   neverActive approach (491 never-active users truncated to
 *                   300 made the remaining 191 appear "active" regardless of
 *                   the selected period).
 * @param dim        the selected org dimension — the ONLY field read
 */
export function usageAdoptionByOrg(
  staff: UsageOrgStaff[],
  activeNames: Set<string>,
  dim: OrgDim,
): UsageOrgResult | null {
  const gmap = new Map<string, { total: number; never: number }>();
  for (const s of dedupeUsageOrgStaff(staff)) {
    const rawVal = dim === "businessUnit" ? s.businessUnit
      : dim === "department" ? s.department
      : s.division;
    const g = ((rawVal ?? "") as string).trim() || "Unassigned";
    const cur = gmap.get(g) ?? { total: 0, never: 0 };
    cur.total++;
    if (!activeNames.has(s.name.toLowerCase().trim())) cur.never++;
    gmap.set(g, cur);
  }
  const rows: UsageOrgRow[] = [...gmap.entries()]
    .map(([group, v]) => ({
      group,
      total: v.total,
      never: v.never,
      active: v.total - v.never,
      adoptionPct: v.total > 0 ? Math.round(((v.total - v.never) / v.total) * 100) : null,
    }))
    .sort((x, y) => y.total - x.total);

  /* Honest absence: a single group or Unassigned-only roster means this
   * dimension carries no real signal — return null, never another dim. */
  const hasSignal = rows.length > 1 && rows.some(r => r.group !== "Unassigned");
  if (!hasSignal) return null;

  const label = orgDimLabel(dim);
  const card: CardModel = {
    id: "usage" as SectionId,
    title: `Adoption by ${label}`,
    takeaway: `Staff enabled vs active by ${label.toLowerCase()} — ${rows.length} groups. Active = at least one recorded action; groups come from each person's ${label.toLowerCase()} only.`,
    stats: [
      { label: "Groups", value: String(rows.length) },
      { label: "Total staff", value: String(rows.reduce((s, r) => s + r.total, 0)) },
    ],
    columns: [
      { key: "group", label, width: 28 },
      { key: "total", label: "Staff", kind: "int" as const, align: "right" as const, width: 12 },
      { key: "active", label: "Active", kind: "int" as const, align: "right" as const, width: 12 },
      { key: "never", label: "Never active", kind: "int" as const, align: "right" as const, width: 14 },
      { key: "adoptionPct", label: "Adoption %", align: "right" as const, width: 14 },
    ],
    rows: rows.map(r => ({
      group: r.group,
      total: r.total,
      active: r.active,
      never: r.never,
      adoptionPct: r.adoptionPct != null ? `${r.adoptionPct}%` : "—",
    })),
  };
  return { dim, rows, card };
}
