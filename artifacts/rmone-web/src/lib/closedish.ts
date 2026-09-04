// ── PMM (project) terminal-status classification — ONE definition for the
// web app (server twin: isPmmClosedishStatus in api-server rds-provider.ts;
// keep the two in lockstep).
//
// Substring family: the long-standing closed-ish words ("Closed",
// "Closeout", "Project Complete") stay SUBSTRING matches — historical tenant
// data carries many variants and this is the behavior grids always had.
//
// Ending family: the record-page ending buttons write EXACT statuses
// ("Cancelled", "Lost", "Declined"), so these match the WHOLE string only —
// an ACTIVE path stage like "Lost Time Recovery" or "Cancelled Contracts
// Review" must never be filed as closed by a substring hit.
const EXACT_ENDED = new Set(["cancelled", "canceled", "cancel", "lost", "declined"]);

export function isClosedishStatus(status: unknown): boolean {
  const s = String(status ?? "").trim();
  return /closed|complete|closeout/i.test(s) || EXACT_ENDED.has(s.toLowerCase());
}

// Negative endings ONLY — display accent (red) for records that ended badly.
// Exact whole-string matches: "Closeout" / "Project Complete" are normal
// successful phases and must never turn red. Exact "Closed" is deliberately
// EXCLUDED — awarded/won opportunities legitimately end as "Closed", so it
// carries no negative signal on its own.
const RED_ENDED = new Set([
  "cancelled", "canceled", "cancel", "lost", "declined", "dead", "withdrawn",
]);

export function isLostishStatus(status: unknown): boolean {
  return RED_ENDED.has(String(status ?? "").trim().toLowerCase());
}
