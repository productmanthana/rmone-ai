import type { DashboardData } from "@/components/AnalyticsDashboard";

function getProjectValue(p: any): number {
  const n = Number(p?.ApproxContractValue);
  return Number.isFinite(n) && n > 0 ? n : 0;
}
const GUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
function cleanLabel(v: any): string | null {
  if (v === null || v === undefined) return null;
  const s = String(v).trim();
  if (!s || s === "0" || s === "None") return null;
  if (GUID_RE.test(s)) return null;
  return s;
}
function getProjectClient(p: any): string | null {
  return (
    cleanLabel(p?.CRMCompanyLookupName) ||
    cleanLabel(p?.ClientName) ||
    cleanLabel(p?.CompanyName) ||
    cleanLabel(p?.OwnerName) ||
    cleanLabel(p?.CompanyLookup) ||
    cleanLabel(p?.CRMCompanyLookup)
  );
}
function getProjectSector(p: any): string {
  const candidates = [
    p?.SectorChoice,
    p?.Sector,
    p?.SectorName,
    p?.SectorTagsChoice,
    p?.MarketSector,
    p?.IndustryChoice,
    p?.Industry,
    p?.CRMSectorChoice,
  ];
  for (const c of candidates) {
    if (typeof c === "string" && c.trim() && c.trim().toLowerCase() !== "none") return c.trim();
  }
  return "Other";
}
function getProjectDivision(p: any): string | null {
  return (
    cleanLabel(p?.DivisionLookupName) ||
    cleanLabel(p?.BusinessUnitName) ||
    cleanLabel(p?.BusinessUnit) ||
    cleanLabel(p?.CRMBusinessUnitChoice) ||
    cleanLabel(p?.DivisionLookup)
  );
}
function getProjectContractType(p: any): string | null {
  return (
    cleanLabel(p?.OwnerContractTypeChoice) ||
    cleanLabel(p?.ContractTypeChoice) ||
    cleanLabel(p?.ContractType)
  );
}
function getProjectRequestType(p: any): string | null {
  return (
    cleanLabel(p?.RequestTypeCategory) ||
    cleanLabel(p?.RequestTypeSubCategory) ||
    cleanLabel(p?.RequestTypeLookupName) ||
    cleanLabel(p?.RequestTypeLookup)
  );
}

export function buildDashboardData(rawPmm: any[], rawOpm: any[], rawLem: any[]): DashboardData | null {
  if (!rawPmm.length && !rawOpm.length && !rawLem.length) return null;

  const sectorMap: Record<string, { won: number; lost: number; activeCount: number; activeVal: number }> = {};
  const cityMap: Record<string, { count: number; val: number }> = {};
  const opmStatusMap: Record<string, number> = {};
  const valueRanges = [
    { label: "<$1M", min: 0, max: 1e6, count: 0 },
    { label: "$1-5M", min: 1e6, max: 5e6, count: 0 },
    { label: "$5-15M", min: 5e6, max: 15e6, count: 0 },
    { label: "$15-50M", min: 15e6, max: 50e6, count: 0 },
    { label: "$50M+", min: 50e6, max: Infinity, count: 0 },
  ];
  let totalActiveVal = 0,
    totalOpmVal = 0,
    totalLemVal = 0;
  let activeCount = 0;

  type Bucket = { count: number; val: number };
  const clientMap: Record<string, Bucket> = {};
  const divisionMap: Record<string, Bucket> = {};
  const contractTypeMap: Record<string, Bucket> = {};
  const requestTypeMap: Record<string, Bucket> = {};
  const addToMap = (m: Record<string, Bucket>, key: string | null, v: number) => {
    if (!key) return;
    if (!m[key]) m[key] = { count: 0, val: 0 };
    m[key].count++;
    m[key].val += v;
  };

  for (const p of rawPmm) {
    if (!p || typeof p !== "object") continue;
    const v = getProjectValue(p);
    const sector = getProjectSector(p);
    const city = p.City || "Unknown";
    const isClosed = p.Closed === true;
    for (const r of valueRanges) {
      if (v >= r.min && v < r.max) {
        r.count++;
        break;
      }
    }
    if (!isClosed) {
      activeCount++;
      totalActiveVal += v;
      if (!sectorMap[sector]) sectorMap[sector] = { won: 0, lost: 0, activeCount: 0, activeVal: 0 };
      sectorMap[sector].activeCount++;
      sectorMap[sector].activeVal += v;
      if (!cityMap[city]) cityMap[city] = { count: 0, val: 0 };
      cityMap[city].count++;
      cityMap[city].val += v;
      addToMap(clientMap, getProjectClient(p), v);
      addToMap(divisionMap, getProjectDivision(p), v);
      addToMap(contractTypeMap, getProjectContractType(p), v);
      addToMap(requestTypeMap, getProjectRequestType(p), v);
    }
  }
  for (const p of rawOpm) {
    if (!p || typeof p !== "object") continue;
    const s = p.CRMOpportunityStatusChoice || p.Status || p.ModuleStepLookup || "";
    const sector = getProjectSector(p);
    totalOpmVal += getProjectValue(p);
    opmStatusMap[s] = (opmStatusMap[s] || 0) + 1;
    if (!sectorMap[sector]) sectorMap[sector] = { won: 0, lost: 0, activeCount: 0, activeVal: 0 };
    if (s === "Awarded") sectorMap[sector].won++;
    else if (s === "Lost") sectorMap[sector].lost++;
  }
  const LEM_CLOSED = new Set(["Lost", "Cancelled", "Declined", "Dead", "Closed", "Awarded"]);
  let openLemCount = 0;
  for (const l of rawLem) {
    if (!l || typeof l !== "object") continue;
    const ll = l as any;
    if (ll.Closed === true) continue;
    const status = String(ll.LeadStatus ?? "").trim();
    if (LEM_CLOSED.has(status)) continue;
    openLemCount++;
    totalLemVal += getProjectValue(l);
  }

  const topSectors = Object.entries(sectorMap)
    .filter(([, v]) => v.won + v.lost >= 3 || v.activeCount >= 2)
    .sort((a, b) => b[1].activeVal - a[1].activeVal)
    .slice(0, 8);
  const topCities = Object.entries(cityMap).sort((a, b) => b[1].val - a[1].val).slice(0, 8);
  const maxCityVal = topCities[0]?.[1].val || 1;
  const topOpmStatuses = Object.entries(opmStatusMap).sort((a, b) => b[1] - a[1]).slice(0, 6);
  const maxOpmCount = topOpmStatuses[0]?.[1] || 1;
  const maxValCount = Math.max(...valueRanges.map((r) => r.count), 1);
  const sectorVal = Object.entries(sectorMap)
    .filter(([, d]) => d.activeVal > 0)
    .sort((a, b) => b[1].activeVal - a[1].activeVal)
    .slice(0, 8);

  const sectorRealBuckets = sectorVal.filter(([k]) => k.toLowerCase() !== "other").length;
  const candidates = [
    {
      label: "Sector",
      entries: sectorVal.map(([k, d]) => [k, { count: d.activeCount, val: d.activeVal }] as const),
      realBuckets: sectorRealBuckets,
    },
    { label: "Client", entries: Object.entries(clientMap), realBuckets: Object.keys(clientMap).length },
    { label: "Division", entries: Object.entries(divisionMap), realBuckets: Object.keys(divisionMap).length },
    {
      label: "Contract Type",
      entries: Object.entries(contractTypeMap),
      realBuckets: Object.keys(contractTypeMap).length,
    },
    {
      label: "Project Type",
      entries: Object.entries(requestTypeMap),
      realBuckets: Object.keys(requestTypeMap).length,
    },
    {
      label: "City",
      entries: Object.entries(cityMap).filter(([k]) => k && k !== "Unknown"),
      realBuckets: Object.keys(cityMap).filter((k) => k && k !== "Unknown").length,
    },
  ];
  const winner =
    candidates.find((c) => c.realBuckets >= 2) ||
    candidates.find((c) => c.realBuckets >= 1) ||
    candidates[0];
  const pivotLabel = winner.label;
  const pivotVal = (winner.entries as Array<readonly [string, { count?: number; val?: number }]>)
    .map(([k, d]) => [k, { count: d.count ?? 0, val: d.val ?? 0 }] as [string, { count: number; val: number }])
    .filter(([, d]) => d.val > 0)
    .sort((a, b) => b[1].val - a[1].val)
    .slice(0, 8);
  const totalPivotVal = pivotVal.reduce((s, [, d]) => s + d.val, 0) || 1;

  return {
    totalActiveVal,
    totalOpmVal,
    totalLemVal,
    activeCount,
    opmCount: rawOpm.length,
    lemCount: openLemCount,
    topSectors,
    topCities,
    maxCityVal,
    topOpmStatuses,
    maxOpmCount,
    valueRanges,
    maxValCount,
    pivotLabel,
    pivotVal,
    totalPivotVal,
  };
}
