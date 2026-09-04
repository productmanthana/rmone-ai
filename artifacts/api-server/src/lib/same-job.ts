/**
 * Server-side duplicate-title classifier for the create-record gate.
 *
 * Mirrors the web's "same job?" voting rules (rmone-web/src/lib/sameJob.ts —
 * keep in lockstep; check-same-job.ts verifies both):
 *  - compare client (CRMCompanyLookup ID), business unit name, division ID
 *  - blank on either side = not comparable = NO VOTE
 *  - a row with zero conflicting comparable fields is POSSIBLY THE SAME JOB
 *
 * Verdicts:
 *  - "possibly-same": at least one existing same-title row could be the same
 *    job (fields agree or nothing comparable) → hard reject, same as the
 *    historical behavior. We must never allow two records for the SAME job.
 *  - "different-job": EVERY existing same-title row conflicts on at least one
 *    comparable field → it's a separate job sharing the name. The create may
 *    proceed, but only with an explicit user confirmation
 *    (ConfirmDuplicateTitle) — the route returns DUP_TITLE_DIFFERENT_JOB
 *    so the client can show a "create anyway?" step.
 */

export interface DupTitleRow {
  ticketId: string;
  client: string;   // CRMCompanyLookup (company FK, varchar)
  bu: string;       // CRMBusinessUnitChoice (persisted by NAME)
  division: string; // DivisionLookup (division FK)
}

export interface DupTitleIncoming { client: string; bu: string; division: string }

export interface DupTitleVerdict {
  kind: "possibly-same" | "different-job";
  /** The row driving the verdict: the possibly-same row, or (for
   *  different-job) the first conflicting row — used in user messaging. */
  ticketId: string;
  /** For different-job: the fields that differ on the reported row. */
  conflictFields: string[];
}

const norm = (v: unknown): string => String(v ?? "").trim().toLowerCase();

export function classifyDuplicateTitle(
  rows: readonly DupTitleRow[],
  incoming: DupTitleIncoming,
): DupTitleVerdict | null {
  if (rows.length === 0) return null;
  let firstConflict: { ticketId: string; fields: string[] } | null = null;
  for (const r of rows) {
    const diffs: string[] = [];
    const cmp = (label: string, a: string, b: string) => {
      const na = norm(a); const nb = norm(b);
      if (!na || !nb) return; // blank → not comparable, no vote
      if (na !== nb) diffs.push(label);
    };
    cmp("client", incoming.client, r.client);
    cmp("business unit", incoming.bu, r.bu);
    cmp("division", incoming.division, r.division);
    if (diffs.length === 0) {
      // Agrees (or nothing comparable) → could be the same job. One such row
      // is enough to block outright — never create a second record for it.
      return { kind: "possibly-same", ticketId: r.ticketId, conflictFields: [] };
    }
    if (!firstConflict) firstConflict = { ticketId: r.ticketId, fields: diffs };
  }
  return {
    kind: "different-job",
    ticketId: firstConflict!.ticketId,
    conflictFields: firstConflict!.fields,
  };
}
