/**
 * Shared "same job?" comparison — the single source of truth for deciding
 * whether two same-titled records describe the same real-world job.
 *
 * Title alone is a WEAK signal: names legitimately repeat across different
 * jobs ("Holiday", "Renovation"). A title hit only counts as the SAME job
 * when no comparable secondary field (client, business unit, division —
 * plus lead users where available) disagrees.
 *
 * Blank on either side = not comparable = NO VOTE, so sparse records still
 * match (conversion copies these fields verbatim when set). Only a real
 * value-vs-value mismatch votes "different".
 *
 * Consumers:
 *  - projects.tsx  — converted-opp/lead popup detection (sameJobFields)
 *  - project-detail.tsx — "may already be converted" verify notice
 *    (scoreSameJobRaw + pickBestSameJobMatch)
 *  - api-server has a mirrored server-side classifier for the create-record
 *    duplicate-title gate (lib/same-job.ts) — keep the voting rules in
 *    lockstep; check-same-job.ts verifies both.
 */

export const normJobField = (v: unknown): string => String(v ?? "").trim().toLowerCase();

/** Mapped-object comparison (client/bu/division already extracted).
 *  True = no comparable field disagrees → treat as the same job. */
export function sameJobFields(
  a: { client?: string; bu?: string; division?: string },
  b: { client?: string; bu?: string; division?: string },
): boolean {
  return ([[a.client, b.client], [a.bu, b.bu], [a.division, b.division]] as const)
    .every(([x, y]) => {
      const nx = normJobField(x); const ny = normJobField(y);
      return !nx || !ny || nx === ny;
    });
}

export interface SameJobScore {
  /** Comparable fields that AGREE ("client", "business unit", "division", "leads"). */
  same: string[];
  /** Comparable fields that CONFLICT — any entry means "likely a different job". */
  diff: string[];
}

/**
 * Score a raw PMM/OPM record (as returned by the list API — raw core2 column
 * names) against an already-normalized opp side. `opp` values must be
 * pre-normalized with normJobField; `opp.leads` holds normalized GUIDs AND
 * display names (the *User columns store comma lists of either).
 *
 * `leadFieldNames` = the *User column names to scan on the raw record
 * (callers pass KP_FIELD_ROLES fields). Rows with no lead values cast no
 * lead vote.
 */
export function scoreSameJobRaw(
  opp: { client: string; bu: string; division: string; leads: ReadonlySet<string> },
  raw: Record<string, unknown>,
  leadFieldNames: readonly string[],
): SameJobScore {
  const same: string[] = []; const diff: string[] = [];
  const cmp = (label: string, a: string, b: string) => {
    if (!a || !b) return; // one side blank → not comparable, no vote
    (a === b ? same : diff).push(label);
  };
  cmp("client", opp.client, normJobField(raw.CRMCompanyLookupName ?? raw.CompanyName ?? raw.CRMCompanyNameChoice ?? raw.ClientName));
  cmp("business unit", opp.bu, normJobField(raw.CRMBusinessUnitChoice ?? raw.BusinessUnitName));
  cmp("division", opp.division, normJobField(raw.DivisionName ?? raw.DivisionLookup));
  if (opp.leads.size > 0) {
    const rowLeads = leadFieldNames
      .flatMap((f) => String(raw[f] ?? "").split(/[,;]/))
      .map(normJobField).filter(Boolean);
    if (rowLeads.length > 0) {
      (rowLeads.some((t) => opp.leads.has(t)) ? same : diff).push("leads");
    }
  }
  return { same, diff };
}

export interface SameJobCandidate extends SameJobScore { id: string }

/** Multiple same-title candidates: keep the strongest (fewest conflicts,
 *  then most agreements) — that's the one worth pointing the user at. */
export function pickBestSameJobMatch(candidates: readonly SameJobCandidate[]): SameJobCandidate | null {
  let best: SameJobCandidate | null = null;
  for (const c of candidates) {
    if (!c.id) continue;
    if (!best || c.diff.length < best.diff.length ||
        (c.diff.length === best.diff.length && c.same.length > best.same.length)) {
      best = c;
    }
  }
  return best;
}
