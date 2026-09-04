/**
 * Quarter helpers shared by the Resources/Manager pages (initial state) and
 * the post-login cache prewarm in App.tsx.
 *
 * defaultUtilQuery() builds the EXACT query key + fetch args the Resources
 * page's utilization useQuery starts from on first mount (current quarter,
 * Weekly mode, every filter toggle off). App.tsx prefetches under this key so
 * a first click on Manager/Resources renders the timeline grid instantly
 * instead of blocking on the utilization round-trip. If the page's defaults
 * ever change, change them HERE — both sides read these helpers, so the key
 * cannot drift apart.
 */

export interface Quarter { label: string; sd: string; ed: string }

function fmtLocalDay(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

export function buildQuarters(): Quarter[] {
  const out: Quarter[] = [];
  const now = new Date();
  const cy = now.getFullYear();
  const cq = Math.floor(now.getMonth() / 3);
  for (let i = -12; i <= 4; i++) {
    const totalQ = cy * 4 + cq + i;
    const y = Math.floor(totalQ / 4);
    const q = totalQ % 4;
    const sd = new Date(y, q * 3, 1);
    const ed = new Date(y, q * 3 + 3, 0);
    out.push({ label: `Q${q + 1} ${y}`, sd: fmtLocalDay(sd), ed: fmtLocalDay(ed) });
  }
  return out;
}

export function quarterFromLabel(label: string): Quarter | null {
  const match = /^Q([1-4])\s+(\d{4})$/.exec(label.trim());
  if (!match) return null;
  const q = Number(match[1]) - 1;
  const year = Number(match[2]);
  return {
    label,
    sd: fmtLocalDay(new Date(year, q * 3, 1)),
    ed: fmtLocalDay(new Date(year, q * 3 + 3, 0)),
  };
}

export function currentQuarterLabel(now = new Date()): string {
  return `Q${Math.floor(now.getMonth() / 3) + 1} ${now.getFullYear()}`;
}

export interface UtilFilters {
  includeClosedProject: boolean;
  includeSoftAllocations: boolean;
  onlyNCO: boolean;
  showActuals: boolean;
}

/** Initial state of the Resources page filter toggles — all off. */
export function defaultUtilFilters(): UtilFilters {
  return { includeClosedProject: false, includeSoftAllocations: false, onlyNCO: false, showActuals: false };
}

/**
 * Key + fetch args for the Resources/Manager timeline utilization query in
 * its first-mount state. Weekly mode keeps effectiveEndDate === quarter end,
 * matching the page's ["util", sd, effectiveEndDate, mode, filters] key.
 */
export function defaultUtilQuery(): {
  queryKey: [string, string, string, string, UtilFilters];
  opts: {
    startDate: string; endDate: string; mode: "Weekly";
    showActuals: boolean; onlyNCO: boolean;
    includeClosedProject: boolean; includeSoftAllocations: boolean;
  };
} {
  const q = quarterFromLabel(currentQuarterLabel())!;
  const filters = defaultUtilFilters();
  return {
    queryKey: ["util", q.sd, q.ed, "Weekly", filters],
    opts: {
      startDate: q.sd,
      endDate: q.ed,
      mode: "Weekly",
      showActuals: filters.showActuals,
      onlyNCO: filters.onlyNCO,
      includeClosedProject: filters.includeClosedProject,
      includeSoftAllocations: filters.includeSoftAllocations,
    },
  };
}
