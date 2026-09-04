import { useEffect, useMemo, useRef, useState, useCallback, type CSSProperties } from "react";
import { useLocation } from "wouter";
import { Check, Loader2, Download, Upload } from "lucide-react";
import { getRoleBillingRates, saveRoleBillingRate, saveRoleRates, saveRoleRatesByDept, createRole, deleteRole, getDepartments, getDivisions, getBusinessUnits, bustCache, authHeaders, downloadRateCard, previewRateCard, applyRateCard, getRoleClassifications, saveRoleClassifications, type RoleBillingRate, type BillingRatesPayload, type RateCardPreview, type RateCardPreviewRow, type RoleClassification } from "@/lib/api";
import { ROLE_CATALOG } from "@/lib/roleCatalog";
import { useToast } from "@/hooks/use-toast";
import { useAuth } from "@/lib/useAuth";
import { getMyCapabilitiesChecked, usePermissionsVersion } from "@/lib/permissions";
import { RmOneProcessing } from "@/components/CommandCentreLoader";

type DeptOption = { id: string; name: string; divisionId?: string; buId?: string };
type BuOption = { id: string; name: string };

// Module-level cache so data shows instantly when revisiting the page.
// Key = dept id ("" = company-wide). Cleared when a save mutates rates.
const _ratesCache = new Map<string, RoleBillingRate[]>();
// Dept/division list also cached — getDepartments() has no client cache
// so without this the dropdown is always empty for ~2s on every visit.
let _deptsCache: { grouping: string; list: DeptOption[] } | null = null;
// BU list also cached — same reasoning as _deptsCache.
let _busCache: BuOption[] | null = null;

function pickBusinessUnits(raw: unknown[]): BuOption[] {
  const seen = new Set<string>();
  const out: BuOption[] = [];
  for (const b of raw as Record<string, unknown>[]) {
    const id = String(b?.ID ?? b?.Id ?? b?.id ?? "").trim();
    const name = String(b?.Title ?? b?.ShortName ?? b?.name ?? "").trim();
    if (!id || !name || seen.has(id)) continue;
    seen.add(id);
    out.push({ id, name });
  }
  return out.sort((a, b) => a.name.localeCompare(b.name));
}

function pickDepartments(raw: unknown[]): DeptOption[] {
  const seenId = new Set<string>();
  const out: DeptOption[] = [];
  for (const d of raw as Record<string, unknown>[]) {
    const id = String(d?.ID ?? d?.Id ?? d?.DepartmentId ?? "").trim();
    const name = String(d?.Title ?? d?.Name ?? d?.DepartmentName ?? "").trim();
    // Dedup by ID only — same name under different divisions is a distinct dept.
    if (!id || !name || seenId.has(id)) continue;
    seenId.add(id);
    const divisionId = String(d?.DivisionIdLookup ?? d?.DivisionId ?? "").trim() || undefined;
    out.push({ id, name, divisionId });
  }
  return out.sort((a, b) => a.name.localeCompare(b.name));
}

// For any department names that appear more than once, append "(Division Name)"
// so users can tell them apart in the picker. Mutates labels in-place.
function disambiguateDepts(opts: DeptOption[], divMap: Map<string, string>): DeptOption[] {
  // Count by lowercase so "construction" and "Construction" are treated as duplicates.
  const nameCounts = new Map<string, number>();
  for (const o of opts) {
    const key = o.name.toLowerCase();
    nameCounts.set(key, (nameCounts.get(key) ?? 0) + 1);
  }

  // For any name that appears more than once, check whether at least one entry
  // has a resolvable divisionId. If so, drop the entries that have no divisionId
  // — they are orphan rows with no valid division context and would show as an
  // ambiguous plain duplicate (e.g. a bare "design" alongside "Design (Academic)").
  const nameHasDiv = new Map<string, boolean>();
  for (const o of opts) {
    const key = o.name.toLowerCase();
    if ((nameCounts.get(key) ?? 0) > 1 && o.divisionId && divMap.has(o.divisionId)) {
      nameHasDiv.set(key, true);
    }
  }

  return opts
    .filter((o) => {
      const key = o.name.toLowerCase();
      // Drop orphan (no-divisionId) entries only when at least one sibling CAN
      // be labelled — otherwise keep all entries (we can't distinguish them anyway).
      if ((nameCounts.get(key) ?? 0) > 1 && nameHasDiv.get(key) && !o.divisionId) {
        return false;
      }
      return true;
    })
    .map((o) => {
      if ((nameCounts.get(o.name.toLowerCase()) ?? 0) <= 1) return o;
      const divName = o.divisionId ? divMap.get(o.divisionId) : undefined;
      return { ...o, name: divName ? `${o.name} (${divName})` : o.name };
    });
}

const BRAND_GREEN = "#6BA539";
const PANEL_BG = "var(--rm-panel)";
const BORDER = "var(--rm-panel-border)";
const INPUT_BG = "var(--rm-panel-soft)";
const INPUT_BORDER = "var(--rm-panel-border)";

function fmtRate(n: number | null): string {
  return n == null ? "" : String(n);
}

// Entry-time validation: true when the draft text is NOT a valid non-negative
// number (empty = valid, it means "clear the rate"). Inputs accept free text so
// the user gets an inline red flag the moment they type something bad, instead
// of keystrokes being silently swallowed; saves are blocked while invalid.
function rateDraftInvalid(v: string): boolean {
  const t = v.trim();
  if (t === "") return false;
  const n = Number(t);
  return !Number.isFinite(n) || n < 0;
}

const INVALID_BORDER = "#ef4444";

export default function BillingRatesPage({ embedded = false }: { embedded?: boolean } = {}) {
  const { toast: _toast } = useToast();
  const toastRef = useRef(_toast);
  toastRef.current = _toast;
  const toast = useCallback((...args: Parameters<typeof _toast>) => toastRef.current(...args), []);
  const { user } = useAuth();
  // Rates are financial data. The old broad `canEdit` flag only distinguishes
  // "User" from everyone else, so it ignored a Manager/custom level's
  // Edit-financials setting. Stay disabled until the server confirms the
  // capability; every rate mutation is server-gated too.
  const permsVer = usePermissionsVersion();
  const [canEdit, setCanEdit] = useState(false);
  useEffect(() => {
    let alive = true;
    void getMyCapabilitiesChecked()
      .then((caps) => { if (alive) setCanEdit(caps?.caps.editFinancials === true); })
      .catch(() => { if (alive) setCanEdit(false); });
    return () => { alive = false; };
  }, [user?.username, user?.tenant, permsVer]);

  const [rows, setRows] = useState<RoleBillingRate[]>([]);
  // Role-level Billable / Non-billable classification, keyed by role id. This is
  // NOT dept-scoped — the same value shows in company-wide and per-dept views.
  const [classifications, setClassifications] = useState<Record<string, RoleClassification>>({});
  const [savingClassId, setSavingClassId] = useState<string | null>(null);
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [laborDrafts, setLaborDrafts] = useState<Record<string, string>>({});
  const [costDrafts, setCostDrafts] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);
  const [savingOneId, setSavingOneId] = useState<string | null>(null);
  const [savingLaborId, setSavingLaborId] = useState<string | null>(null);
  const [savingCostId, setSavingCostId] = useState<string | null>(null);
  const [loading, setLoading] = useState(() => !_ratesCache.has(""));
  const [orgRefreshToken, setOrgRefreshToken] = useState(0);
  // Deep link from the project Team grid's "Set" button (?editRole=<name>):
  // pre-filter the table to that role's row, then focus its billing-rate input
  // once rows load (see the editRole effect below). One-shot per mount.
  const editRoleTargetRef = useRef<string>((() => {
    try { return (new URLSearchParams(window.location.search).get("editRole") ?? "").trim(); }
    catch { return ""; }
  })());
  // Where the deep link came from (?returnTo=<in-app path>). After a successful
  // save the user is taken straight back there — the Set-button flow is "jump
  // in, fix the rate, jump back". Only same-app absolute paths are honoured
  // ("/..." but not "//host") so the param can't be abused as an open redirect.
  const [, navigateTo] = useLocation();
  const returnToRef = useRef<string>((() => {
    try {
      const v = (new URLSearchParams(window.location.search).get("returnTo") ?? "").trim();
      return v.startsWith("/") && !v.startsWith("//") ? v : "";
    } catch { return ""; }
  })());
  /** One-shot: after a successful save, go back to the page that sent us here. */
  function returnAfterSave() {
    const dest = returnToRef.current;
    if (!dest) return;
    returnToRef.current = "";
    // Let the "Saved" toast render first, then navigate (toaster is global, so
    // the confirmation stays visible on the destination page).
    // Tell Project Detail to make its first team read cache-bypassing. A
    // server-side cluster bust is asynchronous, so without this a returned
    // page can briefly hit a sibling worker before it receives the bust.
    const join = dest.includes("?") ? "&" : "?";
    setTimeout(() => navigateTo(`${dest}${join}ratesRefreshed=1`), 400);
  }
  const [highlightRowId, setHighlightRowId] = useState<string | null>(null);
  // True while a rates fetch is in flight (the page ALWAYS background-refetches,
  // even on a module-cache hit). The editRole effect uses this to avoid falling
  // back to the add-role box based on a stale cached row list — it waits for the
  // fresh wave before concluding the role doesn't exist.
  const ratesFetchPendingRef = useRef(false);
  const [filter, setFilter] = useState(() => editRoleTargetRef.current);
  // Tracks whether ANY dept/division (not just the current one) has saved rates.
  // Used to lock the Dept/Division toggle so switching to an empty dept can't
  // be used as a backdoor to unlock and flip the grouping mode.
  const [globalSetCount, setGlobalSetCount] = useState(() => {
    let n = 0;
    for (const cached of _ratesCache.values()) n += cached.filter((r) => r.billingRate != null).length;
    return n;
  });

  // ── Org grouping (department vs division) — persisted to tenant settings ──
  const [orgGrouping, setOrgGrouping] = useState<"department" | "division">("department");
  useEffect(() => {
    fetch("/api/onboarding/settings", { headers: authHeaders() })
      .then((r) => r.ok ? r.json() : null)
      .then((d) => {
        const g = d?.effective?.orgGrouping;
        if (g === "department" || g === "division") setOrgGrouping(g);
      })
      .catch(() => { /* keep default */ });
  }, []);

  // ── Role classifications (Billable / Non-billable) — load once on mount ──
  // Best-effort: on failure we keep an empty map so the page still works.
  useEffect(() => {
    getRoleClassifications()
      .then((map) => setClassifications(map ?? {}))
      .catch(() => { /* leave unclassified — no crash */ });
  }, []);

  // Change a role's classification with an optimistic local update, then persist
  // the FULL updated map. Revert + toast on failure (friendly copy on a 403).
  async function changeClassification(roleId: string, value: "" | RoleClassification) {
    if (savingClassId) return;
    const prev = classifications;
    const next: Record<string, RoleClassification> = { ...prev };
    if (value === "") delete next[roleId];
    else next[roleId] = value;
    setClassifications(next);
    setSavingClassId(roleId);
    try {
      await saveRoleClassifications(next);
    } catch (e) {
      setClassifications(prev); // revert
      const msg = String((e as Error)?.message ?? e);
      const forbidden = /(^|\D)403(\D|$)/.test(msg) || /forbidden/i.test(msg);
      toast(
        forbidden
          ? { title: "You can't change this", description: "Only a company admin can change this.", variant: "destructive" }
          : { title: "Couldn't save classification", description: msg, variant: "destructive" },
      );
    } finally {
      setSavingClassId(null);
    }
  }

  function toggleOrgGrouping() {
    const next = orgGrouping === "department" ? "division" : "department";
    setOrgGrouping(next);
    // Persist to tenant settings best-effort
    fetch("/api/onboarding/settings", {
      method: "POST",
      headers: { ...authHeaders(), "Content-Type": "application/json" },
      body: JSON.stringify({ orgGrouping: next }),
    }).catch(() => { /* ignore — UI already updated */ });
  }

  // ── Group scope ── "" = company-wide default; an id = override for that group ──
  const [departments, setDepartments] = useState<DeptOption[]>([]);
  const [selectedDept, setSelectedDept] = useState("");
  const deptName = useMemo(
    () => departments.find((d) => d.id === selectedDept)?.name ?? "",
    [departments, selectedDept],
  );

  // ── Cascading BU → Division scope filter — same pattern as Projects/
  // Opportunities/Leads/Staff: narrows which departments (or divisions, in
  // "division" grouping) show up in the picker above. ──
  const [businessUnits, setBusinessUnits] = useState<BuOption[]>([]);
  const [divNameById, setDivNameById] = useState<Map<string, string>>(new Map());
  const [rateBuFilter, setRateBuFilter] = useState("All");
  const [rateDivFilter, setRateDivFilter] = useState("All");
  const buOptionsForFilter = useMemo(() => {
    const ids = new Set(departments.map((d) => d.buId).filter(Boolean) as string[]);
    return businessUnits.filter((b) => ids.has(b.id));
  }, [businessUnits, departments]);
  const divOptionsForFilter = useMemo(() => {
    if (orgGrouping !== "department") return [];
    const seen = new Map<string, string>();
    for (const d of departments) {
      if (!d.divisionId) continue;
      if (rateBuFilter !== "All" && d.buId !== rateBuFilter) continue;
      seen.set(d.divisionId, divNameById.get(d.divisionId) || d.divisionId);
    }
    return Array.from(seen.entries()).map(([id, name]) => ({ id, name }));
  }, [departments, rateBuFilter, orgGrouping, divNameById]);
  const filteredDepartments = useMemo(() => {
    return departments.filter((d) => {
      if (rateBuFilter !== "All" && d.buId !== rateBuFilter) return false;
      if (orgGrouping === "department" && rateDivFilter !== "All" && d.divisionId !== rateDivFilter) return false;
      return true;
    });
  }, [departments, rateBuFilter, rateDivFilter, orgGrouping]);
  // Reset the actual scope selection whenever it falls outside the filtered list.
  useEffect(() => {
    if (selectedDept && !filteredDepartments.some((d) => d.id === selectedDept)) {
      setSelectedDept("");
    }
  }, [filteredDepartments, selectedDept]);

  // ── Add-role combobox state ──
  // Pre-fill role name from ?role= query param (linked from Cost Rate $0 card).
  const [newRoleName, setNewRoleName] = useState(() => {
    try {
      return new URLSearchParams(window.location.search).get("role") ?? "";
    } catch { return ""; }
  });
  const [newRoleRate, setNewRoleRate] = useState("");
  const [suggestOpen, setSuggestOpen] = useState(false);
  const [adding, setAdding] = useState(false);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);
  const addBoxRef = useRef<HTMLDivElement | null>(null);

  // ── Rate Card upload/download (standalone page only; hidden when embedded) ──
  const [billingUploading, setBillingUploading] = useState(false);
  const [billingDownloading, setBillingDownloading] = useState(false);
  const [billingMsg, setBillingMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const billingFileRef = useRef<HTMLInputElement>(null);
  const [billingReview, setBillingReview] = useState<{ preview: RateCardPreview; decisions: Record<number, boolean> } | null>(null);
  const [billingApplying, setBillingApplying] = useState(false);

  // When arriving from a "Set rate →" link, open the suggestion dropdown and
  // scroll the add-role box into view so the user sees the pre-filled name.
  useEffect(() => {
    if (!newRoleName) return;
    setSuggestOpen(true);
    const id = setTimeout(() => {
      addBoxRef.current?.scrollIntoView({ behavior: "smooth", block: "center" });
    }, 300);
    return () => clearTimeout(id);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Rate Card upload helpers (mirrors import.tsx) ────────────────────────
  const toRateApplyRow = (r: RateCardPreviewRow) => ({
    roleName: r.roleName, roleId: r.roleId, deptId: r.deptId, deptName: r.deptName,
    billing: r.incoming.billing, labor: r.incoming.labor, cost: r.incoming.cost,
  });

  const rateCardSummaryMsg = (
    res: { saved: number; created: number; errors: string[] },
    pv: RateCardPreview,
    keptExisting: number,
  ): { ok: boolean; text: string } => {
    const parts: string[] = [];
    if (res.saved   > 0) parts.push(`${res.saved} rate${res.saved === 1 ? "" : "s"} updated`);
    if (res.created > 0) parts.push(`${res.created} new role${res.created === 1 ? "" : "s"} created`);
    if (keptExisting > 0) parts.push(`${keptExisting} kept ${keptExisting === 1 ? "its" : "their"} existing rate`);
    const unchanged = pv.rows.filter(r => r.status === "unchanged").length;
    if (unchanged > 0) parts.push(`${unchanged} already up to date`);
    const summary = parts.length ? parts.join(", ") + "." : "No rates changed.";
    const notes = [...pv.warnings, ...(res.errors ?? [])];
    const noteText = notes.length ? ` Notes: ${notes.slice(0, 3).join("; ")}` : "";
    const hasErr = (res.errors ?? []).length > 0;
    return { ok: !hasErr || res.saved > 0 || res.created > 0, text: summary + noteText };
  };

  const ratePillStyle = (active: boolean, green: boolean): CSSProperties => ({
    padding: "4px 12px", fontSize: 11, fontWeight: 700, borderRadius: 6, cursor: "pointer",
    border: `1px solid ${active ? (green ? "#6BA539" : "#c0392b") : "var(--rm-panel-border)"}`,
    background: active ? (green ? "#6BA539" : "#fff0f0") : "var(--rm-panel-soft)",
    color: active ? (green ? "#fff" : "#c0392b") : "var(--rm-text-muted)",
  });

  const applyBillingReview = async () => {
    if (!billingReview) return;
    const { preview, decisions } = billingReview;
    const conflicts = preview.rows.filter(r => r.status === "conflict");
    const included  = conflicts.filter(c => decisions[c.idx]);
    const rowsToApply = [...preview.rows.filter(r => r.status === "new"), ...included];
    const kept = conflicts.length - included.length;
    setBillingApplying(true);
    try {
      if (rowsToApply.length === 0) {
        setBillingMsg({ ok: true, text: `Nothing changed — you kept the existing rate for all ${conflicts.length} differing row${conflicts.length === 1 ? "" : "s"}.` });
        setBillingReview(null);
        return;
      }
      const res = await applyRateCard(rowsToApply.map(toRateApplyRow));
      setBillingMsg(rateCardSummaryMsg(res, preview, kept));
      setBillingReview(null);
      // Refresh cached rates so the table reflects the newly-applied values.
      _ratesCache.clear();
      setOrgRefreshToken((t) => t + 1);
    } catch (err: unknown) {
      // Prefer the server's human-readable message over the raw `400: {json}` blob.
      const friendly = (err as { friendlyMessage?: string })?.friendlyMessage;
      setBillingMsg({ ok: false, text: friendly || (err instanceof Error ? err.message : "Apply failed.") });
    } finally {
      setBillingApplying(false);
    }
  };

  function hydrate(list: RoleBillingRate[], deptKey: string) {
    _ratesCache.set(deptKey, list);
    setRows(list);
    setDrafts(Object.fromEntries(list.map((r) => [r.id, fmtRate(r.billingRate)])));
    setLaborDrafts(Object.fromEntries(list.map((r) => [r.id, fmtRate(r.laborRate ?? null)])));
    setCostDrafts(Object.fromEntries(list.map((r) => [r.id, fmtRate(r.costRate ?? null)])));
    // Recompute global count across ALL cached depts so the Dept/Division toggle
    // stays locked even when viewing an empty dept.
    let n = 0;
    for (const cached of _ratesCache.values()) n += cached.filter((r) => r.billingRate != null).length;
    setGlobalSetCount(n);
  }

  // ── Org data sync: refresh rates + dept list whenever BU/Div/Dept/Role changes ──
  useEffect(() => {
    const handler = () => {
      _ratesCache.clear();
      _deptsCache = null;
      setGlobalSetCount(0);
      setOrgRefreshToken((t) => t + 1);
    };
    window.addEventListener("rmone:bustCache", handler);
    return () => window.removeEventListener("rmone:bustCache", handler);
  }, []);

  // Load department or division list based on the org grouping setting.
  useEffect(() => {
    let alive = true;
    setSelectedDept(""); // reset selection when grouping changes
    // Always re-fetch departments on mount so newly-created departments (added
    // via EditStaff or Organization page) appear without a full page reload.
    // Use the cached list only as an instant preview while the fetch is in-flight.
    if (_deptsCache && _deptsCache.grouping === orgGrouping) {
      setDepartments(_deptsCache.list);
    }
    _deptsCache = null; // invalidate so the fetch below always writes fresh data
    if (_busCache) setBusinessUnits(_busCache);
    // NOTE: do NOT call bustCache() here — it fires "rmone:bustCache" which
    // increments orgRefreshToken, which is in this effect's deps → infinite loop.
    const busPromise = getBusinessUnits().catch(() => [] as unknown[]);
    const loader = orgGrouping === "division"
      ? Promise.all([getDivisions(), busPromise]).then(([raw, bus]) => {
          const buByDivId = new Map<string, string>(
            (raw as { ID: number | string; BusinessUnitIdLookup: number | string | null }[])
              .map((d) => [String(d.ID).trim(), String(d.BusinessUnitIdLookup ?? "").trim()])
          );
          const opts = pickDepartments(
            (raw as { ID: number; Title: string; ShortName: string | null }[])
              .map((d) => ({ ID: d.ID, Title: d.ShortName || d.Title }))
          );
          setBusinessUnits(pickBusinessUnits(bus));
          _busCache = pickBusinessUnits(bus);
          return opts.map((d) => ({ ...d, buId: buByDivId.get(d.id) || undefined }));
        })
      : Promise.all([getDepartments(), getDivisions(), busPromise]).then(([depts, divs, bus]) => {
          const divMap = new Map<string, string>(
            (divs as { ID: number | string; Title: string }[])
              .map((d) => [String(d.ID).trim(), d.Title])
          );
          const buByDivId = new Map<string, string>(
            (divs as { ID: number | string; BusinessUnitIdLookup: number | string | null }[])
              .map((d) => [String(d.ID).trim(), String(d.BusinessUnitIdLookup ?? "").trim()])
          );
          setBusinessUnits(pickBusinessUnits(bus));
          _busCache = pickBusinessUnits(bus);
          setDivNameById(divMap);
          const opts = disambiguateDepts(pickDepartments(depts as unknown[]), divMap);
          return opts.map((d) => ({ ...d, buId: d.divisionId ? buByDivId.get(d.divisionId) || undefined : undefined }));
        });
    loader
      .then((opts) => {
        if (!alive) return;
        _deptsCache = { grouping: orgGrouping, list: opts };
        setDepartments(opts);
      })
      .catch(() => { /* picker stays empty — company-wide still works */ });
    return () => { alive = false; };
  }, [orgGrouping, orgRefreshToken]); // eslint-disable-line react-hooks/exhaustive-deps

  // Reset the division sub-filter whenever the BU filter or grouping changes.
  useEffect(() => { setRateDivFilter("All"); }, [rateBuFilter, orgGrouping]);

  // (Re)load rows whenever the department scope changes.
  useEffect(() => {
    let alive = true;
    const key = selectedDept || "";
    const cached = _ratesCache.get(key);
    if (cached) {
      // Show cached data immediately — no spinner shown.
      hydrate(cached, key);
      setLoading(false);
    } else {
      setLoading(true);
    }
    // Always re-fetch in background to keep data fresh.
    // Race with a 20s timeout so a stalled RDS/upstream connection never
    // strands the user on the loading splash indefinitely.
    ratesFetchPendingRef.current = true;
    const timeout = new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error("Loading timed out — please try again.")), 20_000),
    );
    Promise.race([getRoleBillingRates(selectedDept || undefined), timeout])
      .then((payload: BillingRatesPayload) => {
        if (!alive) return;
        hydrate(payload.rates, key);
      })
      .catch((e) => {
        if (!alive) return;
        // Always show the error and clear the overlay even when cached data
        // exists, so a timed-out refresh doesn't silently hold the splash.
        toast({ title: "Failed to load billing rates", description: String(e), variant: "destructive" });
      })
      .finally(() => { if (alive) { ratesFetchPendingRef.current = false; setLoading(false); } });
    return () => { alive = false; };
  }, [selectedDept, orgRefreshToken]); // eslint-disable-line react-hooks/exhaustive-deps

  // Every role from the catalogue is listed directly in the table as a
  // placeholder row (no rate yet, synthetic "new:" id). Typing a rate into one
  // and saving creates the real role on the fly (see saveAll). Catalogue roles
  // already present as real rows are skipped so they aren't duplicated.
  const catalogRows = useMemo(() => {
    const existing = new Set(rows.map((r) => r.name.trim().toLowerCase()));
    const seen = new Set<string>();
    const out: RoleBillingRate[] = [];
    for (const name of ROLE_CATALOG) {
      const key = name.trim().toLowerCase();
      if (!key || existing.has(key) || seen.has(key)) continue;
      seen.add(key);
      out.push({ id: `new:${key}`, name: name.trim(), billingRate: null });
    }
    return out;
  }, [rows]);

  const allRows = useMemo(() => [...rows, ...catalogRows], [rows, catalogRows]);

  const filtered = useMemo(() => {
    const q = filter.trim().toLowerCase();
    const hasAnyRate = (r: RoleBillingRate) =>
      r.billingRate != null || r.laborRate != null || r.costRate != null;
    return allRows
      .filter((r) => !q || r.name.toLowerCase().includes(q))
      .sort((a, b) => {
        const aSet = hasAnyRate(a) ? 0 : 1;
        const bSet = hasAnyRate(b) ? 0 : 1;
        if (aSet !== bSet) return aSet - bSet;
        return a.name.localeCompare(b.name);
      });
  }, [allRows, filter]);

  const setCount = useMemo(() => allRows.filter((r) => r.billingRate != null).length, [allRows]);

  // ── ?editRole= deep link (from the Team grid's "Set" button) ──────────────
  // Once rows have loaded, find the target role's row, highlight it and focus
  // its billing-rate input. If no row matches (role not in the tenant list,
  // catalogue, or unmatched set), fall back to pre-filling the add-role box.
  useEffect(() => {
    const raw = editRoleTargetRef.current;
    if (!raw || loading || allRows.length === 0) return;
    const q = raw.toLowerCase();
    const match =
      allRows.find((r) => r.name.trim().toLowerCase() === q) ??
      allRows.find((r) => r.name.trim().toLowerCase().includes(q));
    if (!match) {
      // No match yet — if this wave came from the (possibly stale) module cache
      // and a fresh fetch is still in flight, keep the target armed and let the
      // fresh row list decide. Only conclude "unknown role" on settled data.
      if (ratesFetchPendingRef.current) return;
      editRoleTargetRef.current = ""; // one-shot
      // Unknown role — clear the (now useless) row filter and offer to add it.
      setFilter("");
      setNewRoleName(raw);
      setSuggestOpen(true);
      setTimeout(() => addBoxRef.current?.scrollIntoView({ behavior: "smooth", block: "center" }), 300);
      return;
    }
    // On first mount `rows` is still empty, so allRows is catalogue-only and a
    // "new:" placeholder can match even though the tenant's real/unmatched row
    // (stable id) is about to arrive. Don't consume the one-shot on a
    // placeholder match while a fetch is pending — wait for the real rows.
    if (match.id.startsWith("new:") && ratesFetchPendingRef.current) return;
    editRoleTargetRef.current = ""; // one-shot
    setHighlightRowId(match.id);
    // Wait a tick so the filtered table has rendered the row before focusing.
    setTimeout(() => {
      const sel = `[data-testid="${`billing-rate-input-${match.id}`.replace(/["\\]/g, "\\$&")}"]`;
      const el = document.querySelector<HTMLInputElement>(sel);
      if (el) {
        el.scrollIntoView({ behavior: "smooth", block: "center" });
        el.focus({ preventScroll: true });
      }
    }, 250);
  }, [allRows, loading]); // eslint-disable-line react-hooks/exhaustive-deps

  // Clear the deep-link highlight after a few seconds. Kept as a SEPARATE
  // effect keyed on highlightRowId: the background rates refetch changes
  // allRows' identity, and a timer owned by the effect above would be
  // cancelled by that re-run — leaving the green tint stuck forever.
  useEffect(() => {
    if (!highlightRowId) return;
    const t = setTimeout(() => setHighlightRowId(null), 5000);
    return () => clearTimeout(t);
  }, [highlightRowId]);

  // Rows whose draft differs from the saved value (computed across ALL rows, not
  // just the filtered view, so a hidden edited row is still saved).
  const dirtyRows = useMemo(
    () => allRows.filter((r) => (drafts[r.id] ?? "").trim() !== fmtRate(r.billingRate)),
    [allRows, drafts],
  );

  // Combobox suggestions: the catalogue of common role names PLUS any existing
  // tenant roles not already in the catalogue, filtered by what the user typed.
  // We only suggest AS the user types (no full-catalogue dump on focus) so the
  // common path is "type the role and add it". Already-listed roles are tagged so
  // the user knows selecting one just edits its rate. Case-insensitive, capped.
  const existingNames = useMemo(
    () => new Set(rows.map((r) => r.name.trim().toLowerCase())),
    [rows],
  );
  const suggestions = useMemo(() => {
    const q = newRoleName.trim().toLowerCase();
    if (!q) return [] as string[]; // nothing typed → no dropdown
    const seen = new Set<string>();
    const all: string[] = [];
    for (const n of [...ROLE_CATALOG, ...rows.map((r) => r.name)]) {
      const key = n.trim().toLowerCase();
      if (!key || seen.has(key)) continue;
      seen.add(key);
      all.push(n.trim());
    }
    return all
      .filter((n) => n.toLowerCase().includes(q))
      .sort((a, b) => a.localeCompare(b))
      .slice(0, 60);
  }, [rows, newRoleName]);

  const newNameKey = newRoleName.trim().toLowerCase();
  const newNameExists = newNameKey !== "" && existingNames.has(newNameKey);

  // Close the suggestion dropdown on an outside click.
  useEffect(() => {
    if (!suggestOpen) return;
    function onDocClick(e: MouseEvent) {
      if (addBoxRef.current && !addBoxRef.current.contains(e.target as Node)) {
        setSuggestOpen(false);
      }
    }
    document.addEventListener("mousedown", onDocClick);
    return () => document.removeEventListener("mousedown", onDocClick);
  }, [suggestOpen]);

  // Pending "this role already has a different rate" confirmation for the
  // manual Add flow. Set instead of writing when the typed rate differs from
  // the explicitly-stored rate at the current scope; the popup's "Replace
  // rate" button calls performAdd with these values.
  const [confirmAdd, setConfirmAdd] = useState<{ name: string; rate: number; existingRate: number } | null>(null);

  async function addRole() {
    if (adding || !canEdit) return;
    const name = newRoleName.trim();
    if (!name) {
      toast({ title: "Enter a role name", description: "Type or pick a role to add.", variant: "destructive" });
      return;
    }

    // Validate the optional rate before any write.
    const rawRate = newRoleRate.trim();
    let rate: number | null = null;
    if (rawRate !== "") {
      const n = Number(rawRate);
      if (Number.isNaN(n) || n < 0) {
        toast({ title: "Enter a valid rate", description: "Billing rate must be a non-negative number.", variant: "destructive" });
        return;
      }
      rate = n;
    }

    // If this role already has an explicitly-stored billing rate at the
    // CURRENT scope and the typed rate differs, confirm before overwriting.
    // (In dept scope billingRate is the dept override — null means the role
    // only inherits the company-wide default, which is not a conflict.)
    if (rate != null) {
      const existing = rows.find((r) =>
        !r.id.startsWith("new:") && !r.id.startsWith("unmatched:") &&
        r.name.trim().toLowerCase() === name.toLowerCase());
      if (existing && existing.billingRate != null && Math.abs(existing.billingRate - rate) >= 0.005) {
        setConfirmAdd({ name, rate, existingRate: existing.billingRate });
        return;
      }
    }

    await performAdd(name, rate);
  }

  async function performAdd(name: string, rate: number | null) {
    if (adding || !canEdit) return;
    setAdding(true);
    try {
      // createRole is idempotent — returns the existing role if the name already
      // exists (case-insensitive), so this both adds new roles and re-targets an
      // existing one for a rate edit.
      const role = await createRole(name);
      const isNew = !rows.some((r) => r.id === role.id);

      // Reflect the created/looked-up role immediately. Append only when it is
      // genuinely new; never touch an existing row's rate or draft here (so a
      // blank-rate add on an existing role can't mark it dirty as a stray clear).
      if (isNew) {
        setRows((prev) => prev.some((r) => r.id === role.id)
          ? prev
          : [...prev, { id: role.id, name: role.name, billingRate: null }]);
        setDrafts((prev) => ({ ...prev, [role.id]: "" }));
      }

      // Persist the rate as a separate step so a rate-save failure still leaves
      // the freshly-created role visible in the list.
      if (rate != null) {
        await saveRoleBillingRate(role.id, rate, selectedDept || undefined);
        setRows((prev) => prev.map((r) => (r.id === role.id ? { ...r, billingRate: rate } : r)));
        setDrafts((prev) => ({ ...prev, [role.id]: fmtRate(rate) }));
      }

      const scope = deptName ? ` for ${deptName}` : "";
      toast({
        title: isNew ? "Role added" : "Role updated",
        description: rate == null
          ? (isNew ? `${role.name} added (no rate yet)` : `${role.name} already exists`)
          : `${role.name} → $${rate.toFixed(2)}/hr${scope}`,
      });
      setNewRoleName("");
      setNewRoleRate("");
      setSuggestOpen(false);
      setFilter("");
    } catch (e) {
      toast({ title: "Couldn't add role", description: String(e), variant: "destructive" });
    } finally {
      setAdding(false);
    }
  }

  async function saveLaborOne(row: RoleBillingRate) {
    if (savingLaborId || !canEdit) return;
    const raw = (laborDrafts[row.id] ?? "").trim();
    let value: number | null = null;
    if (raw !== "") {
      const n = Number(raw);
      if (Number.isNaN(n) || n < 0) {
        toast({ title: "Enter a valid rate", description: `${row.name}: labor rate must be a non-negative number.`, variant: "destructive" });
        return;
      }
      value = n;
    }
    if (row.id.startsWith("new:") || row.id.startsWith("unmatched:")) { toast({ title: "Save billing rate first", description: "Add the role before setting its labor rate." }); return; }
    setSavingLaborId(row.id);
    const scope = deptName ? ` for ${deptName}` : "";
    try {
      if (selectedDept) {
        await saveRoleRatesByDept(row.id, selectedDept, { laborRate: value });
      } else {
        await saveRoleRates(row.id, { laborRate: value });
      }
      setRows((prev) => prev.map((r) => r.id === row.id ? { ...r, laborRate: value } : r));
      setLaborDrafts((prev) => ({ ...prev, [row.id]: fmtRate(value) }));
      toast({ title: "Saved", description: `${row.name} labor rate → ${value == null ? "cleared" : `$${value.toFixed(2)}/hr`}${scope}` });
    } catch (e) {
      toast({ title: "Save failed", description: String(e), variant: "destructive" });
    } finally { setSavingLaborId(null); }
  }

  async function saveCostOne(row: RoleBillingRate) {
    if (savingCostId || !canEdit) return;
    const raw = (costDrafts[row.id] ?? "").trim();
    let value: number | null = null;
    if (raw !== "") {
      const n = Number(raw);
      if (Number.isNaN(n) || n < 0) {
        toast({ title: "Enter a valid rate", description: `${row.name}: cost rate must be a non-negative number.`, variant: "destructive" });
        return;
      }
      value = n;
    }
    if (row.id.startsWith("new:") || row.id.startsWith("unmatched:")) { toast({ title: "Save billing rate first", description: "Add the role before setting its cost rate." }); return; }
    setSavingCostId(row.id);
    const scope = deptName ? ` for ${deptName}` : "";
    try {
      if (selectedDept) {
        await saveRoleRatesByDept(row.id, selectedDept, { costRate: value });
      } else {
        await saveRoleRates(row.id, { costRate: value });
      }
      setRows((prev) => prev.map((r) => r.id === row.id ? { ...r, costRate: value } : r));
      setCostDrafts((prev) => ({ ...prev, [row.id]: fmtRate(value) }));
      toast({ title: "Saved", description: `${row.name} cost rate → ${value == null ? "cleared" : `$${value.toFixed(2)}/hr`}${scope}` });
    } catch (e) {
      toast({ title: "Save failed", description: String(e), variant: "destructive" });
    } finally { setSavingCostId(null); }
  }

  async function saveOne(row: RoleBillingRate) {
    if (saving || savingOneId || !canEdit) return;
    const raw = (drafts[row.id] ?? "").trim();
    let value: number | null = null;
    if (raw !== "") {
      const n = Number(raw);
      if (Number.isNaN(n) || n < 0) {
        toast({ title: "Enter a valid rate", description: `${row.name}: billing rate must be a non-negative number.`, variant: "destructive" });
        return;
      }
      value = n;
    }
    setSavingOneId(row.id);
    try {
      if (row.id.startsWith("new:") || row.id.startsWith("unmatched:")) {
        if (value == null) return;
        const role = await createRole(row.name);
        await saveRoleBillingRate(role.id, value, selectedDept || undefined);
        setRows((prev) =>
          prev.some((r) => r.id === role.id)
            ? prev.map((r) => (r.id === role.id ? { ...r, billingRate: value } : r))
            : prev.map((r) => r.id === row.id ? { ...r, id: role.id, billingRate: value } : r),
        );
        setDrafts((prev) => {
          const next = { ...prev };
          delete next[row.id];
          next[role.id] = fmtRate(value);
          return next;
        });
      } else {
        await saveRoleBillingRate(row.id, value, selectedDept || undefined);
        setRows((prev) => prev.map((r) => (r.id === row.id ? { ...r, billingRate: value } : r)));
        setDrafts((prev) => ({ ...prev, [row.id]: fmtRate(value) }));
      }
      const scope = deptName ? ` for ${deptName}` : "";
      toast({
        title: "Saved",
        description: `${row.name} → ${value == null ? "rate cleared" : `$${value.toFixed(2)}/hr${scope}`}`,
      });
      returnAfterSave();
    } catch (e) {
      toast({ title: "Save failed", description: String(e), variant: "destructive" });
    } finally {
      setSavingOneId(null);
    }
  }

  async function saveAll() {
    if (saving || !canEdit || dirtyRows.length === 0) return;

    // Validate everything first so one bad value doesn't leave a half-saved set.
    const updates: { row: RoleBillingRate; value: number | null }[] = [];
    for (const row of dirtyRows) {
      const raw = (drafts[row.id] ?? "").trim();
      let value: number | null = null;
      if (raw !== "") {
        const n = Number(raw);
        if (Number.isNaN(n) || n < 0) {
          toast({ title: "Enter a valid rate", description: `${row.name}: billing rate must be a non-negative number.`, variant: "destructive" });
          return;
        }
        value = n;
      }
      updates.push({ row, value });
    }

    setSaving(true);
    // Persist sequentially, tracking which rows actually committed so a mid-batch
    // failure leaves the UI consistent: saved rows reflect their new value (and
    // their draft is normalized), un-saved rows keep the user's pending edits.
    // Placeholder catalogue rows ("new:" id) are materialised via createRole
    // first, then their virtual draft key is swapped for the real role id.
    const savedExisting: { id: string; value: number | null }[] = [];
    const created: { virtualId: string; id: string; name: string; value: number | null }[] = [];
    let failure: { name: string; error: string } | null = null;
    for (const u of updates) {
      try {
        if (u.row.id.startsWith("new:") || u.row.id.startsWith("unmatched:")) {
          // Clearing a not-yet-created role is a no-op (nothing to persist).
          if (u.value == null) continue;
          const role = await createRole(u.row.name);
          await saveRoleBillingRate(role.id, u.value, selectedDept || undefined);
          created.push({ virtualId: u.row.id, id: role.id, name: role.name, value: u.value });
        } else {
          await saveRoleBillingRate(u.row.id, u.value, selectedDept || undefined);
          savedExisting.push({ id: u.row.id, value: u.value });
        }
      } catch (e) {
        failure = { name: u.row.name, error: String(e) };
        break;
      }
    }

    const savedCount = savedExisting.length + created.length;
    if (savedCount > 0) {
      setRows((prev) => {
        let next = prev.map((r) => {
          const s = savedExisting.find((x) => x.id === r.id);
          return s ? { ...r, billingRate: s.value } : r;
        });
        // Promote newly-created placeholder rows into real rows (which also
        // removes them from the catalogue placeholders, since their name now
        // exists as a real row).
        for (const c of created) {
          if (!next.some((r) => r.id === c.id)) {
            next = [...next, { id: c.id, name: c.name, billingRate: c.value }];
          }
        }
        return next;
      });
      // Normalize committed drafts so numeric-equivalent input (e.g. "1.00")
      // no longer registers as unsaved; re-key created rows off the real id.
      setDrafts((prev) => {
        const next = { ...prev };
        for (const s of savedExisting) next[s.id] = fmtRate(s.value);
        for (const c of created) {
          delete next[c.virtualId];
          next[c.id] = fmtRate(c.value);
        }
        return next;
      });
    }

    if (failure) {
      toast({
        title: "Save failed",
        description: `${failure.name}: ${failure.error}${savedCount > 0 ? ` (${savedCount} saved before the error)` : ""}`,
        variant: "destructive",
      });
    } else {
      const only = savedExisting[0] ?? created[0];
      toast({
        title: "Saved",
        description: savedCount === 1
          ? `${updates[0].row.name} → ${only.value == null ? "rate cleared" : `$${only.value.toFixed(2)}/hr`}`
          : `${savedCount} billing rates updated`,
      });
      if (savedCount > 0) returnAfterSave();
    }
    setSaving(false);
  }

  async function confirmDelete(roleId: string, roleName: string) {
    if (deletingId || !canEdit) return;
    setDeletingId(roleId);
    setConfirmDeleteId(null);
    try {
      await deleteRole(roleId);
      setRows((prev) => prev.filter((r) => r.id !== roleId));
      setDrafts((prev) => { const next = { ...prev }; delete next[roleId]; return next; });
      toast({ title: "Role deleted", description: `${roleName} and all its billing rate overrides have been removed.` });
    } catch (e) {
      toast({ title: "Could not delete role", description: String(e), variant: "destructive" });
    } finally {
      setDeletingId(null);
    }
  }

  // Show the processing popup only on the very first load (no cache).
  const showOverlay = loading && rows.length === 0;

  return (
    <div className={embedded ? "" : "p-6 max-w-4xl mx-auto"}>
      {showOverlay && (
        <RmOneProcessing
          label="Loading rates…"
          sublabel="FETCHING BILLING DATA"
          stages={["Connecting to data", "Loading roles", "Fetching billing rates", "Applying dept overrides", "Ready"]}
        />
      )}
      {!embedded && (
        <div className="flex items-start justify-between gap-4 mb-1">
          <h1 className="text-[22px] font-semibold">Billing Rates</h1>
          <div style={{ display: "flex", alignItems: "center", gap: 8, flexShrink: 0, marginTop: 2 }}>
            <button
              disabled={billingDownloading}
              onClick={async () => {
                setBillingDownloading(true);
                try { await downloadRateCard(); }
                catch (e) { console.error("Rate card download failed", e); }
                finally { setBillingDownloading(false); }
              }}
              style={{ display: "flex", alignItems: "center", gap: 6, padding: "6px 14px", borderRadius: 7, fontSize: 12, fontWeight: 600, background: "var(--rm-panel)", border: "1px solid var(--rm-panel-border)", color: "var(--rm-text-muted)", cursor: billingDownloading ? "not-allowed" : "pointer", opacity: billingDownloading ? 0.7 : 1 }}
              onMouseEnter={e => { if (!billingDownloading) e.currentTarget.style.color = "var(--rm-text)"; }}
              onMouseLeave={e => { e.currentTarget.style.color = "var(--rm-text-muted)"; }}
              title="Download Rate Card template (Excel)"
            >
              {billingDownloading
                ? <><Loader2 size={13} style={{ animation: "spin 1s linear infinite" }} /> Downloading…</>
                : <><Download size={13} /> Download template</>}
            </button>
            <button
              onClick={() => billingFileRef.current?.click()}
              disabled={billingUploading}
              style={{ display: "flex", alignItems: "center", gap: 6, padding: "6px 14px", borderRadius: 7, fontSize: 12, fontWeight: 600, background: "#6BA539", border: "none", color: "#fff", cursor: billingUploading ? "not-allowed" : "pointer", opacity: billingUploading ? 0.7 : 1 }}
              title="Upload an Excel Rate Card file"
            >
              {billingUploading ? <Loader2 size={13} style={{ animation: "spin 1s linear infinite" }} /> : <Upload size={13} />}
              {billingUploading ? "Uploading…" : "Upload File"}
            </button>
            <input
              ref={billingFileRef}
              type="file"
              accept=".xlsx,.xls,.csv"
              style={{ display: "none" }}
              onChange={async (e) => {
                const file = e.target.files?.[0];
                e.target.value = "";
                if (!file) return;
                setBillingUploading(true);
                setBillingMsg(null);
                try {
                  const pv = await previewRateCard(file);
                  const conflicts = pv.rows.filter(r => r.status === "conflict");
                  if (conflicts.length > 0) {
                    setBillingReview({ preview: pv, decisions: Object.fromEntries(conflicts.map(c => [c.idx, true])) });
                    return;
                  }
                  const actionable = pv.rows.filter(r => r.status !== "unchanged");
                  if (actionable.length === 0) {
                    const extra = pv.warnings.length ? ` Notes: ${pv.warnings.slice(0, 2).join("; ")}` : "";
                    setBillingMsg({ ok: true, text: "No changes — every rate in the file matches what's already saved." + extra });
                    return;
                  }
                  const res = await applyRateCard(actionable.map(toRateApplyRow));
                  setBillingMsg(rateCardSummaryMsg(res, pv, 0));
                  // Refresh so the table shows the newly-applied values.
                  _ratesCache.clear();
                  setOrgRefreshToken((t) => t + 1);
                } catch (err: unknown) {
                  const friendly = (err as { friendlyMessage?: string })?.friendlyMessage;
                  setBillingMsg({ ok: false, text: friendly || (err instanceof Error ? err.message : "Upload failed.") });
                } finally {
                  setBillingUploading(false);
                }
              }}
            />
          </div>
        </div>
      )}
      {!embedded && (
        <p className="text-[13px] text-muted-foreground mb-3">
          The hourly billing rate charged to clients for each role. Rates can vary by
          department — pick a department to set rates specific to it, or keep the
          company-wide default. Rates auto-filled from your onboarding default appear
          here too; edit any value to override it.
        </p>
      )}
      {!embedded && billingMsg && (
        <div style={{ marginBottom: 16, padding: "8px 14px", borderRadius: 7, fontSize: 12, fontWeight: 500, background: billingMsg.ok ? "#f0fce8" : "#fff0f0", color: billingMsg.ok ? "#3a7d18" : "#c0392b", border: `1px solid ${billingMsg.ok ? "#b3e89a" : "#f5c6c6"}` }}>
          {billingMsg.text}
          <button onClick={() => setBillingMsg(null)} style={{ float: "right", background: "none", border: "none", cursor: "pointer", fontSize: 14, lineHeight: 1, color: "inherit", opacity: 0.6 }}>×</button>
        </div>
      )}

      <div className="rounded-xl p-4 mb-4" style={{ backgroundColor: PANEL_BG, border: `1px solid ${BORDER}` }}>
        <div className="flex flex-wrap gap-3 items-center">
          {/* Dept / Division toggle — locked once any rate is saved */}
          <div className="flex flex-col gap-1">
            <div
              className="flex items-center gap-1 rounded-lg p-0.5"
              style={{
                background: INPUT_BG,
                border: `1px solid ${BORDER}`,
                opacity: globalSetCount > 0 ? 0.55 : 1,
                cursor: globalSetCount > 0 ? "not-allowed" : "auto",
              }}
              title={globalSetCount > 0 ? `Locked — rates already saved under ${orgGrouping === "division" ? "divisions" : "departments"}. Clear all rates to switch.` : undefined}
            >
              {(["department", "division"] as const).map((g) => (
                <button
                  key={g}
                  disabled={globalSetCount > 0}
                  onClick={() => { if (orgGrouping !== g) toggleOrgGrouping(); }}
                  className="px-3 py-1 rounded-md text-[11px] font-bold uppercase tracking-wide transition-all"
                  style={{
                    background: orgGrouping === g ? BRAND_GREEN : "transparent",
                    color: orgGrouping === g ? "#fff" : "var(--color-muted-foreground)",
                    cursor: globalSetCount > 0 ? "not-allowed" : "pointer",
                  }}
                >
                  {g === "department" ? "Dept" : "Division"}
                </button>
              ))}
            </div>
            {globalSetCount > 0 && (
              <span className="text-[10px] text-muted-foreground">
                🔒 Locked — clear all rates to switch
              </span>
            )}
          </div>
          {/* Cascading BU → Division scope filter — same pattern used on
              Projects/Opportunities/Leads and Staff/Timeline. */}
          {buOptionsForFilter.length > 0 && (
            <label className="flex items-center gap-2 text-[12px] font-bold uppercase tracking-wider">
              BU
              <div className="relative">
                <select
                  value={rateBuFilter}
                  onChange={(e) => setRateBuFilter(e.target.value)}
                  className="appearance-none rounded-md pl-2.5 pr-8 py-1.5 text-[13px] normal-case tracking-normal border"
                  style={{ backgroundColor: INPUT_BG, borderColor: INPUT_BORDER, minWidth: 150 }}
                  data-testid="billing-rates-bu-filter"
                >
                  <option value="All">All</option>
                  {buOptionsForFilter.map((b) => (
                    <option key={b.id} value={b.id}>{b.name}</option>
                  ))}
                </select>
                <span className="pointer-events-none absolute inset-y-0 right-2 flex items-center text-muted-foreground">▾</span>
              </div>
            </label>
          )}
          {orgGrouping === "department" && divOptionsForFilter.length > 0 && (
            <label className="flex items-center gap-2 text-[12px] font-bold uppercase tracking-wider">
              Division
              <div className="relative">
                <select
                  value={rateDivFilter}
                  onChange={(e) => setRateDivFilter(e.target.value)}
                  className="appearance-none rounded-md pl-2.5 pr-8 py-1.5 text-[13px] normal-case tracking-normal border"
                  style={{ backgroundColor: INPUT_BG, borderColor: INPUT_BORDER, minWidth: 150 }}
                  data-testid="billing-rates-division-filter"
                >
                  <option value="All">All</option>
                  {divOptionsForFilter.map((d) => (
                    <option key={d.id} value={d.id}>{d.name}</option>
                  ))}
                </select>
                <span className="pointer-events-none absolute inset-y-0 right-2 flex items-center text-muted-foreground">▾</span>
              </div>
            </label>
          )}
          <label className="flex items-center gap-2 text-[12px] font-bold uppercase tracking-wider">
            {orgGrouping === "division" ? "Division" : "Department"}
            <div className="relative">
              <select
                value={selectedDept}
                onChange={(e) => setSelectedDept(e.target.value)}
                className="appearance-none rounded-md pl-2.5 pr-8 py-1.5 text-[13px] normal-case tracking-normal border"
                style={{ backgroundColor: INPUT_BG, borderColor: INPUT_BORDER, minWidth: 200 }}
                data-testid="billing-rates-department"
              >
                <option value="">Company-wide (default)</option>
                {filteredDepartments.map((d) => (
                  <option key={d.id} value={d.id}>{d.name}</option>
                ))}
              </select>
              <span className="pointer-events-none absolute inset-y-0 right-2 flex items-center text-muted-foreground">▾</span>
            </div>
          </label>
          <span className="text-[12px] font-semibold uppercase tracking-wider flex items-center gap-1.5">
            {loading
              ? <Loader2 size={14} className="animate-spin text-muted-foreground" />
              : `${rows.length} roles · ${setCount} with a rate`}
          </span>
          <input
            type="search"
            placeholder="Filter roles…"
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
            className="rounded-md px-3 py-1.5 text-[13px] border ml-auto"
            style={{ backgroundColor: INPUT_BG, borderColor: INPUT_BORDER, minWidth: 220 }}
            data-testid="billing-rates-filter"
          />
        </div>
        {selectedDept && (
          <p className="text-[11px] text-muted-foreground mt-2.5">
            Editing rates for <span style={{ color: BRAND_GREEN }}>{deptName}</span>.
            Roles without a {orgGrouping === "division" ? "division" : "department"} rate fall back to the company-wide default
            (shown in grey).
          </p>
        )}
      </div>

      {!canEdit && (
        <p className="text-[12px] text-muted-foreground mb-3">
          Your access level does not allow editing billing, labor, or cost rates.
        </p>
      )}

      {canEdit && (
        <div
          ref={addBoxRef}
          className="rounded-xl p-4 mb-4"
          style={{ backgroundColor: PANEL_BG, border: `1px solid ${BORDER}` }}
        >
          <div className="text-[12px] font-bold uppercase tracking-wider mb-2.5">
            Add a role
          </div>
          <div className="flex flex-wrap items-start gap-3">
            {/* Role combobox: pick from the catalogue OR type a brand-new role. */}
            <div className="relative" style={{ minWidth: 280, flex: "1 1 280px" }}>
              <input
                type="text"
                placeholder="Type a role name to add…"
                value={newRoleName}
                onChange={(e) => { setNewRoleName(e.target.value); setSuggestOpen(e.target.value.trim() !== ""); }}
                onFocus={() => { if (newRoleName.trim() !== "") setSuggestOpen(true); }}
                onKeyDown={(e) => {
                  if (e.key === "Enter") { e.preventDefault(); addRole(); }
                  if (e.key === "Escape") setSuggestOpen(false);
                }}
                className="w-full rounded-md px-3 py-2 text-[13px] border"
                style={{ backgroundColor: INPUT_BG, borderColor: INPUT_BORDER }}
                disabled={adding}
                role="combobox"
                aria-expanded={suggestOpen}
                aria-autocomplete="list"
                autoComplete="off"
                data-testid="add-role-name"
              />
              {suggestOpen && suggestions.length > 0 && (
                <ul
                  className="absolute z-30 mt-1 w-full max-h-64 overflow-auto rounded-md py-1 shadow-lg"
                  style={{ backgroundColor: PANEL_BG, border: `1px solid ${BORDER}` }}
                  data-testid="add-role-suggestions"
                >
                  {suggestions.map((s) => {
                    const exists = existingNames.has(s.toLowerCase());
                    return (
                      <li key={s}>
                        <button
                          type="button"
                          onMouseDown={(e) => {
                            // onMouseDown (not onClick) so it fires before the
                            // input's blur / outside-click close.
                            e.preventDefault();
                            setNewRoleName(s);
                            setSuggestOpen(false);
                          }}
                          className="w-full text-left px-3 py-1.5 text-[13px] hover:bg-black/10 dark:hover:bg-white/10 flex items-center justify-between gap-2"
                        >
                          <span>{s}</span>
                          {exists && (
                            <span className="text-[11px] text-muted-foreground">already listed</span>
                          )}
                        </button>
                      </li>
                    );
                  })}
                </ul>
              )}
            </div>

            <div className="flex flex-col gap-0.5">
              <input
                type="text"
                inputMode="decimal"
                placeholder="Rate $/hr (optional)"
                value={newRoleRate}
                onChange={(e) => setNewRoleRate(e.target.value)}
                onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); if (!rateDraftInvalid(newRoleRate)) addRole(); } }}
                className="rounded-md px-3 py-2 text-[13px] border"
                style={{
                  backgroundColor: INPUT_BG,
                  borderColor: rateDraftInvalid(newRoleRate) ? INVALID_BORDER : INPUT_BORDER,
                  width: 170,
                }}
                disabled={adding}
                data-testid="add-role-rate"
              />
              {rateDraftInvalid(newRoleRate) && (
                <span className="text-[10px]" style={{ color: INVALID_BORDER }} data-testid="add-role-rate-error">
                  Enter a non-negative number
                </span>
              )}
            </div>

            <button
              type="button"
              onClick={addRole}
              disabled={adding || newRoleName.trim() === "" || rateDraftInvalid(newRoleRate)}
              className="rounded-md px-5 py-2 text-[13px] font-semibold transition-opacity disabled:opacity-40 disabled:cursor-not-allowed"
              style={{
                backgroundColor: !adding && newRoleName.trim() !== "" ? BRAND_GREEN : INPUT_BG,
                color: !adding && newRoleName.trim() !== "" ? "#0B1620" : "var(--color-muted-foreground)",
              }}
              data-testid="add-role-submit"
            >
              {adding ? "Adding…" : newNameExists ? "Update rate" : "Add role"}
            </button>
          </div>
          <p className="text-[11px] text-muted-foreground mt-2">
            {newNameExists
              ? "This role already exists — adding will update its billing rate."
              : "Pick a common role from the list or type any custom role name. New roles are created when you add them."}
          </p>
        </div>
      )}

      <div className="rounded-xl overflow-hidden" style={{ backgroundColor: PANEL_BG, border: `1px solid ${BORDER}` }}>
        <table className="w-full text-[13px]">
          <thead>
            <tr style={{ backgroundColor: INPUT_BG }}>
              <th className="text-left px-4 py-2 font-medium">Role</th>
              <th className="text-left px-4 py-2 font-medium">Classification</th>
              <th className="text-right px-4 py-2 font-medium">Billing rate ($/hr)</th>
              <th className="text-right px-4 py-2 font-medium">Labor rate ($/hr)</th>
              <th className="text-right px-4 py-2 font-medium">Cost rate ($/hr)</th>
              {canEdit && <th className="px-3 py-2" style={{ width: 110 }} />}
            </tr>
          </thead>
          <tbody>
            {!loading && filtered.length === 0 && (
              <tr><td colSpan={canEdit ? 6 : 5} className="px-4 py-6 text-center text-muted-foreground">No roles match.</td></tr>
            )}
            {filtered.map((r, i) => {
              const draft = drafts[r.id] ?? "";
              const isSet = r.billingRate != null;
              const dirty = draft.trim() !== fmtRate(r.billingRate);
              const isCatalogue = r.id.startsWith("new:");
              const isUnmatched = r.id.startsWith("unmatched:");
              const isConfirming = confirmDeleteId === r.id;
              const isDeleting = deletingId === r.id;
              return (
                <tr
                  key={r.id}
                  style={{
                    borderTop: i === 0 ? "none" : `1px solid ${BORDER}`,
                    // Deep-link target row (?editRole=) gets a brief green tint.
                    ...(highlightRowId === r.id
                      ? { backgroundColor: "rgba(107,165,57,0.14)", transition: "background-color 0.6s ease" }
                      : {}),
                  }}
                >
                  <td className="px-4 py-2.5">
                    {r.name}
                    {isUnmatched && (
                      <span className="ml-2 text-[10px] font-medium px-1.5 py-0.5 rounded-full bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-400">
                        used in projects
                      </span>
                    )}
                    {!isSet && selectedDept && r.defaultRate != null && (
                      <span className="ml-2 text-[11px] text-muted-foreground">
                        default ${r.defaultRate}/hr
                      </span>
                    )}
                    {!isSet && (!selectedDept || r.defaultRate == null) && !isUnmatched && (
                      <span className="ml-2 text-[11px] text-muted-foreground">not set</span>
                    )}
                    {dirty && (
                      <span className="ml-2 text-[11px]" style={{ color: BRAND_GREEN }}>• unsaved</span>
                    )}
                  </td>
                  <td className="px-4 py-2">
                    {(() => {
                      // Classification is keyed by the real role id, so it can only
                      // be set on saved roles. Placeholder catalogue / unmatched
                      // rows show a disabled hint until the role is created.
                      const isPlaceholder = isCatalogue || isUnmatched;
                      if (isPlaceholder) {
                        return (
                          <span className="text-[11px] text-muted-foreground" title="Add this role first, then set its classification">
                            add role first
                          </span>
                        );
                      }
                      const current = classifications[r.id] ?? "";
                      return (
                        <div className="flex items-center gap-1.5">
                          <select
                            value={current}
                            onChange={(e) => changeClassification(r.id, e.target.value as "" | RoleClassification)}
                            disabled={!canEdit || savingClassId != null}
                            className="rounded-md px-2 py-1 text-[12px] border"
                            style={{ backgroundColor: INPUT_BG, borderColor: INPUT_BORDER, color: current ? "var(--rm-text)" : "var(--rm-text-muted)" }}
                            title="Whether time on this role can be billed to clients"
                            data-testid={`role-classification-${r.id}`}
                          >
                            <option value="">—</option>
                            <option value="billable">Billable</option>
                            <option value="nonbillable">Non-billable</option>
                          </select>
                          {savingClassId === r.id && (
                            <Loader2 size={13} className="animate-spin text-muted-foreground" />
                          )}
                        </div>
                      );
                    })()}
                  </td>
                  <td className="px-4 py-2 text-right">
                    <div className="flex flex-col items-end gap-0.5">
                      <input
                        type="text"
                        inputMode="decimal"
                        placeholder="—"
                        value={draft}
                        onChange={(e) => setDrafts((prev) => ({ ...prev, [r.id]: e.target.value }))}
                        onKeyDown={(e) => { if (e.key === "Enter" && !rateDraftInvalid(draft)) saveAll(); }}
                        className="w-28 text-right rounded-md px-2 py-1 border"
                        style={{
                          backgroundColor: INPUT_BG,
                          borderColor: rateDraftInvalid(draft) ? INVALID_BORDER : INPUT_BORDER,
                          color: isSet ? BRAND_GREEN : "inherit",
                        }}
                        disabled={saving || !canEdit}
                        data-testid={`billing-rate-input-${r.id}`}
                      />
                      {rateDraftInvalid(draft) && (
                        <span className="text-[10px]" style={{ color: INVALID_BORDER }}>
                          Enter a non-negative number
                        </span>
                      )}
                    </div>
                  </td>
                  <td className="px-4 py-2 text-right">
                    {(() => {
                      const lDraft = laborDrafts[r.id] ?? "";
                      const lSet = r.laborRate != null;
                      const lDirty = lDraft.trim() !== fmtRate(r.laborRate ?? null);
                      return (
                        <div className="flex flex-col items-end gap-0.5">
                          {!lSet && selectedDept && r.defaultLaborRate != null && (
                            <span className="text-[10px] text-muted-foreground">default ${r.defaultLaborRate}/hr</span>
                          )}
                          <div className="flex items-center justify-end gap-1">
                            <input
                              type="text"
                              inputMode="decimal"
                              placeholder="—"
                              value={lDraft}
                              onChange={(e) => setLaborDrafts((prev) => ({ ...prev, [r.id]: e.target.value }))}
                              onKeyDown={(e) => { if (e.key === "Enter" && !rateDraftInvalid(lDraft)) saveLaborOne(r); }}
                              onBlur={() => { if (lDirty && !rateDraftInvalid(lDraft)) saveLaborOne(r); }}
                              className="w-24 text-right rounded-md px-2 py-1 border"
                              style={{
                                backgroundColor: INPUT_BG,
                                borderColor: rateDraftInvalid(lDraft) ? INVALID_BORDER : INPUT_BORDER,
                                color: lSet ? "#60a5fa" : "inherit",
                              }}
                              disabled={!canEdit || !!savingLaborId}
                            />
                            {lDirty && canEdit && !rateDraftInvalid(lDraft) && (
                              <button type="button" onClick={() => saveLaborOne(r)} disabled={!!savingLaborId}
                                className="flex items-center justify-center rounded-lg disabled:opacity-40"
                                style={{ width: 26, height: 26, background: "#3b82f6", border: "none", flexShrink: 0 }}>
                                {savingLaborId === r.id ? <Loader2 size={12} color="#fff" className="animate-spin" /> : <Check size={12} color="#fff" strokeWidth={2.5} />}
                              </button>
                            )}
                          </div>
                        </div>
                      );
                    })()}
                  </td>
                  <td className="px-4 py-2 text-right">
                    {(() => {
                      const cDraft = costDrafts[r.id] ?? "";
                      const cSet = r.costRate != null;
                      const cDirty = cDraft.trim() !== fmtRate(r.costRate ?? null);
                      return (
                        <div className="flex flex-col items-end gap-0.5">
                          {!cSet && selectedDept && r.defaultCostRate != null && (
                            <span className="text-[10px] text-muted-foreground">default ${r.defaultCostRate}/hr</span>
                          )}
                          <div className="flex items-center justify-end gap-1">
                          <input
                            type="text"
                            inputMode="decimal"
                            placeholder="—"
                            value={cDraft}
                            onChange={(e) => setCostDrafts((prev) => ({ ...prev, [r.id]: e.target.value }))}
                            onKeyDown={(e) => { if (e.key === "Enter" && !rateDraftInvalid(cDraft)) saveCostOne(r); }}
                            onBlur={() => { if (cDirty && !rateDraftInvalid(cDraft)) saveCostOne(r); }}
                            className="w-24 text-right rounded-md px-2 py-1 border"
                            style={{
                              backgroundColor: INPUT_BG,
                              borderColor: rateDraftInvalid(cDraft) ? INVALID_BORDER : INPUT_BORDER,
                              color: cSet ? "#f59e0b" : "inherit",
                            }}
                            disabled={!canEdit || !!savingCostId}
                          />
                          {cDirty && canEdit && !rateDraftInvalid(cDraft) && (
                            <button type="button" onClick={() => saveCostOne(r)} disabled={!!savingCostId}
                              className="flex items-center justify-center rounded-lg disabled:opacity-40"
                              style={{ width: 26, height: 26, background: "#f59e0b", border: "none", flexShrink: 0 }}>
                              {savingCostId === r.id ? <Loader2 size={12} color="#fff" className="animate-spin" /> : <Check size={12} color="#fff" strokeWidth={2.5} />}
                            </button>
                          )}
                        </div>
                        </div>
                      );
                    })()}
                  </td>
                  {canEdit && (
                    <td className="px-3 py-2">
                      <span className="flex items-center justify-end gap-1.5">
                        {/* Per-row save button — visible when this row has unsaved changes */}
                        {dirty && !rateDraftInvalid(draft) && (
                          <button
                            type="button"
                            title="Save this rate"
                            onClick={() => saveOne(r)}
                            disabled={saving || !!savingOneId}
                            className="flex items-center justify-center rounded-lg transition-all disabled:opacity-40 hover:scale-105 active:scale-95"
                            style={{
                              width: 32, height: 32, flexShrink: 0,
                              background: BRAND_GREEN,
                              boxShadow: "0 2px 8px rgba(107,165,57,0.45)",
                              border: "none",
                            }}
                          >
                            {savingOneId === r.id
                              ? <Loader2 size={15} color="#fff" className="animate-spin" />
                              : <Check size={15} color="#fff" strokeWidth={2.5} />}
                          </button>
                        )}
                        {/* Delete button — only for real (non-catalogue) rows */}
                        {!isCatalogue && (
                          isConfirming ? (
                            <>
                              <button
                                type="button"
                                onClick={() => confirmDelete(r.id, r.name)}
                                disabled={!!deletingId}
                                className="text-[11px] px-2 py-0.5 rounded"
                                style={{ background: "rgba(239,68,68,0.2)", color: "#f87171", border: "1px solid rgba(239,68,68,0.4)" }}
                              >
                                {isDeleting ? "…" : "Yes"}
                              </button>
                              <button
                                type="button"
                                onClick={() => setConfirmDeleteId(null)}
                                className="text-[11px] px-2 py-0.5 rounded text-muted-foreground hover:text-foreground"
                                style={{ border: `1px solid ${BORDER}` }}
                              >
                                No
                              </button>
                            </>
                          ) : (
                            <button
                              type="button"
                              title="Delete role"
                              onClick={() => setConfirmDeleteId(r.id)}
                              disabled={!!deletingId}
                              className="text-muted-foreground/50 hover:text-red-400 transition-colors text-[15px] leading-none disabled:opacity-30"
                            >
                              ×
                            </button>
                          )
                        )}
                      </span>
                    </td>
                  )}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {canEdit && (
        <div className="flex items-center justify-end gap-3 mt-4">
          <span className="text-[12px] text-muted-foreground">
            {dirtyRows.length === 0
              ? "No unsaved changes"
              : `${dirtyRows.length} unsaved ${dirtyRows.length === 1 ? "change" : "changes"}`}
          </span>
          <button
            type="button"
            onClick={saveAll}
            disabled={saving || dirtyRows.length === 0}
            className="rounded-md px-5 py-2 text-[13px] font-semibold transition-opacity disabled:opacity-40 disabled:cursor-not-allowed"
            style={{
              backgroundColor: dirtyRows.length > 0 && !saving ? BRAND_GREEN : INPUT_BG,
              color: dirtyRows.length > 0 && !saving ? "#0B1620" : "var(--color-muted-foreground)",
            }}
            data-testid="billing-rates-save-all"
          >
            {saving ? "Saving…" : "Save changes"}
          </button>
        </div>
      )}

      {/* Rate Card conflict review modal — same role + scope, different rate */}
      {!embedded && billingReview && (() => {
        const conflicts = billingReview.preview.rows.filter(r => r.status === "conflict");
        const includedCount = conflicts.filter(c => billingReview.decisions[c.idx]).length;
        const newCount = billingReview.preview.rows.filter(r => r.status === "new").length;
        const fmtR = (n: number | null) => (n == null ? "—" : `$${n}`);
        const FIELD_LABEL: Record<string, string> = { billing: "Billing", labor: "Labor", cost: "Cost" };
        const setAll = (v: boolean) => setBillingReview(prev => prev && ({ ...prev, decisions: Object.fromEntries(conflicts.map(c => [c.idx, v])) }));
        const setOne = (idx: number, v: boolean) => setBillingReview(prev => prev && ({ ...prev, decisions: { ...prev.decisions, [idx]: v } }));
        return (
          <div style={{ position: "fixed", inset: 0, zIndex: 60, background: "rgba(0,0,0,0.45)", display: "flex", alignItems: "center", justifyContent: "center" }}>
            <div style={{ background: "var(--rm-panel)", borderRadius: 12, padding: 24, maxWidth: 680, width: "94%", maxHeight: "84vh", display: "flex", flexDirection: "column", boxShadow: "var(--rm-shadow)" }}>
              <div style={{ fontSize: 16, fontWeight: 700, color: "var(--rm-text)" }}>Review rate changes</div>
              <div style={{ fontSize: 12, color: "var(--rm-text-muted)", margin: "6px 0 12px", lineHeight: 1.55 }}>
                {conflicts.length === 1 ? "1 row in your file has" : `${conflicts.length} rows in your file have`} a different
                rate than what's currently saved. Choose <b>Update</b> to use the file's rate or <b>Skip</b> to keep the existing one.
                {newCount > 0 ? ` ${newCount} other row${newCount === 1 ? "" : "s"} (new or previously blank rates) will be applied automatically.` : ""}
              </div>
              <div style={{ display: "flex", gap: 8, marginBottom: 8 }}>
                <button onClick={() => setAll(true)}  style={{ padding: "4px 12px", fontSize: 11, fontWeight: 700, borderRadius: 6, cursor: "pointer", border: "1px solid var(--rm-panel-border)", background: "var(--rm-panel-soft)", color: "var(--rm-text)" }}>Update all</button>
                <button onClick={() => setAll(false)} style={{ padding: "4px 12px", fontSize: 11, fontWeight: 700, borderRadius: 6, cursor: "pointer", border: "1px solid var(--rm-panel-border)", background: "var(--rm-panel-soft)", color: "var(--rm-text)" }}>Skip all</button>
              </div>
              <div style={{ overflowY: "auto", border: "1px solid var(--rm-panel-border)", borderRadius: 8, minHeight: 0 }}>
                <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12 }}>
                  <thead>
                    <tr style={{ position: "sticky", top: 0, background: "var(--rm-panel-soft)", zIndex: 1 }}>
                      {["Role", "Applies to", "Rate change", "Decision"].map(h => (
                        <th key={h} style={{ textAlign: "left", padding: "8px 10px", fontSize: 10.5, fontWeight: 700, textTransform: "uppercase", letterSpacing: 0.4, color: "var(--rm-text-muted)" }}>{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {conflicts.map(c => (
                      <tr key={c.idx} style={{ borderTop: "1px solid var(--rm-panel-border)" }}>
                        <td style={{ padding: "8px 10px", fontWeight: 600, color: "var(--rm-text)" }}>{c.roleName || c.roleId}</td>
                        <td style={{ padding: "8px 10px", color: "var(--rm-text-muted)" }}>{c.scope}</td>
                        <td style={{ padding: "8px 10px", color: "var(--rm-text)" }}>
                          {c.conflictFields.map(f => (
                            <div key={f} style={{ whiteSpace: "nowrap" }}>
                              {FIELD_LABEL[f]}: <span style={{ textDecoration: "line-through", opacity: 0.55 }}>{fmtR(c.existing?.[f] ?? null)}</span>
                              {" → "}<b>{fmtR(c.incoming[f])}</b>/hr
                            </div>
                          ))}
                        </td>
                        <td style={{ padding: "8px 10px", whiteSpace: "nowrap" }}>
                          <button onClick={() => setOne(c.idx, true)}  style={{ ...ratePillStyle(!!billingReview.decisions[c.idx], true), marginRight: 6 }}>Update</button>
                          <button onClick={() => setOne(c.idx, false)} style={ratePillStyle(!billingReview.decisions[c.idx], false)}>Skip</button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              {billingReview.preview.warnings.length > 0 && (
                <div style={{ fontSize: 11, color: "#b26a00", marginTop: 8, lineHeight: 1.5 }}>
                  {billingReview.preview.warnings.slice(0, 3).join(" · ")}
                </div>
              )}
              <div style={{ display: "flex", justifyContent: "flex-end", alignItems: "center", gap: 10, marginTop: 14 }}>
                <button
                  disabled={billingApplying}
                  onClick={() => { setBillingReview(null); setBillingMsg({ ok: true, text: "Upload cancelled — nothing was changed." }); }}
                  style={{ padding: "7px 16px", fontSize: 12, fontWeight: 700, borderRadius: 6, background: "var(--rm-panel-soft)", color: "var(--rm-text)", border: "1px solid var(--rm-panel-border)", cursor: billingApplying ? "not-allowed" : "pointer", opacity: billingApplying ? 0.6 : 1 }}
                >
                  Cancel upload
                </button>
                <button
                  disabled={billingApplying}
                  onClick={() => void applyBillingReview()}
                  style={{ display: "flex", alignItems: "center", gap: 6, padding: "7px 18px", fontSize: 12, fontWeight: 700, borderRadius: 6, background: "#6BA539", color: "#fff", border: "none", cursor: billingApplying ? "not-allowed" : "pointer", opacity: billingApplying ? 0.7 : 1 }}
                >
                  {billingApplying && <Loader2 size={13} style={{ animation: "spin 1s linear infinite" }} />}
                  {billingApplying
                    ? "Applying…"
                    : `Apply (${includedCount} update${includedCount === 1 ? "" : "s"}${newCount > 0 ? ` + ${newCount} new` : ""})`}
                </button>
              </div>
            </div>
          </div>
        );
      })()}

      {/* Confirm overwriting an existing rate from the manual Add flow */}
      {confirmAdd && (
        <div style={{ position: "fixed", inset: 0, zIndex: 60, background: "rgba(0,0,0,0.45)", display: "flex", alignItems: "center", justifyContent: "center" }}>
          <div style={{ background: PANEL_BG, borderRadius: 12, padding: 24, maxWidth: 420, width: "90%", boxShadow: "var(--rm-shadow)", border: `1px solid ${BORDER}` }}>
            <div style={{ fontSize: 15, fontWeight: 700, color: "var(--rm-text)", marginBottom: 8 }}>
              This role already has a rate
            </div>
            <div style={{ fontSize: 12.5, color: "var(--rm-text-muted)", lineHeight: 1.6, marginBottom: 16 }}>
              <b style={{ color: "var(--rm-text)" }}>{confirmAdd.name}</b> already has a billing rate of{" "}
              <b style={{ color: "var(--rm-text)" }}>${confirmAdd.existingRate.toFixed(2)}/hr</b>
              {deptName ? <> for <b style={{ color: "var(--rm-text)" }}>{deptName}</b></> : " company-wide"}.
              Replace it with <b style={{ color: "var(--rm-text)" }}>${confirmAdd.rate.toFixed(2)}/hr</b>?
            </div>
            <div style={{ display: "flex", justifyContent: "flex-end", gap: 10 }}>
              <button
                type="button"
                disabled={adding}
                onClick={() => {
                  setConfirmAdd(null);
                  toast({ title: "Kept the existing rate", description: `${confirmAdd.name} stays at $${confirmAdd.existingRate.toFixed(2)}/hr.` });
                }}
                style={{ padding: "7px 16px", fontSize: 12, fontWeight: 700, borderRadius: 6, background: INPUT_BG, color: "var(--rm-text)", border: `1px solid ${INPUT_BORDER}`, cursor: adding ? "not-allowed" : "pointer", opacity: adding ? 0.6 : 1 }}
              >
                Keep existing
              </button>
              <button
                type="button"
                disabled={adding}
                onClick={() => {
                  const c = confirmAdd;
                  setConfirmAdd(null);
                  void performAdd(c.name, c.rate);
                }}
                style={{ padding: "7px 18px", fontSize: 12, fontWeight: 700, borderRadius: 6, background: BRAND_GREEN, color: "#fff", border: "none", cursor: adding ? "not-allowed" : "pointer", opacity: adding ? 0.7 : 1 }}
              >
                {adding ? "Saving…" : "Replace rate"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
