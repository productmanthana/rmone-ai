import type { ActionDetail } from "@/lib/homeIntelligence";

/**
 * Shared "Go to issue" deep-link derivation for AI-generated warning /
 * critical / insight items. Used by RiskSidePanel, KpiFormulaPanel and
 * the pages that feed them so every surface routes to the exact same
 * place for the same data.
 *
 * Canon: a record-level link is ONLY produced from the hidden _ticket/_id
 * fields the live data builders attach — never text-sniffed from visible
 * cells or descriptions — so a link always points at a real record. When
 * no confident target exists the helpers return null and the caller
 * renders no button (a missing link is better than a wrong one).
 */

export type IssueLink = { to: string; label: string };

// Matches the year-prefixed format (PMM-23-001234), the shorter format
// used by older/imported records (OPM-00156, LEM-00001) AND custom
// multi-segment client IDs (PRJ-2026-001). The trailing (?:-\d{1,6})*
// is REQUIRED so custom IDs are never clipped mid-way (PRJ-2026-001
// must never match as just "PRJ-2026" — that routes to a non-existent
// record).
export const TICKET_RE = /[A-Z]{2,4}-\d{2,6}(?:-\d{1,6})*/;

export function validTicket(t?: string | null): string | null {
  if (!t) return null;
  const m = String(t).trim().match(TICKET_RE);
  return m ? m[0] : null;
}

// Global variant for extracting EVERY ticket ID from free-form copy
// (alert titles/subs that enumerate several projects). String.match with
// a /g regex always scans the whole string, so the shared const is safe.
// Boundary lookarounds stop substring false positives in prose — without
// them "COVID-19" would extract "OVID-19" and "AB-12345678" would clip
// to "AB-123456". The bare TICKET_RE stays as-is for trusted _ticket
// fields, which are exact IDs rather than free text.
const TICKET_RE_G = new RegExp(
  `(?<![A-Za-z0-9-])${TICKET_RE.source}(?![A-Za-z0-9])`,
  "g",
);

/** All distinct ticket IDs mentioned in a piece of free-form text, in
 *  order of first appearance. Used by the risk-detail builders so an
 *  alert like "OPM-00195, OPM-00424 … are on hold" renders one
 *  selectable row PER project instead of a single bundled row. */
export function extractTicketIds(text?: string | null): string[] {
  const m = String(text ?? "").match(TICKET_RE_G) ?? [];
  return [...new Set(m)];
}

const LEADING_TICKET_RE = new RegExp(
  `^${TICKET_RE.source}(?![A-Za-z0-9])\\s*[—-]\\s*`,
);

/** Strip a leading "PMM-26-001234 — " prefix from an alert title. */
export function stripLeadingTicket(text?: string | null): string {
  return String(text ?? "").replace(LEADING_TICKET_RE, "").trim();
}

/** Record-level link for one detail-table row. */
export function deriveRowLink(
  row: Record<string, unknown> | null | undefined,
): IssueLink | null {
  if (!row) return null;
  // Portfolio-level / curated sample rows never link anywhere.
  if (String(row._aggregate ?? "") === "true") return null;
  const t = validTicket(String(row._ticket ?? row._id ?? ""));
  if (t) {
    // Use the row's visible "title" column as the button label when it's
    // short enough and doesn't already look like a ticket ID — this gives
    // "Open ABN Amro" instead of the less informative "Open OPM-00156".
    // Strip any leading ticket prefix the data builder may have added
    // (e.g. "OPM-00156 · ABN Amro" → "ABN Amro").
    const rawTitle = typeof row.title === "string" ? row.title.trim() : "";
    const name = rawTitle.replace(/^[A-Z]{2,4}-[\d-]+\s*[·•\-]\s*/i, "").trim();
    const label =
      name && name.length >= 3 && name.length <= 35 ? `Open ${name}` : `Open ${t}`;
    return { to: `/project/${encodeURIComponent(t)}`, label };
  }
  // Person-level rows (over-allocation / workload tables). A person
  // spread across several projects has no single record to open, so the
  // row links to their line on Resources → Timeline instead — the one
  // place that shows every allocation side by side.
  const person = typeof row._person === "string" ? row._person.trim() : "";
  if (person) {
    const personId = typeof row._personId === "string" ? row._personId.trim() : "";
    if (personId) {
      const displayName = person !== personId ? person : "person";
      return {
        to: `/resources?view=Staff&openProfile=${encodeURIComponent(personId)}`,
        label: `Open ${displayName}'s profile`,
      };
    }
    return {
      to: `/resources?view=Timeline&q=${encodeURIComponent(person)}`,
      label: `Open ${person.split(" ")[0]}'s timeline`,
    };
  }
  return null;
}

/** When a detail table has exactly ONE distinct real record behind it,
 *  the category-level button may jump straight to that record. */
export function uniqueRowLink(
  detail: ActionDetail | null | undefined,
): IssueLink | null {
  const rows = detail?.rows ?? [];
  let found: IssueLink | null = null;
  for (const row of rows) {
    const link = deriveRowLink(row as Record<string, unknown>);
    if (!link) continue;
    if (found && found.to !== link.to) return null;
    found = link;
  }
  return found;
}

/** Pull a person name out of over-allocation style detail rows. */
export function personFromRows(
  detail: ActionDetail | null | undefined,
): string | null {
  const rows = detail?.rows ?? [];
  for (const row of rows) {
    const r = row as Record<string, unknown>;
    for (const key of ["resource", "name", "person", "staff"]) {
      const v = r[key] ?? r[key.charAt(0).toUpperCase() + key.slice(1)];
      if (typeof v === "string" && /^[A-Z][\p{L}'.-]+ [A-Z]/u.test(v.trim())) {
        return v.trim();
      }
    }
  }
  return null;
}

/** Person name ONLY when the detail rows contain exactly one distinct
 *  person — a multi-person table must never get a person-specific link. */
export function uniquePersonFromRows(
  detail: ActionDetail | null | undefined,
): string | null {
  const rows = detail?.rows ?? [];
  const names = new Set<string>();
  for (const row of rows) {
    const r = row as Record<string, unknown>;
    for (const key of ["resource", "name", "person", "staff"]) {
      const v = r[key] ?? r[key.charAt(0).toUpperCase() + key.slice(1)];
      if (typeof v === "string" && /^[A-Z][\p{L}'.-]+ [A-Z]/u.test(v.trim())) {
        names.add(v.trim());
        break;
      }
    }
    if (names.size > 1) return null;
  }
  return names.size === 1 ? Array.from(names)[0] : null;
}

export function staffLink(person?: string | null): IssueLink {
  return person
    ? {
        to: `/resources?view=Staff&q=${encodeURIComponent(person)}`,
        label: `Open ${person.split(" ")[0]}'s workload`,
      }
    : { to: "/resources?view=Staff", label: "Open staff workload" };
}

export const DEMAND_LINK: IssueLink = {
  to: "/resources?view=Demand",
  label: "Review open demands",
};

/** Query params appended to a /project/:id link raised from a demand /
 *  unfilled-position context so the project page opens with the Team
 *  section expanded and the open-position rows highlighted. */
export const TEAM_FOCUS_PARAMS = "section=team&highlight=open";

/** Append the team-focus params to a record-level project link. Links that
 *  already carry a query string (or aren't project links) pass through. */
export function withTeamFocus(link: IssueLink | null): IssueLink | null {
  if (!link) return null;
  if (!link.to.startsWith("/project/") || link.to.includes("?")) return link;
  return { ...link, to: `${link.to}?${TEAM_FOCUS_PARAMS}` };
}

/** True when a detail panel is about unfilled demand / open positions.
 *  Detected from (a) a category-level target that points at the demand
 *  queue, or (b) demand phrasing in the detail's own title/subtitle —
 *  same keyword canon as classifyIssueTarget below. */
export function isDemandIssueContext(
  detail: ActionDetail | null | undefined,
  fallback?: IssueLink | null,
): boolean {
  if ((fallback?.to ?? "").startsWith(DEMAND_LINK.to)) return true;
  if ((detail?.goTo?.to ?? "").startsWith(DEMAND_LINK.to)) return true;
  const text = [detail?.title ?? "", detail?.subtitle ?? ""]
    .join(" ")
    .toLowerCase();
  const isDemand =
    /\breqs?\b|demand|unfilled|awaiting fill|open position|vacan|shortfall|hiring|no.{0,12}coverage/.test(text);
  const isOverAlloc =
    /over-?alloc|burnout|overload|over capacity|\b1[0-9]{2}%|utilization/.test(text);
  return isDemand && !isOverAlloc;
}

export const PIPELINE_LINK: IssueLink = {
  to: "/projects?view=Opportunities",
  label: "Review pipeline",
};
export const PROJECTS_LINK: IssueLink = {
  to: "/projects",
  label: "Review projects",
};
export const FORECAST_LINK: IssueLink = {
  to: "/forecast",
  label: "Analyse in Forecast",
};
export const STAFF_LIST_LINK: IssueLink = {
  to: "/resources?view=Staff",
  label: "Open staff list",
};

/**
 * Category-level classification for free-form item text. Demand/hiring
 * signals are checked first because phrases like "capacity shortfall ·
 * 8 reqs" mention capacity but are really unfilled-demand problems.
 */
export function classifyIssueTarget(args: {
  title?: string;
  subtitle?: string;
  detail?: ActionDetail | null;
}): IssueLink | null {
  const unique = uniqueRowLink(args.detail);
  if (unique) return unique;

  const text = [
    args.title ?? "",
    args.subtitle ?? "",
    args.detail?.title ?? "",
    args.detail?.subtitle ?? "",
  ]
    .join(" ")
    .toLowerCase();

  // "Projects with NO demand records" is a project-side gap — the fix is
  // opening each project and adding a staffing plan, not the demand queue
  // (which lists positions that already exist). Checked BEFORE the generic
  // demand keywords so "no demand" never routes to Resources → Demand.
  const isNoDemandProject =
    /\bno (?:staffing |resource[- ])?demand\b|no demand (?:records?|data)|demand (?:records?|data) on file/.test(text) &&
    /\bno\b|without/.test(text);
  // On-hold work — route to the record list that owns those tickets:
  // OPM-prefixed ids live under the Opportunities view, otherwise Projects.
  const isOnHold = /\bon hold\b/.test(text);

  const isDemand =
    /\breqs?\b|demand|unfilled|awaiting fill|open position|vacan|shortfall|hiring|no.{0,12}coverage/.test(text);
  const isOverAlloc =
    /over-?alloc|burnout|overload|over capacity|\b1[0-9]{2}%|utilization/.test(text);
  const isBench = /\bbench\b|available now/.test(text);
  const isSchedule =
    /overdue|past target|due (this|next|in)|milestone|deadline|behind schedule|schedule risk/.test(text);
  const isPipeline = /pipeline|opportunit|win rate|\bbid\b|closing|pursuit/.test(text);
  const isMoney = /revenue|margin|contract value|backlog|cash|\$\d/.test(text);

  if (isNoDemandProject) {
    return { to: "/projects", label: "Review projects" };
  }
  if (isOnHold) {
    return /\bopm-\d/.test(text)
      ? { to: "/projects?view=Opportunities", label: "Review on-hold work" }
      : { to: "/projects", label: "Review on-hold work" };
  }
  if (isDemand && !isOverAlloc) return DEMAND_LINK;
  if (isOverAlloc) return staffLink(uniquePersonFromRows(args.detail));
  if (isBench) return STAFF_LIST_LINK;
  if (isSchedule) return PROJECTS_LINK;
  if (isPipeline) return PIPELINE_LINK;
  if (isMoney) return PROJECTS_LINK;
  return null;
}

/**
 * Compose the footer link for a detail modal / side panel.
 * Priority: the user's selected row (exact record) → a single-record
 * table (exact record) → caller-supplied fallback → the goTo the data
 * builder attached to the detail → null (no button).
 */
export function effectiveIssueLink(
  detail: ActionDetail | null | undefined,
  fallback?: IssueLink | null,
  selectedRow?: Record<string, unknown> | null,
): IssueLink | null {
  const link =
    (selectedRow ? deriveRowLink(selectedRow) : null) ??
    uniqueRowLink(detail) ??
    fallback ??
    detail?.goTo ??
    null;
  // Demand-context record links land on the project's Team section with
  // the open-position rows highlighted — that's where the fix happens.
  return isDemandIssueContext(detail, fallback) ? withTeamFocus(link) : link;
}
