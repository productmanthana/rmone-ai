// ─────────────────────────────────────────────────────────────────────────────
// Recruitment Analytics aggregation (Analytics Center → Recruitment page).
//
// Pure math: per ROLE over a selected period,
//   Recruitment Capacity Variance = Available Hours − Required Hours
//     negative = shortage (recruitment need) · positive = surplus · 0 = matched
//
// Available hours (per person-week, summed into the person's role):
//   per WORKING day: company holidays contribute nothing, every other working
//   day contributes (fullWeekHours ÷ workingDays) scaled by the person's
//   remaining leave availability % for THAT day. Weekend/non-working-day
//   leave never deducts, and leave on a holiday workday never deducts twice.
//   (Day math lives in @workspace/alloc-math — weekCapacityHours /
//    weekAvailableHours are the ONE calendar-capacity choke point)
//
// Required hours:
//   • staffed rows — weekly expansion mirroring financial-analytics semantics:
//     hours-win over pct rows, shorter-span hours rows claim weeks first,
//     PctAllocation > 150 on assigned rows = raw hours over the span,
//     168 h/week integrity cap. Hours attribute to the ASSIGNED PERSON's
//     roster role (a booked Mechanical Engineer consumes ME capacity, whatever
//     the slot was labeled).
//   • open demand rows — weekly % × fullWeekHours per covered week, grouped by
//     the requested role. Demand may exceed 100% (multi-FTE) — no cap.
//   Required hours are used AS BOOKED: holidays reduce capacity only, never
//   the requirement side (otherwise the deduction would count twice).
//
// Honesty rules: no headcount conversion, no CEILING — results stay in hours.
// People without a recorded role land in "No role recorded" rather than being
// silently dropped. Weeks are UTC-Monday keyed (date-only ISO inputs).
// ─────────────────────────────────────────────────────────────────────────────
import {
  weekCapacityHours, weekAvailableHours, parseHolidaySet, workingDaysPerWeek,
  type AvailabilityWindow,
} from "@workspace/alloc-math";

const DAY = 86_400_000;
const WEEK = 7 * DAY;
const MAX_WEEKS_PER_ROW = 530; // ~10 years — junk-date guard (same idea as financial-analytics)

export const NO_ROLE_LABEL = "No role recorded";

/** Staffed allocation row (subset of FinAllocRow — person is non-empty). */
export interface RecruitStaffedRow {
  person: string;   // resource GUID
  ticket: string;
  start: string;    // ISO yyyy-mm-dd
  end: string;
  hours: number;    // AllocationHour (0 when absent)
  pct: number;      // PctAllocation (may hold raw hours — see rules above)
}

/** Open-demand weekly row (from getResourceDemands — already normalized). */
export interface RecruitDemandRow {
  ticketId: string;
  role: string;     // normalized role — hour GROUPING only (dup suffix stripped)
  slotKey?: string; // unique position identity within the ticket (e.g. the
                    // original suffixed role "PM (2)") — used ONLY for the
                    // openPositions COUNT so two identical-role slots on one
                    // project count as two. Falls back to `role` when absent.
  start: string;    // ISO yyyy-mm-dd ("" tolerated → row skipped)
  end: string;
  pct: number;      // weekly percent (100 = one full-time slot; >100 legal)
}

/** Roster person contributing capacity.
 * NOTE: roster start/end dates are deliberately NOT consulted — no other
 * capacity surface (bench, utilization, financial) gates on them, and in real
 * tenants they are often imported junk that would zero out people whose booked
 * allocations still count as required, fabricating shortages. Capacity basis =
 * enabled roster × calendar rules × recorded leave, same as the rest of the app. */
export interface RecruitPerson {
  guid: string;
  role: string;             // display role/title ("" → NO_ROLE_LABEL)
}

export interface RecruitWeekPoint {
  weekStart: string;   // ISO Monday
  available: number;
  required: number;
  variance: number;    // available − required
}

export interface RecruitRoleRow {
  role: string;
  people: number;          // roster headcount contributing capacity
  openPositions: number;   // unique (ticket, role) demand slots in the period
  available: number;
  required: number;
  staffedHours: number;    // required portion booked on people
  demandHours: number;     // required portion still unfilled
  variance: number;        // available − required (negative = shortage)
  weekly: RecruitWeekPoint[];
}

export interface RecruitmentAnalyticsCore {
  periodStart: string;
  periodEnd: string;
  weekStarts: string[];        // ISO Mondays covered
  workWeekHours: number;
  workingDays: number;         // working days per week from Settings
  holidaysInPeriod: string[];  // ISO dates deducted from capacity
  roles: RecruitRoleRow[];     // sorted: biggest shortage first
  weeklyTotals: RecruitWeekPoint[];
  totals: {
    available: number;
    required: number;
    variance: number;
    shortageHours: number;   // Σ |variance| over shortage roles
    surplusHours: number;    // Σ variance over surplus roles
    rolesShort: number;
    rolesSurplus: number;
    rolesMatched: number;
    people: number;
    openPositions: number;
  };
}

function mondayUtc(t: number): number {
  const d = new Date(t);
  const day = d.getUTCDay();
  const diff = (day + 6) % 7;
  return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() - diff);
}
const isoDay = (t: number): string => new Date(t).toISOString().slice(0, 10);
const r1 = (n: number): number => Math.round(n * 10) / 10;

/** Role grouping: trim + case-insensitive key, first-seen display casing. */
class RoleKeyer {
  private display = new Map<string, string>();
  key(raw: string | null | undefined): string {
    const label = String(raw ?? "").trim() || NO_ROLE_LABEL;
    const k = label.toLowerCase();
    if (!this.display.has(k)) this.display.set(k, label);
    return k;
  }
  labelOf(key: string): string { return this.display.get(key) ?? key; }
}

export function computeRecruitmentAnalytics(input: {
  staffedRows: RecruitStaffedRow[];
  demandRows: RecruitDemandRow[];
  people: RecruitPerson[];
  availabilityByGuid: Map<string, AvailabilityWindow[]>;
  workWeekHours: number;
  nonWorkingDays: number[] | undefined;
  holidayDates: string[] | undefined;
  periodStart: string;  // ISO yyyy-mm-dd (inclusive)
  periodEnd: string;    // ISO yyyy-mm-dd (inclusive)
}): RecruitmentAnalyticsCore {
  const wwh = input.workWeekHours > 0 ? input.workWeekHours : 40;
  const holidaySet = parseHolidaySet(input.holidayDates);
  const workingDays = workingDaysPerWeek(input.nonWorkingDays);

  const psMs = Date.parse(input.periodStart);
  const peMs = Date.parse(input.periodEnd);
  const w0 = mondayUtc(psMs);
  const w1 = mondayUtc(peMs);
  const weekStarts: number[] = [];
  for (let w = w0; w <= w1; w += WEEK) weekStarts.push(w);
  const weekIndex = new Map<number, number>(weekStarts.map((w, i) => [w, i]));

  const keyer = new RoleKeyer();
  // per role: parallel weekly arrays
  const avail = new Map<string, number[]>();
  const reqStaffed = new Map<string, number[]>();
  const reqDemand = new Map<string, number[]>();
  const peopleByRole = new Map<string, number>();
  const openPosByRole = new Map<string, Set<string>>();
  const zeros = () => new Array<number>(weekStarts.length).fill(0);
  const bucket = (m: Map<string, number[]>, k: string) => {
    let a = m.get(k);
    if (!a) { a = zeros(); m.set(k, a); }
    return a;
  };

  // Capacity per week (same for everyone before leave scaling) — precompute.
  const weekCap = weekStarts.map((w) => weekCapacityHours(w, wwh, input.nonWorkingDays, holidaySet, true));

  // Holidays actually deducted in this period (working-day ones only shown
  // as period coverage; keep it simple: any configured holiday inside range).
  const holidaysInPeriod = [...holidaySet]
    .filter((d) => { const t = Date.parse(d); return Number.isFinite(t) && t >= w0 && t <= w1 + 6 * DAY; })
    .sort();

  /* ── available hours per role ── */
  let totalPeople = 0;
  for (const p of input.people) {
    const rk = keyer.key(p.role);
    peopleByRole.set(rk, (peopleByRole.get(rk) ?? 0) + 1);
    totalPeople++;
    const windows = input.availabilityByGuid.get(p.guid);
    const arr = bucket(avail, rk);
    for (let i = 0; i < weekStarts.length; i++) {
      // Day-granular availability: leave scales WORKING days only, and a
      // holiday workday is never deducted twice (capacity already skips it).
      // With no leave windows this equals the precomputed weekCap.
      const cap = windows && windows.length > 0
        ? weekAvailableHours(weekStarts[i], wwh, input.nonWorkingDays, holidaySet, windows, true)
        : weekCap[i];
      if (cap <= 0) continue;
      arr[i] += cap;
    }
  }

  /* ── required hours: staffed rows (financial-analytics semantics) ── */
  const roleByGuid = new Map<string, string>();
  for (const p of input.people) roleByGuid.set(p.guid, keyer.key(p.role));

  // Pass 1 — hours-win sets per (person|ticket).
  const hourWeeks = new Map<string, Set<number>>();
  for (const row of input.staffedRows) {
    if (!row.person || !(row.hours > 0)) continue;
    const s = Date.parse(row.start), e = Date.parse(row.end || row.start);
    if (!Number.isFinite(s)) continue;
    const a0 = mondayUtc(s), a1 = Number.isFinite(e) && e >= s ? mondayUtc(e) : a0;
    if ((a1 - a0) / WEEK > MAX_WEEKS_PER_ROW) continue;
    const key = `${row.person}|${row.ticket}`;
    let set = hourWeeks.get(key);
    if (!set) { set = new Set(); hourWeeks.set(key, set); }
    for (let w = a0; w <= a1; w += WEEK) set.add(w);
  }

  // Pass 2 — shorter-span hours rows claim weeks first (dedup vs containers).
  const sorted = [...input.staffedRows].sort((a, b) => {
    const aH = a.hours > 0, bH = b.hours > 0;
    if (!aH && !bH) return 0;
    if (!aH) return 1;
    if (!bH) return -1;
    const sa = Date.parse(a.start), ea = Date.parse(a.end || a.start);
    const sb = Date.parse(b.start), eb = Date.parse(b.end || b.start);
    const spanA = Number.isFinite(ea) && ea >= sa ? ea - sa : 0;
    const spanB = Number.isFinite(eb) && eb >= sb ? eb - sb : 0;
    return spanA - spanB;
  });
  const claimed = new Map<string, Set<number>>();

  for (const row of sorted) {
    if (!row.person) continue;
    const s = Date.parse(row.start), eRaw = Date.parse(row.end || row.start);
    if (!Number.isFinite(s)) continue;
    const e = Number.isFinite(eRaw) && eRaw >= s ? eRaw : s;
    const a0 = mondayUtc(s), a1 = mondayUtc(e);
    const weeks = Math.round((a1 - a0) / WEEK) + 1;
    if (weeks > MAX_WEEKS_PER_ROW) continue;
    if (a1 < w0 || a0 > w1) continue; // no overlap with the period

    const fromHours = row.hours > 0;
    let perWeek: number;
    if (fromHours) {
      perWeek = Math.min(row.hours / weeks, 168);
    } else if (row.pct > 0) {
      perWeek = row.pct > 150
        ? Math.min(row.pct / weeks, 168)            // legacy raw-hours rows
        : Math.min((row.pct / 100) * wwh, 168);     // genuine percent
    } else {
      continue;
    }

    const pairKey = `${row.person}|${row.ticket}`;
    const winSet = !fromHours ? hourWeeks.get(pairKey) : undefined;
    let claimSet: Set<number> | undefined;
    if (fromHours) {
      claimSet = claimed.get(pairKey);
      if (!claimSet) { claimSet = new Set(); claimed.set(pairKey, claimSet); }
    }

    const rk = roleByGuid.get(row.person) ?? keyer.key(null);
    const arr = bucket(reqStaffed, rk);
    for (let w = Math.max(a0, w0); w <= Math.min(a1, w1); w += WEEK) {
      if (winSet && winSet.has(w)) continue;             // hours-win
      if (claimSet) {
        if (claimSet.has(w)) continue;                    // week already claimed
        claimSet.add(w);
      }
      const idx = weekIndex.get(w);
      if (idx !== undefined) arr[idx] += perWeek;
    }
    // Claim weeks OUTSIDE the period too so a container row can't re-claim
    // an in-period week another (out-of-period-starting) weekly row owns.
    if (claimSet) {
      for (let w = a0; w <= a1; w += WEEK) claimSet.add(w);
    }
  }

  /* ── required hours: open demand rows ── */
  for (const row of input.demandRows) {
    if (!(row.pct > 0)) continue; // zero-hour placeholder weeks are noise
    const s = Date.parse(row.start), eRaw = Date.parse(row.end || row.start);
    if (!Number.isFinite(s)) continue;
    const e = Number.isFinite(eRaw) && eRaw >= s ? eRaw : s;
    const a0 = mondayUtc(s), a1 = mondayUtc(e);
    if ((a1 - a0) / WEEK > MAX_WEEKS_PER_ROW) continue;
    if (a1 < w0 || a0 > w1) continue;
    const rk = keyer.key(row.role);
    const perWeek = (row.pct / 100) * wwh; // multi-FTE demand is legitimate
    const arr = bucket(reqDemand, rk);
    let counted = false;
    for (let w = Math.max(a0, w0); w <= Math.min(a1, w1); w += WEEK) {
      const idx = weekIndex.get(w);
      if (idx !== undefined) { arr[idx] += perWeek; counted = true; }
    }
    if (counted) {
      let set = openPosByRole.get(rk);
      if (!set) { set = new Set(); openPosByRole.set(rk, set); }
      // Position identity: prefer the unique slot key so two same-role slots
      // on one project count as two open positions (hours still group by role).
      set.add(`${row.ticketId}||${row.slotKey || row.role}`);
    }
  }

  /* ── merge per role ── */
  const roleKeys = new Set<string>([
    ...avail.keys(), ...reqStaffed.keys(), ...reqDemand.keys(),
  ]);
  const roles: RecruitRoleRow[] = [];
  for (const rk of roleKeys) {
    const a = avail.get(rk) ?? zeros();
    const rs = reqStaffed.get(rk) ?? zeros();
    const rd = reqDemand.get(rk) ?? zeros();
    const weekly: RecruitWeekPoint[] = weekStarts.map((w, i) => ({
      weekStart: isoDay(w),
      available: r1(a[i]),
      required: r1(rs[i] + rd[i]),
      variance: r1(a[i] - rs[i] - rd[i]),
    }));
    const availSum = a.reduce((x, y) => x + y, 0);
    const staffedSum = rs.reduce((x, y) => x + y, 0);
    const demandSum = rd.reduce((x, y) => x + y, 0);
    const reqSum = staffedSum + demandSum;
    if (availSum === 0 && reqSum === 0) continue; // nothing in this period
    roles.push({
      role: keyer.labelOf(rk),
      people: peopleByRole.get(rk) ?? 0,
      openPositions: openPosByRole.get(rk)?.size ?? 0,
      available: r1(availSum),
      required: r1(reqSum),
      staffedHours: r1(staffedSum),
      demandHours: r1(demandSum),
      variance: r1(availSum - reqSum),
      weekly,
    });
  }
  roles.sort((x, y) => x.variance - y.variance || y.required - x.required);

  const weeklyTotals: RecruitWeekPoint[] = weekStarts.map((w, i) => {
    let av = 0, rq = 0;
    for (const rk of roleKeys) {
      av += (avail.get(rk) ?? zeros())[i] ?? 0;
      rq += ((reqStaffed.get(rk) ?? zeros())[i] ?? 0) + ((reqDemand.get(rk) ?? zeros())[i] ?? 0);
    }
    return { weekStart: isoDay(w), available: r1(av), required: r1(rq), variance: r1(av - rq) };
  });

  let shortageHours = 0, surplusHours = 0, rolesShort = 0, rolesSurplus = 0, rolesMatched = 0;
  let totalAvail = 0, totalReq = 0, totalOpen = 0;
  for (const r of roles) {
    totalAvail += r.available;
    totalReq += r.required;
    totalOpen += r.openPositions;
    if (r.variance < -0.05) { rolesShort++; shortageHours += -r.variance; }
    else if (r.variance > 0.05) { rolesSurplus++; surplusHours += r.variance; }
    else rolesMatched++;
  }

  return {
    periodStart: input.periodStart,
    periodEnd: input.periodEnd,
    weekStarts: weekStarts.map(isoDay),
    workWeekHours: wwh,
    workingDays,
    holidaysInPeriod,
    roles,
    weeklyTotals,
    totals: {
      available: r1(totalAvail),
      required: r1(totalReq),
      variance: r1(totalAvail - totalReq),
      shortageHours: r1(shortageHours),
      surplusHours: r1(surplusHours),
      rolesShort, rolesSurplus, rolesMatched,
      people: totalPeople,
      openPositions: totalOpen,
    },
  };
}
