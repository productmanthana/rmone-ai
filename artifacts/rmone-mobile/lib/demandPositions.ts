/* Shared demand-position math (mobile copy — keep in lockstep with
 * artifacts/rmone-web/src/lib/demandPositions.ts).
 *
 * RM ONE's GetResourceDemandItems returns ONE ROW PER WEEK per open position,
 * so a single requisition that runs for months arrives as dozens of near-
 * identical weekly rows. Counting those rows (or summing their PctAllocation)
 * over-states both the number of open requisitions and the FTE demand. The
 * API proxy already disambiguates genuinely-separate slots on the same project
 * by suffixing the Role ("Plumbing Engineer (2)"), so a unique position is
 * (TicketId + Role).
 *
 * CANONICAL COUNTING RULES (keep every surface consistent — home,
 * Daily Briefing, Weekly Demand popup, reports):
 *  - A "position" is one (TicketId, Role) pair, never a raw weekly row.
 *  - When counting demand inside a time window, only positions that have
 *    unfilled HOURS in that window count (PctAllocation > 0 on at least one
 *    overlapping row). Zero-hour placeholder weeks are noise, not demand —
 *    this is the same rule the Weekly Demand drill-down popup applies.
 *  - Contract value "at risk" counts each project ONCE, no matter how many
 *    open positions or weekly rows it has.
 */

/** Collapse weekly demand rows into one record per (TicketId, Role) position:
 *  earliest start, latest end, and the AVERAGE weekly % allocation (which is
 *  the concurrent FTE for that one position). */
export function collapseDemandsToPositions(rows: any[]): any[] {
  const groups = new Map<string, any[]>();
  for (const r of rows) {
    if (!r) continue;
    const key = `${String(r.TicketId ?? "")}||${String(r.Role ?? "")}`;
    let g = groups.get(key);
    if (!g) { g = []; groups.set(key, g); }
    g.push(r);
  }
  const positions: any[] = [];
  for (const arr of groups.values()) {
    if (arr.length === 0) continue;
    let minStart = Infinity;
    let maxEnd = -Infinity;
    let pctSum = 0;
    let pctCount = 0;
    let rep = arr[0];
    let anySoft = false;
    for (const d of arr) {
      const s = d?.AllocationStartDate ? new Date(d.AllocationStartDate).getTime() : NaN;
      const e = d?.AllocationEndDate ? new Date(d.AllocationEndDate).getTime() : NaN;
      if (!isNaN(s) && s < minStart) { minStart = s; rep = d; }
      if (!isNaN(e) && e > maxEnd) maxEnd = e;
      const p = Number(d?.PctAllocation);
      if (Number.isFinite(p)) { pctSum += p; pctCount++; }
      if (d?.SoftAllocation) anySoft = true;
    }
    const pct = pctCount > 0 ? pctSum / pctCount : (Number(rep?.PctAllocation) || 0);
    positions.push({
      ...rep,
      PctAllocation: pct,
      AllocationStartDate: isFinite(minStart) ? new Date(minStart).toISOString() : rep?.AllocationStartDate,
      AllocationEndDate: isFinite(maxEnd) ? new Date(maxEnd).toISOString() : rep?.AllocationEndDate,
      SoftAllocation: anySoft,
      _weekRows: arr.length,
    });
  }
  return positions;
}

/** Window rule: keep only rows that carry unfilled hours (PctAllocation > 0).
 *  Apply to the window-overlapping row slice BEFORE collapsing so a position
 *  whose only in-window weeks are zero-hour placeholders doesn't count —
 *  mirrors the Weekly Demand popup's ctxHrs > 0 filter. */
export function fundedDemandRows(rows: any[]): any[] {
  return rows.filter((r) => (Number(r?.PctAllocation) || 0) > 0);
}

/** Contract value across demand rows/positions counting each project once. */
export function uniqueProjectDemandValue(rows: any[]): number {
  const seen = new Set<string>();
  let sum = 0;
  for (const d of rows) {
    if (!d) continue;
    const t = String(d.TicketId ?? "");
    if (seen.has(t)) continue;
    seen.add(t);
    sum += Number(d.ApproxContractValue ?? 0) || 0;
  }
  return sum;
}
